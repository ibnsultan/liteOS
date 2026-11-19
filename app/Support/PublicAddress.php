<?php

namespace App\Support;

use Closure;

// The guard for every request LiteOS makes to the web for a user (downloads, frame checks, the stream relay): only
// http and https, no credentials in the address, and the host must resolve to public IP addresses only. The address
// that passed the check is pinned for the request (curl's resolve list), so a second DNS answer can't swap in a
// private one (DNS rebinding). Redirects are checked again hop by hop by the callers.
class PublicAddress
{
    const MAX_REDIRECTS = 5;

    /** @var (Closure(string): list<string>)|null replaces DNS in tests */
    private static ?Closure $resolver = null;

    public function __construct(
        public readonly string $url,
        public readonly string $scheme,
        public readonly string $host,
        public readonly int $port,
        public readonly string $ip,
    ) {}

    /**
     * Checks a web address, or stops the request with a plain-sentence error.
     */
    public static function check(string $url): self
    {
        $parts = parse_url($url) ?: [];
        $scheme = strtolower($parts['scheme'] ?? '');
        abort_if(! in_array($scheme, ['http', 'https'], true) || empty($parts['host']), 400, 'Enter a web address that starts with http:// or https://');
        abort_if(isset($parts['user']) || isset($parts['pass']), 400, 'Addresses with a username or password aren’t supported.');

        $host = strtolower(trim($parts['host'], '[]'));
        $port = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));

        return new self($url, $scheme, $host, $port, self::publicIp($host));
    }

    /**
     * The curl option that pins the checked address (Guzzle limits the protocols itself).
     *
     * @return array<int, mixed>
     */
    public function curl(): array
    {
        $ip = str_contains($this->ip, ':') ? '['.$this->ip.']' : $this->ip;

        return [CURLOPT_RESOLVE => [$this->host.':'.$this->port.':'.$ip]];
    }

    /**
     * A redirect's Location, made absolute against the address that sent it.
     */
    public static function resolve(string $base, string $ref): string
    {
        if (preg_match('#^[a-z][a-z0-9+.-]*://#i', $ref)) {
            return $ref;
        }
        $p = parse_url($base) ?: [];
        $scheme = $p['scheme'] ?? 'http';
        $origin = $scheme.'://'.($p['host'] ?? '').(isset($p['port']) ? ':'.$p['port'] : '');
        if (str_starts_with($ref, '//')) {
            return $scheme.':'.$ref;
        }
        if (str_starts_with($ref, '/')) {
            return $origin.$ref;
        }
        $path = $p['path'] ?? '/';
        if (str_starts_with($ref, '?')) {
            return $origin.$path.$ref;
        }

        // relative to the folder, with ./ and ../ worked out
        $out = [];
        foreach (explode('/', substr($path, 0, (int) strrpos($path, '/') + 1).$ref) as $segment) {
            if ($segment === '..') {
                if (count($out) > 1) {
                    array_pop($out);
                }
            } elseif ($segment !== '.') {
                $out[] = $segment;
            }
        }

        return $origin.implode('/', $out);
    }

    /**
     * @param  (Closure(string): list<string>)|null  $resolver
     */
    public static function resolveUsing(?Closure $resolver): void
    {
        self::$resolver = $resolver;
    }

    private static function publicIp(string $host): string
    {
        $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (self::$resolver ? (self::$resolver)($host) : self::lookup($host));
        abort_if($ips === [], 400, 'Couldn’t find that website.');
        foreach ($ips as $ip) {
            abort_unless(
                filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE),
                403,
                'LiteOS doesn’t connect to local network addresses.',
            );
        }

        return $ips[0];
    }

    /**
     * @return list<string>
     */
    private static function lookup(string $host): array
    {
        $ips = gethostbynamel($host) ?: [];
        foreach (@dns_get_record($host, DNS_AAAA) ?: [] as $record) {
            if (! empty($record['ipv6'])) {
                $ips[] = $record['ipv6'];
            }
        }

        return array_values($ips);
    }
}
