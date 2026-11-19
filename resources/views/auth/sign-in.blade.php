{{-- Signing in (Auth\SignInController@show): the username first, then that account's password. --}}
<x-auth-layout :title="'Sign in to '.$instanceName">
<div class="lock" data-wall>
  <div class="greeter">
    <div class="g-clock"><div class="t" data-clock="t"></div><div class="d" data-clock="dl"></div></div>

    @if ($profile)
      <form class="g-form" method="post" action="{{ route('login.store') }}" autocomplete="on" data-busy>
        @csrf
        <span class="g-avatar" style="background:{{ $profile->color }}">{{ $profile->initials() }}</span>
        <div class="g-name">{{ $profile->name }}</div>
        <div class="g-sub">{{ $profile->username }}</div>
        <input type="text" name="username" autocomplete="username" value="{{ $profile->username }}" hidden>
        <div @class(['g-field', 'shake' => $errors->has('password')])>
          <input class="g-input" type="password" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" autofocus required>
          <button class="g-go" type="submit" aria-label="Sign in"><i data-icon="forward" data-size="18"></i></button>
        </div>
        @error('password')
          <div class="g-err" role="alert"><i data-icon="info" data-size="14"></i><span>{{ $message }}</span></div>
        @enderror
        <a class="g-link" href="{{ route('login', ['other' => 1]) }}">Not {{ strtok($profile->name, ' ') }}? Use another account</a>
      </form>
    @else
      <form class="g-form" method="get" action="{{ route('login') }}" autocomplete="on" data-busy>
        <span class="g-avatar anon"><i data-icon="glass.user" data-size="44"></i></span>
        <div class="g-name">Sign in</div>
        <div class="g-sub">Enter your username to continue</div>
        <div @class(['g-field', 'shake' => $error])>
          <input class="g-input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Username" aria-label="Username" value="{{ $typed }}" autofocus>
          <button class="g-go" type="submit" aria-label="Next"><i data-icon="forward" data-size="18"></i></button>
        </div>
        @if ($error)
          <div class="g-err" role="alert"><i data-icon="info" data-size="14"></i><span>{{ $error }}</span></div>
        @endif
      </form>
    @endif
  </div>
  <x-auth-actions />
</div>
</x-auth-layout>
