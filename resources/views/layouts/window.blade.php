{{-- An app window's page (App\View\Components\WindowLayout): the shared app look, the app's styles, the config, the
     icon set, the registry and the SDK, then the app's own scripts. The app's markup is the slot. --}}
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ $title }}</title>
@include('partials.app-favicon', ['app' => $app])
<link rel="stylesheet" href="@versioned('assets/css/app.css')">
<link rel="stylesheet" href="@versioned('assets/css/menu.css')">
@foreach (array_filter($vendor, fn ($f) => str_ends_with($f, '.css')) as $library)
<link rel="stylesheet" href="@versioned('assets/vendor/'.$library)">
@endforeach
@foreach ($styles as $style)
<link rel="stylesheet" href="@versioned('assets/apps/'.$app.'/'.$style)">
@endforeach
@include('partials.config')
</head>
<body>
{{ $slot }}

<script src="@versioned('assets/js/icons.js')"></script>
<script src="@versioned('assets/js/apps.js')"></script>
<script src="@versioned('assets/js/menu.js')"></script>
<script src="@versioned('assets/js/sdk.js')"></script>
@foreach (array_filter($vendor, fn ($f) => str_ends_with($f, '.js')) as $library)
<script src="@versioned('assets/vendor/'.$library)"></script>
@endforeach
@foreach ($scripts as $script)
<script src="@versioned('assets/apps/'.$app.'/'.$script)"></script>
@endforeach
</body>
</html>
