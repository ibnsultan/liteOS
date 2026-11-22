<?php

namespace App\Support;

use App\Models\User;

// Each user's own desktop settings: theme, accent, wallpaper, dock or taskbar, accessibility, volume, brightness...
// Only the values a user changed are stored (App\Models\UserSetting); everything else comes from defaults(), so new
// settings reach existing users without a migration. validate() keeps only known keys with acceptable values, the
// same rules as the MVP, and checks app ids against the installed apps. Keys are camelCase as the shell sends them.
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
    ];

    /**
     * @var list<string> on/off settings
     */
    const SWITCHES = [
        'autohide', 'labels', 'topbar', 'magnify', 'transparency', 'nightLight', 'dnd', 'clock24', 'muted',
        'reduceMotion', 'notifySound', 'flashOnNotify', 'focusRing', 'deskIcons',
    ];

    /**
     * @return array<string, mixed>
     */
    public static function defaults(): array
    {
        return [
            'theme' => 'light',
            'accent' => '#2F6FD6',
            'wallpaper' => 'siamese',       // a built-in wallpaper id, or "file:/path/in/drive.jpg"
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
            // accessibility
            'reduceMotion' => false,
            'notifyTimeout' => 5,           // seconds a notification stays
            'notifySound' => false,
            'flashOnNotify' => false,
            'cursorSize' => 'default',
            'caretColor' => 'auto',
            'colorFilter' => 'none',
            'contrast' => 'off',
            'captionSize' => 'medium',
            'focusRing' => false,
            'brightness' => 100,            // 20–100, dims the screen with an overlay
            'volume' => 80,                 // 0–100, for audio and video in LiteOS apps
            'muted' => false,
            'textSize' => 'default',
            'clock24' => true,
            'pinned' => ['files', 'settings', 'browser'],
            'desktopIcons' => ['files', 'trash'],   // app ids, and "trash"
            'deskIcons' => true,            // show the desktop icons at all (desktop menu > View)
            'deskIconSize' => 'medium',
            'deskSort' => 'name',           // how the Desktop folder's items are ordered (folders first)
            'deskLayout' => [],             // icons the user dragged: { "desk:files" | "file:/Desktop/a.txt": [column, row] }
            'quickAccess' => ['/Desktop', '/Downloads', '/Documents', '/Pictures', '/Music', '/Videos'], // folders pinned in Files
            'homepage' => 'https://www.wikipedia.org',
        ];
    }

    /**
     * A user's settings: what they changed, over the defaults.
     *
     * @return array<string, mixed>
     */
    public static function for(User $user): array
    {
        return array_merge(self::defaults(), self::validate($user->settings?->settings ?? []));
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
        $clean = self::validate($changes);
        $stored = $user->settings?->settings ?? [];
        $user->settings()->updateOrCreate([], ['settings' => array_merge($stored, $clean)]);
        $user->unsetRelation('settings');

        return self::for($user);
    }

    /**
     * Only the known keys with acceptable values.
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
            } elseif ($key === 'accent') {
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
                    // the old Documents app (docs) was replaced by documents: keep it where it was pinned
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
            } elseif ($key === 'homepage') {
                if (is_string($value) && preg_match('#^https?://#i', $value) && strlen($value) < 2048) {
                    $out[$key] = $value;
                }
            }
        }

        return $out;
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
