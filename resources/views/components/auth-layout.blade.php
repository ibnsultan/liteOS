@props(['title', 'embed' => false])
{{-- <x-auth-layout title="…"> : the screens before the desktop: first-run setup, signing in and the lock screen (resources/views/auth). Same look
     as the desktop: its tokens and styles, the boot screen on the first page of a visit, and the corner buttons
     (accessibility, language, power) from public/assets/js/auth.js. --}}
<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{{-- Lets clients recognise a LiteOS instance (LiteLink turns on the Frame Helper) --}}
<meta name="application-name" content="LiteOS">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#101217">
<title>{{ $title }}</title>
<link rel="icon" href="{{ asset('assets/img/kite-blue.svg') }}" type="image/svg+xml">
<link rel="stylesheet" href="@versioned('assets/css/boot.css')">
<link rel="stylesheet" href="@versioned('assets/css/tokens.css')">
<link rel="stylesheet" href="@versioned('assets/css/os.css')">
<link rel="stylesheet" href="@versioned('assets/css/menu.css')">
<link rel="stylesheet" href="@versioned('assets/css/oobe.css')">
<link rel="stylesheet" href="@versioned('assets/css/greeter.css')">
<link rel="stylesheet" href="@versioned('assets/css/a11y.css')">
@include('partials.config')
</head>
<body @class(['embedded' => $embed])>
@unless ($embed)
<x-boot :label="$title" />
@endunless
<div id="os" class="os-root">
{{ $slot }}
</div>
<script src="@versioned('assets/js/greeting.js')"></script>
<script src="@versioned('assets/js/icons.js')"></script>
<script src="@versioned('assets/js/apps.js')"></script>
<script src="@versioned('assets/js/menu.js')"></script>
<script src="@versioned('assets/js/auth.js')"></script>
{{ $scripts ?? '' }}
</body>
</html>
