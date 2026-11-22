<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// The desktop, sign-in, setup and the lock page are LiteOS itself, so they are never shown inside a frame: not in an
// app window whose session ended (an app reloading after the session ended would otherwise show the sign-in page
// inside its window, and signing in there would put a whole desktop inside it), not in the Browser app pointed at
// LiteOS's own address, and not in anything else. App windows (/apps/*) and the lock screen the desktop shows over its
// windows (/lock?embed=1) are framed by the desktop and stay as they are.
//
// When the browser says the page is being loaded into a frame (Sec-Fetch-Dest), the frame gets a small page instead
// that moves the whole tab there (in the desktop: to the sign-in page), or, where the frame isn't allowed to (the
// Browser app's sandbox), says so. Every other answer forbids framing outright, for browsers that don't say.
class TopLevelOnly
{
    const ROUTES = ['home', 'login', 'setup', 'lock'];

    /**
     * @param  Closure(Request): (Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->applies($request)) {
            return $next($request);
        }

        if (in_array($request->header('Sec-Fetch-Dest'), ['iframe', 'frame', 'embed', 'object'], true)) {
            return response()->view('auth.frame-breaker', ['target' => $request->fullUrl()])
                ->header('Cache-Control', 'no-store');
        }

        $response = $next($request);
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");

        return $response;
    }

    private function applies(Request $request): bool
    {
        if (! $request->isMethod('GET') && ! $request->isMethod('HEAD')) {
            return false;
        }
        // the lock screen the desktop shows over its windows
        if ($request->routeIs('lock') && $request->boolean('embed')) {
            return false;
        }

        return $request->routeIs(...self::ROUTES);
    }
}
