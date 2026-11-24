<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Drive;
use App\Support\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

// System Monitor › Storage: the user's own drive by folder with its largest files (/os/fs/summary), and every
// account's drive for administrators (/os/users/storage).
class StorageReportTest extends TestCase
{
    use RefreshDatabase;

    private User $amina;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('drives');
        $this->amina = User::factory()->create(['username' => 'amina']);
        Drive::ensureHome('amina');
        $disk = Storage::disk('drives');
        $disk->put('amina/Documents/report.txt', str_repeat('a', 3000));
        $disk->put('amina/Documents/sub/big.bin', str_repeat('b', 9000));
        $disk->put('amina/Desktop/note.txt', str_repeat('c', 500));
        $disk->put('amina/.apps/archives/state.json', str_repeat('d', 700));
    }

    public function test_the_own_drive_by_folder_with_its_largest_files(): void
    {
        $res = $this->actingAs($this->amina)->getJson('/os/fs/summary')->assertOk();
        $res->assertJsonPath('result.folders.0.name', 'Documents')
            ->assertJsonPath('result.folders.0.bytes', 12000)
            ->assertJsonPath('result.other', 700)
            ->assertJsonPath('result.used', 13200)
            ->assertJsonPath('result.largest.0.path', '/Documents/sub/big.bin');
        // hidden app data counts, but its files are never listed
        $this->assertNotContains('/.apps/archives/state.json', collect($res->json('result.largest'))->pluck('path')->all());
    }

    public function test_only_administrators_see_everyones_storage(): void
    {
        $this->actingAs($this->amina)->getJson('/os/users/storage')->assertForbidden();

        $admin = User::factory()->create(['username' => 'admin', 'role' => Role::Admin->value]);
        $res = $this->actingAs($admin)->getJson('/os/users/storage')->assertOk();
        $amina = collect($res->json('result'))->firstWhere('username', 'amina');
        $this->assertSame(['desktop' => 500, 'documents' => 12000, 'downloads' => 0, 'other' => 700], $amina['parts']);
        $this->assertSame(13200, $amina['used']);
    }
}
