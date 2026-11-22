{{-- What the shell and the apps read about this LiteOS (App\Support\ClientConfig): window.LOS_CONFIG, read by
     public/assets/js/apps.js before anything else. Included in the head of the desktop page and every app window. --}}
<meta name="csrf-token" content="{{ csrf_token() }}">
<script>window.LOS_CONFIG = @json(\App\Support\ClientConfig::make());</script>
{{-- the Guest account's files and settings live in this browser (docs/account-types.md) --}}
@if (auth()->user()?->isGuest())
<script src="@versioned('assets/js/guest-drive.js')"></script>
@endif
