<?php

namespace App\Services;

use Symfony\Component\HttpKernel\Exception\HttpException;

// Browser: will a page refuse to show inside LiteOS (lib/net.php's net_frame_check)? Asks the site for the page's
// headers only and applies the browser's framing rules: CSP frame-ancestors, else X-Frame-Options. Anything that can't
// be checked (local address, timeout, no answer) comes back unchecked and the Browser simply tries to load it.
class FrameChecker
{
    const HEADERS = [
        'User-Agent' => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept' => 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Sec-Fetch-Dest' => 'iframe',
        'Sec-Fetch-Mode' => 'navigate',
    ];

    public function __construct(private WebClient $web) {}

    /**
     * @param  string  $self  the origin LiteOS is served from, e.g. https://liteos.test
     * @return array{blocked: bool, checked: bool, reason?: string, file?: array{name: string, type: string, size: int, attachment: bool}}
     */
    public function check(string $url, string $self): array
    {
        try {
            $web = $this->web->open($url, self::HEADERS, ['connect' => 5, 'total' => 8]);
        } catch (HttpException) {
            return ['blocked' => false, 'checked' => false];
        }
        $web->close(); // the headers are all it needs

        // A bot check (Cloudflare's challenge) answers the server, not the page: the user's own browser may pass it and
        // get the real page or file. Its headers say nothing about that, so leave it to the browser.
        if (self::challenged($web->headers)) {
            return ['blocked' => false, 'checked' => false];
        }

        $result = $this->verdict($web->headers, $web->url, $self) + ['checked' => true];
        $file = $this->file($web->url, $web->header('Content-Type'), $web->header('Content-Disposition'), $web->header('Content-Length'));
        if ($file !== null) {
            $result['file'] = $file; // a file, not a page: the Browser saves it into the drive instead of framing it
        }

        return $result;
    }

    /**
     * Did the site answer with a bot check instead of the page?
     *
     * @param  array<string, list<string>>  $headers  lower-case names
     */
    public static function challenged(array $headers): bool
    {
        foreach ($headers['cf-mitigated'] ?? [] as $value) {
            if (strtolower(trim($value)) === 'challenge') {
                return true;
            }
        }

        return false;
    }

    /**
     * Is the address a file rather than a page? Sent as an attachment, or of a type that isn't a web page.
     *
     * @return array{name: string, type: string, size: int, attachment: bool}|null
     */
    public function file(string $url, string $type, string $disposition, string $length): ?array
    {
        $mime = strtolower(trim(explode(';', $type)[0]));
        $attachment = (bool) preg_match('/^\s*attachment/i', $disposition);
        $page = $mime === '' || in_array($mime, ['text/html', 'application/xhtml+xml', 'text/plain', 'application/xml', 'text/xml', 'image/svg+xml'], true);
        if (! $attachment && $page) {
            return null;
        }

        return [
            'name' => WebFetcher::filename($url, $disposition, $type),
            'type' => $mime,
            'size' => ctype_digit($length) ? (int) $length : -1,
            'attachment' => $attachment,
        ];
    }

    /**
     * @param  array<string, list<string>>  $headers  lower-case names
     * @return array{blocked: bool, reason?: string}
     */
    public function verdict(array $headers, string $url, string $self): array
    {
        $selfOrigin = self::origin($self);
        $sameOrigin = self::origin($url) === $selfOrigin;
        $hasAncestors = false;
        foreach ($headers['content-security-policy'] ?? [] as $line) {
            foreach (explode(',', $line) as $policy) {
                foreach (explode(';', $policy) as $directive) {
                    $parts = preg_split('/\s+/', trim($directive)) ?: [];
                    if (strtolower($parts[0] ?? '') !== 'frame-ancestors') {
                        continue;
                    }
                    $hasAncestors = true;
                    if (! $this->ancestorsAllow(array_slice($parts, 1), $selfOrigin, $sameOrigin)) {
                        return ['blocked' => true, 'reason' => 'csp'];
                    }
                    break; // only the first frame-ancestors in a policy counts
                }
            }
        }

        // browsers ignore X-Frame-Options when the page has frame-ancestors
        if (! $hasAncestors) {
            foreach ($headers['x-frame-options'] ?? [] as $line) {
                foreach (explode(',', strtolower($line)) as $option) {
                    $option = trim($option);
                    if ($option === 'deny' || ($option === 'sameorigin' && ! $sameOrigin)) {
                        return ['blocked' => true, 'reason' => 'xfo'];
                    }
                }
            }
        }

        return ['blocked' => false];
    }

    /**
     * Does a frame-ancestors source list let LiteOS ($self) frame the page?
     *
     * @param  list<string>  $sources
     * @param  array{0: string, 1: string, 2: int}  $self
     */
    private function ancestorsAllow(array $sources, array $self, bool $sameOrigin): bool
    {
        [$selfScheme, $selfHost, $selfPort] = $self;
        foreach ($sources as $source) {
            $s = strtolower(trim($source));
            if ($s === '' || $s === "'none'") {
                continue;
            }
            if ($s === '*') {
                return true;
            }
            if ($s === "'self'") {
                if ($sameOrigin) {
                    return true;
                }

                continue;
            }
            if (preg_match('#^([a-z][a-z0-9+.-]*):$#', $s, $m)) { // a scheme alone, e.g. https:
                if ($m[1] === $selfScheme || ($m[1] === 'http' && $selfScheme === 'https')) {
                    return true;
                }

                continue;
            }
            if (! preg_match('#^(?:([a-z][a-z0-9+.-]*)://)?(\*\.)?([a-z0-9.-]+|\*)(?::(\d+|\*))?(?:/.*)?$#', $s, $m)) {
                continue;
            }
            $scheme = $m[1] ?? '';
            if ($scheme !== '' && $scheme !== $selfScheme && ! ($scheme === 'http' && $selfScheme === 'https')) {
                continue;
            }
            $host = $m[3];
            $hostOk = $host === '*' || (! empty($m[2]) ? str_ends_with($selfHost, '.'.$host) : $selfHost === $host);
            if (! $hostOk) {
                continue;
            }
            $port = $m[4] ?? '';
            if ($port === '*') {
                return true;
            }
            if ($port !== '') {
                if ((int) $port === $selfPort) {
                    return true;
                }

                continue;
            }
            if ($selfPort === (($scheme ?: $selfScheme) === 'https' ? 443 : 80) || ($scheme === 'http' && $selfPort === 443)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{0: string, 1: string, 2: int} scheme, host, port (default filled in)
     */
    private static function origin(string $url): array
    {
        $p = parse_url($url) ?: [];
        $scheme = strtolower($p['scheme'] ?? 'http');

        return [$scheme, strtolower(trim($p['host'] ?? '', '[]')), (int) ($p['port'] ?? ($scheme === 'https' ? 443 : 80))];
    }
}
