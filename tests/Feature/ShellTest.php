<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\AppRegistry;
use App\Support\SystemSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// The desktop page and the app windows' pages: Blade pages that carry LOS_CONFIG for the shell and the SDK, for a
// signed-in user (where everyone else is sent: see AuthTest).
class ShellTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::factory()->create());
    }

    public function test_the_desktop_page_carries_the_config_and_the_shell(): void
    {
        SystemSettings::put(['instanceName' => 'Lab Desk']);

        $this->get('/')
            ->assertOk()
            ->assertSee('<title>Lab Desk</title>', false)
            ->assertSee('window.LOS_CONFIG', false)
            ->assertSee('assets/js/os.js?v=', false)
            ->assertSee('class="boot"', false);
    }

    public function test_an_app_window_page_loads_the_sdk_and_its_own_files(): void
    {
        $this->get('/apps/sheets')
            ->assertOk()
            ->assertSee('<title>Sheets</title>', false)
            ->assertSee('window.LOS_CONFIG', false)
            ->assertSeeInOrder(['assets/js/sdk.js?v=', 'assets/apps/sheets/formula.js?v=', 'assets/apps/sheets/app.js?v='], false)
            ->assertSee('assets/apps/sheets/sheets.css?v=', false);
    }

    public function test_documents_loads_its_app_and_opens_its_own_and_word_files(): void
    {
        $this->get('/apps/documents')
            ->assertOk()
            ->assertSee('assets/apps/documents/index.css?v=', false)
            ->assertSee('id="root"', false);

        $docs = collect(app(AppRegistry::class)->forClient())->firstWhere('id', 'documents');
        $this->assertContains('ldoc', $docs['exts'] ?? $docs['opens'] ?? []);
        $this->assertContains('docx', $docs['exts'] ?? $docs['opens'] ?? []);
    }

    public function test_the_old_documents_app_is_gone(): void
    {
        $this->get('/apps/docs')->assertNotFound();
        $this->assertNull(collect(app(AppRegistry::class)->forClient())->firstWhere('id', 'docs'));
    }

    public function test_an_unknown_app_is_not_found(): void
    {
        $this->get('/apps/nope')->assertNotFound();
    }

    public function test_every_bundled_app_has_a_window_page(): void
    {
        foreach (['files', 'documents', 'sheets', 'slides', 'code', 'media', 'browser', 'board', 'notes', 'settings'] as $app) {
            $this->get('/apps/'.$app)->assertOk();
        }
    }
}
