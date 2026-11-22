<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Accounts;
use App\Support\Capabilities;
use App\Support\Guest;
use App\Support\Role;
use App\Support\SystemSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

// The built-in Guest account (App\Support\Guest, docs/account-types.md): off until an administrator turns it on, then
// anyone signs in from the sign-in screen without a password; it has no drive on the server, can't lock, and gets web
// access and apps from the system settings.
class GuestTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('drives');
        // an instance with no accounts sends everyone to first-run setup
        User::factory()->admin()->create(['username' => 'owner']);
    }

    private function turnOn(array $more = []): User
    {
        SystemSettings::save(['guestEnabled' => true] + $more);

        return Guest::account();
    }

    public function test_there_is_no_guest_until_an_administrator_turns_it_on(): void
    {
        $this->assertNull(Guest::account());
        $this->get('/login')->assertOk()->assertDontSee('Sign in as guest');
        $this->post('/login/guest')->assertRedirect('/login');
        $this->assertGuest();
    }

    public function test_turning_guest_on_offers_it_on_the_sign_in_screen(): void
    {
        $this->turnOn();

        $this->get('/login')->assertSee('Sign in as guest');
        $this->post('/login/guest')->assertRedirect('/');
        $this->assertAuthenticatedAs(Guest::account());
        // nothing is made on the drives disk, and the device doesn't remember the guest as its last account
        $this->assertFalse(Storage::disk('drives')->exists('guest'));
    }

    public function test_the_guest_never_signs_in_with_a_password_or_as_a_profile(): void
    {
        $this->turnOn();

        $this->get('/login?username=guest')->assertSee('We couldn’t find that account');
        $this->post('/login', ['username' => 'guest', 'password' => 'anything'])->assertSessionHasErrors('password');
        $this->assertGuest();
    }

    public function test_turning_guest_off_ends_guest_sessions(): void
    {
        $guest = $this->turnOn();
        $this->post('/login/guest');
        $this->assertAuthenticatedAs($guest);

        SystemSettings::save(['guestEnabled' => false]);
        // the next request reads the account again, as a real one would
        $this->app['auth']->forgetGuards();

        $this->getJson('/os/settings/get')->assertUnauthorized();
        $this->get('/login')->assertDontSee('Sign in as guest');
        $this->post('/login/guest')->assertRedirect('/login');
    }

    public function test_the_guest_link_is_rate_limited(): void
    {
        $this->turnOn();
        for ($i = 0; $i < 10; $i++) {
            $this->post('/login/guest');
            $this->post('/logout');
        }

        $this->post('/login/guest')->assertStatus(429);
    }

    public function test_a_guest_has_no_drive_cant_lock_or_change_its_account(): void
    {
        $this->actingAs($this->turnOn());

        $this->getJson('/os/fs/list?path=/')->assertForbidden();
        $this->getJson('/os/trash/list')->assertForbidden();
        $this->postJson('/auth/lock')->assertForbidden();
        $this->postJson('/os/account/update', ['name' => 'Me'])->assertForbidden();
        $this->postJson('/os/account/password', ['current' => 'x', 'new' => 'secret12'])->assertForbidden();
        $this->getJson('/os/users/list')->assertForbidden();

        $can = Capabilities::for(Guest::account());
        $this->assertFalse($can['drive'] || $can['lock'] || $can['usb'] || $can['settingsDevice']);
        $this->assertTrue($can['print']);
    }

    public function test_guest_web_access_and_apps_come_from_the_system_settings(): void
    {
        $guest = $this->turnOn(['guestWeb' => false, 'guestApps' => ['notes', 'browser', 'nope']]);
        $this->actingAs($guest);

        $this->assertSame(['notes', 'settings'], Capabilities::for($guest)['apps']);
        $this->postJson('/os/net/fetch', ['url' => 'https://example.com'])->assertForbidden();
        $this->get('/apps/files')->assertForbidden();
        $this->withHeader('Sec-Fetch-Dest', 'iframe')->get('/apps/notes')->assertOk();
    }

    public function test_the_guest_is_built_in_and_its_name_is_kept(): void
    {
        $this->turnOn();
        $this->actingAs(User::query()->where('username', 'owner')->first());

        $this->postJson('/os/users/create', ['username' => 'guest', 'name' => 'G', 'password' => 'secret12'])
            ->assertStatus(422)->assertJsonPath('message', 'That username is kept for the guest account.');
        $this->postJson('/os/users/create', ['username' => 'g2', 'name' => 'G', 'password' => 'secret12', 'role' => 'guest'])
            ->assertStatus(422);
        $this->postJson('/os/users/update', ['username' => 'guest', 'changes' => ['role' => 'admin']])->assertNotFound();
        $this->postJson('/os/users/delete', ['username' => 'guest'])->assertNotFound();
        $this->getJson('/os/users/list')->assertJsonCount(1, 'result');
        $this->assertSame(Role::Guest, Guest::account()->role);
    }

    public function test_an_existing_account_called_guest_stops_it_being_turned_on(): void
    {
        User::factory()->create(['username' => 'guest']);

        $this->expectException(ValidationException::class);
        SystemSettings::save(['guestEnabled' => true]);
    }

    public function test_administrators_turn_guest_on_from_settings(): void
    {
        $this->actingAs(User::query()->where('username', 'owner')->first())
            ->postJson('/os/system/save', ['system' => ['guestEnabled' => true, 'guestWeb' => false]])
            ->assertOk()
            ->assertJsonPath('result.guestEnabled', true)
            ->assertJsonPath('result.guestWeb', false);
        $this->assertFalse(Guest::account()->isDisabled());

        $this->getJson('/os/system/get')->assertJsonPath('result.localApps', config('liteos.local_apps'));
    }

    public function test_the_last_administrator_rule_ignores_the_guest(): void
    {
        $this->turnOn();

        $this->expectException(ValidationException::class);
        Accounts::update(User::query()->where('username', 'owner')->first(), ['role' => 'user']);
    }

    public function test_a_guest_opens_apps_only_in_the_desktops_windows(): void
    {
        $this->actingAs($this->turnOn());

        // a typed address or a new tab (and a browser that doesn't say) goes back to the desktop
        $this->withHeader('Sec-Fetch-Dest', 'document')->get('/apps/settings')->assertRedirect('/');
        $this->get('/apps/settings')->assertRedirect('/');
        $this->withHeader('Sec-Fetch-Dest', 'iframe')->get('/apps/settings')->assertOk();
    }

    public function test_other_accounts_can_still_open_an_app_page_on_its_own(): void
    {
        $this->actingAs(User::query()->where('username', 'owner')->first());

        $this->withHeader('Sec-Fetch-Dest', 'document')->get('/apps/settings')->assertOk();
    }

    // ------------------------------------------------------------ files and settings in the browser

    public function test_pages_tell_the_browser_to_keep_a_guests_files_itself(): void
    {
        $this->actingAs($this->turnOn());

        $page = $this->withHeader('Sec-Fetch-Dest', 'iframe')->get('/apps/notes')->assertOk()->getContent();
        preg_match('/window\.LOS_CONFIG = (\{.*\});/', $page, $m);
        $config = json_decode($m[1], true);

        $this->assertTrue($config['guest']);
        $this->assertStringContainsString('assets/js/guest-drive.js', $page);
        // scripts that run before the desktop asks the server know the account, to keep its browser storage apart
        // and to leave out a LiteLink device's USB drives
        $this->assertSame('guest', $config['account']);
        $this->assertFalse($config['can']['usb']);
        $this->assertFalse($config['can']['settingsDevice']);
        $this->assertSame(config('liteos.guest_quota_mb') * 1024 * 1024, $config['guestQuota']);
        $this->assertTrue(Capabilities::for(Guest::account())['files']);
        $this->assertFalse(Capabilities::for(Guest::account())['drive']);
    }

    public function test_other_accounts_keep_their_files_on_the_server(): void
    {
        $this->actingAs(User::query()->where('username', 'owner')->first());

        $page = $this->get('/apps/notes')->assertOk()->getContent();
        preg_match('/window\.LOS_CONFIG = (\{.*\});/', $page, $m);

        $this->assertFalse(json_decode($m[1], true)['guest']);
        $this->assertStringNotContainsString('guest-drive.js', $page);
    }

    public function test_nothing_of_a_guests_settings_is_kept_on_the_server(): void
    {
        $guest = $this->turnOn();
        $guest->settings()->create(['settings' => ['theme' => 'dark']]);
        $this->actingAs($guest);

        $this->postJson('/os/settings/save', ['settings' => ['theme' => 'dark']])->assertForbidden();
        $this->getJson('/os/settings/get')
            ->assertOk()
            ->assertJsonPath('result.theme', 'light')
            ->assertJsonPath('result.desktopIcons', ['files', 'trash']);
    }

    public function test_a_guest_cant_download_to_the_server(): void
    {
        $this->actingAs($this->turnOn());

        $this->postJson('/os/net/fetch', ['url' => 'https://example.com/a.pdf'])
            ->assertForbidden()
            ->assertJsonPath('message', 'Guests can’t download files to this computer yet.');
        $this->assertFalse(Storage::disk('drives')->exists('guest'));
    }
}
