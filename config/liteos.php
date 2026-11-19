<?php

// LiteOS itself: limits, file-type groups, the built-in wallpapers and accent colours, and where the bundled apps'
// manifests are. The shell and the apps read the same values (printed into the page by the views), and the server
// validates settings against them, so each fact lives here once. Apps are described by their manifest.json files, see
// docs/app-platform.md and App\Support\AppRegistry.

return [

    // shown in the boot screen, the About page and the API (the MVP was 0.1.0)
    'version' => '0.2.0',

    // the largest file fs.read hands back as text, and the largest body fs.write accepts
    'max_read_bytes' => 8 * 1024 * 1024,
    'max_write_bytes' => 16 * 1024 * 1024,

    // storage for a new account, in MB, until an admin sets another default in Settings › System
    'default_quota_mb' => (int) env('LITEOS_DEFAULT_QUOTA_MB', 1024),

    // where the bundled apps live: one folder per app with its manifest.json, icon.svg and files
    'apps_path' => public_path('assets/apps'),

    // the launcher's order for the bundled apps; apps not listed (installed later) follow, by name. Which apps are part
    // of the OS and can't be removed is "system": true in their manifest.
    'app_order' => ['files', 'documents', 'sheets', 'slides', 'code', 'media', 'browser', 'board', 'notes', 'settings'],

    // file-type groups, by extension; the SDK hands these to apps as OS.kinds
    'kinds' => [
        'image' => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'],
        'video' => ['mp4', 'webm', 'ogv', 'mov', 'm4v'],
        'audio' => ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'],
        'text' => ['txt', 'md', 'html', 'htm', 'css', 'js', 'mjs', 'json', 'php', 'py', 'xml', 'ini', 'log', 'sh', 'ts', 'yml', 'yaml', 'sql', 'c', 'cpp', 'h', 'java'],
    ],

    // built-in wallpapers: a picture under public/assets/img/wallpapers (with the colour shown while it loads), or a
    // CSS background. Settings stores the id; "file:/path" in settings means a picture from the user's drive instead.
    'wallpapers' => [
        ['id' => 'siamese', 'name' => 'Siamese', 'image' => 'siamese.jpg', 'color' => '#2F6FD6'],
        ['id' => 'kites', 'name' => 'Kites', 'image' => 'kites.jpg', 'color' => '#F4B88A'],
        ['id' => 'aurora', 'name' => 'Aurora', 'image' => 'aurora.jpg', 'color' => '#0E1E4A'],
        ['id' => 'bloom', 'name' => 'Bloom', 'image' => 'bloom.jpg', 'color' => '#081430'],
        ['id' => 'forest-mist', 'name' => 'Misty forest', 'image' => 'forest-mist.jpg', 'color' => '#B9D6D6'],
        ['id' => 'ocean', 'name' => 'Ocean', 'css' => 'linear-gradient(160deg,#9FD3F7 0%,#3F8FE0 50%,#1B4F9C 100%)'],
        ['id' => 'dawn', 'name' => 'Dawn', 'css' => 'linear-gradient(170deg,#FFD6A5 0%,#F49B8C 45%,#8E5A9B 100%)'],
        ['id' => 'forest', 'name' => 'Forest', 'css' => 'linear-gradient(165deg,#CDEBC8 0%,#6DB27A 50%,#24573A 100%)'],
        ['id' => 'slate', 'name' => 'Slate', 'css' => 'linear-gradient(160deg,#5A6577 0%,#2B3240 60%,#151A23 100%)'],
        ['id' => 'lilac', 'name' => 'Lilac', 'css' => 'radial-gradient(circle at 30% 30%,#F5E6FF 0%,#C6A6F2 40%,#5B3FA3 100%)'],
        ['id' => 'blue', 'name' => 'Blue', 'css' => '#2F6FD6'],
        ['id' => 'mist', 'name' => 'Mist', 'css' => '#DDE2EA'],
    ],

    // accent colours offered in Settings › Personalisation (name => hex); any #RRGGBB is accepted
    'accents' => [
        'Blue' => '#2F6FD6', 'Teal' => '#0F7A6E', 'Green' => '#1A8A54', 'Amber' => '#B7791F',
        'Orange' => '#DD630A', 'Red' => '#D63B41', 'Pink' => '#C9306B', 'Purple' => '#6B4CCB',
    ],

];
