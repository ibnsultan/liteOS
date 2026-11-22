<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

// Signing in, shared by the sign-in page and first-run setup. Wrong passwords are slowed down, and five in a row lock
// that username from that address for five minutes. The device remembers the last account that signed in (a cookie
// holding the username only), so the sign-in page can go straight to its password.
class SignIn
{
    const MAX_ATTEMPTS = 5;

    const LOCKOUT_SECONDS = 300;

    const LAST_USER_COOKIE = 'los_last_user';

    /**
     * The account a username names, if it can sign in. Unknown and disabled accounts look the same from outside.
     */
    public static function profile(string $username): ?User
    {
        $user = User::query()->where('username', strtolower(trim($username)))->first();

        return $user !== null && ! $user->isDisabled() && ! $user->isGuest() ? $user : null;
    }

    /**
     * Checks a username and password, or throws with the message to show next to the password.
     *
     * @throws ValidationException
     */
    public static function attempt(Request $request, string $username, string $password): User
    {
        $username = strtolower(trim($username));
        $key = 'login:'.$username.'|'.$request->ip();

        if (RateLimiter::tooManyAttempts($key, self::MAX_ATTEMPTS)) {
            $seconds = RateLimiter::availableIn($key);
            SecurityLog::signInLocked($username, $seconds);
            $minutes = (int) ceil($seconds / 60);
            throw ValidationException::withMessages(['password' => "Too many attempts. Try again in {$minutes} minute(s)."]);
        }

        $user = User::query()->where('username', $username)->first();
        if ($user?->isGuest()) {
            $user = null; // the guest signs in from its own link, never with a password
        }
        if ($user === null || $user->isDisabled() || ! Hash::check($password, $user->password)) {
            SecurityLog::signInFailed($username, $user === null ? 'unknown account' : ($user->isDisabled() ? 'disabled account' : 'wrong password'));
            RateLimiter::hit($key, self::LOCKOUT_SECONDS);
            usleep(400000);
            throw ValidationException::withMessages(['password' => $user?->isDisabled()
                ? 'This account is disabled. Ask an administrator.'
                : 'Wrong password. Try again.']);
        }

        RateLimiter::clear($key);

        return $user;
    }

    /**
     * Signs the user in on a fresh session.
     */
    public static function login(Request $request, User $user): void
    {
        Auth::login($user);
        $request->session()->regenerate();
        SessionLock::clear($request);
        $user->forceFill(['last_login_at' => now()])->save();
        if (! $user->isGuest()) {
            Drive::ensureHome($user->username);
            Cookie::queue(self::LAST_USER_COOKIE, $user->username, 60 * 24 * 365);
        }
        SecurityLog::signedIn($user);
    }

    public static function logout(Request $request): void
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
    }
}
