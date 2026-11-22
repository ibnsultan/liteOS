<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\SessionLock;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

// LiteOS never shows inside itself (App\Http\Middleware\TopLevelOnly): the desktop, sign-in, setup and lock pages
// asked for inside a frame get a page that moves the whole tab there instead, and are never framed otherwise; app
// windows and the lock screen over the desktop's windows are framed by the desktop as before.
class TopLevelOnlyTest extends TestCase
{
    use RefreshDatabase;

    private User $amina;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('drives');
        $this->amina = User::factory()->create(['username' => 'amina']);
    }

    private function inFrame(): static
    {
        return $this->withHeader('Sec-Fetch-Dest', 'iframe');
    }

    public function test_the_sign_in_page_in_a_frame_moves_the_whole_tab_instead(): void
    {
        $this->inFrame()->get('/login')
            ->assertOk()
            ->assertSee('window.top.location.replace', false)
            ->assertDontSee('name="password"', false)
            ->assertDontSee('name="username"', false);
    }

    public function test_the_desktop_in_a_frame_moves_the_whole_tab_instead(): void
    {
        $this->actingAs($this->amina);

        $this->inFrame()->get('/')->assertOk()->assertSee('window.top.location.replace', false)->assertDontSee('LOS_CONFIG', false);
        // signed in, the sign-in page would send the frame to the desktop: it never gets that far
        $this->inFrame()->get('/login')->assertOk()->assertSee('window.top.location.replace', false);
    }

    public function test_an_app_window_whose_session_ended_takes_the_desktop_to_sign_in(): void
    {
        // the app page sends a signed-out frame to the sign-in page, which moves the whole tab there
        $this->inFrame()->get('/apps/notes')->assertRedirect('/login');
        $this->inFrame()->get('/login')->assertSee(json_encode(url('/login')), false);
    }

    public function test_these_pages_are_never_framed_otherwise(): void
    {
        $page = $this->get('/login')->assertOk();
        $page->assertHeader('X-Frame-Options', 'DENY');
        $this->assertStringContainsString("frame-ancestors 'none'", $page->headers->get('Content-Security-Policy'));

        $this->actingAs($this->amina);
        $this->assertStringContainsString("frame-ancestors 'none'", $this->get('/')->headers->get('Content-Security-Policy'));
    }

    public function test_app_windows_and_the_desktops_lock_screen_are_still_framed_by_the_desktop(): void
    {
        $this->actingAs($this->amina);

        $app = $this->inFrame()->get('/apps/notes')->assertOk();
        $this->assertStringContainsString("frame-ancestors 'self'", $app->headers->get('Content-Security-Policy'));
        $app->assertDontSee('window.top.location.replace', false);

        $this->withSession([SessionLock::KEY => true])->inFrame()->get('/lock?embed=1')
            ->assertOk()->assertDontSee('window.top.location.replace', false);
    }
}
