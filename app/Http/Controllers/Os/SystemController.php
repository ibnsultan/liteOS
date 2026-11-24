<?php

namespace App\Http\Controllers\Os;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Role;
use App\Support\ServerStats;
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
            'userCount' => User::query()->where('role', '!=', Role::Guest->value)->count(),
            'localApps' => config('liteos.local_apps'),
        ];

        return $this->jsonSuccess();
    }

    public function save(Request $request): JsonResponse
    {
        $changes = $request->input('system', []);
        $this->result = SystemSettings::save(is_array($changes) ? $changes : []);

        return $this->jsonSuccess();
    }

    /** The server's facts: versions, the database, the disk, who is signed in (System Monitor › Server). */
    public function server(): JsonResponse
    {
        $this->result = (new ServerStats)->facts();

        return $this->jsonSuccess();
    }

    /** The server's running totals for the live charts, or null where the system doesn't offer them. */
    public function counters(): JsonResponse
    {
        $this->result = (new ServerStats)->counters();

        return $this->jsonSuccess();
    }

    public static function routes(): void
    {
        Route::get('/get', [self::class, 'get'])->name('system.get');
        Route::get('/server', [self::class, 'server'])->name('system.server');
        Route::get('/counters', [self::class, 'counters'])->name('system.counters');
        Route::post('/save', [self::class, 'save'])->name('system.save');
    }
}
