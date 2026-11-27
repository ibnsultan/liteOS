<?php

namespace Tests\Feature;

use App\Support\AppRegistry;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * AppRegistryTest
 *
 * The app list comes from the manifest.json files: the bundled apps in public/assets/apps, in launcher order, and
 * broken folders are skipped rather than breaking the desktop.
 */
class AppRegistryTest extends TestCase
{
    private string $tmp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tmp = storage_path('framework/testing/apps-'.uniqid());
        File::makeDirectory($this->tmp, 0755, true);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->tmp);
        parent::tearDown();
    }

    public function test_the_bundled_apps_are_listed_in_launcher_order(): void
    {
        $registry = app(AppRegistry::class);

        $this->assertSame(
            ['files', 'documents', 'sheets', 'slides', 'database', 'code', 'media', 'pdf', 'browser', 'board', 'notes', 'calculator', 'clock', 'archives', 'monitor', 'screenshot', 'calendar', 'settings'],
            $registry->ids(),
        );
    }

    public function test_files_and_settings_are_the_system_apps(): void
    {
        $system = array_column(array_filter(app(AppRegistry::class)->forClient(), fn (array $app) => $app['system']), 'id');

        $this->assertSame(['files', 'settings'], $system);
    }

    /**
     * LiteOS's own apps take their icon from the system icon set.
     */
    public function test_the_shell_gets_each_app_with_its_icon_window_and_file_types(): void
    {
        $media = collect(app(AppRegistry::class)->forClient())->firstWhere('id', 'media');

        $this->assertSame('Media', $media['name']);
        $this->assertSame('custom', $media['chrome']);
        $this->assertSame([1040, 660], $media['size']);
        $this->assertContains('mp4', $media['exts']);
        $this->assertContains('m3u8', $media['exts']);
        $this->assertSame('app.media', $media['role']);
        $this->assertStringEndsWith('/icons/liteos/light/apps/scalable/multimedia-video-player.svg', $media['img']);
        $this->assertStringEndsWith('/apps/media', $media['entry']);
    }

    public function test_an_app_the_icon_set_has_no_icon_for_keeps_its_own(): void
    {
        $this->makeApp('good', ['id' => 'good', 'name' => 'Good', 'version' => '1.0.0', 'entry' => 'index.html', 'icon' => 'icon.svg']);

        $good = (new AppRegistry($this->tmp))->forClient()[0];

        $this->assertNull($good['role']);
        $this->assertStringContainsString('assets/apps/good/icon.svg?v=', $good['img']);
    }

    public function test_an_app_without_a_usable_manifest_is_skipped_and_logged(): void
    {
        Log::spy();
        $this->makeApp('good', ['id' => 'good', 'name' => 'Good', 'version' => '1.0.0', 'entry' => 'index.html', 'icon' => 'icon.svg']);
        $this->makeApp('broken', null);
        $this->makeApp('renamed', ['id' => 'other', 'name' => 'Other', 'version' => '1.0.0', 'entry' => 'index.html', 'icon' => 'icon.svg']);
        $this->makeApp('noname', ['id' => 'noname', 'version' => '1.0.0', 'entry' => 'index.html', 'icon' => 'icon.svg']);

        $registry = new AppRegistry($this->tmp);

        $this->assertSame(['good'], $registry->ids());
        $this->assertNull($registry->find('other'));
        Log::shouldHaveReceived('warning')->times(3);
    }

    public function test_apps_not_in_the_launcher_order_follow_by_name(): void
    {
        foreach (['org.example.zebra' => 'Zebra', 'org.example.apple' => 'Apple', 'notes' => 'Notes'] as $id => $name) {
            $this->makeApp($id, ['id' => $id, 'name' => $name, 'version' => '1.0.0', 'entry' => 'index.html', 'icon' => 'icon.svg']);
        }

        $this->assertSame(['notes', 'org.example.apple', 'org.example.zebra'], (new AppRegistry($this->tmp))->ids());
    }

    /**
     * @param  array<string, mixed>|null  $manifest  null writes an unreadable manifest
     */
    private function makeApp(string $folder, ?array $manifest): void
    {
        File::makeDirectory($this->tmp.'/'.$folder);
        File::put($this->tmp.'/'.$folder.'/manifest.json', $manifest === null ? '{not json' : json_encode($manifest));
        File::put($this->tmp.'/'.$folder.'/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    }
}
