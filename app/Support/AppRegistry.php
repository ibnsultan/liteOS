<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;

// The apps LiteOS knows about, read from their manifest.json files (the package format in docs/app-platform.md).
// Today these are the bundled apps under public/assets/apps/<id>/; installed store apps will be added here later.
// The shell gets them through forClient(), printed into the desktop page, so the launcher, the dock, "Open with" and
// settings validation all read the same list. A folder with a missing or broken manifest is skipped and logged.
class AppRegistry
{
    /** @var array<string, array<string, mixed>>|null manifests by app id, in launcher order */
    private ?array $apps = null;

    public function __construct(private string $path) {}

    /**
     * Every app's manifest, keyed by id, in launcher order (config liteos.app_order first, then by name).
     *
     * @return array<string, array<string, mixed>>
     */
    public function all(): array
    {
        if ($this->apps !== null) {
            return $this->apps;
        }

        $apps = [];
        foreach (glob($this->path.'/*/manifest.json') ?: [] as $file) {
            $manifest = json_decode((string) file_get_contents($file), true);
            $folder = basename(dirname($file));
            $problem = $this->problemWith($manifest, $folder);
            if ($problem !== null) {
                Log::warning("App in {$folder}/ skipped: {$problem}");

                continue;
            }
            $apps[$manifest['id']] = $manifest;
        }

        $order = array_flip(config('liteos.app_order', []));
        uasort($apps, fn (array $a, array $b) => [$order[$a['id']] ?? PHP_INT_MAX, $a['name']] <=> [$order[$b['id']] ?? PHP_INT_MAX, $b['name']]);

        return $this->apps = $apps;
    }

    /**
     * One app's manifest, or null when there is no such app.
     *
     * @return array<string, mixed>|null
     */
    public function find(string $id): ?array
    {
        return $this->all()[$id] ?? null;
    }

    /**
     * @return list<string>
     */
    public function ids(): array
    {
        return array_keys($this->all());
    }

    /**
     * The apps as the shell's registry needs them (what the MVP's LOS_APPS held), printed into the desktop page.
     *
     * @return list<array{id: string, name: string, icon: string, c: list<string>, img: string, role: ?string, entry: string, exts: list<string>, size: list<int>, chrome: string, material: string, single: bool, reports: bool, system: bool}>
     */
    public function forClient(): array
    {
        return array_values(array_map(fn (array $app) => [
            'id' => $app['id'],
            'name' => $app['name'],
            'icon' => $app['glyph'] ?? 'apps',
            'c' => $app['colors'] ?? ['#8C929C', '#5A606B'],
            'img' => $this->iconUrl($app['id']),
            'role' => $this->iconRole($app['id']),
            'entry' => url('apps/'.$app['id']),
            'exts' => array_values($app['opens'] ?? []),
            'size' => $app['window']['size'] ?? [960, 640],
            'chrome' => $app['window']['chrome'] ?? 'standard',
            // "mica": a frosted window over the wallpaper while Transparency effects is on (the app paints its page
            // transparent); anything else is a solid window
            'material' => ($app['window']['material'] ?? '') === 'mica' ? 'mica' : 'solid',
            'single' => (bool) ($app['window']['single'] ?? false),
            // the app says when it's ready to be seen (OS.win.loaded): its window stays covered until then
            'reports' => (bool) ($app['window']['reportsReady'] ?? false),
            'system' => (bool) ($app['system'] ?? false),
        ], $this->all()));
    }

    /**
     * The app's role in the system icon set (app.<id>) when the set has one: LiteOS's own apps take their icon from
     * there, so they look like the rest of the OS. Other apps have none and keep their package's icon.
     */
    public function iconRole(string $id): ?string
    {
        return app(SystemIcons::class)->has('app.'.$id) ? 'app.'.$id : null;
    }

    /**
     * The app's icon URL (the light theme's file from the system icon set, or the package's own icon stamped with
     * its last change so an updated icon isn't served from cache).
     */
    public function iconUrl(string $id, string $theme = 'light'): string
    {
        $role = $this->iconRole($id);
        if ($role !== null) {
            return app(SystemIcons::class)->url($role, $theme);
        }
        $icon = $this->find($id)['icon'] ?? 'icon.svg';

        return asset('assets/apps/'.$id.'/'.$icon).'?v='.@filemtime($this->path.'/'.$id.'/'.$icon);
    }

    /**
     * Why a manifest can't be used, or null when it is fine. Bundled apps may use a short id (files, documents); store apps
     * always have a reverse-domain id with a dot, so the two can never clash.
     *
     * @param  mixed  $manifest  the decoded manifest.json
     */
    private function problemWith(mixed $manifest, string $folder): ?string
    {
        if (! is_array($manifest)) {
            return 'manifest.json is missing or not valid JSON';
        }
        foreach (['id', 'name', 'version', 'entry', 'icon'] as $key) {
            if (! isset($manifest[$key]) || ! is_string($manifest[$key]) || $manifest[$key] === '') {
                return "\"{$key}\" is missing";
            }
        }
        if (! preg_match('/^[a-z0-9]+([.][a-z0-9-]+)*$/', $manifest['id'])) {
            return '"id" must be lowercase letters, digits and dots';
        }
        if ($manifest['id'] !== $folder) {
            return "the folder must be named after the id ({$manifest['id']})";
        }
        if (! is_file($this->path.'/'.$folder.'/'.$manifest['icon'])) {
            return "the icon {$manifest['icon']} is missing";
        }

        return null;
    }
}
