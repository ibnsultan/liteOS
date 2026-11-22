{{-- Clock: the app window's page (AppsController). Its scripts and styles are in public/assets/apps/clock/; the alarm
     sounds are the shell's (assets/js/sounds.js), which also rings alarms and timers (assets/js/reminders.js). --}}
<x-layout-window app="clock" title="Clock" :styles="['clock.css']" :scripts="['world-data.js', 'app.js']">
<script src="@versioned('assets/js/sounds.js')"></script>
<div class="app clock" id="app">
  <div class="split">
    <nav class="sidebar ck-nav" id="nav" aria-label="Clock">
      <div class="ck-titlebar" id="tbLeft"><span class="ck-tb-icon" id="tbIcon" aria-hidden="true"></span><span class="ck-tb-name">Clock</span></div>
      <button type="button" class="nav-item" data-view="timers"><span data-ico="timers"></span><span class="nav-label">Timer</span></button>
      <button type="button" class="nav-item" data-view="alarms"><span data-ico="alarms"></span><span class="nav-label">Alarm</span></button>
      <button type="button" class="nav-item" data-view="stopwatch"><span data-ico="stopwatch"></span><span class="nav-label">Stopwatch</span></button>
      <button type="button" class="nav-item" data-view="world"><span data-ico="world"></span><span class="nav-label">World clock</span></button>
    </nav>
    <div class="ck-body">
      <div class="ck-drag" id="tbRight" aria-hidden="true"></div>
      <main class="ck-main" id="main"></main>
      <div class="ck-tools" id="tools" role="toolbar" aria-label="Manage"></div>
    </div>
  </div>
</div>
</x-layout-window>
