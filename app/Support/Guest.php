<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

// The built-in Guest account (docs/account-types.md): one users row, username "guest", role guest, with a random
// password nobody knows. An administrator turns it on or off in Settings › Accounts (system setting guestEnabled);
// while it's on, the sign-in screen offers "Sign in as guest" and anyone can use it without a password. The row is
// made the first time Guest is turned on, so installs that never use it have none, and it's disabled while Guest is
// off (open guest sessions then end on their next request, EnsureAccountActive). A guest has no drive on the server:
// its files stay in the browser on that device. What a guest may do is in App\Support\Capabilities.
class Guest
{
    const USERNAME = 'guest';

    public static function enabled(): bool
    {
        return (bool) SystemSettings::get('guestEnabled');
    }

    /**
     * The Guest account's row, if it was ever made.
     */
    public static function account(): ?User
    {
        return User::query()->where('username', self::USERNAME)->where('role', Role::Guest)->first();
    }

    /**
     * The Guest account when guests may sign in now, else null.
     */
    public static function available(): ?User
    {
        $user = self::enabled() ? self::account() : null;

        return $user !== null && ! $user->isDisabled() ? $user : null;
    }

    /**
     * Turning Guest on needs the username: an account someone made called "guest" (before it was reserved) stops it.
     *
     * @throws ValidationException
     */
    public static function checkCanEnable(): void
    {
        $taken = User::query()->where('username', self::USERNAME)->where('role', '!=', Role::Guest->value)->exists();
        if ($taken) {
            throw ValidationException::withMessages(['guestEnabled' => 'An account called “guest” already exists. Delete it before turning on the guest account.']);
        }
    }

    /**
     * Makes the row match the setting: made or enabled when Guest is on, disabled when it's off.
     */
    public static function sync(bool $on): void
    {
        $user = self::account();
        if ($user === null) {
            if (! $on) {
                return;
            }
            $user = User::query()->create([
                'username' => self::USERNAME,
                'name' => 'Guest',
                'password' => Str::random(64),
                'role' => Role::Guest,
                'color' => '#8C929C',
            ]);
        }
        $user->forceFill(['disabled_at' => $on ? null : ($user->disabled_at ?? now())])->save();
    }
}
