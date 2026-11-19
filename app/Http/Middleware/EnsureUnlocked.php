<?php

namespace App\Http\Middleware;

use App\Support\SessionLock;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// While the screen is locked (App\Support\SessionLock) the desktop's API refuses with 423 and its pages send you to the
// lock page, so a reload or an app window can't get around the lock.
class EnsureUnlocked
{
    /**
     * @param  Closure(Request): (Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (SessionLock::isLocked($request)) {
            return $request->is('os/*') || $request->expectsJson()
                ? response()->json(['success' => false, 'message' => 'LiteOS is locked. Unlock it to continue.'], 423)
                : redirect()->route('lock');
        }

        return $next($request);
    }
}
