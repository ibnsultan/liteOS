{{-- Calendar: the app window's page (AppsController). Its script and styles are in public/assets/apps/calendar/;
     each calendar is an .ics file in /Calendar on the drive, read and written with the shared reader
     (public/assets/js/ics.js). app.js draws the toolbar, the side (the month and the calendars) and the view (month,
     week or day), and the event editor. --}}
<x-layout-window app="calendar" title="Calendar" :styles="['calendar.css']" :scripts="['../../js/ics.js', 'app.js']">
<div class="app cal" id="app">
  <header class="cal-title" id="titlebar">
    <span class="cal-title-icon" id="tbIcon" aria-hidden="true"></span>
    <span class="cal-title-name">Calendar</span>
    <span class="spacer"></span>
    <span class="cal-title-controls" id="tbControls"></span>
  </header>
  <div class="cal-bar" role="toolbar" aria-label="Calendar">
    <button type="button" class="btn btn-primary cal-new" id="newBtn" title="New event (Ctrl+N)"></button>
    <button type="button" class="btn cal-today" id="todayBtn" title="Today (T)">Today</button>
    <span class="cal-nav">
      <button type="button" class="icon-btn" id="prevBtn" aria-label="Previous"></button>
      <button type="button" class="icon-btn" id="nextBtn" aria-label="Next"></button>
    </span>
    <h1 class="cal-period" id="period"></h1>
    <span class="spacer"></span>
    <span class="cal-views" role="tablist" aria-label="View">
      <button type="button" role="tab" data-view="day">Day</button>
      <button type="button" role="tab" data-view="week">Week</button>
      <button type="button" role="tab" data-view="month">Month</button>
    </span>
  </div>
  <div class="cal-body">
    <aside class="cal-side">
      <div class="cal-mini" id="mini"></div>
      <div class="cal-side-h">Calendars</div>
      <div class="cal-list" id="calList"></div>
    </aside>
    <main class="cal-main" id="main" aria-live="polite"></main>
  </div>
</div>
</x-layout-window>
