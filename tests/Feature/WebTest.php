<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\RelaySlots;
use App\Services\StreamRelay;
use App\Services\WebClient;
use App\Support\Drive;
use App\Support\PublicAddress;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

// The Browser's and Live TV's server side (/os/net/*): downloads into the drive, the frame check and the stream
// relay, and the guard that keeps all three away from local network addresses. DNS is replaced so nothing here
// depends on the network: *.lan names resolve to a private address, everything else to a public one.
class WebTest extends TestCase
{
    use RefreshDatabase;

    private User $amina;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('drives');
        PublicAddress::resolveUsing(fn (string $host) => str_ends_with($host, '.lan') ? ['192.168.1.20'] : ['93.184.216.34']);
        WebClient::fake([]);
        $this->amina = User::factory()->create(['username' => 'amina']);
        Drive::ensureHome('amina');
        $this->actingAs($this->amina);
    }

    protected function tearDown(): void
    {
        PublicAddress::resolveUsing(null);
        WebClient::stopFaking();
        parent::tearDown();
    }

    // ------------------------------------------------------------ downloads

    public function test_a_download_is_saved_into_downloads_under_the_name_the_site_gives(): void
    {
        WebClient::fake(['files.example.com/*' => [200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="Annual report.pdf"',
        ], '%PDF-1.4 report']]);

        $this->postJson('/os/net/fetch', ['url' => 'https://files.example.com/get?id=7'])
            ->assertOk()
            ->assertJsonPath('result.path', '/Downloads/Annual report.pdf')
            ->assertJsonPath('result.size', 15);

        $this->postJson('/os/net/fetch', ['url' => 'https://files.example.com/get?id=7'])
            ->assertJsonPath('result.path', '/Downloads/Annual report (2).pdf');
        $this->assertSame('%PDF-1.4 report', file_get_contents(Drive::root('amina').'/Downloads/Annual report.pdf'));
    }

    public function test_a_download_without_a_name_is_named_from_its_address_and_type(): void
    {
        WebClient::fake(['example.com/*' => [200, ['Content-Type' => 'text/html; charset=utf-8'], '<p>hi</p>']]);

        $this->postJson('/os/net/fetch', ['url' => 'https://example.com/docs/welcome'])
            ->assertJsonPath('result.path', '/Downloads/welcome.html');
    }

    public function test_redirects_are_followed_and_checked_hop_by_hop(): void
    {
        WebClient::fake([
            'short.example.com/files/*' => [200, ['Content-Type' => 'image/png'], 'PNG'],
            'short.example.com/*' => [302, ['Location' => '/files/photo.png']],
        ]);

        $this->postJson('/os/net/fetch', ['url' => 'https://short.example.com/x'])
            ->assertOk()
            ->assertJsonPath('result.path', '/Downloads/photo.png');
    }

    public function test_local_network_addresses_are_refused_even_behind_a_redirect(): void
    {
        WebClient::fake(['example.com/*' => [302, ['Location' => 'http://router.lan/admin']]]);

        foreach (['http://127.0.0.1/secret', 'http://10.0.0.5/', 'http://nas.lan/files', 'https://example.com/go'] as $url) {
            $this->postJson('/os/net/fetch', ['url' => $url])
                ->assertStatus(403)
                ->assertJsonPath('message', 'LiteOS doesn’t connect to local network addresses.');
        }
        $this->assertSame(['https://example.com/go'], array_column(WebClient::sent(), 'url')); // the only site contacted
    }

    public function test_ranges_php_doesnt_count_as_private_are_refused_by_every_route(): void
    {
        // a name for the cloud metadata address in carrier-grade NAT, and one with a public and a private answer
        PublicAddress::resolveUsing(fn (string $host) => match ($host) {
            'metadata.example.com' => ['100.100.100.200'],
            'mixed.example.com' => ['93.184.216.34', '198.18.0.1'],
            default => ['93.184.216.34'],
        });
        WebClient::fake(['*' => [200, ['Content-Type' => 'text/plain'], 'secret']]);

        foreach (['http://metadata.example.com/latest/meta-data/', 'http://mixed.example.com/', 'http://100.64.0.1/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://[2002:a9fe:a9fe::1]/'] as $url) {
            $this->postJson('/os/net/fetch', ['url' => $url])
                ->assertStatus(403)
                ->assertJsonPath('message', 'LiteOS doesn’t connect to local network addresses.');

            $this->getJson('/os/net/framecheck?url='.urlencode($url))
                ->assertOk()
                ->assertJsonPath('result.checked', false);

            $link = $this->postJson('/os/net/sign', ['urls' => [$url], 'rewrite' => false])->json('result')[$url];
            $this->get($link)->assertStatus(403);
        }
        $this->assertSame([], WebClient::sent());
    }

    public function test_only_web_addresses_are_accepted(): void
    {
        foreach (['file:///etc/passwd', 'ftp://example.com/x', 'https://user:pw@example.com/'] as $url) {
            $this->postJson('/os/net/fetch', ['url' => $url])->assertStatus(400);
        }
        $this->assertSame([], WebClient::sent());
    }

    public function test_a_download_larger_than_the_free_space_is_refused_and_leaves_nothing_behind(): void
    {
        $this->amina->update(['quota_mb' => 1]);
        WebClient::fake(['example.com/*' => [200, [], str_repeat('x', 1_100_000)]]);

        $this->postJson('/os/net/fetch', ['url' => 'https://example.com/big.bin'])->assertStatus(507);
        $this->assertSame([], array_diff(scandir(Drive::root('amina').'/Downloads'), ['.', '..']));
    }

    public function test_a_website_error_is_explained(): void
    {
        WebClient::fake(['example.com/*' => [404, [], 'nope']]);

        $this->postJson('/os/net/fetch', ['url' => 'https://example.com/gone.zip'])
            ->assertStatus(502)
            ->assertJsonPath('message', 'The website answered with an error (404).');
    }

    // ------------------------------------------------------------ frame check

    public function test_the_frame_check_reads_the_pages_framing_rules(): void
    {
        WebClient::fake([
            'deny.example.com/*' => [200, ['X-Frame-Options' => 'DENY']],
            'csp.example.com/*' => [200, ['Content-Security-Policy' => "default-src *; frame-ancestors 'self'"]],
            'open.example.com/*' => [200, ['Content-Security-Policy' => 'frame-ancestors *', 'X-Frame-Options' => 'DENY']],
            'plain.example.com/*' => [200],
        ]);

        $check = fn (string $host) => $this->getJson('/os/net/framecheck?url='.urlencode('https://'.$host.'/'))->assertOk()->json('result');

        $this->assertSame(['blocked' => true, 'reason' => 'xfo', 'checked' => true], $check('deny.example.com'));
        $this->assertSame(['blocked' => true, 'reason' => 'csp', 'checked' => true], $check('csp.example.com'));
        $this->assertSame(['blocked' => false, 'checked' => true], $check('open.example.com'));
        $this->assertSame(['blocked' => false, 'checked' => true], $check('plain.example.com'));
    }

    public function test_the_frame_check_tells_files_from_pages(): void
    {
        WebClient::fake([
            'cdn.example.com/*' => [200, ['Content-Type' => 'video/webm', 'Content-Length' => '900000']],
            'files.example.com/*' => [200, ['Content-Type' => 'text/html', 'Content-Disposition' => 'attachment; filename="notes.html"']],
            'site.example.com/*' => [200, ['Content-Type' => 'text/html; charset=utf-8']],
        ]);

        $check = fn (string $url) => $this->getJson('/os/net/framecheck?url='.urlencode($url))->assertOk()->json('result');

        $this->assertSame(['name' => 'file_example_WEBM_480_900KB.webm', 'type' => 'video/webm', 'size' => 900000, 'attachment' => false],
            $check('https://cdn.example.com/file_example_WEBM_480_900KB.webm')['file']);
        $this->assertSame(['name' => 'notes.html', 'type' => 'text/html', 'size' => -1, 'attachment' => true], $check('https://files.example.com/get')['file']);
        $this->assertArrayNotHasKey('file', $check('https://site.example.com/'));
    }

    public function test_a_download_can_be_saved_under_the_name_picked_in_the_save_dialog(): void
    {
        WebClient::fake(['cdn.example.com/*' => [200, ['Content-Type' => 'video/webm'], 'WEBM']]);
        Storage::disk('drives')->put('amina/Videos/clip.webm', 'old');

        $this->postJson('/os/net/fetch', ['url' => 'https://cdn.example.com/a.webm', 'dir' => '/Videos', 'name' => 'clip.webm'])
            ->assertOk()
            ->assertJsonPath('result.path', '/Videos/clip.webm');
        $this->assertSame('WEBM', file_get_contents(Drive::root('amina').'/Videos/clip.webm'));
    }

    public function test_a_bot_check_is_left_to_the_browser_and_explained_when_saving(): void
    {
        WebClient::fake(['guarded.example.com/*' => [403, ['Content-Type' => 'text/html', 'Cf-Mitigated' => 'challenge', 'X-Frame-Options' => 'SAMEORIGIN'], 'challenge']]);
        $url = 'https://guarded.example.com/2020/03/file_example_WEBM_480_900KB.webm';

        $this->assertSame(['blocked' => false, 'checked' => false], $this->getJson('/os/net/framecheck?url='.urlencode($url))->json('result'));
        $this->postJson('/os/net/fetch', ['url' => $url])
            ->assertStatus(502)
            ->assertJsonPath('message', 'guarded.example.com only lets a web browser that passes its security check download this file, so it can’t be saved to your drive.');
        $this->assertSame([], array_values(array_diff(scandir(Drive::root('amina').'/Downloads'), ['.', '..'])));
    }

    public function test_pages_that_cant_be_checked_are_left_to_the_browser(): void
    {
        $this->getJson('/os/net/framecheck?url='.urlencode('http://intranet.lan/'))
            ->assertOk()
            ->assertExactJson(['success' => true, 'message' => '', 'result' => ['blocked' => false, 'checked' => false]]);
    }

    // ------------------------------------------------------------ stream relay

    public function test_signed_links_relay_playlists_with_every_address_rewritten(): void
    {
        WebClient::fake(['tv.example.com/*' => [
            200,
            ['Content-Type' => 'application/vnd.apple.mpegurl'],
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:6,\nseg/1.ts\nhttps://cdn.example.com/2.ts\n",
        ]]);

        $url = 'http://tv.example.com/live/index.m3u8';
        $link = $this->postJson('/os/net/sign', ['urls' => [$url, 'javascript:alert(1)']])->assertOk()->json('result');
        $this->assertSame([$url], array_keys($link));

        $body = $this->get($link[$url])
            ->assertOk()
            ->assertHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8')
            ->getContent();
        $relay = app(StreamRelay::class);
        $this->assertStringContainsString('URI="'.$relay->url('http://tv.example.com/live/key.bin').'"', $body);
        $this->assertStringContainsString($relay->url('http://tv.example.com/live/seg/1.ts'), $body);
        $this->assertStringContainsString($relay->url('https://cdn.example.com/2.ts'), $body);
        $this->assertStringNotContainsString("\nseg/1.ts", $body);
    }

    public function test_media_is_passed_through_with_its_range(): void
    {
        WebClient::fake(['radio.example.com/*' => [206, ['Content-Type' => 'audio/mpeg', 'Content-Range' => 'bytes 0-6/100'], 'MP3DATA']]);

        $url = 'http://radio.example.com/stream.mp3';
        $link = $this->postJson('/os/net/sign', ['urls' => [$url], 'rewrite' => false])->json('result')[$url];
        $this->assertStringNotContainsString('r=1', $link);
        $response = $this->get($link, ['Range' => 'bytes=0-6'])
            ->assertStatus(206)
            ->assertHeader('Content-Type', 'audio/mpeg')
            ->assertHeader('Content-Range', 'bytes 0-6/100');
        $this->assertSame('MP3DATA', $response->streamedContent());
        $this->assertSame('bytes=0-6', WebClient::sent()[0]['headers']['Range']);
    }

    public function test_relayed_answers_are_inert_on_the_liteos_origin(): void
    {
        WebClient::fake([
            'evil.example.com/page' => [200, ['Content-Type' => 'text/html; charset=utf-8'], '<script>parent.alert(1)</script>'],
            'evil.example.com/image.svg' => [200, ['Content-Type' => 'image/svg+xml'], '<svg onload="alert(1)"/>'],
            'evil.example.com/untyped' => [200, [], 'data'],
            'tv.example.com/seg.ts' => [200, ['Content-Type' => 'video/MP2T'], 'TS'],
            'tv.example.com/index.m3u8' => [200, ['Content-Type' => 'application/vnd.apple.mpegurl'], "#EXTM3U\nseg.ts\n"],
            'radio.example.com/*' => [200, ['Content-Type' => 'audio/aac'], 'AAC'],
        ]);
        $expect = [
            'http://evil.example.com/page' => 'application/octet-stream',
            'http://evil.example.com/image.svg' => 'application/octet-stream',
            'http://evil.example.com/untyped' => 'application/octet-stream',
            'http://tv.example.com/seg.ts' => 'video/MP2T',
            'http://tv.example.com/index.m3u8' => 'application/vnd.apple.mpegurl; charset=utf-8',
            'http://radio.example.com/live' => 'audio/aac',
        ];

        config(['liteos.net.relays_at_once' => 10]); // the bodies aren't read here, so their slots aren't given back
        $links = $this->postJson('/os/net/sign', ['urls' => array_keys($expect)])->json('result');
        foreach ($expect as $url => $type) {
            $this->get($links[$url])
                ->assertOk()
                ->assertHeader('Content-Type', $type)
                ->assertHeader('Content-Security-Policy', "sandbox; default-src 'none'; frame-ancestors 'none'")
                ->assertHeader('Content-Disposition', 'attachment')
                ->assertHeader('X-Content-Type-Options', 'nosniff');
        }
    }

    // ------------------------------------------------------------ limits per account

    public function test_signing_relaying_and_downloading_are_rate_limited_per_account(): void
    {
        config(['liteos.net.sign_per_minute' => 2, 'liteos.net.stream_per_minute' => 2, 'liteos.net.fetch_per_minute' => 1]);
        WebClient::fake(['radio.example.com/*' => [200, ['Content-Type' => 'audio/mpeg'], 'MP3'], 'example.com/*' => [200, ['Content-Type' => 'text/plain'], 'hi']]);
        $url = 'http://radio.example.com/live.mp3';

        $this->postJson('/os/net/sign', ['urls' => [$url]])->assertOk();
        $link = $this->postJson('/os/net/sign', ['urls' => [$url], 'rewrite' => false])->assertOk()->json('result')[$url];
        $this->postJson('/os/net/sign', ['urls' => [$url]])
            ->assertStatus(429)
            ->assertJsonPath('message', 'Too many requests. Wait a minute and try again.');

        $this->get($link)->assertOk();
        $this->get($link)->assertOk();
        $this->get($link)->assertStatus(429);

        $this->postJson('/os/net/fetch', ['url' => 'https://example.com/a.txt'])->assertOk();
        $this->postJson('/os/net/fetch', ['url' => 'https://example.com/b.txt'])->assertStatus(429);

        // another account has its own allowance
        $this->actingAs(User::factory()->create(['username' => 'baraka']));
        Drive::ensureHome('baraka');
        $this->postJson('/os/net/sign', ['urls' => [$url]])->assertOk();
        $this->postJson('/os/net/fetch', ['url' => 'https://example.com/a.txt'])->assertOk();
    }

    public function test_an_account_can_run_only_so_many_long_relays_at_once(): void
    {
        config(['liteos.net.relays_at_once' => 2]);
        WebClient::fake(['radio.example.com/*' => [200, ['Content-Type' => 'audio/mpeg'], 'MP3']]);
        $url = 'http://radio.example.com/live.mp3';
        $link = $this->postJson('/os/net/sign', ['urls' => [$url], 'rewrite' => false])->json('result')[$url];
        $slots = app(RelaySlots::class);
        $id = (string) $this->amina->id;

        // two relays still streaming elsewhere
        $slots->take($id);
        $slots->take($id);
        $this->get($link)
            ->assertStatus(429)
            ->assertJsonPath('message', 'You’re playing too many streams at once. Stop one and try again.');

        // a relay whose worker died stops counting once it hasn't been seen for a minute
        Cache::put('relay-slots:'.$id, ['old1' => time() - 61, 'old2' => time() - 120], 3600);
        $response = $this->get($link)->assertOk();
        $this->assertSame(1, $slots->inUse($id));

        // a finished relay gives its slot back
        $this->assertSame('MP3', $response->streamedContent());
        $this->assertSame(0, $slots->inUse($id));
    }

    public function test_playlists_dont_take_a_relay_slot(): void
    {
        config(['liteos.net.relays_at_once' => 1]);
        WebClient::fake(['tv.example.com/*' => [200, ['Content-Type' => 'application/vnd.apple.mpegurl'], "#EXTM3U\nseg.ts\n"]]);
        app(RelaySlots::class)->take((string) $this->amina->id);
        $url = 'http://tv.example.com/index.m3u8';

        $link = $this->postJson('/os/net/sign', ['urls' => [$url]])->json('result')[$url];
        $this->get($link)->assertOk();
    }

    public function test_unsigned_or_altered_links_are_refused(): void
    {
        $signed = app(StreamRelay::class)->url('http://tv.example.com/a.m3u8');

        $this->get(str_replace('a.m3u8', 'b.m3u8', $signed))->assertStatus(403);
        $this->get('/os/net/stream?u='.urlencode('http://tv.example.com/a.m3u8').'&s=0000')->assertStatus(403);
        $this->assertSame([], WebClient::sent());
    }

    public function test_the_relay_needs_a_signed_in_user(): void
    {
        $this->app['auth']->forgetGuards();
        $this->getJson('/os/net/framecheck?url=https%3A%2F%2Fexample.com')->assertStatus(401);
        $this->postJson('/os/net/sign', ['urls' => ['http://tv.example.com/a.m3u8']])->assertStatus(401);
    }
}
