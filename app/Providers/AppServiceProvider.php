<?php

namespace App\Providers;

use App\Models\User;
use App\Support\AppRegistry;
use App\Support\SecurityLog;
use App\Support\SystemIcons;
use App\View\Components\WindowLayout;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // the apps, read from their manifests once per request
        $this->app->scoped(AppRegistry::class, fn () => new AppRegistry(config('liteos.apps_path')));
        // the system icon set and its map (public/icons/liteos/map.json)
        $this->app->scoped(SystemIcons::class, fn () => new SystemIcons(public_path('icons/liteos')));
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // a public/ file's URL stamped with its last change: <script src="@versioned('assets/js/os.js')">. The shell's
        // and the apps' files aren't built by Vite, so without it browsers keep the old copy after an edit (the MVP
        // did the same with ?v=filemtime in index.php)
        Blade::directive('versioned', fn (string $path) => "<?php echo e(asset({$path}).'?v='.@filemtime(public_path({$path}))); ?>");

        // an app window's page: <x-layout-window app="notes" title="Notes" :styles="['notes.css']">
        Blade::component('layout-window', WindowLayout::class);

        // administrators manage accounts and the system settings (routes/os.php: can:admin)
        Gate::define('admin', fn (User $user) => $user->isAdmin() && ! $user->isDisabled());
        // a refused admin request goes to the security log (only can:admin asks this gate)
        Gate::after(function (User $user, string $ability, ?bool $result) {
            if ($ability === 'admin' && $result === false) {
                SecurityLog::adminRefused();
            }
        });

        // the web relay and downloads, per account (config liteos.net; StreamController and WebController routes)
        foreach (['net-sign' => 'sign_per_minute', 'net-stream' => 'stream_per_minute', 'net-fetch' => 'fetch_per_minute'] as $name => $key) {
            RateLimiter::for($name, fn (Request $request) => Limit::perMinute(max(1, (int) config('liteos.net.'.$key)))
                ->by($name.':'.($request->user()?->getAuthIdentifier() ?? $request->ip()))
                ->response(fn (Request $request, array $headers) => response()->json(
                    ['success' => false, 'message' => 'Too many requests. Wait a minute and try again.'],
                    429,
                    $headers,
                )));
        }
    }
}
