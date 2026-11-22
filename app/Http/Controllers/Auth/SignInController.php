<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Support\Guest;
use App\Support\SignIn;
use App\Support\SystemSettings;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\Route;

// The sign-in page (/login), LightDM-style: the username first (a plain GET form, ?username=), then that account's
// name and avatar with a password field. Accounts are never listed. A device that signed in before starts at its last
// account's password; "Use another account" (?other=1) forgets it.
class SignInController extends Controller
{
    public function show(Request $request): View|RedirectResponse
    {
        $other = $request->boolean('other');
        if ($other) {
            Cookie::queue(Cookie::forget(SignIn::LAST_USER_COOKIE));
        }

        // an empty ?username= reaches here as null (ConvertEmptyStringsToNull), so ask whether it was sent at all
        $typed = $request->query->has('username') ? (string) $request->query('username') : null;
        $username = is_string($typed) ? $typed : (string) old('username', $other ? '' : (string) $request->cookie(SignIn::LAST_USER_COOKIE));
        $profile = $username !== '' ? SignIn::profile($username) : null;

        $error = null;
        if (is_string($typed) && trim($typed) === '') {
            $error = 'Enter your username.';
        } elseif (is_string($typed) && $profile === null) {
            usleep(300000);
            $error = 'We couldn’t find that account. Check the username and try again.';
        }

        return view('auth.sign-in', [
            'instanceName' => SystemSettings::get('instanceName'),
            'profile' => $profile,
            'typed' => is_string($typed) ? trim($typed) : '',
            'error' => $error,
            'guest' => Guest::available() !== null,
        ]);
    }

    /**
     * "Sign in as guest": the built-in Guest account, without a password, while an administrator has it turned on.
     */
    public function guest(Request $request): RedirectResponse
    {
        $user = Guest::available();
        if ($user === null) {
            return redirect()->route('login');
        }
        SignIn::login($request, $user);

        return redirect()->route('home');
    }

    public function store(Request $request): RedirectResponse
    {
        $user = SignIn::attempt($request, (string) $request->input('username'), (string) $request->input('password'));
        SignIn::login($request, $user);

        return redirect()->intended(route('home'));
    }

    public function logout(Request $request): RedirectResponse
    {
        SignIn::logout($request);

        return redirect()->route('login');
    }

    public static function routes(): void
    {
        Route::middleware('guest')->group(function () {
            Route::get('/login', [self::class, 'show'])->name('login');
            Route::post('/login', [self::class, 'store'])->name('login.store');
            Route::post('/login/guest', [self::class, 'guest'])->middleware('throttle:guest-sign-in')->name('login.guest');
        });
        Route::post('/logout', [self::class, 'logout'])->name('logout');
    }
}
