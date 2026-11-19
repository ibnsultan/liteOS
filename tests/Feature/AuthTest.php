<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Drive;
use App\Support\SignIn;
use App\Support\SystemSettings;
use App\Support\UserSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

// The pages before the desktop: first-run setup (/setup), signing in (/login), the lock screen (/lock), signing out,
// and where each kind of visitor is sent. All of them are real form posts; the desktop only asks /auth/status, locks
// and signs out in JSON.
class AuthTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('drives');
    }

    private function amina(array $attributes = []): User
    {
        return User::factory()->create(['username' => 'amina', 'name' => 'Amina Juma'] + $attributes);
    }

    // ------------------------------------------------------------ first run

    public function test_a_new_install_sends_every_page_to_setup(): void
    {
        $this->getJson('/auth/status')->assertOk()->assertJsonPath('result.setupNeeded', true)->assertJsonPath('result.user', null);
        $this->get('/')->assertRedirect('/setup');
        $this->get('/login')->assertRedirect('/setup');
        $this->get('/setup')->assertOk()->assertSee('Welcome to LiteOS')->assertSee('assets/js/setup.js?v=', false);
    }

    public function test_setup_creates_the_administrator_with_their_look_and_opens_the_desktop(): void
    {
        $this->post('/setup', [
            'instanceName' => 'Lab Desk', 'name' => 'Abdul Basit', 'username' => 'Abdul',
            'password' => 'secret12', 'password_confirmation' => 'secret12',
            'theme' => 'dark', 'accent' => '#1A8A54', 'taskbar' => 'classic',
        ])->assertRedirect('/')->assertSessionHas('welcome', true)->assertCookie(SignIn::LAST_USER_COOKIE);

        $user = User::query()->sole();
        $this->assertAuthenticatedAs($user);
        $this->assertSame(['abdul', 'admin'], [$user->username, $user->role->value]);
        $this->assertSame('Lab Desk', SystemSettings::get('instanceName'));
        $settings = UserSettings::for($user);
        $this->assertSame(['dark', '#1A8A54', 'classic'], [$settings['theme'], $settings['accent'], $settings['taskbar']]);
        $this->assertDirectoryExists(Drive::root('abdul').'/Documents');

        $this->get('/')->assertOk()->assertSee('"welcome":true', false);
    }

    public function test_setup_errors_come_back_to_the_wizard_with_what_was_typed(): void
    {
        $this->from('/setup')->post('/setup', ['instanceName' => 'Lab', 'name' => 'Abdul', 'username' => 'a b', 'password' => 'secret12', 'password_confirmation' => 'secret12'])
            ->assertRedirect('/setup')
            ->assertSessionHasErrors('username')
            ->assertSessionHasInput('name', 'Abdul')
            ->assertSessionMissing('_old_input.password');

        $this->from('/setup')->post('/setup', ['instanceName' => 'Lab', 'name' => 'Abdul', 'username' => 'abdul', 'password' => 'secret12', 'password_confirmation' => 'secret13'])
            ->assertSessionHasErrors(['password_confirmation' => 'The passwords don’t match.']);

        $this->assertGuest();
        $this->assertSame(0, User::query()->count());
    }

    public function test_setup_is_closed_once_there_is_an_account(): void
    {
        $this->amina();

        $this->get('/setup')->assertRedirect('/');
        $this->post('/setup', ['instanceName' => 'x', 'name' => 'Eve', 'username' => 'eve', 'password' => 'secret12', 'password_confirmation' => 'secret12'])->assertRedirect('/');
        $this->assertSame(1, User::query()->count());
        $this->assertGuest();
    }

    // ------------------------------------------------------------ signing in

    public function test_guests_are_sent_to_sign_in(): void
    {
        $this->amina();

        $this->get('/')->assertRedirect('/login');
        $this->get('/apps/files')->assertRedirect('/login');
        $this->getJson('/os/settings/get')->assertUnauthorized();
        $this->get('/login')->assertOk()->assertSee('Enter your username to continue');
    }

    public function test_the_username_step_shows_only_that_accounts_name_and_avatar(): void
    {
        $this->amina();
        User::factory()->create(['username' => 'baraka', 'name' => 'Baraka Otieno']);

        $this->get('/login?username=Amina')
            ->assertOk()
            ->assertSee('Amina Juma')->assertSee('>AJ<', false)->assertSee('Not Amina? Use another account')
            ->assertDontSee('Baraka');
    }

    public function test_unknown_and_disabled_accounts_look_the_same(): void
    {
        $this->amina(['disabled_at' => now()]);

        foreach (['amina', 'nobody'] as $username) {
            $this->get('/login?username='.$username)->assertOk()->assertSee('We couldn’t find that account.')->assertDontSee('Amina Juma');
        }
        $this->get('/login?username=')->assertSee('Enter your username.');
    }

    public function test_signing_in_opens_the_desktop_and_the_device_remembers_the_account(): void
    {
        $this->amina();

        $this->post('/login', ['username' => 'AMINA', 'password' => 'password'])->assertRedirect('/')->assertCookie(SignIn::LAST_USER_COOKIE, 'amina');
        $this->assertAuthenticated();
        $this->get('/login')->assertRedirect('/');

        $this->post('/logout')->assertRedirect('/login');
        $this->assertGuest();

        // next time this device goes straight to Amina's password, unless asked for another account
        $this->withCookie(SignIn::LAST_USER_COOKIE, 'amina')->get('/login')->assertSee('Amina Juma')->assertSee('autocomplete="current-password"', false);
        $this->withCookie(SignIn::LAST_USER_COOKIE, 'amina')->get('/login?other=1')->assertSee('Enter your username to continue')->assertDontSee('Amina Juma');
    }

    public function test_a_wrong_password_or_a_disabled_account_is_refused(): void
    {
        $this->amina();
        User::factory()->disabled()->create(['username' => 'old']);

        $this->from('/login?username=amina')->post('/login', ['username' => 'amina', 'password' => 'nope'])
            ->assertRedirect('/login?username=amina')
            ->assertSessionHasErrors(['password' => 'Wrong password. Try again.']);
        $this->post('/login', ['username' => 'old', 'password' => 'password'])
            ->assertSessionHasErrors(['password' => 'This account is disabled. Ask an administrator.']);
        $this->assertGuest();
    }

    public function test_five_wrong_passwords_lock_the_username_for_a_while(): void
    {
        $this->amina();

        for ($i = 0; $i < 5; $i++) {
            $this->post('/login', ['username' => 'amina', 'password' => 'nope'])->assertSessionHasErrors('password');
        }
        $this->post('/login', ['username' => 'amina', 'password' => 'password'])
            ->assertSessionHasErrors(['password' => 'Too many attempts. Try again in 5 minute(s).']);
        $this->assertGuest();
    }

    // ------------------------------------------------------------ the lock screen

    public function test_a_locked_session_stays_locked_until_the_password_is_entered(): void
    {
        $this->actingAs($this->amina());

        $this->postJson('/auth/lock')->assertOk()->assertJsonPath('result.lock', route('lock', ['embed' => 1]));

        // the desktop, its windows and its API are all closed while locked; a reload lands on the lock page
        $this->getJson('/os/settings/get')->assertStatus(423)->assertJsonPath('message', 'LiteOS is locked. Unlock it to continue.');
        $this->get('/')->assertRedirect('/lock');
        $this->get('/apps/files')->assertRedirect('/lock');
        $this->get('/lock')->assertOk()->assertSee('Amina Juma')->assertSee('Sign out instead');

        $this->from('/lock')->post('/unlock', ['password' => 'nope'])->assertRedirect('/lock')->assertSessionHasErrors(['password' => 'Wrong password. Try again.']);
        $this->getJson('/os/settings/get')->assertStatus(423);

        $this->post('/unlock', ['password' => 'password'])->assertRedirect('/');
        $this->getJson('/os/settings/get')->assertOk();
        $this->get('/lock')->assertRedirect('/');
    }

    public function test_the_lock_screen_over_the_desktop_reports_back_when_unlocked(): void
    {
        $this->actingAs($this->amina());
        $this->postJson('/auth/lock');

        $this->get('/lock?embed=1')->assertOk()->assertSee('<input type="hidden" name="embed" value="1">', false)->assertDontSee('class="boot"', false);
        $this->post('/unlock', ['password' => 'password', 'embed' => '1'])->assertRedirect(route('lock', ['embed' => 1]));
        $this->get('/lock?embed=1')->assertOk()->assertSee("type: 'liteos-unlocked'", false);
    }

    public function test_signing_in_again_clears_an_old_lock(): void
    {
        $this->actingAs($this->amina())->postJson('/auth/lock');
        $this->post('/logout');

        $this->post('/login', ['username' => 'amina', 'password' => 'password'])->assertRedirect('/');
        $this->get('/')->assertOk();
    }

    // ------------------------------------------------------------ signing out

    public function test_the_desktop_signs_out_and_is_told_where_to_go(): void
    {
        $this->actingAs($this->amina());

        $this->postJson('/auth/logout')->assertOk()->assertJsonPath('result.next', route('login'));
        $this->assertGuest();
    }
}
