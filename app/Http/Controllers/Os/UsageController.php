<?php

namespace App\Http\Controllers\Os;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\SystemSettings;
use App\Support\Usage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// Usage tracking (/os/usage, App\Support\Usage): the desktop adds what it measured, and System Monitor reads the
// signed-in user's own; administrators also read everyone's (everyone) and any one account's (of). Nobody else reads
// anyone else's.
class UsageController extends Controller
{
    public function add(Request $request): JsonResponse
    {
        $this->result = ['recorded' => Usage::add($request->user(), $request->all())];

        return $this->jsonSuccess();
    }

    public function get(Request $request): JsonResponse
    {
        $this->result = Usage::get($request->user(), (string) $request->query('from'), (string) $request->query('to'))
            + ['tracking' => Usage::on(), 'recorded' => Usage::records($request->user()), 'keepDays' => (int) SystemSettings::get('usageKeepDays')];

        return $this->jsonSuccess();
    }

    /** Administrators: everyone's time, account by account, and the apps and websites used most. */
    public function everyone(Request $request): JsonResponse
    {
        $this->result = Usage::everyone((string) $request->query('from'), (string) $request->query('to'))
            + ['tracking' => Usage::on(), 'keepDays' => (int) SystemSettings::get('usageKeepDays')];

        return $this->jsonSuccess();
    }

    /** Administrators: one account's usage, as that account sees it. */
    public function of(Request $request): JsonResponse
    {
        $user = User::query()->where('username', (string) $request->query('user'))->first();
        if (! $user) {
            return $this->jsonError('There is no such account.', 404);
        }
        $this->result = Usage::get($user, (string) $request->query('from'), (string) $request->query('to'))
            + ['tracking' => Usage::on(), 'recorded' => Usage::records($user), 'keepDays' => (int) SystemSettings::get('usageKeepDays'),
                'user' => ['username' => $user->username, 'name' => $user->name, 'roleLabel' => $user->role->label()]];

        return $this->jsonSuccess();
    }

    public static function routes(): void
    {
        Route::post('/add', [self::class, 'add'])->name('usage.add');
        Route::get('/get', [self::class, 'get'])->name('usage.get');
        // another account's usage: administrators only
        Route::middleware('can:admin')->group(function () {
            Route::get('/everyone', [self::class, 'everyone'])->name('usage.everyone');
            Route::get('/of', [self::class, 'of'])->name('usage.of');
        });
    }
}
