<?php

namespace App\Support;

use App\Models\User;

/**
 * UserSettings
 *
 * Each user's own desktop settings: theme, accent, wallpaper, dock or taskbar, accessibility, volume, brightness...
 * Only the values a user changed are stored (App\Models\UserSetting); everything else comes from defaults(), so new
 * settings reach existing users without a migration. validate() keeps only known keys with acceptable values, the
 * same rules as the MVP, and checks app ids against the installed apps. Keys are camelCase as the shell sends them.
 */
class UserSettings
{
    /**
     * @var array<string, list<string>> settings that take one of a fixed set of values
     */
    const CHOICES = [
        'theme' => ['light', 'dark', 'auto'],
        'wallpaperFit' => ['cover', 'contain', 'center'],
        'taskbar' => ['floating', 'classic'],
        'align' => ['center', 'left'],
        'iconSize' => ['small', 'medium', 'large'],
        'textSize' => ['default', 'large', 'larger'],
        'cursorSize' => ['default', 'large', 'larger'],
        'caretColor' => ['auto', 'accent', 'red', 'green', 'purple'],
        'colorFilter' => ['none', 'grayscale', 'invert', 'grayscale-invert'],
        'contrast' => ['off', 'dark', 'light'],
        'captionSize' => ['small', 'medium', 'large'],
        'deskIconSize' => ['small', 'medium', 'large'],
        'deskSort' => ['name', 'type', 'size', 'mtime'],
        'shotBorderWidth' => [1, 2, 4, 8],
    ];

    /**
     * @var list<string> on/off settings
     */
    const SWITCHES = [
        'autohide', 'labels', 'topbar', 'magnify', 'transparency', 'nightLight', 'dnd', 'clock24', 'muted',
        'reduceMotion', 'notifySound', 'flashOnNotify', 'focusRing', 'deskIcons',
        'shotCopy', 'shotSave', 'shotBorder', 'shotCopyEdits', 'shotAskSave', 'shotRecSave', 'shotRecMic', 'shotRecSound',
    ];

    /**
     * Every setting's default value.
     *
     * - wallpaper: a built-in wallpaper id, or "file:/path/in/drive.jpg"
     * - the accessibility settings start at reduceMotion
     * - notifyTimeout: seconds a notification stays
     * - brightness: 20–100, dims the screen with an overlay
     * - volume: 0–100, for audio and video in LiteOS apps
     * - desktopIcons: app ids, and "trash"
     * - deskIcons: show the desktop icons at all (desktop menu > View)
     * - deskSort: how the Desktop folder's items are ordered (folders first)
     * - deskLayout: icons the user dragged: { "desk:files" | "file:/Desktop/a.txt": [column, row] }
     * - quickAccess: folders pinned in Files
     * - launcherWidth: the classic launcher's width in px; 0 = its default
     * - appUsage: how often each app was opened: { id: count }, for the modern launcher's Popular
     * - shot*: Screenshot's settings: copy each one to the clipboard, save it (and where), and a border around it
     * - shotCopyEdits: markup in Screenshot is copied as it changes
     * - shotAskSave: asked on closing Screenshot with unsaved markup
     * - shotRec*: Screenshot's screen recordings: saved by themselves (and where), the microphone and the tab's sound
     *
     * @return array<string, mixed>
     */
    public static function defaults(): array
    {
        return [
            'theme' => 'light',
            'accent' => '#2F6FD6',
            'wallpaper' => 'siamese',
            'wallpaperFit' => 'cover',
            'taskbar' => 'floating',
            'align' => 'center',
            'iconSize' => 'medium',
            'autohide' => false,
            'labels' => false,
            'topbar' => true,
            'magnify' => true,
            'transparency' => true,
            'nightLight' => false,
            'dnd' => false,
            'reduceMotion' => false,
            'notifyTimeout' => 5,
            'notifySound' => false,
            'flashOnNotify' => false,
            'cursorSize' => 'default',
            'caretColor' => 'auto',
            'colorFilter' => 'none',
            'contrast' => 'off',
            'captionSize' => 'medium',
            'focusRing' => false,
            'brightness' => 100,
            'volume' => 80,
            'muted' => false,
            'textSize' => 'default',
            'clock24' => true,
            'pinned' => ['files', 'settings', 'browser'],
            'desktopIcons' => ['files', 'trash'],
            'deskIcons' => true,
            'deskIconSize' => 'medium',
            'deskSort' => 'name',
            'deskLayout' => [],
            'quickAccess' => ['/Desktop', '/Downloads', '/Documents', '/Pictures', '/Music', '/Videos'],
            'homepage' => 'https://www.wikipedia.org',
            'launcherWidth' => 0,
            'appUsage' => [],
            'shotCopy' => true,
            'shotSave' => true,
            'shotFolder' => '/Pictures/Screenshots',
            'shotBorder' => false,
            'shotBorderColor' => '#000000',
            'shotBorderWidth' => 2,
            'shotCopyEdits' => true,
            'shotAskSave' => false,
            'shotRecSave' => true,
            'shotRecFolder' => '/Videos/Recordings',
            'shotRecMic' => false,
            'shotRecSound' => true,
        ];
    }

    /**
     * A user's settings: what they changed, over the defaults. A guest's changes are kept in its browser
     * (public/guest-sw.js); the shell lays them over these defaults.
     *
     * @return array<string, mixed>
     */
    public static function for(User $user): array
    {
        if ($user->isGuest()) {
            return self::limit(self::defaults(), $user);
        }

        return self::limit(array_merge(self::defaults(), self::validate($user->settings?->settings ?? [])), $user);
    }

    /**
     * Validates the changes and stores them with the user's earlier ones. Unknown keys and unacceptable values are
     * dropped quietly (the MVP did the same), so an old or newer shell never breaks saving.
     *
     * @param  array<string, mixed>  $changes
     * @return array<string, mixed> the user's settings after saving
     */
    public static function save(User $user, array $changes): array
    {
        $clean = self::limit(self::validate($changes), $user);
        $stored = $user->settings?->settings ?? [];
        $user->settings()->updateOrCreate([], ['settings' => array_merge($stored, $clean)]);
        $user->unsetRelation('settings');

        return self::for($user);
    }

    /**
     * Only the known keys with acceptable values. The old Documents app (docs) was replaced by documents: in pinned
     * and desktopIcons it is kept where it was pinned, as documents.
     *
     * @param  array<string, mixed>  $in
     * @return array<string, mixed>
     */
    public static function validate(array $in): array
    {
        $out = [];
        foreach ($in as $key => $value) {
            if (isset(self::CHOICES[$key])) {
                if (in_array($value, self::CHOICES[$key], true)) {
                    $out[$key] = $value;
                }
            } elseif (in_array($key, self::SWITCHES, true)) {
                $out[$key] = (bool) $value;
            } elseif ($key === 'notifyTimeout') {
                if (in_array((int) $value, [5, 10, 20, 30], true)) {
                    $out[$key] = (int) $value;
                }
            } elseif ($key === 'brightness' || $key === 'volume') {
                if (is_numeric($value)) {
                    $out[$key] = $key === 'brightness' ? max(20, min(100, (int) $value)) : max(0, min(100, (int) $value));
                }
            } elseif ($key === 'shotFolder' || $key === 'shotRecFolder') {
                $folder = self::folderList([$value]);
                if ($folder) {
                    $out[$key] = $folder[0];
                }
            } elseif ($key === 'accent' || $key === 'shotBorderColor') {
                if (is_string($value) && preg_match('/^#[0-9a-fA-F]{6}$/', $value)) {
                    $out[$key] = strtoupper($value);
                }
            } elseif ($key === 'wallpaper') {
                if (is_string($value) && strlen($value) < 512 && (preg_match('/^[a-z0-9-]{1,32}$/', $value) || str_starts_with($value, 'file:/'))) {
                    $out[$key] = $value;
                }
            } elseif ($key === 'pinned' || $key === 'desktopIcons') {
                if (is_array($value)) {
                    $allowed = app(AppRegistry::class)->ids();
                    $value = array_map(fn ($id) => $id === 'docs' ? 'documents' : $id, $value);
                    if ($key === 'desktopIcons') {
                        $allowed[] = 'trash';
                    }
                    $out[$key] = array_values(array_unique(array_filter($value, fn ($id) => is_string($id) && in_array($id, $allowed, true))));
                }
            } elseif ($key === 'deskLayout') {
                if (is_array($value)) {
                    $out[$key] = self::deskLayout($value);
                }
            } elseif ($key === 'quickAccess') {
                if (is_array($value)) {
                    $out[$key] = self::folderList($value);
                }
            } elseif ($key === 'launcherWidth') {
                if (is_numeric($value)) {
                    $out[$key] = (int) $value === 0 ? 0 : max(480, min(1200, (int) $value));
                }
            } elseif ($key === 'appUsage') {
                if (is_array($value)) {
                    $allowed = app(AppRegistry::class)->ids();
                    $usage = [];
                    foreach ($value as $id => $n) {
                        if (is_string($id) && in_array($id, $allowed, true) && is_numeric($n)) {
                            $usage[$id] = max(0, min(1000000, (int) $n));
                        }
                    }
                    $out[$key] = $usage;
                }
            } elseif ($key === 'homepage') {
                if (is_string($value) && preg_match('#^https?://#i', $value) && strlen($value) < 2048) {
                    $out[$key] = $value;
                }
            }
        }

        return $out;
    }

    /**
     * Drops what the account may not have (App\Support\Capabilities): apps it can't open from pinned and the desktop
     * icons, a wallpaper from the drive without a drive, a home page without web access. Run on saving and on
     * reading, so narrowing a Local account's apps later also takes them off its taskbar.
     *
     * @param  array<string, mixed>  $settings
     * @return array<string, mixed>
     */
    private static function limit(array $settings, User $user): array
    {
        $can = Capabilities::for($user);
        foreach (['pinned', 'desktopIcons'] as $key) {
            if (isset($settings[$key]) && is_array($settings[$key])) {
                $settings[$key] = array_values(array_filter($settings[$key], fn ($id) => $id === 'trash' ? $can['files'] : in_array($id, $can['apps'], true)));
            }
        }
        if (! $can['drive'] && isset($settings['wallpaper']) && str_starts_with((string) $settings['wallpaper'], 'file:')) {
            $settings['wallpaper'] = self::defaults()['wallpaper'];
        }
        if (! $can['web'] && array_key_exists('homepage', $settings)) {
            $settings['homepage'] = self::defaults()['homepage'];
        }

        return $settings;
    }

    /**
     * Desktop icon cells: keys are "desk:<id>" or "file:/path", values a [column, row] pair of small whole numbers.
     *
     * @param  array<mixed>  $in
     * @return array<string, array{int, int}>
     */
    private static function deskLayout(array $in): array
    {
        $out = [];
        foreach ($in as $key => $cell) {
            if (count($out) >= 500) {
                break;
            }
            if (! is_string($key) || strlen($key) > 600 || ! preg_match('#^(desk:[a-z0-9-]{1,32}|file:/.+)$#', $key)) {
                continue;
            }
            if (! is_array($cell) || count($cell) !== 2 || ! is_numeric($cell[0] ?? null) || ! is_numeric($cell[1] ?? null)) {
                continue;
            }
            $out[$key] = [max(0, min(200, (int) $cell[0])), max(0, min(200, (int) $cell[1]))];
        }

        return $out;
    }

    /**
     * Folders pinned to Quick access: absolute drive paths ("/Documents/Work"), each once, in the order given.
     *
     * @param  array<mixed>  $in
     * @return list<string>
     */
    private static function folderList(array $in): array
    {
        $out = [];
        foreach ($in as $path) {
            if (count($out) >= 50) {
                break;
            }
            if (! is_string($path) || strlen($path) > 600 || ! str_starts_with($path, '/') || $path === '/'
                || preg_match('#(^|/)\.\.?(/|$)|//|[ -]#', $path) || in_array($path, $out, true)) {
                continue;
            }
            $out[] = rtrim($path, '/');
        }

        return $out;
    }
}
