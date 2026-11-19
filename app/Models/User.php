<?php

namespace App\Models;

use App\Support\Role;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;

// A LiteOS account. Signs in with a username (stored lowercase, so "Abdul" and "abdul" are one account on MySQL and
// SQLite alike), has a role, an avatar colour for the sign-in screen, an optional storage quota and a drive folder
// named after the username. Disabled accounts keep their data but can't sign in.
#[Fillable(['username', 'name', 'password', 'role', 'color', 'quota_mb', 'disabled_at', 'last_login_at'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory;

    // avatar colours, given out in turn as accounts are created (the MVP's order)
    const COLORS = ['#2F6FD6', '#0F7A6E', '#1A8A54', '#B7791F', '#DD630A', '#D63B41', '#C9306B', '#6B4CCB'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'role' => Role::class,
            'quota_mb' => 'integer',
            'disabled_at' => 'datetime',
            'last_login_at' => 'datetime',
        ];
    }

    // usernames are compared lowercase everywhere
    protected function username(): Attribute
    {
        return Attribute::set(fn (string $value) => strtolower(trim($value)));
    }

    // has one row of desktop settings (theme, wallpaper, dock...), created on first save
    public function settings(): HasOne
    {
        return $this->hasOne(UserSetting::class);
    }

    public function isAdmin(): bool
    {
        return $this->role === Role::Admin;
    }

    public function isDisabled(): bool
    {
        return $this->disabled_at !== null;
    }

    /**
     * Up to two letters for the avatar: "Amina Juma" → "AJ" (the shell's initials() does the same).
     */
    public function initials(): string
    {
        $words = preg_split('/\s+/u', trim($this->name), -1, PREG_SPLIT_NO_EMPTY) ?: ['?'];

        return mb_strtoupper(implode('', array_map(fn ($w) => mb_substr($w, 0, 1), array_slice($words, 0, 2))));
    }

    /**
     * The account as the desktop sees it (never the password). Keys are the MVP's, which the shell and Settings read.
     *
     * @return array{username: string, name: string, role: string, color: string, disabled: bool, quotaMB: int|null, created: string|null, lastLogin: string|null}
     */
    public function toPublic(): array
    {
        return [
            'username' => $this->username,
            'name' => $this->name,
            'role' => $this->role->value,
            'color' => $this->color,
            'disabled' => $this->isDisabled(),
            'quotaMB' => $this->quota_mb,
            'created' => $this->created_at?->toIso8601String(),
            'lastLogin' => $this->last_login_at?->toIso8601String(),
        ];
    }
}
