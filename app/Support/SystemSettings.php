<?php

namespace App\Support;

use App\Models\SystemSetting;
use Illuminate\Validation\ValidationException;

// Settings for the whole instance, changed by administrators in Settings › System: the instance name (shown on the
// sign-in screen and in the browser tab) and the storage quota new accounts get. Stored one row per key; anything not
// stored yet comes from the defaults here. Keys are the MVP's camelCase names, which the Settings app sends.
class SystemSettings
{
    /**
     * @return array{instanceName: string, defaultQuotaMB: int, createdAt: string|null}
     */
    public static function defaults(): array
    {
        return [
            'instanceName' => 'LiteOS',
            'defaultQuotaMB' => (int) config('liteos.default_quota_mb'),
            'createdAt' => null,
        ];
    }

    /**
     * Every setting, stored values over the defaults.
     *
     * @return array{instanceName: string, defaultQuotaMB: int, createdAt: string|null}
     */
    public static function all(): array
    {
        $stored = SystemSetting::query()->pluck('value', 'key')->all();

        return array_merge(self::defaults(), array_intersect_key($stored, self::defaults()));
    }

    public static function get(string $key): mixed
    {
        return self::all()[$key] ?? null;
    }

    /**
     * Validates and stores the changes an administrator made; unknown keys are ignored.
     *
     * @param  array<string, mixed>  $changes
     * @return array{instanceName: string, defaultQuotaMB: int, createdAt: string|null}
     *
     * @throws ValidationException
     */
    public static function save(array $changes): array
    {
        $clean = [];
        if (array_key_exists('instanceName', $changes)) {
            $name = trim(strip_tags((string) $changes['instanceName']));
            if ($name === '' || mb_strlen($name) > 40) {
                throw ValidationException::withMessages(['instanceName' => 'Enter a name for this LiteOS (up to 40 characters).']);
            }
            $clean['instanceName'] = $name;
        }
        if (array_key_exists('defaultQuotaMB', $changes)) {
            if (! is_numeric($changes['defaultQuotaMB'])) {
                throw ValidationException::withMessages(['defaultQuotaMB' => 'Enter the default storage in MB.']);
            }
            $clean['defaultQuotaMB'] = max(10, min(1024 * 1024, (int) $changes['defaultQuotaMB']));
        }

        self::put($clean);

        return self::all();
    }

    /**
     * Stores values as they are (no validation), for setup and the importer.
     *
     * @param  array<string, mixed>  $values
     */
    public static function put(array $values): void
    {
        foreach ($values as $key => $value) {
            SystemSetting::query()->updateOrCreate(['key' => $key], ['value' => $value]);
        }
    }
}
