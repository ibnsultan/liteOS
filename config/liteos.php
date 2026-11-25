<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Version
    |--------------------------------------------------------------------------
    |
    | Shown in the boot screen, the About page and the API
    |
    */

    'version' => '0.2.0',

    /*
    |--------------------------------------------------------------------------
    | File Read and Write Limits
    |--------------------------------------------------------------------------
    |
    | The largest file fs.read hands back as text, and the largest body fs.write accepts.
    |
    */

    'max_read_bytes' => 8 * 1024 * 1024,
    'max_write_bytes' => 16 * 1024 * 1024,

    /*
    |--------------------------------------------------------------------------
    | Default Storage Quotas
    |--------------------------------------------------------------------------
    |
    | Storage for a new account, in MB, until an admin sets another default in Settings › System, and the same for a
    | Local account (the limited account type, docs/account-types.md).
    |
    */

    'default_quota_mb' => (int) env('LITEOS_DEFAULT_QUOTA_MB', 1024),
    'default_local_quota_mb' => (int) env('LITEOS_DEFAULT_LOCAL_QUOTA_MB', 500),

    /*
    |--------------------------------------------------------------------------
    | Guest Quota
    |--------------------------------------------------------------------------
    |
    | How much a guest may keep in the browser it uses (its files live there, not on the server).
    |
    */

    'guest_quota_mb' => (int) env('LITEOS_GUEST_QUOTA_MB', 2048),

    /*
    |--------------------------------------------------------------------------
    | Local Account Apps
    |--------------------------------------------------------------------------
    |
    | The apps a Local account may open unless an administrator picks others (App\Support\Capabilities). Settings is
    | always allowed, and the Browser only with web access.
    |
    */

    'local_apps' => ['files', 'documents', 'sheets', 'slides', 'notes', 'pdf', 'media', 'board', 'calculator', 'clock', 'archives', 'monitor', 'screenshot', 'settings', 'browser'],

    /*
    |--------------------------------------------------------------------------
    | Web Connection Limits
    |--------------------------------------------------------------------------
    |
    | What one account may ask of the server's web connection, so nobody can use it as an unmetered proxy: requests a
    | minute for signing relay links, relayed requests (HLS asks for a segment every few seconds per stream, and
    | retries quickly) and downloads to the drive; long relays (radio, a direct video) running at once; and how long
    | one relay may run before it ends.
    |
    */

    'net' => [
        'sign_per_minute' => (int) env('LITEOS_NET_SIGN_PER_MINUTE', 30),
        'stream_per_minute' => (int) env('LITEOS_NET_STREAM_PER_MINUTE', 600),
        'fetch_per_minute' => (int) env('LITEOS_NET_FETCH_PER_MINUTE', 20),
        'relays_at_once' => (int) env('LITEOS_NET_RELAYS_AT_ONCE', 4),
        'relay_max_seconds' => (int) env('LITEOS_NET_RELAY_MAX_SECONDS', 4 * 3600),
    ],

    /*
    |--------------------------------------------------------------------------
    | Apps Path
    |--------------------------------------------------------------------------
    |
    | Where the bundled apps live: one folder per app with its manifest.json, icon.svg and files.
    |
    */

    'apps_path' => public_path('assets/apps'),

    /*
    |--------------------------------------------------------------------------
    | App Order
    |--------------------------------------------------------------------------
    |
    | The launcher's order for the bundled apps; apps not listed (installed later) follow, by name. Which apps are part
    | of the OS and can't be removed is "system": true in their manifest.
    |
    */

    'app_order' => ['files', 'documents', 'sheets', 'slides', 'database', 'code', 'media', 'pdf', 'browser', 'board', 'notes', 'calculator', 'clock', 'archives', 'monitor', 'screenshot', 'settings'],

    /*
    |--------------------------------------------------------------------------
    | File Kinds
    |--------------------------------------------------------------------------
    |
    | File-type groups, by extension; the SDK hands these to apps as OS.kinds.
    |
    */

    'kinds' => [
        'image' => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'],
        'video' => ['mp4', 'webm', 'ogv', 'mov', 'm4v'],
        'audio' => ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'],
        'text' => ['txt', 'md', 'html', 'htm', 'css', 'js', 'mjs', 'json', 'php', 'py', 'xml', 'ini', 'log', 'sh', 'ts', 'yml', 'yaml', 'sql', 'c', 'cpp', 'h', 'java'],
    ],

    /*
    |--------------------------------------------------------------------------
    | Wallpapers
    |--------------------------------------------------------------------------
    |
    | Built-in wallpapers: a picture under public/assets/img/wallpapers (with the colour shown while it loads), or a
    | CSS background. Settings stores the id; "file:/path" in settings means a picture from the user's drive instead.
    |
    */

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

    /*
    |--------------------------------------------------------------------------
    | Accent Colours
    |--------------------------------------------------------------------------
    |
    | Accent colours offered in Settings › Personalisation (name => hex); any #RRGGBB is accepted.
    |
    */

    'accents' => [
        'Blue' => '#2F6FD6', 'Teal' => '#0F7A6E', 'Green' => '#1A8A54', 'Amber' => '#B7791F',
        'Orange' => '#DD630A', 'Red' => '#D63B41', 'Pink' => '#C9306B', 'Purple' => '#6B4CCB',
    ],

];
