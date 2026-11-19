{{-- The lock screen (Auth\LockController@show). In the desktop it sits in a frame over the open windows (embed). --}}
<x-auth-layout :title="$instanceName.' is locked'" :embed="$embed">
<div class="lock" data-wall="{{ $wallpaper }}">
  <div class="greeter">
    <div class="g-clock"><div class="t" data-clock="t"></div><div class="d" data-clock="dl"></div></div>
    <form class="g-form" method="post" action="{{ route('unlock') }}" data-busy>
      @csrf
      @if ($embed)<input type="hidden" name="embed" value="1">@endif
      <span class="g-avatar" style="background:{{ $user->color }}">{{ $user->initials() }}</span>
      <div class="g-name">{{ $user->name }}</div>
      <input type="text" name="username" autocomplete="username" value="{{ $user->username }}" hidden>
      <div @class(['g-field', 'shake' => $errors->has('password')])>
        <input class="g-input" type="password" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" autofocus required>
        <button class="g-go" type="submit" aria-label="Unlock"><i data-icon="forward" data-size="18"></i></button>
      </div>
      @error('password')
        <div class="g-err" role="alert"><i data-icon="info" data-size="14"></i><span>{{ $message }}</span></div>
      @enderror
      <button type="submit" class="g-link" form="sign-out">Sign out instead</button>
    </form>
  </div>
  <x-auth-actions :signed-in="true" />
</div>
</x-auth-layout>
