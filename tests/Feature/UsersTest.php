<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Drive;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

// Accounts and system settings for administrators (/os/users/*, /os/system/*), from Settings › Accounts and System.
class UsersTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $amina;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('drives');
        $this->admin = User::factory()->admin()->create(['username' => 'admin']);
        $this->amina = User::factory()->create(['username' => 'amina']);
    }

    public function test_only_administrators_manage_accounts_and_the_system(): void
    {
        $this->actingAs($this->amina);

        $this->getJson('/os/users/list')->assertForbidden()->assertJsonPath('message', 'Only administrators can do that.');
        $this->postJson('/os/users/create', ['username' => 'x1', 'name' => 'X', 'password' => 'secret12'])->assertForbidden();
        $this->getJson('/os/system/get')->assertForbidden();
    }

    public function test_the_list_shows_each_account_with_its_drive_use_and_quota(): void
    {
        Drive::ensureHome('amina');
        File::put(Drive::root('amina').'/Documents/a.txt', str_repeat('x', 1500));

        $this->actingAs($this->admin)->getJson('/os/users/list')
            ->assertOk()
            ->assertJsonCount(2, 'result')
            ->assertJsonPath('result.1.username', 'amina')
            ->assertJsonPath('result.1.used', 1500)
            ->assertJsonPath('result.1.quota', 1024 * 1024 * 1024)
            ->assertJsonMissingPath('result.1.password');
    }

    public function test_an_administrator_creates_an_account_with_its_drive(): void
    {
        $this->actingAs($this->admin)->postJson('/os/users/create', ['username' => 'Baraka', 'name' => 'Baraka M', 'password' => 'secret12', 'role' => 'user', 'quotaMB' => '500'])
            ->assertOk()
            ->assertJsonPath('result.username', 'baraka')
            ->assertJsonPath('result.quotaMB', 500);

        $this->assertDirectoryExists(Drive::root('baraka').'/Pictures');
        $this->postJson('/os/users/create', ['username' => 'baraka', 'name' => 'Again', 'password' => 'secret12'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'That username is already taken.');
    }

    public function test_a_disabled_account_is_signed_out_on_its_next_request(): void
    {
        $this->actingAs($this->admin)->postJson('/os/users/update', ['username' => 'amina', 'changes' => ['disabled' => true]])
            ->assertOk()
            ->assertJsonPath('result.disabled', true);

        $this->actingAs($this->amina->fresh())->getJson('/os/settings/get')->assertUnauthorized();
        $this->assertGuest();
    }

    public function test_an_administrator_cannot_disable_or_delete_themselves(): void
    {
        $this->actingAs($this->admin);

        $this->postJson('/os/users/update', ['username' => 'admin', 'changes' => ['disabled' => true]])
            ->assertStatus(400)
            ->assertJsonPath('message', 'You can’t disable your own account.');
        $this->postJson('/os/users/delete', ['username' => 'admin'])
            ->assertStatus(400)
            ->assertJsonPath('message', 'You can’t delete your own account while signed in.');
    }

    public function test_there_is_always_an_active_administrator(): void
    {
        $other = User::factory()->admin()->create(['username' => 'other']);
        $this->actingAs($other)->postJson('/os/users/update', ['username' => 'admin', 'changes' => ['role' => 'user']])->assertOk();

        // "other" is now the only administrator; another admin demoting them is impossible, so try via a third admin
        $third = User::factory()->admin()->create(['username' => 'third']);
        $this->actingAs($third)->postJson('/os/users/update', ['username' => 'other', 'changes' => ['role' => 'user']])->assertOk();
        $this->postJson('/os/users/update', ['username' => 'third', 'changes' => ['role' => 'user']])
            ->assertStatus(422)
            ->assertJsonPath('message', 'There must be at least one active administrator.');

        $this->assertTrue($third->fresh()->isAdmin());
    }

    public function test_deleting_an_account_keeps_its_files_aside(): void
    {
        Drive::ensureHome('amina');
        File::put(Drive::root('amina').'/Documents/keep.txt', 'keep me');

        $this->actingAs($this->admin)->postJson('/os/users/delete', ['username' => 'amina'])->assertOk();

        $this->assertNull(User::query()->firstWhere('username', 'amina'));
        $this->assertDirectoryDoesNotExist(Drive::root('amina'));
        $kept = glob(Storage::disk('drives')->path('.deleted').'/amina-*/Documents/keep.txt');
        $this->assertCount(1, $kept);
    }

    public function test_an_administrator_renames_the_instance_and_sets_the_default_quota(): void
    {
        $this->actingAs($this->admin)->postJson('/os/system/save', ['system' => ['instanceName' => 'Lab Desk', 'defaultQuotaMB' => 2048]])
            ->assertOk()
            ->assertJsonPath('result.instanceName', 'Lab Desk')
            ->assertJsonPath('result.defaultQuotaMB', 2048);

        $this->getJson('/os/system/get')->assertJsonPath('result.userCount', 2);
        $this->postJson('/os/system/save', ['system' => ['instanceName' => '  ']])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Enter a name for this LiteOS (up to 40 characters).');
    }
}
