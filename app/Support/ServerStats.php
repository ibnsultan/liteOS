<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Throwable;

// The LiteOS server, for administrators (System Monitor › Server): facts that rarely change (versions, the database,
// the disk, who is signed in) and counters for the live charts. Counters are the system's running totals (processor
// time, disk sectors, network bytes), read from /proc on Linux; System Monitor works out the rates between two reads
// two seconds apart, so the server keeps nothing. Other systems don't offer them to PHP: their counters are null.
class ServerStats
{
    public function __construct(private string $proc = '/proc') {}

    /** @return array<string, mixed> */
    public function facts(): array
    {
        $storage = storage_path();

        return [
            'liteos' => config('liteos.version'),
            'php' => PHP_VERSION,
            'os' => PHP_OS_FAMILY === 'Linux' ? $this->distro() : php_uname('s').' '.php_uname('r'),
            'database' => $this->database(),
            'uploadMax' => ini_get('upload_max_filesize'),
            'upSince' => $this->bootTime(),
            'cores' => $this->cores(),
            'disk' => ['total' => (int) (@disk_total_space($storage) ?: 0), 'free' => (int) (@disk_free_space($storage) ?: 0)],
            'signedIn' => $this->signedIn(),
            'live' => $this->live(),
        ];
    }

    /** Whether this server can give counters for the live charts. */
    public function live(): bool
    {
        return is_readable($this->proc.'/stat');
    }

    /**
     * The running totals now: processor time (all and idle), memory, disk sectors read and written (whole disks only),
     * network bytes in and out (every interface but loopback), and when they were read.
     *
     * @return array<string, mixed>|null
     */
    public function counters(): ?array
    {
        if (! $this->live()) {
            return null;
        }
        $cpu = $this->cpu();
        $mem = $this->memory();

        return [
            't' => (int) floor(microtime(true) * 1000),
            'cpuTotal' => $cpu[0],
            'cpuIdle' => $cpu[1],
            'memTotal' => $mem[0],
            'memUsed' => $mem[1],
            'disk' => $this->disk(),
            'net' => $this->net(),
        ];
    }

    /** @return array{0: int, 1: int} */
    private function cpu(): array
    {
        foreach ($this->lines('stat') as $line) {
            if (str_starts_with($line, 'cpu ')) {
                $v = array_map('intval', preg_split('/\s+/', trim(substr($line, 4))) ?: []);

                // user nice system idle iowait irq softirq steal: idle is idle and iowait
                return [array_sum(array_slice($v, 0, 8)), ($v[3] ?? 0) + ($v[4] ?? 0)];
            }
        }

        return [0, 0];
    }

    /** @return array{0: int, 1: int} bytes in all, bytes in use */
    private function memory(): array
    {
        $m = [];
        foreach ($this->lines('meminfo') as $line) {
            if (preg_match('/^(\w+):\s+(\d+)/', $line, $x)) {
                $m[$x[1]] = (int) $x[2] * 1024;
            }
        }
        $total = $m['MemTotal'] ?? 0;
        $available = $m['MemAvailable'] ?? (($m['MemFree'] ?? 0) + ($m['Cached'] ?? 0));

        return [$total, max(0, $total - $available)];
    }

    /** @return array{read: int, write: int} bytes */
    private function disk(): array
    {
        $read = 0;
        $write = 0;
        foreach ($this->lines('diskstats') as $line) {
            $f = preg_split('/\s+/', trim($line)) ?: [];
            $name = $f[2] ?? '';
            // whole disks: sda, vda, xvda, nvme0n1, mmcblk0 (never their partitions, nor loop or ram devices)
            if (! preg_match('/^((s|v|xv|h)d[a-z]+|nvme\d+n\d+|mmcblk\d+)$/', $name)) {
                continue;
            }
            $read += (int) ($f[5] ?? 0) * 512;
            $write += (int) ($f[9] ?? 0) * 512;
        }

        return ['read' => $read, 'write' => $write];
    }

    /** @return array{in: int, out: int} bytes */
    private function net(): array
    {
        $in = 0;
        $out = 0;
        foreach ($this->lines('net/dev') as $line) {
            if (! str_contains($line, ':')) {
                continue;
            }
            [$name, $rest] = explode(':', $line, 2);
            if (trim($name) === 'lo') {
                continue;
            }
            $f = preg_split('/\s+/', trim($rest)) ?: [];
            $in += (int) ($f[0] ?? 0);
            $out += (int) ($f[8] ?? 0);
        }

        return ['in' => $in, 'out' => $out];
    }

    /** @return array{engine: string, version: string|null, bytes: int|null} */
    private function database(): array
    {
        $db = DB::connection();
        $driver = $db->getDriverName();
        try {
            if ($driver === 'sqlite') {
                $file = (string) $db->getConfig('database');

                return ['engine' => 'SQLite', 'version' => (string) $db->selectOne('select sqlite_version() as v')->v, 'bytes' => is_file($file) ? (int) filesize($file) : null];
            }
            if ($driver === 'mysql' || $driver === 'mariadb') {
                $version = (string) $db->selectOne('select version() as v')->v;
                $bytes = $db->selectOne('select sum(data_length + index_length) as b from information_schema.tables where table_schema = ?', [$db->getDatabaseName()]);

                return ['engine' => str_contains(strtolower($version), 'mariadb') ? 'MariaDB' : 'MySQL', 'version' => preg_replace('/-.*$/', '', $version), 'bytes' => (int) ($bytes->b ?? 0)];
            }
        } catch (Throwable) {
            // the engine still answers queries; its size just isn't readable here
        }

        return ['engine' => ucfirst($driver), 'version' => null, 'bytes' => null];
    }

    /**
     * Who is signed in now: accounts with a session used in the last 15 minutes (sessions are kept in the database).
     *
     * @return list<array{name: string, since: string|null}>
     */
    private function signedIn(): array
    {
        if (config('session.driver') !== 'database') {
            return [];
        }
        try {
            $rows = DB::table(config('session.table', 'sessions'))->whereNotNull('user_id')
                ->where('last_activity', '>=', time() - 15 * 60)
                ->select('user_id', DB::raw('MAX(last_activity) as last'))->groupBy('user_id')->get();
        } catch (Throwable) {
            return [];
        }
        $users = User::query()->whereIn('id', $rows->pluck('user_id'))->get()->keyBy('id');

        return $rows->map(fn ($r) => isset($users[$r->user_id]) ? [
            'name' => $users[$r->user_id]->name,
            'since' => $users[$r->user_id]->last_login_at?->toIso8601String(),
            'active' => Carbon::createFromTimestamp((int) $r->last)->toIso8601String(),
        ] : null)->filter()->sortBy('name')->values()->all();
    }

    private function bootTime(): ?string
    {
        $up = @file_get_contents($this->proc.'/uptime');
        if (! is_string($up) || ! is_numeric(strtok($up, ' '))) {
            return null;
        }

        return Carbon::now()->subSeconds((int) floatval($up))->toIso8601String();
    }

    private function cores(): ?int
    {
        $n = 0;
        foreach ($this->lines('cpuinfo') as $line) {
            if (str_starts_with($line, 'processor')) {
                $n++;
            }
        }
        if ($n) {
            return $n;
        }
        $env = getenv('NUMBER_OF_PROCESSORS');

        return is_string($env) && ctype_digit($env) ? (int) $env : null;
    }

    private function distro(): string
    {
        foreach ($this->lines('../etc/os-release', '/etc/os-release') as $line) {
            if (str_starts_with($line, 'PRETTY_NAME=')) {
                return trim(substr($line, 12), "\"'");
            }
        }

        return 'Linux '.php_uname('r');
    }

    /** @return list<string> */
    private function lines(string $file, ?string $absolute = null): array
    {
        $path = $absolute ?? $this->proc.'/'.$file;
        $text = is_readable($path) ? @file_get_contents($path) : false;

        return is_string($text) ? preg_split('/\R/', $text) ?: [] : [];
    }
}
