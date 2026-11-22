<?php

namespace App\Support;

use App\Models\User;

// What an account may do, decided in one place (docs/account-types.md). The gates in AppServiceProvider, the routes,
// the settings filter, the app list sent to the browser and User::toPublic()['can'] all ask for(), so the server and
// the UI can't disagree.
//
// Administrators and standard users can do everything they could before; only administrators manage accounts and the
// system. A Local account gets the role's limited defaults, which an administrator can tune with the switches stored
// in users.permissions: web (bool), apps (list of app ids, or null for config liteos.local_apps), changeName and
// changePassword (bool). "drive" is a drive on the server; "files" is having files at all, which a guest also has, in
// its browser (public/guest-sw.js). The Guest account has no drive on the server, can't lock (there's no password to unlock
// with) and gets web access and apps from the system settings guestWeb and guestApps. A disabled account can do
// nothing.
class Capabilities
{
    /** @var list<string> the switches an administrator may set on a Local account */
    const SWITCHES = ['web', 'changeName', 'changePassword'];

    /**
     * @return array{drive: bool, files: bool, web: bool, apps: list<string>, settingsDevice: bool, changeName: bool, changePassword: bool, lock: bool, usb: bool, print: bool, admin: bool}
     */
    public static function for(User $user): array
    {
        $installed = app(AppRegistry::class)->ids();

        if ($user->isDisabled()) {
            return ['drive' => false, 'files' => false, 'web' => false, 'apps' => [], 'settingsDevice' => false, 'changeName' => false,
                'changePassword' => false, 'lock' => false, 'usb' => false, 'print' => false, 'admin' => false];
        }

        if ($user->isGuest()) {
            // the built-in Guest account: set for all guests at once in the system settings; files stay in the browser
            $web = (bool) SystemSettings::get('guestWeb');
            $apps = SystemSettings::get('guestApps') ?? config('liteos.local_apps', []);

            return ['drive' => false, 'files' => true, 'web' => $web, 'apps' => self::allowedApps(is_array($apps) ? $apps : [], $installed, $web),
                'settingsDevice' => false, 'changeName' => false, 'changePassword' => false, 'lock' => false, 'usb' => false,
                'print' => true, 'admin' => false];
        }

        if (! $user->isLocal()) {
            return ['drive' => true, 'files' => true, 'web' => true, 'apps' => $installed, 'settingsDevice' => true, 'changeName' => true,
                'changePassword' => true, 'lock' => true, 'usb' => true, 'print' => true, 'admin' => $user->isAdmin()];
        }

        $switches = self::cleanPermissions($user->permissions ?? []);
        $web = $switches['web'] ?? true;
        $apps = $switches['apps'] ?? config('liteos.local_apps', []);

        return [
            'drive' => true,
            'files' => true,
            'web' => $web,
            'apps' => self::allowedApps($apps, $installed, $web),
            'settingsDevice' => false,
            'changeName' => $switches['changeName'] ?? true,
            'changePassword' => $switches['changePassword'] ?? true,
            'lock' => true,
            'usb' => true,
            'print' => true,
            'admin' => false,
        ];
    }

    /**
     * Whether the account may open the app.
     */
    public static function allowsApp(User $user, string $id): bool
    {
        return in_array($id, self::for($user)['apps'], true);
    }

    /**
     * An administrator's switches for a Local account, keeping only known keys with acceptable values. "apps" keeps
     * installed app ids only; null (or leaving it out) means the default list.
     *
     * @param  array<mixed>  $in
     * @return array{web?: bool, changeName?: bool, changePassword?: bool, apps?: list<string>|null}
     */
    public static function cleanPermissions(array $in): array
    {
        $out = [];
        foreach (self::SWITCHES as $key) {
            if (array_key_exists($key, $in)) {
                $out[$key] = (bool) $in[$key];
            }
        }
        if (array_key_exists('apps', $in)) {
            $installed = app(AppRegistry::class)->ids();
            $out['apps'] = is_array($in['apps'])
                ? array_values(array_unique(array_filter($in['apps'], fn ($id) => is_string($id) && in_array($id, $installed, true))))
                : null;
        }

        return $out;
    }

    /**
     * The apps from the list that are installed, in launcher order, with Settings always (it's where anyone locks,
     * signs out or changes their wallpaper) and the Browser only with web access.
     *
     * @param  array<mixed>  $wanted
     * @param  list<string>  $installed
     * @return list<string>
     */
    private static function allowedApps(array $wanted, array $installed, bool $web): array
    {
        return array_values(array_filter($installed, fn (string $id) => $id === 'settings'
            || (in_array($id, $wanted, true) && ($id !== 'browser' || $web))));
    }
}
