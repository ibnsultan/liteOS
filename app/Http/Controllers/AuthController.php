<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\SessionLock;
use App\Support\SignIn;
use App\Support\SystemSettings;
use App\Support\UserSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// What the running desktop asks the server about the session (/auth, names auth.*): its state at start, locking the
// screen and signing out. Setting up, signing in and unlocking are pages of their own (App\Http\Controllers\Auth).
class AuthController extends Controller
{
    /**
     * Everything the desktop needs to start: the CSRF token and the signed-in user with their settings.
     */
    public function status(Request $request): JsonResponse
    {
        $user = $request->user();
        $system = SystemSettings::all();

        $this->result = [
            'setupNeeded' => ! User::query()->exists(),
            'csrf' => csrf_token(),
            'user' => $user?->toPublic(),
            'settings' => $user ? UserSettings::for($user) : null,
            'system' => ['instanceName' => $system['instanceName'], 'version' => config('liteos.version'), 'usageTracking' => (bool) $system['usageTracking']],
        ];

        return $this->jsonSuccess();
    }

    /**
     * Locks the screen: until the password is entered again, the API refuses and the desktop shows the lock page.
     */
    public function lock(Request $request): JsonResponse
    {
        // the guest has no password to unlock with (the desktop signs out instead)
        if ($request->user()?->isGuest()) {
            return $this->jsonError('The guest account can’t be locked. Sign out instead.', 403);
        }
        SessionLock::lock($request);
        $this->result = ['lock' => route('lock', ['embed' => 1])];

        return $this->jsonSuccess();
    }

    public function logout(Request $request): JsonResponse
    {
        SignIn::logout($request);
        $this->result = ['csrf' => csrf_token(), 'next' => route('login')];

        return $this->jsonSuccess();
    }

    public static function routes(): void
    {
        Route::get('/status', [self::class, 'status'])->name('auth.status');
        Route::post('/lock', [self::class, 'lock'])->middleware('auth')->name('auth.lock');
        Route::post('/logout', [self::class, 'logout'])->name('auth.logout');
    }
}
