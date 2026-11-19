<?php

namespace App\Services;

use Closure;
use Generator;

// One answer from the web, opened by WebClient: the status and headers are known as soon as it is returned, and the
// body is read in chunks as it arrives (chunks()), so a caller can cap it, stop after the headers, or pass an
// endless stream (internet radio) through to the viewer.
class WebTransfer
{
    /**
     * @param  array<string, list<string>>  $headers  lower-case names
     * @param  Closure(): Generator<int, string>  $body
     * @param  Closure(): void  $close
     */
    public function __construct(
        public readonly string $url,
        public readonly int $status,
        public readonly array $headers,
        private Closure $body,
        private Closure $close,
    ) {}

    public function header(string $name): string
    {
        return $this->headers[strtolower($name)][0] ?? '';
    }

    /**
     * @return Generator<int, string>
     */
    public function chunks(): Generator
    {
        try {
            yield from ($this->body)();
        } finally {
            $this->close();
        }
    }

    public function close(): void
    {
        ($this->close)();
    }
}
