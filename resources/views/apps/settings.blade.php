{{-- Settings: the app window's page (AppsController). Its scripts and styles are in public/assets/apps/settings/. --}}
<x-layout-window app="settings" title="Settings" :styles="['settings.css']" :scripts="['app.js']">
<div class="app">
  <div class="split">
    <nav class="sidebar" id="nav" aria-label="Settings sections"></nav>
    <main class="page grow" id="page"></main>
  </div>
</div>
<dialog class="dlg dlg-wide" id="dlg" aria-labelledby="dlg-title"></dialog>
</x-layout-window>
