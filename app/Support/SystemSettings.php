<?php

namespace App\Support;

use App\Models\SystemSetting;
use Illuminate\Validation\ValidationException;

// Settings for the whole instance, changed by administrators in Settings › System: the instance name (shown on the
// sign-in screen and in the browser tab) and the storage quota new accounts get (Local accounts have their own).
// Also whether the Guest account is on, and what guests may do. Stored one row per key; anything not stored yet comes
// from the defaults here. Keys are the MVP's camelCase names, which the Settings app sends.
class SystemSettings
{
    /**
     * @return array{instanceName: string, defaultQuotaMB: int, defaultLocalQuotaMB: int, guestEnabled: bool, guestWeb: bool, guestApps: list<string>|null, createdAt: string|null, archiveMaxTotalMB: int, archiveMaxFileMB: int, archiveMaxRatio: int, archiveMaxEntries: int, usageTracking: bool, usageKeepDays: int}
     */
    public static function defaults(): array
    {
        return [
            'instanceName' => 'LiteOS',
            'defaultQuotaMB' => (int) config('liteos.default_quota_mb'),
            'defaultLocalQuotaMB' => (int) config('liteos.default_local_quota_mb'),
            // the built-in Guest account (App\Support\Guest): off until an administrator turns it on
            'guestEnabled' => false,
            'guestWeb' => true,
            'guestApps' => null,           // null: config liteos.local_apps
            'createdAt' => null,
            // Archives (public/assets/apps/archives): the most one extraction may write in all and for one file, the
            // highest compression ratio a file may have, and the most entries an archive may hold. Archives are
            // unpacked in the browser, never here; these stop zip bombs before they fill a drive.
            'archiveMaxTotalMB' => 4096,
            'archiveMaxFileMB' => 1024,
            'archiveMaxRatio' => 100,
            'archiveMaxEntries' => 20000,
            // usage tracking (App\Support\Usage, System Monitor's Usage): off until an administrator turns it on, and how
            // many days are kept
            'usageTracking' => false,
            'usageKeepDays' => 90,
        ];
    }

    /**
     * Every setting, stored values over the defaults.
     *
     * @return array{instanceName: string, defaultQuotaMB: int, defaultLocalQuotaMB: int, guestEnabled: bool, guestWeb: bool, guestApps: list<string>|null, createdAt: string|null, archiveMaxTotalMB: int, archiveMaxFileMB: int, archiveMaxRatio: int, archiveMaxEntries: int, usageTracking: bool, usageKeepDays: int}
     */
    public static function all(): array
    {
        $stored = SystemSetting::query()->pluck('value', 'key')->all();

        return self::capArchive(array_merge(self::defaults(), array_intersect_key($stored, self::defaults())));
    }

    /**
     * Archives may never extract more than a new account's drive holds: the most per extraction is capped at the
     * larger default storage (users or Local accounts), and the largest file at the most per extraction. Applied to
     * what is stored too, so lowering the default storage lowers these with it.
     *
     * @param  array<string, mixed>  $s
     * @return array<string, mixed>
     */
    private static function capArchive(array $s): array
    {
        $s['archiveMaxTotalMB'] = min((int) $s['archiveMaxTotalMB'], self::archiveCeiling($s));
        $s['archiveMaxFileMB'] = min((int) $s['archiveMaxFileMB'], $s['archiveMaxTotalMB']);

        return $s;
    }

    /** @param  array<string, mixed>  $s */
    private static function archiveCeiling(array $s): int
    {
        return max((int) $s['defaultQuotaMB'], (int) $s['defaultLocalQuotaMB']);
    }

    public static function get(string $key): mixed
    {
        return self::all()[$key] ?? null;
    }

    /**
     * Validates and stores the changes an administrator made; unknown keys are ignored.
     *
     * @param  array<string, mixed>  $changes
     * @return array{instanceName: string, defaultQuotaMB: int, defaultLocalQuotaMB: int, guestEnabled: bool, guestWeb: bool, guestApps: list<string>|null, createdAt: string|null, archiveMaxTotalMB: int, archiveMaxFileMB: int, archiveMaxRatio: int, archiveMaxEntries: int, usageTracking: bool, usageKeepDays: int}
     *
     * @throws ValidationException
     */
    public static function save(array $changes): array
    {
        $clean = [];
        if (array_key_exists('instanceName', $changes)) {
            $name = trim(strip_tags((string) $changes['instanceName']));
            if ($name === '' || mb_strlen($name) > 40) {
                throw ValidationException::withMessages(['instanceName' => 'Enter a name for this LiteOS (up to 40 characters).']);
            }
            $clean['instanceName'] = $name;
        }
        foreach (['defaultQuotaMB', 'defaultLocalQuotaMB'] as $key) {
            if (array_key_exists($key, $changes)) {
                if (! is_numeric($changes[$key])) {
                    throw ValidationException::withMessages([$key => 'Enter the default storage in MB.']);
                }
                $clean[$key] = max(10, min(1024 * 1024, (int) $changes[$key]));
            }
        }

        $archive = [
            'archiveMaxTotalMB' => [1, 1024 * 1024, 'Enter the most an extraction may write, in MB.'],
            'archiveMaxFileMB' => [1, 1024 * 1024, 'Enter the largest file an archive may hold, in MB.'],
            'archiveMaxRatio' => [2, 100000, 'Enter the highest compression ratio, such as 100.'],
            'archiveMaxEntries' => [1, 10000000, 'Enter the most files and folders an archive may hold.'],
        ];
        foreach ($archive as $key => [$min, $max, $message]) {
            if (array_key_exists($key, $changes)) {
                if (! is_numeric($changes[$key])) {
                    throw ValidationException::withMessages([$key => $message]);
                }
                $clean[$key] = max($min, min($max, (int) $changes[$key]));
            }
        }
        // an extraction can't be larger than the default storage, nor one file larger than an extraction
        $next = array_merge(self::all(), $clean);
        if (array_key_exists('archiveMaxTotalMB', $clean) && $clean['archiveMaxTotalMB'] > self::archiveCeiling($next)) {
            throw ValidationException::withMessages(['archiveMaxTotalMB' => 'Most data per extraction can’t be more than the default storage ('.self::archiveCeiling($next).' MB).']);
        }
        if (array_key_exists('archiveMaxFileMB', $clean) && $clean['archiveMaxFileMB'] > min((int) $next['archiveMaxTotalMB'], self::archiveCeiling($next))) {
            throw ValidationException::withMessages(['archiveMaxFileMB' => 'The largest file can’t be more than the most data per extraction ('.min((int) $next['archiveMaxTotalMB'], self::archiveCeiling($next)).' MB).']);
        }

        if (array_key_exists('usageKeepDays', $changes)) {
            if (! in_array((int) $changes['usageKeepDays'], [30, 90, 180, 365], true)) {
                throw ValidationException::withMessages(['usageKeepDays' => 'Keep usage for 30, 90, 180 or 365 days.']);
            }
            $clean['usageKeepDays'] = (int) $changes['usageKeepDays'];
        }

        foreach (['guestEnabled', 'guestWeb', 'usageTracking'] as $key) {
            if (array_key_exists($key, $changes)) {
                $clean[$key] = (bool) $changes[$key];
            }
        }
        if (array_key_exists('guestApps', $changes)) {
            $clean['guestApps'] = Capabilities::cleanPermissions(['apps' => $changes['guestApps']])['apps'];
        }
        if (! empty($clean['guestEnabled'])) {
            Guest::checkCanEnable();
        }

        self::put($clean);
        if (array_key_exists('usageKeepDays', $clean)) {
            Usage::prune();
        }
        if (array_key_exists('guestEnabled', $clean)) {
            Guest::sync($clean['guestEnabled']);
        }

        return self::all();
    }

    /**
     * Stores values as they are (no validation), for setup and the importer.
     *
     * @param  array<string, mixed>  $values
     */
    public static function put(array $values): void
    {
        foreach ($values as $key => $value) {
            SystemSetting::query()->updateOrCreate(['key' => $key], ['value' => $value]);
        }
    }
}
