<?php

namespace App\Http\Controllers\Os;

use App\Http\Controllers\Controller;
use App\Support\UserSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// The signed-in user's own desktop settings (/os/settings), the MVP's settings.get and settings.save. Every user has
// their own; a save sends only the keys that changed and gets the whole set back.
class SettingsController extends Controller
{
    public function get(Request $request): JsonResponse
    {
        $this->result = UserSettings::for($request->user());

        return $this->jsonSuccess();
    }

    public function save(Request $request): JsonResponse
    {
        if ($request->user()->isGuest()) {
            return $this->jsonError('A guest’s settings are kept in the browser it uses, not on the server.', 403);
        }
        $changes = $request->input('settings', []);
        $this->result = UserSettings::save($request->user(), is_array($changes) ? $changes : []);

        return $this->jsonSuccess();
    }

    public static function routes(): void
    {
        Route::get('/get', [self::class, 'get'])->name('settings.get');
        Route::post('/save', [self::class, 'save'])->name('settings.save');
    }
}
