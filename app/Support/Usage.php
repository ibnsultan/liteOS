<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

// Usage tracking for System Monitor (liteapps/docs/utilities-roadmap.md, System Monitor). The desktop
// (public/assets/js/usage.js) adds up, while someone is using it, how long each app, file and website was in front, and
// hands the server a minute's worth at a time. Kept: seconds per user, day, five minutes and app (usage_slots), and
// seconds per user, day and file or website (usage_items). Never what was done in them, and for a website only its
// name. Off until an administrator turns it on (SystemSettings usageTracking), kept usageKeepDays days, guests never.
class Usage
{
    /** The most one report may add: a few minutes of one desktop, with room for a late one. */
    private const MAX_SECONDS = 900;

    public static function on(): bool
    {
        return (bool) SystemSettings::get('usageTracking');
    }

    public static function records(User $user): bool
    {
        return self::on() && ! $user->isGuest();
    }

    /**
     * Adds what the desktop reports for one day.
     *
     * @param  array<string, mixed>  $report  { day: 'Y-m-d', slots: [{ slot, app, seconds }], items: [{ kind, app, item, seconds }] }
     *
     * @throws ValidationException
     */
    public static function add(User $user, array $report): bool
    {
        if (! self::records($user)) {
            return false;
        }
        $day = self::day($report['day'] ?? null);
        // the user's own calendar day: their clock may be a day either side of the server's, never further
        $today = Carbon::today();
        if ($day->lt($today->copy()->subDays(2)) || $day->gt($today->copy()->addDays(2))) {
            throw ValidationException::withMessages(['day' => 'That day can’t be recorded now.']);
        }
        $slots = [];
        $total = 0;
        foreach (array_slice((array) ($report['slots'] ?? []), 0, 64) as $s) {
            $slot = (int) ($s['slot'] ?? -1);
            $app = self::app($s['app'] ?? '');
            $sec = (int) ($s['seconds'] ?? 0);
            if ($slot < 0 || $slot > 287 || $app === '' || $sec <= 0) {
                continue;
            }
            $sec = min($sec, 300);
            $key = $slot.'|'.$app;
            $slots[$key] = ['slot' => $slot, 'app' => $app, 'seconds' => ($slots[$key]['seconds'] ?? 0) + $sec];
            $total += $sec;
        }
        if ($total > self::MAX_SECONDS) {
            throw ValidationException::withMessages(['slots' => 'That is more time than can have passed.']);
        }
        $items = [];
        foreach (array_slice((array) ($report['items'] ?? []), 0, 64) as $i) {
            $kind = (string) ($i['kind'] ?? '');
            $app = self::app($i['app'] ?? '');
            $sec = min((int) ($i['seconds'] ?? 0), self::MAX_SECONDS);
            $item = $kind === 'site' ? self::site($i['item'] ?? '') : ($kind === 'file' ? self::file($i['item'] ?? '') : '');
            if ($item === '' || $app === '' || $sec <= 0) {
                continue;
            }
            $hash = hash('sha256', $kind."\n".$app."\n".$item);
            $items[$hash] = ['kind' => $kind, 'app' => $app, 'item' => $item, 'item_hash' => $hash, 'seconds' => ($items[$hash]['seconds'] ?? 0) + $sec];
        }

        $d = $day->toDateString();
        DB::transaction(function () use ($user, $d, $slots, $items) {
            foreach ($slots as $s) {
                self::bump('usage_slots', ['user_id' => $user->id, 'day' => $d, 'slot' => $s['slot'], 'app' => $s['app']], $s['seconds']);
            }
            foreach ($items as $i) {
                self::bump('usage_items', ['user_id' => $user->id, 'day' => $d, 'item_hash' => $i['item_hash']], $i['seconds'], ['kind' => $i['kind'], 'app' => $i['app'], 'item' => $i['item']]);
            }
        });
        self::pruneDaily();

        return true;
    }

    /**
     * One user's usage from one day to another (inclusive): seconds per day and app, the day's five-minute slots when
     * it is one day, and the files and websites over the whole stretch, most time first.
     *
     * @return array{from: string, to: string, days: array<string, array<string, int>>, slots: list<array{slot: int, app: string, seconds: int}>, items: list<array{kind: string, app: string, item: string, seconds: int}>}
     *
     * @throws ValidationException
     */
    public static function get(User $user, string $from, string $to): array
    {
        $range = self::range($from, $to);
        $days = [];
        foreach (DB::table('usage_slots')->where('user_id', $user->id)->whereBetween('day', $range)
            ->select('day', 'app', DB::raw('SUM(seconds) as seconds'))->groupBy('day', 'app')->get() as $r) {
            $days[substr((string) $r->day, 0, 10)][$r->app] = (int) $r->seconds;
        }
        $slots = [];
        if ($range[0] === $range[1]) {
            $slots = DB::table('usage_slots')->where('user_id', $user->id)->where('day', $range[0])->orderBy('slot')
                ->get(['slot', 'app', 'seconds'])->map(fn ($r) => ['slot' => (int) $r->slot, 'app' => (string) $r->app, 'seconds' => (int) $r->seconds])->all();
        }
        $items = DB::table('usage_items')->where('user_id', $user->id)->whereBetween('day', $range)
            ->select('kind', 'app', 'item', DB::raw('SUM(seconds) as seconds'))->groupBy('kind', 'app', 'item')
            ->orderByDesc('seconds')->limit(200)->get()
            ->map(fn ($r) => ['kind' => (string) $r->kind, 'app' => (string) $r->app, 'item' => (string) $r->item, 'seconds' => (int) $r->seconds])->all();

        return ['from' => $range[0], 'to' => $range[1], 'days' => $days, 'slots' => $slots, 'items' => $items];
    }

    /**
     * For administrators: everyone's usage from one day to another. Each account (the guest last, never recorded) with
     * its time, the app and the website it spent most time in, then the apps and websites used most across everyone.
     *
     * @return array{from: string, to: string, users: list<array<string, mixed>>, apps: list<array{app: string, seconds: int}>, sites: list<array{item: string, seconds: int}>}
     *
     * @throws ValidationException
     */
    public static function everyone(string $from, string $to): array
    {
        $range = self::range($from, $to);
        $byUserApp = DB::table('usage_slots')->whereBetween('day', $range)
            ->select('user_id', 'app', DB::raw('SUM(seconds) as seconds'))->groupBy('user_id', 'app')->get();
        $bySite = DB::table('usage_items')->where('kind', 'site')->whereBetween('day', $range)
            ->select('user_id', 'item', DB::raw('SUM(seconds) as seconds'))->groupBy('user_id', 'item')->get();

        $time = [];
        $topApp = [];
        $apps = [];
        foreach ($byUserApp as $r) {
            $s = (int) $r->seconds;
            $time[$r->user_id] = ($time[$r->user_id] ?? 0) + $s;
            if ($s > ($topApp[$r->user_id][1] ?? 0)) {
                $topApp[$r->user_id] = [(string) $r->app, $s];
            }
            $apps[$r->app] = ($apps[$r->app] ?? 0) + $s;
        }
        $topSite = [];
        $sites = [];
        foreach ($bySite as $r) {
            $s = (int) $r->seconds;
            if ($s > ($topSite[$r->user_id][1] ?? 0)) {
                $topSite[$r->user_id] = [(string) $r->item, $s];
            }
            $sites[$r->item] = ($sites[$r->item] ?? 0) + $s;
        }
        arsort($apps);
        arsort($sites);

        $users = User::query()->orderBy('name')->get()
            ->sortBy(fn (User $u) => $u->isGuest() ? 1 : 0)->values()
            ->map(fn (User $u) => [
                'username' => $u->username,
                'name' => $u->name,
                'role' => $u->role->value,
                'roleLabel' => $u->role->label(),
                'color' => $u->color,
                'recorded' => ! $u->isGuest(),
                'seconds' => $time[$u->id] ?? 0,
                'topApp' => $topApp[$u->id][0] ?? null,
                'topSite' => $topSite[$u->id][0] ?? null,
            ])->all();

        return [
            'from' => $range[0], 'to' => $range[1], 'users' => $users,
            'apps' => array_map(fn ($a, $s) => ['app' => (string) $a, 'seconds' => $s], array_keys(array_slice($apps, 0, 10, true)), array_slice($apps, 0, 10, true)),
            'sites' => array_map(fn ($i, $s) => ['item' => (string) $i, 'seconds' => $s], array_keys(array_slice($sites, 0, 10, true)), array_slice($sites, 0, 10, true)),
        ];
    }

    /**
     * @return array{0: string, 1: string}
     *
     * @throws ValidationException
     */
    private static function range(string $from, string $to): array
    {
        $a = self::day($from);
        $b = self::day($to);
        if ($b->lt($a) || $a->diffInDays($b) > 62) {
            throw ValidationException::withMessages(['to' => 'Pick up to two months at a time.']);
        }

        return [$a->toDateString(), $b->toDateString()];
    }

    /** Deletes the days older than an administrator keeps, at most once a day. */
    public static function pruneDaily(): void
    {
        if (Cache::add('usage.pruned.'.Carbon::today()->toDateString(), 1, 86400)) {
            self::prune();
        }
    }

    public static function prune(): void
    {
        $before = Carbon::today()->subDays(max(1, (int) SystemSettings::get('usageKeepDays')))->toDateString();
        DB::table('usage_slots')->where('day', '<', $before)->delete();
        DB::table('usage_items')->where('day', '<', $before)->delete();
    }

    /**
     * Adds seconds to a row, making it when it isn't there yet (the same on MySQL and SQLite).
     *
     * @param  array<string, mixed>  $keys
     * @param  array<string, mixed>  $extra
     */
    private static function bump(string $table, array $keys, int $seconds, array $extra = []): void
    {
        if (DB::table($table)->where($keys)->increment('seconds', $seconds) > 0) {
            return;
        }
        try {
            DB::table($table)->insert($keys + $extra + ['seconds' => $seconds]);
        } catch (QueryException) {
            // another report made it in the meantime
            DB::table($table)->where($keys)->increment('seconds', $seconds);
        }
    }

    /** @throws ValidationException */
    private static function day(mixed $value): Carbon
    {
        $s = (string) $value;
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) || ! checkdate((int) substr($s, 5, 2), (int) substr($s, 8, 2), (int) substr($s, 0, 4))) {
            throw ValidationException::withMessages(['day' => 'Give the day as YYYY-MM-DD.']);
        }

        return Carbon::createFromFormat('Y-m-d', $s)->startOfDay();
    }

    private static function app(mixed $value): string
    {
        $s = strtolower((string) $value);

        return preg_match('/^[a-z0-9][a-z0-9._-]{0,63}$/', $s) ? $s : '';
    }

    /** A website's name only: whatever comes in, nothing of the page's address is kept. */
    private static function site(mixed $value): string
    {
        $s = strtolower(trim((string) $value));
        $host = parse_url(str_contains($s, '://') ? $s : 'http://'.$s, PHP_URL_HOST);
        $host = is_string($host) ? (string) preg_replace('/^www\./', '', $host) : '';
        $ok = strlen($host) <= 253 && preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/', $host);

        return $ok ? $host : '';
    }

    /** A file on the drive, or on a LiteLink device's USB drive. */
    private static function file(mixed $value): string
    {
        $s = (string) $value;
        if ($s === '' || mb_strlen($s) > 1024 || str_contains($s, "\0")) {
            return '';
        }

        return str_starts_with($s, '/') || str_starts_with($s, 'usb:') ? $s : '';
    }
}
