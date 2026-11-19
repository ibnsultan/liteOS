<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Drive;
use App\Support\Trash;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

// The Trash (/os/fs/delete and /os/trash/*): deleting moves items aside, restore puts them back, purge erases them.
class TrashTest extends TestCase
{
    use RefreshDatabase;

    private User $amina;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('drives');
        $this->amina = User::factory()->create(['username' => 'amina']);
        Drive::ensureHome('amina');
        $this->actingAs($this->amina);
        File::put(Drive::root('amina').'/Documents/report.txt', 'twelve bytes');
        File::makeDirectory(Drive::root('amina').'/Documents/Old');
        File::put(Drive::root('amina').'/Documents/Old/a.txt', 'a');
    }

    public function test_deleting_moves_items_to_the_trash(): void
    {
        $this->postJson('/os/fs/delete', ['paths' => ['/Documents/report.txt', '/Documents/Old', '/Documents/missing.txt']])
            ->assertOk()
            ->assertJsonPath('result.trashed', 2);

        $this->assertFileDoesNotExist(Drive::root('amina').'/Documents/report.txt');
        $this->getJson('/os/trash/list')
            ->assertOk()
            ->assertJsonCount(2, 'result')
            ->assertJsonPath('result.1.name', 'report.txt')
            ->assertJsonPath('result.1.original', '/Documents/report.txt')
            ->assertJsonPath('result.1.size', 12)
            ->assertJsonPath('result.0.type', 'dir');
    }

    public function test_restoring_puts_an_item_back_with_a_new_name_if_taken(): void
    {
        $this->postJson('/os/fs/delete', ['paths' => ['/Documents/report.txt']]);
        File::put(Drive::root('amina').'/Documents/report.txt', 'a new one');
        $id = $this->getJson('/os/trash/list')->json('result.0.id');

        $this->postJson('/os/trash/restore', ['ids' => [$id]])->assertOk()->assertJsonPath('result.restored', 1);

        $this->assertSame('twelve bytes', File::get(Drive::root('amina').'/Documents/report (2).txt'));
        $this->getJson('/os/trash/list')->assertJsonCount(0, 'result');
    }

    public function test_an_item_whose_folder_is_gone_comes_back_at_the_top_of_the_drive(): void
    {
        $this->postJson('/os/fs/delete', ['paths' => ['/Documents/Old/a.txt']]);
        File::deleteDirectory(Drive::root('amina').'/Documents/Old');
        $id = $this->getJson('/os/trash/list')->json('result.0.id');

        $this->postJson('/os/trash/restore', ['ids' => [$id]])->assertOk();

        $this->assertFileExists(Drive::root('amina').'/a.txt');
    }

    public function test_emptying_the_trash_erases_everything_in_it(): void
    {
        $this->postJson('/os/fs/delete', ['paths' => ['/Documents/report.txt', '/Documents/Old']]);

        $this->postJson('/os/trash/purge', ['ids' => []])->assertOk()->assertJsonPath('result.deleted', 2);

        $this->getJson('/os/trash/list')->assertJsonCount(0, 'result');
        $this->assertSame([], File::files(Trash::root('amina')));
        $this->assertSame([], File::directories(Trash::root('amina')));
    }

    public function test_items_in_the_trash_still_count_towards_storage(): void
    {
        $before = $this->getJson('/os/fs/usage')->json('result.used');
        $this->postJson('/os/fs/delete', ['paths' => ['/Documents/report.txt']]);

        $this->assertSame($before, $this->getJson('/os/fs/usage')->json('result.used'));
    }

    public function test_a_user_cannot_restore_or_purge_someone_elses_trash(): void
    {
        $this->postJson('/os/fs/delete', ['paths' => ['/Documents/report.txt']]);
        $id = $this->getJson('/os/trash/list')->json('result.0.id');

        $baraka = User::factory()->create(['username' => 'baraka']);
        $this->actingAs($baraka);
        $this->postJson('/os/trash/restore', ['ids' => [$id]])->assertJsonPath('result.restored', 0);
        $this->postJson('/os/trash/purge', ['ids' => [$id]])->assertJsonPath('result.deleted', 0);

        $this->actingAs($this->amina)->getJson('/os/trash/list')->assertJsonCount(1, 'result');
    }
}
