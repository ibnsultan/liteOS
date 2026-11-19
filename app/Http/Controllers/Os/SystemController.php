<?php

namespace App\Http\Controllers\Os;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\SystemSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// Settings for the whole instance, for administrators (/os/system, behind the "admin" gate): the instance name and
// the default storage quota, plus facts shown on Settings › System (version, PHP, largest upload, accounts).
class SystemController extends Controller
{
    public function get(): JsonResponse
    {
        $this->result = SystemSettings::all() + [
            'version' => config('liteos.version'),
            'php' => PHP_VERSION,
            'uploadMax' => ini_get('upload_max_filesize'),
            'userCount' => User::query()->count(),
        ];

        return $this->jsonSuccess();
    }

    public function save(Request $request): JsonResponse
    {
        $changes = $request->input('system', []);
        $this->result = SystemSettings::save(is_array($changes) ? $changes : []);

        return $this->jsonSuccess();
    }

    public static function routes(): void
    {
        Route::get('/get', [self::class, 'get'])->name('system.get');
        Route::post('/save', [self::class, 'save'])->name('system.save');
    }
}
