<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// Headers every response carries, unless it set its own: browsers don't guess a file's type from its content (a file
// served from someone's drive stays the type it says it is), pages are framed only by LiteOS itself (the desktop frames
// its app windows), and other sites are told only the origin of a link followed from here, never the path. The content
// security policy is the part that breaks nothing: no plugins, no <base> pointing elsewhere, and the same framing rule.
// It leaves scripts alone (the shell and apps use inline handlers). Routes that need other framing rules (an installed
// store app, served for a sandboxed frame) set their own.
class SecurityHeaders
{
    /**
     * @var array<string, string>
     */
    const HEADERS = [
        'X-Content-Type-Options' => 'nosniff',
        'X-Frame-Options' => 'SAMEORIGIN',
        'Referrer-Policy' => 'strict-origin-when-cross-origin',
        'Content-Security-Policy' => "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
    ];

    /**
     * @param  Closure(Request): (Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        foreach (self::HEADERS as $name => $value) {
            if (! $response->headers->has($name)) {
                $response->headers->set($name, $value);
            }
        }

        return $response;
    }
}
