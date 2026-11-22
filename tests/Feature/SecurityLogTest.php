<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Drive;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

// The security log (App\Support\SecurityLog): each event is one line with the event as its message and the details as
// context, written to a file here exactly as the real channel writes it. No line ever holds a password.
class SecurityLogTest extends TestCase
{
    use RefreshDatabase;

    private string $file;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('drives');
        $this->file = tempnam(sys_get_temp_dir(), 'lossec');
        config(['logging.channels.security' => ['driver' => 'single', 'path' => $this->file, 'level' => 'info', 'replace_placeholders' => false]]);
        Log::forgetChannel('security');
    }

    protected function tearDown(): void
    {
        Log::forgetChannel('security');
        @unlink($this->file);
        parent::tearDown();
    }

    /**
     * The lines written so far, each as [level, event, context].
     *
     * @return list<array{string, string, array<string, mixed>}>
     */
    private function lines(): array
    {
        $out = [];
        foreach (array_filter(explode("\n", (string) file_get_contents($this->file))) as $line) {
            $this->assertMatchesRegularExpression('/^\[[^\]]+\] \w+\.(\w+): ([a-z_.]+) (\{.*\}) ?$/', $line);
            preg_match('/^\[[^\]]+\] \w+\.(\w+): ([a-z_.]+) (\{.*\}) ?$/', $line, $m);
            $out[] = [$m[1], $m[2], json_decode($m[3], true)];
        }

        return $out;
    }

    private function assertNoSecret(string ...$secrets): void
    {
        $text = (string) file_get_contents($this->file);
        foreach ($secrets as $secret) {
            $this->assertStringNotContainsString($secret, $text);
        }
    }

    public function test_sign_ins_failures_and_lockouts_are_logged_without_the_password(): void
    {
        User::factory()->create(['username' => 'amina']);

        for ($i = 0; $i < 5; $i++) {
            $this->post('/login', ['username' => 'amina', 'password' => 'guess-'.$i]);
        }
        $this->post('/login', ['username' => 'amina', 'password' => 'guess-5']);
        $this->post('/login', ['username' => 'nobody', 'password' => 'whatever-1']);

        $lines = $this->lines();
        $this->assertSame(['signin.failed', 'signin.failed', 'signin.failed', 'signin.failed', 'signin.failed', 'signin.locked', 'signin.failed'], array_column($lines, 1));
        $this->assertSame('WARNING', $lines[0][0]);
        $this->assertSame('amina', $lines[0][2]['username']);
        $this->assertSame('wrong password', $lines[0][2]['reason']);
        $this->assertSame('127.0.0.1', $lines[0][2]['ip']);
        $this->assertGreaterThan(0, $lines[5][2]['seconds_left']);
        $this->assertSame('unknown account', $lines[6][2]['reason']);
        $this->assertNoSecret('guess-', 'whatever-1');
    }

    public function test_a_successful_sign_in_is_logged(): void
    {
        User::factory()->create(['username' => 'amina']);

        $this->post('/login', ['username' => 'amina', 'password' => 'password'])->assertRedirect();

        [$level, $event, $context] = $this->lines()[0];
        $this->assertSame(['INFO', 'signin.ok', 'amina'], [$level, $event, $context['username']]);
        $this->assertNoSecret('password'); // the factory password
    }

    public function test_a_typed_username_cant_forge_a_line(): void
    {
        User::factory()->create(); // past first-run setup
        $this->post('/login', ['username' => "x\n[2026-01-01 00:00:00] local.INFO: signin.ok {\"username\":\"admin\"}", 'password' => 'p']);

        $lines = $this->lines(); // every line still has the shape of one event
        $this->assertCount(1, $lines);
        $this->assertSame('signin.failed', $lines[0][1]);
        $this->assertStringStartsWith('x\n[2026-01-01', $lines[0][2]['username']); // the line break kept as an escape
        $this->assertLessThanOrEqual(64, mb_strlen(str_replace('\n', "\n", $lines[0][2]['username']))); // 64 typed characters
    }

    public function test_failed_unlocks_and_unlock_lockouts_are_logged(): void
    {
        $this->actingAs(User::factory()->create(['username' => 'amina']));
        $this->postJson('/auth/lock');

        for ($i = 0; $i < 6; $i++) {
            $this->post('/unlock', ['password' => 'try-'.$i]);
        }

        $this->assertSame(['unlock.failed', 'unlock.failed', 'unlock.failed', 'unlock.failed', 'unlock.failed', 'unlock.locked'], array_column($this->lines(), 1));
        $this->assertSame('amina', $this->lines()[0][2]['actor']);
        $this->assertNoSecret('try-');
    }

    public function test_administrators_account_changes_are_logged_with_who_did_what(): void
    {
        $admin = User::factory()->admin()->create(['username' => 'admin']);
        $this->actingAs($admin);

        $this->postJson('/os/users/create', ['username' => 'baraka', 'name' => 'Baraka', 'password' => 'first-secret-9'])->assertOk();
        $this->postJson('/os/users/update', ['username' => 'baraka', 'changes' => ['password' => 'second-secret-9', 'role' => 'admin', 'disabled' => true, 'quotaMB' => 300]])->assertOk();
        $this->postJson('/os/users/update', ['username' => 'baraka', 'changes' => ['name' => 'B', 'password' => '']])->assertOk();
        $this->postJson('/os/users/delete', ['username' => 'baraka'])->assertOk();

        $lines = $this->lines();
        $this->assertSame(['account.created', 'account.changed', 'account.changed', 'account.deleted'], array_column($lines, 1));
        $this->assertSame(['admin', 'baraka', 'user'], [$lines[0][2]['actor'], $lines[0][2]['target'], $lines[0][2]['role']]);
        $this->assertSame(['password' => 'changed', 'role' => 'admin', 'disabled' => true, 'quotaMB' => 300], $lines[1][2]['fields']);
        $this->assertSame(['name' => 'changed'], $lines[2][2]['fields']); // an empty password field changes nothing
        $this->assertSame('baraka', $lines[3][2]['target']);
        $this->assertNoSecret('first-secret-9', 'second-secret-9');
    }

    public function test_own_password_changes_and_wrong_current_passwords_are_logged(): void
    {
        $this->actingAs(User::factory()->create(['username' => 'amina']));

        $this->postJson('/os/account/password', ['current' => 'not-it-7', 'new' => 'new-secret-7'])->assertForbidden();
        $this->postJson('/os/account/password', ['current' => 'password', 'new' => 'new-secret-7'])->assertOk();

        $this->assertSame(['password.change_refused', 'password.changed'], array_column($this->lines(), 1));
        $this->assertNoSecret('not-it-7', 'new-secret-7');
    }

    public function test_refused_admin_requests_are_logged(): void
    {
        $this->actingAs(User::factory()->create(['username' => 'amina']));
        Drive::ensureHome('amina');

        $this->getJson('/os/users/list')->assertForbidden();
        $this->getJson('/os/settings/get')->assertOk(); // not an admin request: nothing logged

        $lines = $this->lines();
        $this->assertCount(1, $lines);
        $this->assertSame(['WARNING', 'admin.refused'], [$lines[0][0], $lines[0][1]]);
        $this->assertSame(['amina', 'GET', '/os/users/list'], [$lines[0][2]['actor'], $lines[0][2]['method'], $lines[0][2]['path']]);
    }
}
