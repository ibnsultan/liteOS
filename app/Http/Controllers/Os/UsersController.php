<?php

namespace App\Http\Controllers\Os;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Accounts;
use App\Support\Drive;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// Accounts, for administrators (/os/users, behind the "admin" gate): the list with each drive's use and quota, and
// creating, changing and deleting accounts. The account is named in the request body by username, as the Settings
// app sends it. An administrator can't disable or delete their own account while signed in with it.
class UsersController extends Controller
{
    public function list(): JsonResponse
    {
        $this->result = User::query()->orderBy('created_at')->orderBy('id')->get()->map(fn (User $user) => $user->toPublic() + [
            'used' => Drive::usage($user->username),
            'quota' => Drive::quotaBytes($user),
        ])->all();

        return $this->jsonSuccess();
    }

    public function create(Request $request): JsonResponse
    {
        $quota = $request->input('quotaMB');
        $user = Accounts::create(
            (string) $request->input('username'),
            (string) $request->input('name'),
            (string) $request->input('password'),
            (string) $request->input('role', 'user'),
            ($quota === null || $quota === '') ? null : (int) $quota,
        );

        $this->result = $user->toPublic();

        return $this->jsonSuccess();
    }

    public function update(Request $request): JsonResponse
    {
        $user = $this->target($request);
        if ($user === null) {
            return $this->jsonError('User not found.', 404);
        }

        $changes = $request->input('changes', []);
        $changes = is_array($changes) ? array_intersect_key($changes, array_flip(['name', 'role', 'disabled', 'quotaMB', 'password'])) : [];
        if ($user->is($request->user()) && ! empty($changes['disabled'])) {
            return $this->jsonError('You can’t disable your own account.');
        }

        $this->result = Accounts::update($user, $changes)->toPublic();

        return $this->jsonSuccess();
    }

    public function delete(Request $request): JsonResponse
    {
        $user = $this->target($request);
        if ($user === null) {
            return $this->jsonError('User not found.', 404);
        }
        if ($user->is($request->user())) {
            return $this->jsonError('You can’t delete your own account while signed in.');
        }

        Accounts::delete($user);
        $this->result = true;

        return $this->jsonSuccess();
    }

    private function target(Request $request): ?User
    {
        return User::query()->where('username', strtolower(trim((string) $request->input('username'))))->first();
    }

    public static function routes(): void
    {
        Route::get('/list', [self::class, 'list'])->name('users.list');
        Route::post('/create', [self::class, 'create'])->name('users.create');
        Route::post('/update', [self::class, 'update'])->name('users.update');
        Route::post('/delete', [self::class, 'delete'])->name('users.delete');
    }
}
