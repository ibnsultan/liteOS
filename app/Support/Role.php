<?php

namespace App\Support;

// What an account may do. Administrators manage accounts and the system settings (the "admin" gate); standard users
// can do everything else; Local accounts are limited, and an administrator can tune each one (App\Support\Capabilities,
// docs/account-types.md). Guest is the one built-in account anyone can use without a password (App\Support\Guest).
// "admin" and "user" are what the MVP stored, so imported accounts keep their role.
enum Role: string
{
    case Admin = 'admin';
    case User = 'user';
    case Local = 'local';
    case Guest = 'guest';

    public function label(): string
    {
        return match ($this) {
            self::Admin => 'Administrator',
            self::User => 'User',
            self::Local => 'Local account',
            self::Guest => 'Guest',
        };
    }

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
