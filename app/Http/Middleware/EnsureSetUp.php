<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// First run: until the first account exists, every LiteOS page sends you to the setup wizard.
class EnsureSetUp
{
    /**
     * @param  Closure(Request): (Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! User::query()->exists()) {
            return $request->expectsJson()
                ? response()->json(['success' => false, 'message' => 'LiteOS isn’t set up yet.'], 409)
                : redirect()->route('setup');
        }

        return $next($request);
    }
}
