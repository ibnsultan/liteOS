<?php

namespace App\Providers;

use App\Models\User;
use App\Support\AppRegistry;
use App\Support\Capabilities;
use App\Support\SecurityLog;
use App\Support\SystemIcons;
use App\View\Components\WindowLayout;
use Illuminate\Auth\Access\Response;
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

        // what each account may do (App\Support\Capabilities, docs/account-types.md): the drive, the web relay, its
        // own name and password, and each app. A refusal carries one plain sentence, which the API hands back.
        $capability = fn (string $key, string $refusal) => fn (User $user) => Capabilities::for($user)[$key]
            ? Response::allow()
            : Response::deny($refusal);
        Gate::define('drive', $capability('drive', 'Your account has no drive.'));
        Gate::define('web', $capability('web', 'Web access is turned off for your account.'));
        Gate::define('account.name', $capability('changeName', 'Your administrator doesn’t let this account change its name.'));
        Gate::define('account.password', $capability('changePassword', 'Your administrator doesn’t let this account change its password.'));
        Gate::define('app', fn (User $user, string $id) => Capabilities::allowsApp($user, $id)
            ? Response::allow()
            : Response::deny('Your account can’t open this app.'));

        // a refused request goes to the security log (only the routes ask these gates)
        Gate::after(function (User $user, string $ability, bool|Response|null $result) {
            if ($result === null || ($result instanceof Response ? $result->allowed() : $result)) {
                return;
            }
            if ($ability === 'admin') {
                SecurityLog::adminRefused();
            } elseif (in_array($ability, ['drive', 'web', 'account.name', 'account.password', 'app'], true)) {
                SecurityLog::capabilityRefused($user, $ability);
            }
        });

        // "Sign in as guest", per address: it needs no password, so it's limited like wrong passwords are
        RateLimiter::for('guest-sign-in', fn (Request $request) => Limit::perMinute(10)->by('guest-sign-in:'.$request->ip()));

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
