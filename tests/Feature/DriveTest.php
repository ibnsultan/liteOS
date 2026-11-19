<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Drive;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

// The drive (/os/fs/*): the same arguments, replies and messages as the MVP's fs.* actions, and the rules that keep
// each user inside their own drive and quota.
class DriveTest extends TestCase
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
    }

    private function makeFile(string $path, string $content): void
    {
        File::put(Drive::root('amina').$path, $content);
    }

    public function test_a_folder_lists_folders_first_then_files_by_name_without_hidden_items(): void
    {
        $this->makeFile('/Documents/b10.txt', 'b');
        $this->makeFile('/Documents/b9.txt', 'a');
        File::makeDirectory(Drive::root('amina').'/Documents/Zeta');
        File::makeDirectory(Drive::root('amina').'/Documents/.app-data');

        $this->getJson('/os/fs/list?path=/Documents')
            ->assertOk()
            ->assertJsonPath('result.*.name', ['Zeta', 'b9.txt', 'b10.txt'])
            ->assertJsonPath('result.1.path', '/Documents/b9.txt')
            ->assertJsonPath('result.1.type', 'file')
            ->assertJsonPath('result.1.ext', 'txt')
            ->assertJsonPath('result.1.size', 1);
    }

    public function test_writing_reading_and_stat(): void
    {
        $this->postJson('/os/fs/write', ['path' => '/Documents/note.md', 'content' => '# Hello'])
            ->assertOk()
            ->assertJsonPath('result.path', '/Documents/note.md');

        $this->getJson('/os/fs/read?path=/Documents/note.md')->assertOk()->assertJsonPath('result.content', '# Hello');
        $this->getJson('/os/fs/stat?path=/Documents/note.md')->assertOk()->assertJsonPath('result.size', 7);
        $this->postJson('/os/fs/write', ['path' => '/Documents/note.md', 'content' => 'again', 'overwrite' => false])
            ->assertStatus(409)
            ->assertJsonPath('message', 'A file with that name already exists.');
    }

    public function test_a_new_empty_file_can_be_created(): void
    {
        $this->postJson('/os/fs/write', ['path' => '/Documents/Untitled.ldoc', 'content' => '', 'overwrite' => false])
            ->assertOk()
            ->assertJsonPath('result.size', 0);
    }

    public function test_pictures_are_written_from_base64(): void
    {
        $png = base64_encode("\x89PNG\r\n\x1a\nfake");
        $this->postJson('/os/fs/write', ['path' => '/Pictures/frame.png', 'content' => $png, 'encoding' => 'base64'])->assertOk();

        $this->assertSame("\x89PNG\r\n\x1a\nfake", File::get(Drive::root('amina').'/Pictures/frame.png'));
    }

    public function test_paths_cannot_leave_the_drive(): void
    {
        File::put(Storage::disk('drives')->path('secret.txt'), 'not yours');

        foreach (['/../secret.txt', '/Documents/../../secret.txt', '..\\secret.txt'] as $path) {
            $this->getJson('/os/fs/read?path='.urlencode($path))
                ->assertStatus(400)
                ->assertJsonPath('message', 'Invalid path.');
        }
        $this->postJson('/os/fs/write', ['path' => '/../amina-escape.txt', 'content' => 'x'])->assertStatus(400);
        $this->postJson('/os/fs/move', ['paths' => ['/Documents'], 'dest' => '/..'])->assertStatus(400);
        $this->assertFileDoesNotExist(Storage::disk('drives')->path('amina-escape.txt'));
    }

    public function test_one_user_never_sees_another_users_files(): void
    {
        User::factory()->create(['username' => 'baraka']);
        Drive::ensureHome('baraka');
        File::put(Drive::root('baraka').'/Documents/private.txt', 'baraka only');

        $this->getJson('/os/fs/read?path=/Documents/private.txt')->assertNotFound()->assertJsonPath('message', 'File not found.');
        $this->getJson('/os/fs/search?q=private')->assertOk()->assertJsonCount(0, 'result');
    }

    public function test_names_with_forbidden_characters_are_refused(): void
    {
        $this->postJson('/os/fs/mkdir', ['path' => '/Documents/a:b'])
            ->assertStatus(400)
            ->assertJsonPath('message', 'File names can’t contain < > : " | ? * characters.');
    }

    public function test_folders_are_made_renamed_and_kept_unique(): void
    {
        $this->postJson('/os/fs/mkdir', ['path' => '/Documents/Plans'])->assertOk();
        $this->postJson('/os/fs/mkdir', ['path' => '/Documents/Plans'])->assertStatus(409)->assertJsonPath('message', 'Something with that name already exists.');

        $this->postJson('/os/fs/rename', ['path' => '/Documents/Plans', 'name' => '2027'])
            ->assertOk()
            ->assertJsonPath('result.path', '/Documents/2027');
        $this->postJson('/os/fs/rename', ['path' => '/', 'name' => 'x'])->assertStatus(400)->assertJsonPath('message', 'You can’t rename your drive.');
    }

    public function test_copying_into_a_folder_with_the_same_name_adds_a_number(): void
    {
        $this->makeFile('/Documents/report.txt', 'r');
        $this->makeFile('/Desktop/report.txt', 'other');

        $this->postJson('/os/fs/copy', ['paths' => ['/Documents/report.txt'], 'dest' => '/Desktop'])
            ->assertOk()
            ->assertJsonPath('result.0.path', '/Desktop/report (2).txt');
        $this->postJson('/os/fs/move', ['paths' => ['/Documents/report.txt'], 'dest' => '/Pictures'])
            ->assertOk()
            ->assertJsonPath('result.0.path', '/Pictures/report.txt');
        $this->assertFileDoesNotExist(Drive::root('amina').'/Documents/report.txt');
    }

    public function test_a_folder_cannot_be_moved_into_itself(): void
    {
        File::makeDirectory(Drive::root('amina').'/Documents/Inner');

        $this->postJson('/os/fs/move', ['paths' => ['/Documents'], 'dest' => '/Documents/Inner'])
            ->assertStatus(400)
            ->assertJsonPath('message', 'You can’t move a folder into itself.');
    }

    public function test_the_quota_stops_writes_copies_and_uploads(): void
    {
        $this->amina->update(['quota_mb' => 10]);
        $this->makeFile('/Documents/big.bin', str_repeat('x', 9 * 1024 * 1024));

        $this->postJson('/os/fs/write', ['path' => '/Documents/more.txt', 'content' => str_repeat('y', 2 * 1024 * 1024)])
            ->assertStatus(507)
            ->assertJsonPath('message', 'Not enough storage space. Empty the Trash or ask an administrator for more space.');
        $this->postJson('/os/fs/copy', ['paths' => ['/Documents/big.bin'], 'dest' => '/Desktop'])->assertStatus(507);
        $this->post('/os/fs/upload', ['path' => '/Documents', 'files' => [UploadedFile::fake()->create('clip.mp4', 3 * 1024)]], ['Accept' => 'application/json'])
            ->assertStatus(507);

        $this->getJson('/os/fs/usage')->assertJsonPath('result.quota', 10 * 1024 * 1024);
    }

    public function test_uploads_are_saved_with_unique_names(): void
    {
        $this->makeFile('/Pictures/photo.jpg', 'old');

        $this->post('/os/fs/upload', ['path' => '/Pictures', 'files' => [UploadedFile::fake()->image('photo.jpg'), UploadedFile::fake()->image('second.png')]], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('result.0.path', '/Pictures/photo (2).jpg')
            ->assertJsonPath('result.1.path', '/Pictures/second.png');
    }

    public function test_an_upload_with_no_files_explains_the_size_limit(): void
    {
        $this->post('/os/fs/upload', ['path' => '/Pictures'], ['Accept' => 'application/json'])
            ->assertStatus(413)
            ->assertJsonPath('success', false);
    }

    public function test_search_finds_names_and_kinds_but_never_hidden_app_data(): void
    {
        $this->makeFile('/Music/Morning Song.mp3', 'a');
        $this->makeFile('/Documents/song lyrics.txt', 'b');
        File::makeDirectory(Drive::root('amina').'/.player');
        $this->makeFile('/.player/song-cache.mp3', 'c');

        $this->getJson('/os/fs/search?q=SONG')->assertJsonCount(2, 'result');
        $this->getJson('/os/fs/search?q=&kind=audio')->assertJsonCount(1, 'result')->assertJsonPath('result.0.name', 'Morning Song.mp3');
    }

    public function test_files_opened_or_saved_show_in_recent_but_app_data_does_not(): void
    {
        $this->postJson('/os/fs/write', ['path' => '/Documents/a.txt', 'content' => 'a']);
        $this->postJson('/os/fs/write', ['path' => '/Documents/b.txt', 'content' => 'b']);
        File::makeDirectory(Drive::root('amina').'/.browser');
        $this->postJson('/os/fs/write', ['path' => '/.browser/data.json', 'content' => '{}']);
        $this->getJson('/os/fs/read?path=/Documents/a.txt');
        $this->getJson('/os/fs/read?path=/Documents/b.txt&track=0');

        $this->getJson('/os/fs/recent')->assertOk()->assertJsonPath('result.*.path', ['/Documents/a.txt', '/Documents/b.txt']);
    }

    public function test_raw_serves_the_file_sandboxed_and_answers_range_requests(): void
    {
        $this->makeFile('/Videos/clip.mp4', '0123456789');

        $this->get('/os/fs/raw?path=/Videos/clip.mp4')
            ->assertOk()
            ->assertHeader('Content-Type', 'video/mp4')
            ->assertHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'self' data: blob: 'unsafe-inline'");

        $partial = $this->get('/os/fs/raw?path=/Videos/clip.mp4', ['Range' => 'bytes=2-5']);
        $partial->assertStatus(206)->assertHeader('Content-Range', 'bytes 2-5/10');
        $this->assertSame('2345', $partial->streamedContent());

        $this->get('/os/fs/raw?path=/Videos/clip.mp4&download=1')->assertDownload('clip.mp4');
    }

    public function test_reading_a_binary_file_as_text_is_refused_clearly(): void
    {
        $this->makeFile('/Pictures/x.png', "\x89PNG\xff\xfe");

        $this->getJson('/os/fs/read?path=/Pictures/x.png')
            ->assertStatus(415)
            ->assertJsonPath('message', 'This file can’t be opened as text.');
    }

    public function test_this_device_lists_the_drive_with_a_generic_disk_until_it_has_its_own_icon(): void
    {
        $this->getJson('/os/fs/drives')
            ->assertOk()
            ->assertJsonCount(1, 'result')
            ->assertJsonPath('result.0.path', '/')
            ->assertJsonPath('result.0.name', 'My drive')
            ->assertJsonPath('result.0.icon', null);

        $this->makeFile('/brand.ico', 'x');
        $this->makeFile('/Pictures/deep.ico', 'x');
        $this->getJson('/os/fs/drives')->assertJsonPath('result.0.icon', '/brand.ico');

        $this->makeFile('/autorun.ico', 'x');
        $this->getJson('/os/fs/drives')->assertJsonPath('result.0.icon', '/autorun.ico');
    }
}
