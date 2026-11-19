{{-- An app page's favicon: the app's icon from the system icon set (App\Support\AppRegistry::iconUrl), the dark
     theme's file when the browser is dark. Expects $app, the app id. --}}
@php($registry = app(\App\Support\AppRegistry::class))
<link rel="icon" href="{{ $registry->iconUrl($app) }}" type="image/svg+xml">
<link rel="icon" href="{{ $registry->iconUrl($app, 'dark') }}" type="image/svg+xml" media="(prefers-color-scheme: dark)">
