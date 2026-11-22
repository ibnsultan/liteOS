<?php

namespace App\Http\Controllers\Os;

use App\Http\Controllers\Controller;
use App\Services\FrameChecker;
use App\Services\WebFetcher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// The Browser's server side (/os/net/*, the MVP's net.framecheck and net.fetch): checking whether a page can be shown
// in a frame, and saving a web file into the drive. Both only reach public addresses (App\Support\PublicAddress).
class WebController extends Controller
{
    public function framecheck(Request $request, FrameChecker $checker): JsonResponse
    {
        $this->result = $checker->check((string) $request->query('url'), $request->getSchemeAndHttpHost());

        return $this->jsonSuccess();
    }

    public function fetch(Request $request, WebFetcher $fetcher): JsonResponse
    {
        $this->result = $fetcher->download($request->user(), (string) $request->input('url'), (string) $request->input('dir', '/Downloads'), (string) $request->input('name', ''));

        return $this->jsonSuccess();
    }

    public static function routes(): void
    {
        Route::get('/framecheck', [self::class, 'framecheck'])->name('net.framecheck');
        Route::post('/fetch', [self::class, 'fetch'])->middleware('throttle:net-fetch')->name('net.fetch');
    }
}
