<?php

use App\Http\Controllers\AppsController;
use App\Http\Controllers\Auth\LockController;
use App\Http\Controllers\Auth\SetupController;
use App\Http\Controllers\Auth\SignInController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\ShellController;
use App\Http\Middleware\EnsureAccountActive;
use App\Http\Middleware\EnsureSetUp;
use App\Http\Middleware\EnsureUnlocked;
use Illuminate\Support\Facades\Route;

// The pages: first-run setup, signing in, the lock screen, and once in, the desktop and each app window's page.

SetupController::routes();

Route::middleware(EnsureSetUp::class)->group(function () {
    SignInController::routes();
    LockController::routes();

    Route::middleware(['auth', EnsureAccountActive::class, EnsureUnlocked::class])->group(function () {
        Route::get('/', [ShellController::class, 'show'])->name('home');
        Route::get('/apps/{app}', [AppsController::class, 'show'])->name('apps.show');
    });
});

// what the running desktop asks about its session, answered in JSON (prefix /auth, names auth.*)
Route::prefix('auth')->group(fn () => AuthController::routes());
