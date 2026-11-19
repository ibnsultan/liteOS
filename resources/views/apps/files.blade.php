{{-- Files: the app window's page (AppsController). Its scripts and styles are in public/assets/apps/files/. --}}
<x-layout-window app="files" title="Files" :styles="['files.css']" :scripts="['app.js']">
<div class="app" id="app">
  <div class="toolbar nav">
    <button class="icon-btn" data-c="back" aria-label="Back"></button>
    <button class="icon-btn" data-c="forward" aria-label="Forward"></button>
    <button class="icon-btn" data-c="up" aria-label="Up one level"></button>
    <div class="crumbs" id="crumbs"></div>
    <label class="search" style="width:240px"><span id="search-ico"></span><input class="input" id="search" type="search" placeholder="Search My drive" aria-label="Search My drive"></label>
  </div>
  <div class="toolbar cmd" id="cmdbar"></div>
  <div class="split">
    <nav class="sidebar" id="side" aria-label="Locations"></nav>
    <main class="main grow" id="main" tabindex="0">
      <div class="infobar" id="infobar" hidden></div>
      <div class="content" id="content"></div>
      <div class="drop-hint" id="drop">Drop files to upload them here</div>
    </main>
    <aside class="details" id="details" aria-label="Details"></aside>
  </div>
  <div class="statusbar"><span id="st-count"></span><span id="st-sel"></span><span class="spacer"></span><span id="st-sync"></span></div>
</div>
<input type="file" id="upload" multiple hidden>
</x-layout-window>
