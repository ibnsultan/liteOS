<?php

namespace App\Http\Controllers\Os;

use App\Http\Controllers\Controller;
use App\Services\StreamRelay;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Symfony\Component\HttpFoundation\Response;

// Live TV's stream relay (/os/net/sign and /os/net/stream, the MVP's net.sign and net.stream). The player asks for
// relay links with a POST, then plays them like any other address; see App\Services\StreamRelay.
class StreamController extends Controller
{
    public function sign(Request $request, StreamRelay $relay): JsonResponse
    {
        $urls = $request->input('urls', []);
        abort_if(! is_array($urls) || count($urls) > 500, 400, 'Send up to 500 links.');
        $rewrite = $request->input('rewrite', true) !== false;

        $this->result = (object) collect($urls)
            ->filter(fn ($url) => is_string($url) && strlen($url) < 4096 && preg_match('#^https?://#i', $url))
            ->mapWithKeys(fn ($url) => [$url => $relay->url($url, $rewrite)])
            ->all();

        return $this->jsonSuccess();
    }

    public function stream(Request $request, StreamRelay $relay): Response
    {
        return $relay->relay((string) $request->query('u'), (string) $request->query('s'), $request->query('r') === '1', $request->header('Range'));
    }

    public static function routes(): void
    {
        Route::post('/sign', [self::class, 'sign'])->name('net.sign');
        Route::get('/stream', [self::class, 'stream'])->name('net.stream');
    }
}
