<?php

namespace Tests\Feature;

use App\Models\TrashItem;
use App\Models\User;
use App\Services\WebClient;
use App\Support\Drive;
use App\Support\Fs;
use App\Support\PublicAddress;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

// When the disk refuses (a full disk, a locked file), nothing is recorded as done: the Trash, the drive and the
// accounts change their records only after the disk did, and the user gets one plain sentence. Failures are made
// with Fs::failUsing().
class FilesystemFailureTest extends TestCase
{
    use RefreshDatabase;

    private User $amina;

    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('drives');
        $this->amina = User::factory()->create(['username' => 'amina']);
        Drive::ensureHome('amina');
        $this->root = Drive::root('amina');
        $this->actingAs($this->amina);
        File::put($this->root.'/Documents/report.txt', 'twelve bytes');
        File::put($this->root.'/Documents/notes.txt', 'notes');
    }

    protected function tearDown(): void
    {
        Fs::failUsing(null);
        PublicAddress::resolveUsing(null);
        WebClient::stopFaking();
        parent::tearDown();
    }

    private function failOn(string $operation, string $pathContains = ''): void
    {
        Fs::failUsing(fn (string $op, string $path) => $op === $operation && str_contains(str_replace('\\', '/', $path), $pathContains));
    }

    // ------------------------------------------------------------ Trash

    public function test_an_item_that_cant_be_moved_to_the_trash_stays_and_isnt_recorded(): void
    {
        $this->failOn('rename', 'report.txt');

        $this->postJson('/os/fs/delete', ['paths' => ['/Documents/notes.txt', '/Documents/report.txt']])
            ->assertStatus(500)
            ->assertJsonPath('message', 'Couldn’t move “report.txt” to the Trash.');

        $this->assertFileExists($this->root.'/Documents/report.txt');
        $this->assertFileDoesNotExist($this->root.'/Documents/notes.txt'); // moved before the failure, and recorded
        $this->assertSame(['notes.txt'], TrashItem::query()->pluck('name')->all());
    }

    public function test_an_item_that_cant_be_restored_stays_in_the_trash(): void
    {
        $this->postJson('/os/fs/delete', ['paths' => ['/Documents/report.txt']])->assertOk();
        $item = TrashItem::query()->firstOrFail();
        $this->failOn('rename', '.trash');

        $this->postJson('/os/trash/restore', ['ids' => [$item->trash_id]])
            ->assertStatus(500)
            ->assertJsonPath('message', 'Couldn’t restore “report.txt”.');

        $this->assertTrue(TrashItem::query()->whereKey($item->id)->exists());
        $this->assertFileDoesNotExist($this->root.'/Documents/report.txt');
        $this->getJson('/os/trash/list')->assertJsonCount(1, 'result');
    }

    public function test_an_item_that_cant_be_erased_keeps_its_record_and_the_rest_are_erased(): void
    {
        $this->postJson('/os/fs/delete', ['paths' => ['/Documents/report.txt', '/Documents/notes.txt']])->assertOk();
        $stuck = TrashItem::query()->where('name', 'report.txt')->firstOrFail();
        $this->failOn('delete', $stuck->trash_id);

        $this->postJson('/os/trash/purge', [])
            ->assertStatus(500)
            ->assertJsonPath('message', 'One item couldn’t be deleted. Try again.');

        $this->assertSame(['report.txt'], TrashItem::query()->pluck('name')->all());
        $this->assertFileExists(Storage::disk('drives')->path('.trash/amina/'.$stuck->trash_id));
        $this->assertSame(12, Drive::usage('amina')); // still counted, so the quota matches what's on disk
    }

    // ------------------------------------------------------------ drive

    public function test_a_failed_rename_move_or_copy_is_reported_not_returned_as_done(): void
    {
        File::makeDirectory($this->root.'/Documents/Old');
        File::put($this->root.'/Documents/Old/a.txt', 'a');

        $this->failOn('rename');
        $this->postJson('/os/fs/rename', ['path' => '/Documents/report.txt', 'name' => 'final.txt'])
            ->assertStatus(500)->assertJsonPath('message', 'Couldn’t rename “report.txt”.');
        $this->postJson('/os/fs/move', ['paths' => ['/Documents/report.txt'], 'dest' => '/Pictures'])
            ->assertStatus(500)->assertJsonPath('message', 'Couldn’t move “report.txt”.');
        $this->assertFileExists($this->root.'/Documents/report.txt');

        $this->failOn('copy');
        $this->postJson('/os/fs/copy', ['paths' => ['/Documents/Old'], 'dest' => '/Pictures'])
            ->assertStatus(500)->assertJsonPath('message', 'Couldn’t copy “Old”.');
        $this->assertDirectoryDoesNotExist($this->root.'/Pictures/Old');
    }

    // ------------------------------------------------------------ downloads

    public function test_a_download_that_cant_be_saved_leaves_nothing_behind(): void
    {
        PublicAddress::resolveUsing(fn () => ['93.184.216.34']);
        WebClient::fake(['example.com/*' => [200, ['Content-Type' => 'application/pdf'], '%PDF-1.4']]);
        Fs::failUsing(fn (string $op) => in_array($op, ['rename', 'copy'], true));

        $this->postJson('/os/net/fetch', ['url' => 'https://example.com/report.pdf'])
            ->assertStatus(500)
            ->assertJsonPath('message', 'Couldn’t save the download to your drive.');

        $this->assertSame([], array_values(array_diff(scandir($this->root.'/Downloads'), ['.', '..'])));
    }

    public function test_a_download_falls_back_to_copying_when_the_move_fails(): void
    {
        PublicAddress::resolveUsing(fn () => ['93.184.216.34']);
        WebClient::fake(['example.com/*' => [200, ['Content-Type' => 'application/pdf'], '%PDF-1.4']]);
        $this->failOn('rename'); // as when the temp folder is on another disk

        $this->postJson('/os/net/fetch', ['url' => 'https://example.com/report.pdf'])
            ->assertOk()
            ->assertJsonPath('result.path', '/Downloads/report.pdf');
        $this->assertSame('%PDF-1.4', File::get($this->root.'/Downloads/report.pdf'));
    }

    // ------------------------------------------------------------ accounts

    public function test_an_account_whose_files_cant_be_moved_aside_isnt_deleted(): void
    {
        $admin = User::factory()->admin()->create(['username' => 'admin']);
        $this->failOn('rename', '/amina');

        $this->actingAs($admin)->postJson('/os/users/delete', ['username' => 'amina'])
            ->assertStatus(500)
            ->assertJsonPath('message', 'Couldn’t move the account’s files aside, so the account wasn’t deleted.');

        $this->assertTrue(User::query()->where('username', 'amina')->exists());
        $this->assertFileExists($this->root.'/Documents/report.txt');
    }
}
