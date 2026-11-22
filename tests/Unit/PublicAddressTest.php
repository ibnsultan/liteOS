<?php

namespace Tests\Unit;

use App\Support\PublicAddress;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

// Which IP addresses count as public for the web guard (App\Support\PublicAddress). One address from each blocked
// range, including the ones PHP's private and reserved filters let through.
class PublicAddressTest extends TestCase
{
    /**
     * @return array<string, array{string}>
     */
    public static function blocked(): array
    {
        return [
            'this network' => ['0.1.2.3'],
            'private 10/8' => ['10.0.0.5'],
            'carrier-grade NAT' => ['100.64.0.1'],
            'cloud metadata in CGNAT' => ['100.100.100.200'],
            'loopback' => ['127.0.0.1'],
            'link-local metadata' => ['169.254.169.254'],
            'private 172.16/12' => ['172.20.1.1'],
            'IETF protocol assignments' => ['192.0.0.170'],
            'documentation 192.0.2/24' => ['192.0.2.10'],
            '6to4 relay' => ['192.88.99.1'],
            'private 192.168/16' => ['192.168.1.20'],
            'benchmarking' => ['198.18.0.1'],
            'benchmarking upper half' => ['198.19.255.254'],
            'documentation 198.51.100/24' => ['198.51.100.7'],
            'documentation 203.0.113/24' => ['203.0.113.9'],
            'multicast' => ['224.0.0.251'],
            'multicast upper' => ['239.255.255.250'],
            'reserved' => ['240.0.0.1'],
            'broadcast' => ['255.255.255.255'],
            'IPv6 unspecified' => ['::'],
            'IPv6 loopback' => ['::1'],
            'IPv4-compatible' => ['::10.0.0.1'],
            'IPv4-mapped loopback' => ['::ffff:127.0.0.1'],
            'IPv4-mapped CGNAT' => ['::ffff:100.100.100.200'],
            'NAT64' => ['64:ff9b::a9fe:a9fe'],
            'local NAT64' => ['64:ff9b:1::1'],
            'discard' => ['100::1'],
            'Teredo' => ['2001:0:4136:e378:8000:63bf:3fff:fdd2'],
            'IPv6 benchmarking' => ['2001:2::1'],
            'ORCHID' => ['2001:10::1'],
            'IPv6 documentation' => ['2001:db8::1'],
            '6to4' => ['2002:a9fe:a9fe::1'],
            'unique local fc' => ['fc00::1'],
            'unique local fd' => ['fd12:3456:789a::1'],
            'IPv6 link-local' => ['fe80::1'],
            'site-local' => ['fec0::1'],
            'IPv6 multicast' => ['ff02::1'],
            'not an address' => ['example.com'],
            'empty' => [''],
        ];
    }

    /**
     * @return array<string, array{string}>
     */
    public static function allowed(): array
    {
        return [
            'example.com' => ['93.184.216.34'],
            'Cloudflare DNS' => ['1.1.1.1'],
            'just below CGNAT' => ['100.63.255.255'],
            'just above CGNAT' => ['100.128.0.1'],
            'just above benchmarking' => ['198.20.0.1'],
            'Cloudflare DNS IPv6' => ['2606:4700:4700::1111'],
            'Google DNS IPv6' => ['2001:4860:4860::8888'],
        ];
    }

    #[DataProvider('blocked')]
    public function test_non_public_addresses_are_refused(string $ip): void
    {
        $this->assertFalse(PublicAddress::isPublic($ip));
    }

    #[DataProvider('allowed')]
    public function test_public_addresses_are_allowed(string $ip): void
    {
        $this->assertTrue(PublicAddress::isPublic($ip));
    }
}
