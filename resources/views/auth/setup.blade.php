{{-- First-run setup (Auth\SetupController@show): one form, shown a step at a time by public/assets/js/setup.js, posted
     once at the end. Welcome → Computer → Account → Appearance → Ready. A server error brings you back to its step. --}}
@php
    $steps = ['Welcome', 'Name this computer', 'Create your account', 'Choose your look', 'Ready'];
    $fieldStep = ['instanceName' => 1, 'name' => 2, 'username' => 2, 'password' => 2, 'password_confirmation' => 2];
    $start = collect($fieldStep)->first(fn ($step, $field) => $errors->has($field)) ?? 0;
    $theme = old('theme', 'light');
    $accent = old('accent', '#2F6FD6');
    $taskbar = old('taskbar', 'floating');
    $mini = fn (string $kind) => '<span class="oobe-mini'.($kind === 'classic' ? ' classic' : '').'" data-wall>'.($kind === 'classic' ? '' : '<i class="tb"></i>').'<i class="w"></i>'.($kind === 'classic' ? '<i class="bar"></i>' : '<i class="dk"></i>').'</span>';
@endphp
<x-auth-layout title="Set up LiteOS">
<div class="oobe">
  <div class="oobe-bg" data-wall></div>
  <x-auth-actions />
  <div class="oobe-panel" role="dialog" aria-label="Set up LiteOS">
    <aside class="oobe-rail">
      <div class="oobe-brand"><span class="oobe-logo"><img src="{{ asset('assets/img/kite-white.svg') }}" alt=""></span><b>LiteOS</b></div>
      <ol class="oobe-steps">
        @foreach ($steps as $i => $label)
          <li data-step="{{ $i }}"><span class="n">{{ $i + 1 }}</span>{{ $label }}</li>
        @endforeach
      </ol>
      <div class="oobe-count">Step <span data-count>1</span> of {{ count($steps) }}</div>
    </aside>

    <form class="oobe-main" method="post" action="{{ route('setup.store') }}" novalidate data-start="{{ $start }}">
      @csrf
      <div class="oobe-body" data-step="0" data-next="Get started">
        <div class="oobe-hero"><span class="oobe-logo big"><img src="{{ asset('assets/img/kite-white.svg') }}" alt=""></span>
          <h1>Welcome to LiteOS</h1><p>Your desktop, files and apps in the browser. Let’s set things up — it takes about a minute.</p></div>
      </div>

      <div class="oobe-body" data-step="1" hidden>
        <h1>Name this computer</h1>
        <p class="lead">The name appears on the sign-in screen and in the top bar. You can change it later in Settings.</p>
        <label class="field"><span>Computer name</span><input class="input" name="instanceName" maxlength="40" required value="{{ old('instanceName', 'LiteOS') }}"></label>
      </div>

      <div class="oobe-body" data-step="2" hidden>
        <h1>Create your account</h1>
        <p class="lead">This will be the administrator account. Administrators can add people and manage the system.</p>
        <div class="oobe-grid">
          <label class="field full"><span>Your name</span><input class="input" name="name" maxlength="60" autocomplete="name" required value="{{ old('name') }}"></label>
          <label class="field full"><span>Username</span><input class="input" name="username" maxlength="32" autocomplete="username" required value="{{ old('username') }}"><small class="hint">Lowercase letters, numbers, dot, dash or underscore.</small></label>
          <label class="field"><span>Password</span><input class="input" type="password" name="password" minlength="6" autocomplete="new-password" required></label>
          <label class="field"><span>Confirm password</span><input class="input" type="password" name="password_confirmation" minlength="6" autocomplete="new-password" required></label>
          <div class="full oobe-strength"><span class="meter"><i></i></span><small class="hint">At least 6 characters.</small></div>
        </div>
      </div>

      <div class="oobe-body" data-step="3" hidden>
        <h1>Choose your look</h1>
        <p class="lead">Pick a theme, an accent colour and a taskbar. Everything can be changed later.</p>
        <div class="oobe-label">Theme</div>
        <div class="oobe-choices three">
          @foreach (['light' => 'Light', 'dark' => 'Dark', 'auto' => 'Automatic'] as $value => $label)
            <label @class(['oobe-choice', 'on' => $theme === $value])><input type="radio" name="theme" value="{{ $value }}" @checked($theme === $value) hidden><span class="oobe-theme {{ $value }}"><i></i></span><b>{{ $label }}</b></label>
          @endforeach
        </div>
        <div class="oobe-label">Accent colour</div>
        <div class="oobe-swatches">
          @foreach ($accents as $label => $colour)
            <label @class(['oobe-sw', 'on' => $accent === $colour]) title="{{ $label }}" style="background:{{ $colour }};color:{{ $colour }}"><input type="radio" name="accent" value="{{ $colour }}" @checked($accent === $colour) aria-label="{{ $label }}" hidden><span class="chk"><i data-icon="check" data-size="14"></i></span></label>
          @endforeach
        </div>
        <div class="oobe-label">Taskbar</div>
        <div class="oobe-choices">
          <label @class(['oobe-choice', 'on' => $taskbar === 'floating'])><input type="radio" name="taskbar" value="floating" @checked($taskbar === 'floating') hidden>{!! $mini('floating') !!}<b>Floating dock</b><small>Top bar with a centred dock</small></label>
          <label @class(['oobe-choice', 'on' => $taskbar === 'classic'])><input type="radio" name="taskbar" value="classic" @checked($taskbar === 'classic') hidden>{!! $mini('classic') !!}<b>Classic taskbar</b><small>Full-width bar with Start</small></label>
        </div>
      </div>

      <div class="oobe-body" data-step="4" data-next="Start using LiteOS" hidden>
        <h1>You’re all set</h1>
        <p class="lead">Check your choices. Everything can be changed later in Settings.</p>
        <div class="oobe-review">
          <div class="oobe-row"><span class="oobe-ico"><i data-icon="device.computer" data-size="20"></i></span><span class="txt"><b data-review="instanceName"></b><small>Computer name</small></span><button type="button" class="btn btn-ghost" data-goto="1">Change</button></div>
          <div class="oobe-row"><span class="avatar" data-review="avatar" style="width:40px;height:40px;font-size:15px"></span><span class="txt"><b data-review="name"></b><small><span data-review="username"></span> · Administrator</small></span><button type="button" class="btn btn-ghost" data-goto="2">Change</button></div>
          <div class="oobe-row"><span data-review="mini"></span><span class="txt"><b data-review="look"></b><small data-review="taskbar"></small></span><button type="button" class="btn btn-ghost" data-goto="3">Change</button></div>
        </div>
      </div>

      <div class="err oobe-err" role="alert">{{ $errors->first() }}</div>
      <div class="oobe-foot">
        <button type="button" class="btn btn-ghost" data-back>Back</button>
        <span class="oobe-dots" aria-hidden="true">@foreach ($steps as $i => $label)<i></i>@endforeach</span>
        <button class="btn btn-primary" type="submit"><span data-next-label>Continue</span><i data-icon="forward" data-size="15" data-next-arrow></i></button>
      </div>
    </form>
  </div>
</div>
<x-slot:scripts><script src="@versioned('assets/js/setup.js')"></script></x-slot:scripts>
</x-auth-layout>
