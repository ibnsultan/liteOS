<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Support\SessionLock;
use App\Support\SystemSettings;
use App\Support\UserSettings;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// The lock screen (/lock). The desktop shows it over the open windows in a frame (?embed=1), so nothing is closed;
// opening LiteOS while locked shows it as a page. Unlocking asks for the password again (App\Support\SessionLock).
class LockController extends Controller
{
    public function show(Request $request): View|RedirectResponse
    {
        $embed = $request->boolean('embed');
        if (! SessionLock::isLocked($request)) {
            // in the desktop's frame, the page tells the desktop it can take the lock screen away
            return $embed ? view('auth.unlocked') : redirect()->route('home');
        }

        return view('auth.lock', [
            'instanceName' => SystemSettings::get('instanceName'),
            'user' => $request->user(),
            'embed' => $embed,
            // the user's own wallpaper when it is a built-in one (a picture from their drive can't load while locked)
            'wallpaper' => str_starts_with($wall = (string) UserSettings::for($request->user())['wallpaper'], 'file:') ? '' : $wall,
        ]);
    }

    public function unlock(Request $request): RedirectResponse
    {
        SessionLock::unlock($request, (string) $request->input('password'));

        return $request->boolean('embed') ? redirect()->route('lock', ['embed' => 1]) : redirect()->route('home');
    }

    public static function routes(): void
    {
        Route::middleware('auth')->group(function () {
            Route::get('/lock', [self::class, 'show'])->name('lock');
            Route::post('/unlock', [self::class, 'unlock'])->name('unlock');
        });
    }
}
