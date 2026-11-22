<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Accounts;
use App\Support\AppRegistry;
use App\Support\Capabilities;
use App\Support\Drive;
use App\Support\Role;
use App\Support\SystemSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

// Account types (docs/account-types.md): what App\Support\Capabilities gives each role and each Local account's
// switches, and that the server refuses what isn't allowed even when an app calls the API directly, while
// administrators and standard users keep everything they had.
class AccountTypesTest extends TestCase
{
    use RefreshDatabase;

    private string $log;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('drives');
        $this->log = tempnam(sys_get_temp_dir(), 'lossec');
        config(['logging.channels.security' => ['driver' => 'single', 'path' => $this->log, 'level' => 'info', 'replace_placeholders' => false]]);
        Log::forgetChannel('security');
    }

    protected function tearDown(): void
    {
        Log::forgetChannel('security');
        @unlink($this->log);
        parent::tearDown();
    }

    /**
     * @param  array<string, mixed>|null  $permissions
     */
    private function local(?array $permissions = null, string $username = 'lina'): User
    {
        $user = User::factory()->local($permissions)->create(['username' => $username]);
        Drive::ensureHome($username);

        return $user;
    }

    // ------------------------------------------------------------ the matrix

    public function test_administrators_and_standard_users_can_do_everything_they_could_before(): void
    {
        $installed = app(AppRegistry::class)->ids();
        foreach ([User::factory()->admin()->create(), User::factory()->create()] as $user) {
            $can = Capabilities::for($user);
            $this->assertSame($installed, $can['apps']);
            foreach (['drive', 'web', 'settingsDevice', 'changeName', 'changePassword', 'lock', 'usb', 'print'] as $key) {
                $this->assertTrue($can[$key], "{$user->role->value} should have {$key}");
            }
            $this->assertSame($user->isAdmin(), $can['admin']);
        }
    }

    public function test_a_local_account_gets_the_everyday_apps_and_no_device_settings_by_default(): void
    {
        $can = Capabilities::for($this->local());

        $this->assertTrue($can['drive']);
        $this->assertTrue($can['web']);
        $this->assertTrue($can['changeName']);
        $this->assertTrue($can['changePassword']);
        $this->assertFalse($can['settingsDevice']);
        $this->assertFalse($can['admin']);
        $this->assertContains('browser', $can['apps']);
        $this->assertContains('settings', $can['apps']);
        $this->assertNotContains('code', $can['apps']);
        $this->assertNotContains('database', $can['apps']);
    }

    /**
     * @return array<string, array{array<string, mixed>, string, bool}>
     */
    public static function switches(): array
    {
        return [
            'web off' => [['web' => false], 'web', false],
            'name off' => [['changeName' => false], 'changeName', false],
            'password off' => [['changePassword' => false], 'changePassword', false],
            'web on' => [['web' => true], 'web', true],
        ];
    }

    /**
     * @param  array<string, mixed>  $permissions
     */
    #[DataProvider('switches')]
    public function test_an_administrators_switch_changes_only_its_own_capability(array $permissions, string $key, bool $expected): void
    {
        $can = Capabilities::for($this->local($permissions));
        $defaults = Capabilities::for($this->local(null, 'other'));

        $this->assertSame($expected, $can[$key]);
        foreach (array_diff(['drive', 'web', 'changeName', 'changePassword', 'settingsDevice', 'lock', 'usb', 'print'], [$key, 'web']) as $other) {
            $this->assertSame($defaults[$other], $can[$other], "{$other} shouldn't change");
        }
    }

    public function test_settings_is_always_allowed_and_the_browser_needs_web_access(): void
    {
        $can = Capabilities::for($this->local(['apps' => ['notes', 'browser', 'nope'], 'web' => false]));

        $this->assertSame(['notes', 'settings'], $can['apps']);
        // in launcher order (config liteos.app_order), whatever order the administrator ticked them in
        $this->assertSame(['browser', 'notes', 'settings'], Capabilities::for($this->local(['apps' => ['notes', 'browser']], 'other'))['apps']);
    }

    public function test_switches_are_cleaned(): void
    {
        $this->assertSame(
            ['web' => false, 'changeName' => true, 'apps' => ['notes']],
            Capabilities::cleanPermissions(['web' => 0, 'changeName' => 'yes', 'admin' => true, 'apps' => ['notes', 'nope', 7]]),
        );
        $this->assertSame(['apps' => null], Capabilities::cleanPermissions(['apps' => 'all']));
    }

    public function test_a_disabled_account_can_do_nothing(): void
    {
        $can = Capabilities::for(User::factory()->admin()->disabled()->create());

        $this->assertSame([], $can['apps']);
        $this->assertFalse($can['drive'] || $can['web'] || $can['admin']);
    }

    // ------------------------------------------------------------ the server refuses

    public function test_web_off_refuses_every_relay_route_and_logs_it(): void
    {
        $this->actingAs($this->local(['web' => false]));

        $this->postJson('/os/net/fetch', ['url' => 'https://example.com/a.pdf'])
            ->assertForbidden()
            ->assertJsonPath('message', 'Web access is turned off for your account.');
        $this->getJson('/os/net/framecheck?url=https://example.com')->assertForbidden();
        $this->postJson('/os/net/sign', ['urls' => ['https://example.com/a.m3u8']])->assertForbidden();
        $this->get('/os/net/stream?u=x')->assertForbidden();

        $log = (string) file_get_contents($this->log);
        $this->assertStringContainsString('capability.refused', $log);
        $this->assertStringContainsString('"ability":"web"', $log);
    }

    public function test_refusals_are_logged_only_a_few_times_a_minute(): void
    {
        $this->actingAs($this->local(['web' => false]));
        for ($i = 0; $i < 12; $i++) {
            $this->getJson('/os/net/framecheck?url=https://example.com')->assertForbidden();
        }

        $this->assertSame(5, substr_count((string) file_get_contents($this->log), 'capability.refused'));
    }

    public function test_an_app_outside_the_list_is_refused(): void
    {
        $this->actingAs($this->local());

        $this->get('/apps/code')->assertForbidden();
        $this->get('/apps/notes')->assertOk();
        $this->get('/apps/nope')->assertNotFound();
    }

    public function test_the_app_list_sent_to_the_browser_is_limited(): void
    {
        $this->actingAs($this->local(['apps' => ['notes']]));

        $page = $this->get('/apps/notes')->assertOk()->getContent();
        preg_match('/window\.LOS_CONFIG = (\{.*\});/', $page, $m);
        $ids = array_column(json_decode($m[1], true)['apps'], 'id');

        $this->assertSame(['notes', 'settings'], $ids);
    }

    public function test_name_and_password_changes_follow_the_switches(): void
    {
        $user = $this->local(['changeName' => false, 'changePassword' => false]);
        $user->forceFill(['password' => 'secret12'])->save();
        $this->actingAs($user);

        $this->postJson('/os/account/update', ['name' => 'New Name'])->assertForbidden();
        $this->postJson('/os/account/password', ['current' => 'secret12', 'new' => 'secret34'])->assertForbidden();
        $this->assertNotSame('New Name', $user->fresh()->name);
    }

    public function test_a_local_account_changes_its_name_by_default(): void
    {
        $this->actingAs($this->local());

        $this->postJson('/os/account/update', ['name' => 'New Name'])->assertOk()->assertJsonPath('result.name', 'New Name');
    }

    public function test_a_local_account_can_use_its_drive_but_not_manage_users(): void
    {
        $this->actingAs($this->local());

        $this->postJson('/os/fs/write', ['path' => '/Documents/a.txt', 'content' => 'hi'])->assertOk();
        $this->getJson('/os/trash/list')->assertOk();
        $this->getJson('/os/users/list')->assertForbidden();
        $this->getJson('/os/system/get')->assertForbidden();
    }

    public function test_settings_keep_only_what_the_account_may_have(): void
    {
        $user = $this->local(['apps' => ['notes', 'files'], 'web' => false]);
        $this->actingAs($user);

        $this->postJson('/os/settings/save', ['settings' => [
            'pinned' => ['notes', 'code', 'browser'],
            'desktopIcons' => ['files', 'code', 'trash'],
            'homepage' => 'https://example.com',
            'theme' => 'dark',
        ]])
            ->assertOk()
            ->assertJsonPath('result.pinned', ['notes'])
            ->assertJsonPath('result.desktopIcons', ['files', 'trash'])
            ->assertJsonPath('result.homepage', 'https://www.wikipedia.org')
            ->assertJsonPath('result.theme', 'dark');
    }

    public function test_narrowing_the_apps_later_takes_them_off_the_taskbar(): void
    {
        $user = $this->local();
        $this->actingAs($user)->postJson('/os/settings/save', ['settings' => ['pinned' => ['notes', 'sheets']]])
            ->assertJsonPath('result.pinned', ['notes', 'sheets']);

        $user->forceFill(['permissions' => ['apps' => ['notes']]])->save();

        $this->getJson('/auth/status')->assertJsonPath('result.settings.pinned', ['notes']);
    }

    public function test_the_desktop_is_told_what_the_account_can_do(): void
    {
        $this->actingAs($this->local(['web' => false]));

        $this->getJson('/auth/status')
            ->assertJsonPath('result.user.role', 'local')
            ->assertJsonPath('result.user.can.web', false)
            ->assertJsonPath('result.user.can.settingsDevice', false);
    }

    // ------------------------------------------------------------ accounts and storage

    public function test_a_local_account_has_its_own_default_quota(): void
    {
        SystemSettings::save(['defaultQuotaMB' => 1000, 'defaultLocalQuotaMB' => 200]);

        $this->assertSame(200 * 1024 * 1024, Drive::quotaBytes($this->local()));
        $this->assertSame(1000 * 1024 * 1024, Drive::quotaBytes(User::factory()->create()));
        $this->assertSame(50 * 1024 * 1024, Drive::quotaBytes(User::factory()->local()->create(['quota_mb' => 50])));
    }

    public function test_an_administrator_can_make_an_account_local_and_back(): void
    {
        $admin = User::factory()->admin()->create(['username' => 'admin']);
        $user = User::factory()->create(['username' => 'baraka']);

        $this->actingAs($admin)->postJson('/os/users/update', ['username' => 'baraka', 'changes' => ['role' => 'local']])
            ->assertOk()
            ->assertJsonPath('result.role', 'local');

        $user->refresh()->forceFill(['permissions' => ['web' => false]])->save();
        Accounts::update($user, ['role' => 'user']);

        $this->assertSame(Role::User, $user->fresh()->role);
        $this->assertNull($user->fresh()->permissions);
    }

    public function test_an_administrator_sets_a_local_accounts_switches(): void
    {
        $admin = User::factory()->admin()->create(['username' => 'admin']);
        $this->local();

        $this->actingAs($admin)->postJson('/os/users/update', ['username' => 'lina', 'changes' => ['permissions' => [
            'web' => false, 'changeName' => false, 'changePassword' => true, 'apps' => ['notes', 'code', 'nope'], 'admin' => true,
        ]]])
            ->assertOk()
            ->assertJsonPath('result.can.web', false)
            ->assertJsonPath('result.can.apps', ['code', 'notes', 'settings']);

        $this->assertSame(['web' => false, 'changeName' => false, 'changePassword' => true, 'apps' => ['notes', 'code']], User::query()->where('username', 'lina')->first()->permissions);
        $this->getJson('/os/users/list')->assertJsonPath('result.1.permissions.web', false)->assertJsonPath('result.0.permissions', null);

        $log = (string) file_get_contents($this->log);
        $this->assertStringContainsString('account.changed', $log);
        $this->assertStringContainsString('"permissions":{"web":false', $log);
    }

    public function test_switches_are_ignored_for_other_roles_and_can_be_reset(): void
    {
        $admin = User::factory()->admin()->create(['username' => 'admin']);
        User::factory()->create(['username' => 'baraka']);
        $this->local(['web' => false]);
        $this->actingAs($admin);

        $this->postJson('/os/users/update', ['username' => 'baraka', 'changes' => ['permissions' => ['web' => false]]])->assertOk();
        $this->assertNull(User::query()->where('username', 'baraka')->first()->permissions);

        $this->postJson('/os/users/update', ['username' => 'lina', 'changes' => ['permissions' => null]])->assertOk();
        $this->assertNull(User::query()->where('username', 'lina')->first()->permissions);

        // one request can make an account Local and set its switches
        $this->postJson('/os/users/update', ['username' => 'baraka', 'changes' => ['role' => 'local', 'permissions' => ['web' => false]]])
            ->assertJsonPath('result.can.web', false);
    }

    public function test_only_administrators_change_switches(): void
    {
        $this->local();
        $this->actingAs($this->local(null, 'other'))
            ->postJson('/os/users/update', ['username' => 'lina', 'changes' => ['permissions' => ['web' => false]]])
            ->assertForbidden();
        $this->assertNull(User::query()->where('username', 'lina')->first()->permissions);
    }

    public function test_the_local_default_quota_is_saved_by_administrators(): void
    {
        $this->actingAs(User::factory()->admin()->create())
            ->postJson('/os/system/save', ['system' => ['defaultLocalQuotaMB' => 300]])
            ->assertOk()
            ->assertJsonPath('result.defaultLocalQuotaMB', 300);
    }

    public function test_existing_accounts_have_no_switches_after_the_migration(): void
    {
        $this->assertTrue(Schema::hasColumn('users', 'permissions'));
        $user = User::factory()->create();
        $admin = User::factory()->admin()->create();

        $this->assertNull($user->fresh()->permissions);
        $this->assertNull($admin->fresh()->permissions);
        $this->assertTrue(Capabilities::for($user->fresh())['web']);
        $this->assertTrue(Capabilities::for($admin->fresh())['admin']);
    }
}
