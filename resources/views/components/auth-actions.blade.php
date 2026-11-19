{{-- The corner buttons on the setup, sign-in and lock screens: accessibility, language and power. Their menus come
     from public/assets/js/auth.js. <x-auth-actions :signed-in="true" /> adds Sign out to the power menu. --}}
@props(['signedIn' => false])
<div class="auth-actions" @if ($signedIn) data-signed-in @endif>
  <button type="button" class="aa-btn" data-l="a11y" aria-label="Accessibility" title="Accessibility"><i data-icon="glass.accessibility" data-size="18"></i></button>
  <button type="button" class="aa-btn aa-lang" data-l="lang" aria-label="Language" title="Language">EN</button>
  <button type="button" class="aa-btn" data-l="power" aria-label="Power options" title="Power"><i data-icon="glass.power" data-size="18"></i></button>
</div>
@if ($signedIn)
  <form id="sign-out" method="post" action="{{ route('logout') }}" target="_top" hidden>@csrf</form>
@endif
