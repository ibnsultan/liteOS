<?php

namespace App\Http\Controllers\Os;

use App\Http\Controllers\Controller;
use App\Support\Accounts;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;

// The signed-in user's own account (/os/account), from Settings › Accounts: their display name and password. Role,
// quota and disabling are the administrator's (UsersController).
class AccountController extends Controller
{
    public function update(Request $request): JsonResponse
    {
        $this->result = Accounts::update($request->user(), ['name' => (string) $request->input('name')])->toPublic();

        return $this->jsonSuccess();
    }

    public function password(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! Hash::check((string) $request->input('current'), $user->password)) {
            return $this->jsonError('Your current password is wrong.', 403);
        }

        $this->result = Accounts::update($user, ['password' => (string) $request->input('new')])->toPublic();

        return $this->jsonSuccess();
    }

    public static function routes(): void
    {
        Route::post('/update', [self::class, 'update'])->name('account.update');
        Route::post('/password', [self::class, 'password'])->name('account.password');
    }
}
