<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;

// The security log (config/logging.php, channel "security"): who signed in or failed to, unlocks and lockouts,
// administrators' changes to accounts, password changes, refused admin requests and what a limited account was refused. Every line has the event name as
// its message and the details as context: the address, the account acting, the browser, and what was done to which
// account. Passwords, session ids, CSRF tokens and relay signatures are never passed here.
class SecurityLog
{
    // longest username typed at sign-in that is kept (anything can be typed there) and longest user agent
    const TYPED_MAX = 64;

    const AGENT_MAX = 200;

    public static function signInFailed(string $typed, string $reason): void
    {
        self::warning('signin.failed', ['username' => self::typed($typed), 'reason' => $reason]);
    }

    public static function signInLocked(string $typed, int $seconds): void
    {
        self::warning('signin.locked', ['username' => self::typed($typed), 'seconds_left' => $seconds]);
    }

    public static function signedIn(User $user): void
    {
        self::info('signin.ok', ['username' => $user->username]);
    }

    public static function unlockFailed(User $user): void
    {
        self::warning('unlock.failed', ['username' => $user->username]);
    }

    public static function unlockLocked(User $user, int $seconds): void
    {
        self::warning('unlock.locked', ['username' => $user->username, 'seconds_left' => $seconds]);
    }

    /**
     * The current password given when changing it was wrong (someone at an unlocked desktop trying passwords).
     */
    public static function passwordChangeRefused(User $user): void
    {
        self::warning('password.change_refused', ['username' => $user->username]);
    }

    public static function passwordChanged(User $user): void
    {
        self::info('password.changed', ['username' => $user->username, 'other_sessions' => 'ended']);
    }

    /**
     * An administrator created an account.
     */
    public static function accountCreated(User $target): void
    {
        self::info('account.created', ['target' => $target->username, 'role' => $target->role->value]);
    }

    /**
     * An administrator changed an account. $changes are the fields asked for; a password shows only as changed.
     *
     * @param  array<string, mixed>  $changes
     */
    public static function accountChanged(User $target, array $changes): void
    {
        $fields = [];
        foreach ($changes as $field => $value) {
            if ($field === 'password' && empty($value)) {
                continue; // an empty password field leaves the password as it is (Accounts::update)
            }
            $fields[$field] = match ($field) {
                'password' => 'changed',
                'role' => $target->role->value,
                'disabled' => $target->isDisabled(),
                'quotaMB' => $target->quota_mb,
                'name' => 'changed',
                'permissions' => $target->permissions,
                default => null,
            };
        }
        self::info('account.changed', ['target' => $target->username, 'fields' => $fields]);
    }

    public static function accountDeleted(string $target): void
    {
        self::info('account.deleted', ['target' => $target]);
    }

    public static function adminRefused(): void
    {
        $request = request();
        self::warning('admin.refused', ['method' => $request->method(), 'path' => '/'.ltrim($request->path(), '/')]);
    }

    /**
     * A limited account was refused something (the drive, web, its name or password, an app). Logged at most a few
     * times a minute per account and ability, so an app retrying in a loop can't flood the log.
     */
    public static function capabilityRefused(User $user, string $ability): void
    {
        $key = 'security-log:refused:'.$user->getAuthIdentifier().':'.$ability;
        if (RateLimiter::tooManyAttempts($key, 5)) {
            return;
        }
        RateLimiter::hit($key, 60);
        $request = request();
        self::warning('capability.refused', ['ability' => $ability, 'method' => $request->method(), 'path' => '/'.ltrim($request->path(), '/')]);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private static function info(string $event, array $context): void
    {
        Log::channel('security')->info($event, self::with($context));
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private static function warning(string $event, array $context): void
    {
        Log::channel('security')->warning($event, self::with($context));
    }

    /**
     * The request's details, then the event's. The acting account is the signed-in one, if any.
     *
     * @param  array<string, mixed>  $context
     * @return array<string, mixed>
     */
    private static function with(array $context): array
    {
        $request = request();
        $actor = $request->user();

        return self::clean(array_filter([
            'ip' => $request->ip(),
            'actor' => $actor?->username,
            'user_agent' => mb_substr((string) $request->userAgent(), 0, self::AGENT_MAX),
        ], fn ($value) => $value !== null && $value !== '') + $context);
    }

    /**
     * Control characters written out as escapes (a line break becomes \n), so no value can start a line of its own:
     * Laravel's line format keeps line breaks inside context values as they are.
     *
     * @param  array<string, mixed>  $context
     * @return array<string, mixed>
     */
    private static function clean(array $context): array
    {
        array_walk_recursive($context, function (&$value) {
            if (is_string($value)) {
                $value = (string) preg_replace_callback('/[\x00-\x1F\x7F]/', fn ($m) => match ($m[0]) {
                    "\n" => '\n', "\r" => '\r', "\t" => '\t', default => sprintf('\x%02X', ord($m[0])),
                }, $value);
            }
        });

        return $context;
    }

    private static function typed(string $username): string
    {
        return mb_substr(trim($username), 0, self::TYPED_MAX);
    }
}
