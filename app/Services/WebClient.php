<?php

namespace App\Services;

use App\Support\PublicAddress;
use Closure;
use Illuminate\Support\Str;

// One GET to the web on a user's behalf, shared by downloads, frame checks and the stream relay (the MVP's curl code
// in lib/net.php and lib/stream.php). Redirects are followed here one hop at a time, so every hop passes
// PublicAddress: public IPs only, pinned for the request with curl's resolve list.
//
// curl is driven through curl_multi so open() returns as soon as the headers are in and the body is read as it
// arrives (WebTransfer::chunks). Laravel's HTTP client can't do that with the address pinned: Guzzle's curl handler
// buffers the whole body first, and its stream handler can't pin. Tests swap the network out with fake().
class WebClient
{
    /** @var array<string, array{0: int, 1: array<string, string>, 2: string}|Closure>|null */
    private static ?array $fakes = null;

    /** @var list<array{url: string, headers: array<string, string>}> */
    private static array $sent = [];

    /**
     * @param  array<string, string>  $headers
     * @param  array{connect?: int, total?: int}  $timeouts  seconds; no total time limit when left out (streams)
     */
    public function open(string $url, array $headers = [], array $timeouts = []): WebTransfer
    {
        $current = $url;
        for ($hop = 0; $hop <= PublicAddress::MAX_REDIRECTS; $hop++) {
            $address = PublicAddress::check($current);
            $transfer = self::$fakes !== null ? $this->fakeTransfer($current, $headers) : $this->curlTransfer($address, $headers, $timeouts);

            $location = $transfer->header('Location');
            if ($transfer->status >= 300 && $transfer->status < 400 && $location !== '') {
                $transfer->close();
                $current = PublicAddress::resolve($current, $location);

                continue;
            }

            return $transfer;
        }
        abort(502, 'That address redirects too many times.');
    }

    private function curlTransfer(PublicAddress $address, array $headers, array $timeouts): WebTransfer
    {
        $status = 0;
        $received = [];
        $headersDone = false;
        $queue = '';
        $stopped = false;

        $ch = curl_init($address->url);
        curl_setopt_array($ch, [
            CURLOPT_RESOLVE => $address->curl()[CURLOPT_RESOLVE],
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HTTPHEADER => array_map(fn ($name, $value) => $name.': '.$value, array_keys($headers), $headers),
            CURLOPT_CONNECTTIMEOUT => $timeouts['connect'] ?? 15,
            CURLOPT_TIMEOUT => $timeouts['total'] ?? 0,
            CURLOPT_LOW_SPEED_LIMIT => 1,
            CURLOPT_LOW_SPEED_TIME => 30,
            CURLOPT_ENCODING => '',
            CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$status, &$received, &$headersDone) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                    $status = (int) $m[1]; // a new response (after 100 Continue): start over
                    $received = [];
                } elseif (trim($line) === '') {
                    $headersDone = true;
                } elseif (($p = strpos($line, ':')) !== false) {
                    $received[strtolower(trim(substr($line, 0, $p)))][] = trim(substr($line, $p + 1));
                }

                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($ch, string $data) use (&$queue, &$stopped) {
                if ($stopped) {
                    return 0;
                }
                $queue .= $data;

                return strlen($data);
            },
        ]);
        defined('CURLOPT_PROTOCOLS_STR')
            ? curl_setopt($ch, CURLOPT_PROTOCOLS_STR, 'http,https')
            : curl_setopt($ch, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
        $multi = curl_multi_init();
        curl_multi_add_handle($multi, $ch);

        // runs curl until it has more to give; false once the transfer is over
        $pump = function () use ($multi): bool {
            curl_multi_exec($multi, $running);
            if ($running) {
                curl_multi_select($multi, 1.0);
            }

            return (bool) $running;
        };
        $close = function () use (&$stopped, $multi, $ch) {
            if (! $stopped) {
                $stopped = true;
                curl_multi_remove_handle($multi, $ch);
                curl_multi_close($multi);
            }
        };

        $running = true;
        while ($running && ! ($headersDone && $status >= 200)) {
            $running = $pump();
        }
        if (! $headersDone || $status === 0) {
            $info = curl_multi_info_read($multi);
            $error = $info && $info['result'] !== CURLE_OK ? (string) curl_strerror($info['result']) : curl_error($ch);
            $close();
            abort(502, 'Couldn’t reach '.$address->host.($error !== '' ? ' ('.rtrim($error, '.').')' : '').'.');
        }

        $body = function () use (&$queue, &$running, &$stopped, $pump): \Generator {
            while (true) {
                if ($queue !== '') {
                    $chunk = $queue;
                    $queue = '';
                    yield $chunk;
                }
                if ($stopped || ! $running) {
                    if ($queue === '') {
                        return;
                    }

                    continue;
                }
                $running = $pump();
            }
        };

        return new WebTransfer($address->url, $status, $received, $body, $close);
    }

    // ------------------------------------------------------------ tests

    /**
     * Answers requests from a list instead of the network: [url pattern => [status, headers, body]] or a closure
     * (url, headers) returning one. Requests that match nothing fail the way an unreachable site does.
     *
     * @param  array<string, array{0: int, 1?: array<string, string>, 2?: string}|Closure>  $fakes
     */
    public static function fake(array $fakes): void
    {
        self::$fakes = $fakes;
        self::$sent = [];
    }

    public static function stopFaking(): void
    {
        self::$fakes = null;
        self::$sent = [];
    }

    /**
     * @return list<array{url: string, headers: array<string, string>}>
     */
    public static function sent(): array
    {
        return self::$sent;
    }

    private function fakeTransfer(string $url, array $headers): WebTransfer
    {
        self::$sent[] = ['url' => $url, 'headers' => $headers];
        $answer = null;
        foreach (self::$fakes as $pattern => $fake) {
            if (Str::is(Str::start($pattern, '*'), $url)) {
                $answer = $fake instanceof Closure ? $fake($url, $headers) : $fake;
                break;
            }
        }
        abort_if($answer === null, 502, 'Couldn’t reach '.parse_url($url, PHP_URL_HOST).'.');
        [$status, $responseHeaders, $content] = $answer + [1 => [], 2 => ''];

        $lower = [];
        foreach ($responseHeaders as $name => $value) {
            $lower[strtolower($name)][] = $value;
        }
        $body = function () use ($content): \Generator {
            foreach (str_split($content, 4096) as $chunk) {
                if ($chunk !== '') {
                    yield $chunk;
                }
            }
        };

        return new WebTransfer($url, $status, $lower, $body, fn () => null);
    }
}
