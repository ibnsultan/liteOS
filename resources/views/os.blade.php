{{-- The desktop (ShellController@show): os.js draws it and opens apps in windows (each an iframe on /apps/<id>).
     Setup, signing in and the lock screen are pages of their own (resources/views/auth). --}}
<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{{-- Lets clients recognise a LiteOS instance (LiteLink turns on the Frame Helper) --}}
<meta name="application-name" content="LiteOS">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#101217">
<title>{{ $instanceName }}</title>
<link rel="icon" href="{{ asset('assets/img/kite-blue.svg') }}" type="image/svg+xml">
<link rel="stylesheet" href="@versioned('assets/css/boot.css')">
<link rel="stylesheet" href="@versioned('assets/css/tokens.css')">
<link rel="stylesheet" href="@versioned('assets/css/os.css')">
<link rel="stylesheet" href="@versioned('assets/css/dialog.css')">
<link rel="stylesheet" href="@versioned('assets/css/menu.css')">
<link rel="stylesheet" href="@versioned('assets/css/greeter.css')">
<link rel="stylesheet" href="@versioned('assets/css/a11y.css')">
@include('partials.config')
</head>
<body>
<x-boot :label="'Starting '.$instanceName" />
<div id="os" class="os-root"></div>
<noscript><p style="position:fixed;bottom:24px;left:0;right:0;text-align:center;color:#fff;font-family:sans-serif;z-index:100000">LiteOS needs JavaScript to run.</p></noscript>
<script src="@versioned('assets/js/greeting.js')"></script>
<script src="@versioned('assets/js/icons.js')"></script>
<script src="@versioned('assets/js/apps.js')"></script>
<script src="@versioned('assets/js/menu.js')"></script>
<script src="@versioned('assets/js/usb.js')"></script>
<script src="@versioned('assets/js/os.js')"></script>
<script src="@versioned('assets/js/sounds.js')"></script>
<script src="@versioned('assets/js/reminders.js')"></script>
<script src="@versioned('assets/js/usage.js')"></script>
<script src="@versioned('assets/js/perf.js')"></script>
</body>
</html>
