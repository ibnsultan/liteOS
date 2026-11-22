<?php

namespace App\Services;

use App\Support\PublicAddress;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

// Media › Live TV: relays streams (IPTV, internet radio) that the browser can't load itself, because the server
// doesn't allow cross-site requests or is plain http under an https LiteOS (lib/stream.php).
//
// - Only addresses signed for the viewer's session are relayed; the signature is asked for with a CSRF-protected
//   POST, so other sites can't use the relay.
// - Every hop passes PublicAddress (WebClient).
// - HLS playlists are rewritten so their segments, keys and sub-playlists go through the relay too.
// - What comes back is someone else's content on the LiteOS origin, and the addresses can come from an imported
//   playlist, so it is made inert: sandboxed, sent as a download if a browser ever opens it as a page, and given a
//   type that can't render as a page unless it is media (headers()). The player reads it with fetch and <video>,
//   which ignore all three.
class StreamRelay
{
    const PLAYLIST_MAX = 16 * 1024 * 1024;

    // types passed through as they are; anything else (text/html, image/svg+xml, XML…) goes out as octet-stream
    const MEDIA_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl',
        'application/dash+xml', 'video/mp2t', 'application/octet-stream', 'binary/octet-stream'];

    const USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20';

    public function __construct(private WebClient $web, private RelaySlots $slots) {}

    public function sign(string $url): string
    {
        return substr(hash_hmac('sha256', $url, config('app.key').'|stream|'.session()->token()), 0, 32);
    }

    /**
     * The relay address for $url. With $rewrite, a playlist's contents are relayed too.
     */
    public function url(string $url, bool $rewrite = true): string
    {
        return route('os.net.stream', ['u' => $url, 's' => $this->sign($url)] + ($rewrite ? ['r' => 1] : []));
    }

    public function relay(string $url, string $signature, bool $rewrite, ?string $range): Response
    {
        abort_if($url === '' || ! hash_equals($this->sign($url), $signature), 403, 'This stream link has expired. Reload the player and try again.');
        $maxSeconds = max(60, (int) config('liteos.net.relay_max_seconds'));
        @set_time_limit($maxSeconds + 60);

        $headers = ['User-Agent' => self::USER_AGENT, 'Accept' => '*/*'] + ($range ? ['Range' => $range] : []);
        $web = $this->web->open($url, $headers, ['connect' => 15]);
        if ($web->status >= 400) {
            $web->close();
            abort(502, 'The stream server answered with an error ('.$web->status.').');
        }

        $chunks = $web->chunks();
        $head = $chunks->valid() ? $chunks->current() : '';
        $type = $web->header('Content-Type');

        if ($this->isPlaylist($web->url, $type, $head)) {
            $text = '';
            foreach ($chunks as $chunk) {
                $text .= $chunk;
                if (strlen($text) > self::PLAYLIST_MAX) {
                    $web->close();
                    abort(502, 'That playlist is too large.');
                }
            }

            return response($rewrite ? $this->rewrite($text, $web->url) : $text, 200, $this->headers('application/vnd.apple.mpegurl; charset=utf-8'));
        }

        $out = $this->headers($type);
        // curl unpacks compressed answers, so the server's length only holds for uncompressed ones
        $names = $web->header('Content-Encoding') === '' ? ['Content-Length', 'Content-Range', 'Accept-Ranges'] : ['Accept-Ranges'];
        foreach ($names as $name) {
            if ($web->header($name) !== '') {
                $out[$name] = $web->header($name);
            }
        }

        // a body that streams holds a PHP worker for as long as it runs, so the account gets only so many at once
        $user = (string) auth()->id();
        $slot = $this->slots->take($user);
        if ($slot === null) {
            $web->close();
            abort(429, 'You’re playing too many streams at once. Stop one and try again.');
        }

        return new StreamedResponse(function () use ($chunks, $web, $user, $slot, $maxSeconds) {
            // PHP would end the script the moment the player hangs up, skipping the finally below and keeping the slot
            // taken; with this the loop sees connection_aborted() and gives it back
            ignore_user_abort(true);
            $started = $beat = time();
            try {
                foreach ($chunks as $chunk) {
                    echo $chunk;
                    flush();
                    if (connection_aborted()) {
                        break;
                    }
                    $now = time();
                    if ($now - $started >= $maxSeconds) {
                        break; // set_time_limit only counts CPU time on Linux, so the ceiling is checked here too
                    }
                    if ($now - $beat >= RelaySlots::BEAT) {
                        $this->slots->beat($user, $slot);
                        $beat = $now;
                    }
                }
            } finally {
                $web->close();
                $this->slots->free($user, $slot);
            }
        }, $web->status === 206 ? 206 : 200, $out);
    }

    /**
     * Points every address in an HLS playlist (segments, sub-playlists and URI="…" attributes) at the relay.
     */
    public function rewrite(string $playlist, string $base): string
    {
        $lines = preg_split('/\r?\n/', $playlist) ?: [];
        foreach ($lines as &$line) {
            $t = trim($line);
            if ($t === '') {
                continue;
            }
            if ($t[0] === '#') {
                $line = (string) preg_replace_callback('/URI="([^"]+)"/', fn ($m) => 'URI="'.$this->url(PublicAddress::resolve($base, $m[1])).'"', $line);

                continue;
            }
            $line = $this->url(PublicAddress::resolve($base, $t));
        }

        return implode("\n", $lines);
    }

    /**
     * The headers every relayed answer carries: a type that only renders as media, a sandbox with nothing allowed, and
     * a download if it is ever opened as a page.
     *
     * @return array<string, string>
     */
    private function headers(string $type): array
    {
        $essence = strtolower(trim(explode(';', $type)[0]));
        $media = str_starts_with($essence, 'audio/') || str_starts_with($essence, 'video/') || in_array($essence, self::MEDIA_TYPES, true);

        return [
            'Content-Type' => $media ? $type : 'application/octet-stream',
            'Content-Security-Policy' => "sandbox; default-src 'none'; frame-ancestors 'none'",
            'Content-Disposition' => 'attachment',
            'Cache-Control' => 'no-store',
        ];
    }

    private function isPlaylist(string $url, string $type, string $head): bool
    {
        $path = strtolower((string) parse_url($url, PHP_URL_PATH));

        return str_contains(strtolower($type), 'mpegurl') || str_ends_with($path, '.m3u8') || str_ends_with($path, '.m3u')
            || str_starts_with(ltrim($head, "\xEF\xBB\xBF \r\n\t"), '#EXTM3U');
    }
}
