<?php

namespace Tests\Feature;

use App\Support\SystemIcons;
use Tests\TestCase;

// Every system icon comes from the icon set in public/icons/liteos through its map.json: each role must point at a
// file that exists in both the light and the dark folder, so a broken entry fails here rather than showing a broken
// image in the shell.
class SystemIconsTest extends TestCase
{
    private function icons(): SystemIcons
    {
        return app(SystemIcons::class);
    }

    public function test_every_mapped_role_has_a_light_and_a_dark_file(): void
    {
        $this->assertSame([], $this->icons()->problems());
    }

    public function test_every_bundled_app_and_settings_page_has_a_role(): void
    {
        $missing = [];
        foreach (['files', 'documents', 'sheets', 'slides', 'code', 'browser', 'media', 'notes', 'board', 'settings'] as $app) {
            if (! $this->icons()->has('app.'.$app)) {
                $missing[] = 'app.'.$app;
            }
        }
        foreach (['personalisation', 'taskbar', 'apps', 'notifications', 'storage', 'accessibility', 'accounts', 'system', 'about'] as $page) {
            if (! $this->icons()->has('settings.'.$page)) {
                $missing[] = 'settings.'.$page;
            }
        }
        foreach (['launcher', 'trash', 'trash-full'] as $part) {
            if (! $this->icons()->has('shell.'.$part)) {
                $missing[] = 'shell.'.$part;
            }
        }

        $this->assertSame([], $missing);
    }

    public function test_every_extension_an_app_opens_has_its_own_file_icon(): void
    {
        $unmapped = [];
        foreach (glob(config('liteos.apps_path').'/*/manifest.json') ?: [] as $file) {
            foreach (json_decode((string) file_get_contents($file), true)['opens'] ?? [] as $extension) {
                if ($this->icons()->roleForFile('x.'.$extension) === $this->icons()->map()['fallback']) {
                    $unmapped[] = $extension;
                }
            }
        }

        $this->assertSame([], $unmapped);
    }

    public function test_a_role_resolves_to_the_file_for_the_theme(): void
    {
        $this->assertSame('icons/liteos/light/apps/scalable/libreoffice-calc.svg', $this->icons()->path('app.sheets'));
        $this->assertSame('icons/liteos/dark/apps/scalable/libreoffice-calc.svg', $this->icons()->path('app.sheets', 'dark'));
        $this->assertSame('icons/liteos/light/actions/32/edit-copy.svg', $this->icons()->path('action.copy'));
        $this->assertSame('icons/liteos/dark/actions/symbolic/edit-copy-symbolic.svg', $this->icons()->path('action.copy', 'dark', symbolic: true));
        // an entry can name its own size folder
        $this->assertSame('icons/liteos/dark/actions/symbolic/window-close-symbolic.svg', $this->icons()->path('window.close', 'dark'));
    }

    public function test_unknown_roles_and_missing_variants_fall_back(): void
    {
        $fallback = $this->icons()->path($this->icons()->map()['fallback']);

        $this->assertSame($fallback, $this->icons()->path('app.no-such-app'));
        // a theme LiteOS doesn't have is read as light
        $this->assertSame($this->icons()->path('app.sheets'), $this->icons()->path('app.sheets', 'sepia'));
        // the mime icons have no symbolic variants, so the full-colour one is used
        $this->assertSame($this->icons()->path('mime.pdf'), $this->icons()->path('mime.pdf', symbolic: true));
    }

    public function test_file_names_map_to_roles_by_extension(): void
    {
        $this->assertSame('mime.xlsx', $this->icons()->roleForFile('Budget.XLSX'));
        $this->assertSame('mime.spreadsheet', $this->icons()->roleForFile('notes.lsheet'));
        $this->assertSame('mime.generic', $this->icons()->roleForFile('README'));
    }

    public function test_the_shell_gets_the_resolved_table(): void
    {
        $client = $this->icons()->forClient();

        $this->assertStringEndsWith('/icons/liteos/', $client['base']);
        $this->assertSame('apps/scalable/libreoffice-calc', $client['icons']['app.sheets']);
        $this->assertSame('actions/symbolic/edit-copy-symbolic', $client['symbolic']['action.copy']);
        $this->assertArrayNotHasKey('mime.pdf', $client['symbolic']);
        $this->assertSame('mime.xlsx', $client['extensions']['xlsx']);
        $this->assertCount(count($this->icons()->map()['icons']), $client['icons']);
    }
}
