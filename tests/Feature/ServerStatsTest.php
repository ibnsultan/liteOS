<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Role;
use App\Support\ServerStats;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

// System Monitor › Server (/os/system/server, /os/system/counters): administrators only; the live counters come from
// /proc, read here from a made-up one.
class ServerStatsTest extends TestCase
{
    use RefreshDatabase;

    public function test_only_administrators_see_the_server(): void
    {
        Storage::fake('drives');
        $user = User::factory()->create(['username' => 'amina']);
        $this->actingAs($user)->getJson('/os/system/server')->assertForbidden();
        $this->actingAs($user)->getJson('/os/system/counters')->assertForbidden();

        $admin = User::factory()->create(['username' => 'admin', 'role' => Role::Admin->value]);
        $this->actingAs($admin)->getJson('/os/system/server')->assertOk()
            ->assertJsonPath('result.liteos', config('liteos.version'))
            ->assertJsonPath('result.php', PHP_VERSION);
    }

    public function test_counters_are_read_from_proc(): void
    {
        $proc = storage_path('framework/testing/proc');
        File::ensureDirectoryExists($proc.'/net');
        File::put($proc.'/stat', "cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 100 0 50 800 50 0 0 0 0 0\n");
        File::put($proc.'/meminfo', "MemTotal:       16000 kB\nMemFree:         2000 kB\nMemAvailable:   12000 kB\n");
        File::put($proc.'/diskstats', "   8       0 sda 10 0 100 0 20 0 200 0 0 0 0\n   8       1 sda1 10 0 100 0 20 0 200 0 0 0 0\n   7       0 loop0 1 0 999 0 1 0 999 0\n");
        File::put($proc.'/net/dev', "Inter-|   Receive\n face |bytes\n    lo: 5000 1 0 0 0 0 0 0 5000 1 0 0 0 0 0 0\n  eth0: 7000 1 0 0 0 0 0 0 3000 1 0 0 0 0 0 0\n");
        File::put($proc.'/uptime', "3600.5 100.0\n");

        $c = (new ServerStats($proc))->counters();
        $this->assertSame(1000, $c['cpuTotal']);
        $this->assertSame(850, $c['cpuIdle']);
        $this->assertSame(16000 * 1024, $c['memTotal']);
        $this->assertSame(4000 * 1024, $c['memUsed']);
        $this->assertSame(['read' => 100 * 512, 'write' => 200 * 512], $c['disk']);
        $this->assertSame(['in' => 7000, 'out' => 3000], $c['net']);
        File::deleteDirectory($proc);
    }
}
