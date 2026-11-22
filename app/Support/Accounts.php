<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

// Creating, changing and deleting accounts, with the MVP's rules and messages: usernames are 2–32 lowercase
// characters, passwords at least 6, and there is always at least one active administrator. Used by first-run setup,
// Settings › Accounts (the administrator's user list) and the importer. Every rule fails with one plain sentence.
class Accounts
{
    const USERNAME_PATTERN = '/^[a-z0-9][a-z0-9_.-]{1,31}$/';

    /**
     * @throws ValidationException
     */
    public static function create(string $username, string $name, string $password, Role|string $role = Role::User, ?int $quotaMb = null): User
    {
        $username = self::checkUsername($username);
        $name = self::checkName($name);
        self::checkPassword($password);
        $role = self::checkRole($role);

        if (User::query()->where('username', $username)->exists()) {
            self::fail('username', 'That username is already taken.');
        }

        $user = User::query()->create([
            'username' => $username,
            'name' => $name,
            'password' => $password,
            'role' => $role,
            'color' => User::COLORS[User::query()->count() % count(User::COLORS)],
            'quota_mb' => $quotaMb === null ? null : max(10, $quotaMb),
        ]);
        Drive::ensureHome($user->username);

        return $user;
    }

    /**
     * Applies an administrator's or the user's own changes: name, role, disabled, quotaMB (null = system default),
     * password. Keys that aren't given stay as they are.
     *
     * @param  array<string, mixed>  $changes
     *
     * @throws ValidationException
     */
    public static function update(User $user, array $changes): User
    {
        return DB::transaction(function () use ($user, $changes) {
            if (array_key_exists('name', $changes)) {
                $user->name = self::checkName((string) $changes['name']);
            }
            if (array_key_exists('role', $changes)) {
                $user->role = self::checkRole((string) $changes['role']);
            }
            if (array_key_exists('disabled', $changes)) {
                $user->disabled_at = $changes['disabled'] ? ($user->disabled_at ?? now()) : null;
            }
            if (array_key_exists('quotaMB', $changes)) {
                $quota = $changes['quotaMB'];
                $user->quota_mb = ($quota === null || $quota === '') ? null : max(10, (int) $quota);
            }
            if (! empty($changes['password'])) {
                self::checkPassword((string) $changes['password']);
                $user->password = (string) $changes['password'];
            }

            $user->save();
            // only a change of role or of the disabled flag can take away the last administrator
            if (array_key_exists('role', $changes) || array_key_exists('disabled', $changes)) {
                self::keepAnAdmin('There must be at least one active administrator.');
            }

            return $user;
        });
    }

    /**
     * Deletes the account and moves its drive aside (kept, so it can be recovered by hand).
     *
     * @throws ValidationException
     */
    public static function delete(User $user): void
    {
        // the drive is moved aside last, inside the transaction: if that fails, the account isn't deleted either
        DB::transaction(function () use ($user) {
            $user->delete();
            self::keepAnAdmin('You can’t delete the last administrator.');
            Drive::archive($user->username);
        });
    }

    /**
     * @throws ValidationException
     */
    public static function checkUsername(string $username): string
    {
        $username = strtolower(trim($username));
        if (! preg_match(self::USERNAME_PATTERN, $username)) {
            self::fail('username', 'Usernames are 2–32 characters: lowercase letters, numbers, dot, dash or underscore.');
        }

        return $username;
    }

    /**
     * @throws ValidationException
     */
    public static function checkPassword(string $password): void
    {
        if (strlen($password) < 6) {
            self::fail('password', 'Passwords must be at least 6 characters.');
        }
        if (strlen($password) > 200) {
            self::fail('password', 'Password is too long.');
        }
    }

    /**
     * @throws ValidationException
     */
    private static function checkName(string $name): string
    {
        $name = trim(strip_tags($name));
        if ($name === '' || mb_strlen($name) > 60) {
            self::fail('name', 'Enter a display name (up to 60 characters).');
        }

        return $name;
    }

    /**
     * @throws ValidationException
     */
    private static function checkRole(Role|string $role): Role
    {
        $role = $role instanceof Role ? $role : Role::tryFrom($role);
        if ($role === null) {
            self::fail('role', 'Unknown role.');
        }

        return $role;
    }

    /**
     * Inside a transaction: undoes the change when it would leave no active administrator.
     *
     * @throws ValidationException
     */
    private static function keepAnAdmin(string $message): void
    {
        $admins = User::query()->where('role', Role::Admin)->whereNull('disabled_at')->count();
        if ($admins === 0) {
            self::fail('role', $message);
        }
    }

    /**
     * @throws ValidationException
     */
    private static function fail(string $field, string $message): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}
