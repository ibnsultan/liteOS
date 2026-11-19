<?php

use App\Http\Controllers\Os\AccountController;
use App\Http\Controllers\Os\DriveController;
use App\Http\Controllers\Os\SettingsController;
use App\Http\Controllers\Os\StreamController;
use App\Http\Controllers\Os\SystemController;
use App\Http\Controllers\Os\TrashController;
use App\Http\Controllers\Os\UsersController;
use App\Http\Controllers\Os\WebController;
use Illuminate\Support\Facades\Route;

// The desktop's API (prefix /os, names os.*, signed in only; see RouteServiceProvider). One line per controller, each
// controller lists its own routes in routes(). Replaces the MVP's api.php?action=a.b with /os/a/b (GET for reads, POST
// for changes), so the shell's api() maps actions to URLs with one rule (public/assets/js/apps.js, LOS_endpoint).

Route::prefix('settings')->group(fn () => SettingsController::routes());
Route::prefix('account')->group(fn () => AccountController::routes());
Route::prefix('fs')->group(fn () => DriveController::routes());
Route::prefix('trash')->group(fn () => TrashController::routes());
Route::prefix('net')->group(function () {
    WebController::routes();
    StreamController::routes();
});

// administrators only
Route::middleware('can:admin')->group(function () {
    Route::prefix('users')->group(fn () => UsersController::routes());
    Route::prefix('system')->group(fn () => SystemController::routes());
});
