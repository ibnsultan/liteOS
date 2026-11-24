{{-- System Monitor: the app window's page (AppsController). Its script and styles are in public/assets/apps/monitor/:
     app.js draws the window: its own title bar with the search, the sections down the side, the section on the right.
     Processes lists the open apps and windows through OS.tasks (the desktop's windows, sdk.js and os.js); usage.js draws
     Usage, the user's own time in apps, files and websites (App\Support\Usage). --}}
<x-layout-window app="monitor" title="System Monitor" :styles="['monitor.css']" :scripts="['performance.js', 'usage.js', 'storage.js', 'server.js', 'app.js']">
<div class="app sm" id="app">
  <header class="sm-title" id="titlebar">
    <span class="sm-title-icon" id="tbIcon" aria-hidden="true"></span>
    <span class="sm-title-name">System Monitor</span>
    <span class="spacer"></span>
    <label class="search sm-search" id="searchBox"><span class="sm-search-ico" id="searchIco" aria-hidden="true"></span><input class="input" id="search" type="search" placeholder="Search apps and windows" aria-label="Search apps and windows" autocomplete="off" spellcheck="false"></label>
    <span class="sm-title-controls" id="tbControls"></span>
  </header>
  <div class="sm-body">
    <nav class="sm-nav" id="nav" aria-label="System Monitor"></nav>
    <main class="sm-main" id="main"></main>
  </div>
</div>
</x-layout-window>
