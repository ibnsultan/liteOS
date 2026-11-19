<?php

namespace App\Support;

// What the shell and the apps need to know about this LiteOS, printed into every page as window.LOS_CONFIG
// (resources/views/partials/config.blade.php) and read by public/assets/js/apps.js: where LiteOS lives, the CSRF
// token, the apps (from their manifests), file-type groups, wallpapers and accent colours. It replaces the lists the
// MVP hard-coded in apps.js, so the server and the browser can't disagree.
class ClientConfig
{
    /**
     * @return array{base: string, version: string, csrf: string, welcome: bool, apps: list<array<string, mixed>>, kinds: array<string, list<string>>, wallpapers: list<array{id: string, name: string, css: string}>, accents: list<array{0: string, 1: string}>, icons: array<string, string>}
     */
    public static function make(): array
    {
        return [
            'base' => rtrim(url('/'), '/').'/',
            'version' => (string) config('liteos.version'),
            'csrf' => csrf_token(),
            // just finished first-run setup: the desktop greets the new administrator (flashed by SetupController)
            'welcome' => (bool) session('welcome', false),
            'apps' => app(AppRegistry::class)->forClient(),
            'kinds' => config('liteos.kinds'),
            'wallpapers' => array_map(fn (array $w) => [
                'id' => $w['id'],
                'name' => $w['name'],
                'css' => isset($w['image'])
                    ? 'url('.asset('assets/img/wallpapers/'.$w['image']).') center/cover no-repeat, '.$w['color']
                    : $w['css'],
            ], config('liteos.wallpapers')),
            'accents' => array_map(null, array_keys(config('liteos.accents')), array_values(config('liteos.accents'))),
            // every system icon, by role, from the icon set (App\Support\SystemIcons); the shell reads it through LOS_sysIcon
            'systemIcons' => app(SystemIcons::class)->forClient(),
        ];
    }
}
