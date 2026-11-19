<?php

namespace App\Support;

// The LiteOS system icons: every icon the OS itself shows (app icons, favicons, Settings, the shell, places, file
// types, the tray) comes from the icon set in public/icons/liteos, looked up by role through its map.json
// ("app.sheets" => "apps/libreoffice-calc"). Each theme has its own folder, so a role resolves to a light and a dark
// file; a role can also be asked for as the set's monochrome -symbolic variant where one exists. In-app toolbar icons
// are not system icons and don't go through here. The shell gets the resolved table through forClient().
class SystemIcons
{
    public const THEMES = ['light', 'dark'];

    /** @var array{sizes: array<string, string>, fallback: string, icons: array<string, string>, extensions: array<string, string>}|null */
    private ?array $map = null;

    /** @var array<string, bool> whether a file under the set exists, by relative path */
    private array $exists = [];

    public function __construct(private string $path) {}

    /**
     * The map as read from map.json.
     *
     * @return array{sizes: array<string, string>, fallback: string, icons: array<string, string>, extensions: array<string, string>}
     */
    public function map(): array
    {
        if ($this->map === null) {
            $map = json_decode((string) @file_get_contents($this->path.'/map.json'), true);
            $this->map = [
                'sizes' => $map['sizes'] ?? [],
                'fallback' => $map['fallback'] ?? 'mime.generic',
                'icons' => $map['icons'] ?? [],
                'extensions' => $map['extensions'] ?? [],
            ];
        }

        return $this->map;
    }

    /** Whether a role is in the map. */
    public function has(string $role): bool
    {
        return isset($this->map()['icons'][$role]);
    }

    /**
     * A role's file inside a theme folder, without the extension ("apps/scalable/libreoffice-calc"), or null for a
     * role that isn't mapped or (symbolic) has no symbolic variant.
     */
    public function relativePath(string $role, bool $symbolic = false): ?string
    {
        $target = $this->map()['icons'][$role] ?? null;
        if ($target === null || ! str_contains($target, '/')) {
            return null;
        }
        // "category/name" is at the category's size; "category/size/name" names its own size folder
        $parts = explode('/', $target, 3);
        [$category, $name] = [$parts[0], end($parts)];
        if (! $symbolic) {
            return count($parts) === 3 ? $target : $category.'/'.($this->map()['sizes'][$category] ?? 'scalable').'/'.$name;
        }
        if (count($parts) === 3 && $parts[1] === 'symbolic') {
            return $target;
        }
        $path = $category.'/symbolic/'.$name.'-symbolic';

        return $this->fileExists('light/'.$path.'.svg') ? $path : null;
    }

    /**
     * The icon file for a role in a theme, as a path under public/ ("icons/liteos/dark/apps/scalable/x.svg"). An
     * unmapped role gets the fallback icon, and a missing symbolic variant the full-colour one.
     */
    public function path(string $role, string $theme = 'light', bool $symbolic = false): string
    {
        $theme = in_array($theme, self::THEMES, true) ? $theme : 'light';
        $relative = ($symbolic ? $this->relativePath($role, true) : null)
            ?? $this->relativePath($role)
            ?? $this->relativePath($this->map()['fallback']);

        return 'icons/liteos/'.$theme.'/'.$relative.'.svg';
    }

    /** The icon's URL for a role in a theme. */
    public function url(string $role, string $theme = 'light', bool $symbolic = false): string
    {
        return asset($this->path($role, $theme, $symbolic));
    }

    /** The role for a file name, by its extension (mime.generic when it isn't known; folders are place.folder). */
    public function roleForFile(string $name): string
    {
        $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));

        return $this->map()['extensions'][$extension] ?? $this->map()['fallback'];
    }

    /**
     * What the shell's LOS_sysIcon needs: the set's base URL and, by role, the file under a theme folder (and its
     * symbolic variant where there is one), plus the extension table.
     *
     * @return array{base: string, fallback: string, icons: array<string, string>, symbolic: array<string, string>, extensions: array<string, string>}
     */
    public function forClient(): array
    {
        $icons = [];
        $symbolic = [];
        foreach (array_keys($this->map()['icons']) as $role) {
            $path = $this->relativePath($role);
            if ($path !== null) {
                $icons[$role] = $path;
            }
            $symbolicPath = $this->relativePath($role, true);
            if ($symbolicPath !== null) {
                $symbolic[$role] = $symbolicPath;
            }
        }

        return [
            'base' => rtrim(asset('icons/liteos'), '/').'/',
            'fallback' => $this->map()['fallback'],
            'icons' => $icons,
            'symbolic' => $symbolic,
            'extensions' => $this->map()['extensions'],
        ];
    }

    /**
     * Problems with the map: roles that point at a file missing from either theme, a fallback that isn't mapped, and
     * extensions that name an unmapped role. Empty when the map is sound.
     *
     * @return list<string>
     */
    public function problems(): array
    {
        $problems = [];
        $map = $this->map();
        if ($map['icons'] === []) {
            return ['map.json is missing or has no icons'];
        }
        foreach ($map['icons'] as $role => $target) {
            if (! preg_match('/^[a-z]+\.[a-z0-9-]+$/', $role)) {
                $problems[] = "role {$role} isn't named group.name";
            }
            $path = $this->relativePath($role);
            if ($path === null) {
                $problems[] = "{$role} => {$target} isn't category/name or category/size/name";

                continue;
            }
            if (! isset($map['sizes'][explode('/', $target)[0]])) {
                $problems[] = "{$role} => {$target}: no size for that category";
            }
            foreach (self::THEMES as $theme) {
                if (! $this->fileExists($theme.'/'.$path.'.svg')) {
                    $problems[] = "{$role} => {$theme}/{$path}.svg is missing";
                }
            }
        }
        if (! isset($map['icons'][$map['fallback']])) {
            $problems[] = "the fallback {$map['fallback']} isn't mapped";
        }
        foreach ($map['extensions'] as $extension => $role) {
            if (! isset($map['icons'][$role])) {
                $problems[] = ".{$extension} => {$role} isn't mapped";
            }
        }

        return $problems;
    }

    private function fileExists(string $relative): bool
    {
        return $this->exists[$relative] ??= is_file($this->path.'/'.$relative);
    }
}
