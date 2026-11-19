<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Accounts;
use App\Support\Role;
use App\Support\SignIn;
use App\Support\SystemSettings;
use App\Support\UserSettings;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\ValidationException;

// First run (/setup): the wizard names this computer, creates the administrator and picks the look, then signs in and
// opens the desktop. Only while no account exists; after that the page sends you on.
class SetupController extends Controller
{
    public function show(): View|RedirectResponse
    {
        if (User::query()->exists()) {
            return redirect()->route('home');
        }

        return view('auth.setup', [
            'accents' => config('liteos.accents'),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        if (User::query()->exists()) {
            return redirect()->route('home');
        }

        $instance = mb_substr(trim(strip_tags((string) $request->input('instanceName'))), 0, 40);
        if ($instance === '') {
            throw ValidationException::withMessages(['instanceName' => 'Enter a name for this computer.']);
        }
        if ((string) $request->input('password') !== (string) $request->input('password_confirmation')) {
            throw ValidationException::withMessages(['password_confirmation' => 'The passwords don’t match.']);
        }

        $user = DB::transaction(function () use ($request, $instance) {
            $user = Accounts::create((string) $request->input('username'), (string) $request->input('name'), (string) $request->input('password'), Role::Admin);
            SystemSettings::put(['instanceName' => $instance, 'createdAt' => now()->toIso8601String()]);
            UserSettings::save($user, $request->only(['theme', 'accent', 'taskbar']));

            return $user;
        });

        SignIn::login($request, $user);

        return redirect()->route('home')->with('welcome', true);
    }

    public static function routes(): void
    {
        Route::get('/setup', [self::class, 'show'])->name('setup');
        Route::post('/setup', [self::class, 'store'])->name('setup.store');
    }
}
