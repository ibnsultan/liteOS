<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

// Locking the screen. The lock lives in the session, so the server enforces it: while locked, the desktop's API answers
// 423 and the desktop page sends you to the lock page (EnsureUnlocked), so reloading doesn't get past it. Unlocking
// asks for the signed-in user's password, with the same five-tries limit as signing in.
class SessionLock
{
    const KEY = 'liteos.locked';

    public static function lock(Request $request): void
    {
        $request->session()->put(self::KEY, true);
    }

    public static function isLocked(Request $request): bool
    {
        return $request->hasSession() && $request->session()->get(self::KEY) === true;
    }

    public static function clear(Request $request): void
    {
        $request->session()->forget(self::KEY);
    }

    /**
     * @throws ValidationException
     */
    public static function unlock(Request $request, string $password): void
    {
        $user = $request->user();
        $key = 'unlock:'.$user->id.'|'.$request->ip();

        if (RateLimiter::tooManyAttempts($key, SignIn::MAX_ATTEMPTS)) {
            $minutes = (int) ceil(RateLimiter::availableIn($key) / 60);
            throw ValidationException::withMessages(['password' => "Too many attempts. Try again in {$minutes} minute(s)."]);
        }
        if (! Hash::check($password, $user->password)) {
            RateLimiter::hit($key, SignIn::LOCKOUT_SECONDS);
            usleep(400000);
            throw ValidationException::withMessages(['password' => 'Wrong password. Try again.']);
        }

        RateLimiter::clear($key);
        self::clear($request);
    }
}
