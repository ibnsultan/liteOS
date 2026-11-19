<?php

namespace App\Providers;

use App\Http\Middleware\EnsureAccountActive;
use App\Http\Middleware\EnsureUnlocked;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

/**
 * Registers the signed-in area: routes/os.php, the API the desktop and its apps call (prefix /os, names os.*), for
 * signed-in users only, and refused while the screen is locked. routes/web.php (the desktop page, app pages, setup and sign-in) and routes/console.php are
 * still loaded by bootstrap/app.php.
 */
class RouteServiceProvider extends ServiceProvider
{
    /**
     * Bootstrap services.
     */
    public function boot(): void
    {
        // route:cache already holds these
        if ($this->app->routesAreCached()) {
            return;
        }

        Route::prefix('os')
            ->name('os.')
            ->middleware(['web', 'auth', EnsureAccountActive::class, EnsureUnlocked::class])
            ->group(base_path('routes/os.php'));
    }
}
