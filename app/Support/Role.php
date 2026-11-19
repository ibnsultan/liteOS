<?php

namespace App\Support;

// What an account may do. Administrators manage accounts and the system settings (the "admin" gate); everyone else is
// a user. The values are what the MVP stored, so imported accounts keep their role.
enum Role: string
{
    case Admin = 'admin';
    case User = 'user';

    public function label(): string
    {
        return match ($this) {
            self::Admin => 'Administrator',
            self::User => 'User',
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
