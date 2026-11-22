<?php

namespace App\Support;

use Closure;
use Symfony\Component\HttpFoundation\IpUtils;

// The guard for every request LiteOS makes to the web for a user (downloads, frame checks, the stream relay): only
// http and https, no credentials in the address, and the host must resolve to public IP addresses only. The address
// that passed the check is pinned for the request (curl's resolve list), so a second DNS answer can't swap in a
// private one (DNS rebinding). Redirects are checked again hop by hop by the callers.
class PublicAddress
{
    const MAX_REDIRECTS = 5;

    // Addresses that aren't on the public internet, from the IANA special-purpose address registries (the entries that
    // aren't globally reachable). PHP's private and reserved filters miss several of them (carrier-grade NAT, which
    // holds some clouds' metadata address 100.100.100.200, benchmarking, multicast, and the IPv6 ranges that carry an
    // IPv4 address inside), so they are listed here rather than left to what a PHP build counts as reserved.
    // https://www.iana.org/assignments/iana-ipv4-special-registry and .../iana-ipv6-special-registry
    const BLOCKED = [
        // IPv4
        '0.0.0.0/8',        // "this network"
        '10.0.0.0/8',       // private
        '100.64.0.0/10',    // carrier-grade NAT
        '127.0.0.0/8',      // loopback
        '169.254.0.0/16',   // link-local
        '172.16.0.0/12',    // private
        '192.0.0.0/24',     // IETF protocol assignments
        '192.0.2.0/24',     // documentation
        '192.88.99.0/24',   // 6to4 relay
        '192.168.0.0/16',   // private
        '198.18.0.0/15',    // benchmarking
        '198.51.100.0/24',  // documentation
        '203.0.113.0/24',   // documentation
        '224.0.0.0/4',      // multicast
        '240.0.0.0/4',      // reserved, and the broadcast address
        // IPv6
        '::/96',            // unspecified, loopback and IPv4-compatible
        '::ffff:0:0/96',    // IPv4-mapped
        '64:ff9b::/96',     // NAT64
        '64:ff9b:1::/48',   // local NAT64
        '100::/64',         // discard
        '2001::/32',        // Teredo
        '2001:2::/48',      // benchmarking
        '2001:10::/28',     // ORCHID
        '2001:db8::/32',    // documentation
        '2002::/16',        // 6to4
        'fc00::/7',         // unique local
        'fe80::/10',        // link-local
        'fec0::/10',        // site-local
        'ff00::/8',         // multicast
    ];

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
            abort_unless(self::isPublic($ip), 403, 'LiteOS doesn’t connect to local network addresses.');
        }

        return $ips[0];
    }

    /**
     * Whether an IP address is on the public internet: a valid address that is in no private, reserved or other
     * special-purpose range.
     */
    public static function isPublic(string $ip): bool
    {
        return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false
            && ! IpUtils::checkIp($ip, self::BLOCKED);
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
