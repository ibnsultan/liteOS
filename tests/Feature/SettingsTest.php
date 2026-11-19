<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

// Each user's own desktop settings (/os/settings/*) and their own account (/os/account/*).
class SettingsTest extends TestCase
{
    use RefreshDatabase;

    private User $amina;

    private User $baraka;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('drives');
        $this->amina = User::factory()->create(['username' => 'amina']);
        $this->baraka = User::factory()->create(['username' => 'baraka']);
    }

    public function test_settings_need_a_signed_in_user(): void
    {
        $this->getJson('/os/settings/get')->assertUnauthorized()->assertJsonPath('message', 'Please sign in.');
    }

    public function test_a_new_user_starts_from_the_defaults(): void
    {
        $this->actingAs($this->amina)->getJson('/os/settings/get')
            ->assertOk()
            ->assertJsonPath('result.theme', 'light')
            ->assertJsonPath('result.taskbar', 'floating')
            ->assertJsonPath('result.pinned', ['files', 'documents', 'sheets', 'slides', 'code', 'media', 'browser', 'board']);
    }

    public function test_each_user_keeps_their_own_settings(): void
    {
        $this->actingAs($this->amina)->postJson('/os/settings/save', ['settings' => ['theme' => 'dark', 'wallpaper' => 'aurora']])
            ->assertOk()
            ->assertJsonPath('result.theme', 'dark');
        $this->actingAs($this->baraka)->postJson('/os/settings/save', ['settings' => ['taskbar' => 'classic']])->assertOk();

        $this->actingAs($this->amina)->getJson('/os/settings/get')
            ->assertJsonPath('result.theme', 'dark')
            ->assertJsonPath('result.wallpaper', 'aurora')
            ->assertJsonPath('result.taskbar', 'floating');
        $this->actingAs($this->baraka)->getJson('/os/settings/get')
            ->assertJsonPath('result.theme', 'light')
            ->assertJsonPath('result.taskbar', 'classic');
    }

    public function test_saving_keeps_earlier_changes_and_drops_unacceptable_values(): void
    {
        $this->actingAs($this->amina)->postJson('/os/settings/save', ['settings' => ['theme' => 'dark']]);

        $this->postJson('/os/settings/save', ['settings' => [
            'accent' => '#c9306b',
            'theme' => 'purple',
            'volume' => 250,
            'pinned' => ['files', 'no-such-app', 'notes', 'files'],
            'secret' => 'ignored',
        ]])
            ->assertOk()
            ->assertJsonPath('result.theme', 'dark')
            ->assertJsonPath('result.accent', '#C9306B')
            ->assertJsonPath('result.volume', 100)
            ->assertJsonPath('result.pinned', ['files', 'notes'])
            ->assertJsonMissingPath('result.secret');
    }

    public function test_a_user_changes_their_display_name(): void
    {
        $this->actingAs($this->amina)->postJson('/os/account/update', ['name' => 'Amina Juma'])
            ->assertOk()
            ->assertJsonPath('result.name', 'Amina Juma');
    }

    public function test_changing_a_password_needs_the_current_one(): void
    {
        $this->actingAs($this->amina)->postJson('/os/account/password', ['current' => 'nope', 'new' => 'another1'])
            ->assertForbidden()
            ->assertJsonPath('message', 'Your current password is wrong.');

        $this->postJson('/os/account/password', ['current' => 'password', 'new' => 'abc'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Passwords must be at least 6 characters.');

        $this->postJson('/os/account/password', ['current' => 'password', 'new' => 'another1'])->assertOk();
        $this->assertTrue(Hash::check('another1', $this->amina->fresh()->password));
    }
}
