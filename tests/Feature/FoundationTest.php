<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Blade;
use Tests\TestCase;

// Groundwork every page and API reply relies on: the security headers, the JSON error shape the shell and SDK read,
// and @versioned asset URLs.
class FoundationTest extends TestCase
{
    use RefreshDatabase;

    public function test_every_response_carries_the_security_headers(): void
    {
        $this->get('/')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('X-Frame-Options', 'SAMEORIGIN')
            ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
            ->assertHeader('Content-Security-Policy', "frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
    }

    public function test_errors_from_the_desktop_api_are_json_with_success_and_a_message(): void
    {
        $this->get('/os/no-such-thing')
            ->assertNotFound()
            ->assertExactJson(['success' => false, 'message' => 'That doesn’t exist.']);
    }

    public function test_versioned_assets_are_stamped_with_the_file_change_time(): void
    {
        $html = Blade::render("@versioned('assets/js/os.js')");

        $this->assertSame(asset('assets/js/os.js').'?v='.filemtime(public_path('assets/js/os.js')), html_entity_decode($html));
    }

    public function test_the_file_kinds_the_sdk_hands_to_apps_are_configured(): void
    {
        $this->assertContains('png', config('liteos.kinds.image'));
        $this->assertContains('mp4', config('liteos.kinds.video'));
        $this->assertContains('mp3', config('liteos.kinds.audio'));
        $this->assertContains('md', config('liteos.kinds.text'));
    }
}
