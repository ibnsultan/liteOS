{{-- Archives: the app window's page (AppsController). Its scripts and styles are in public/assets/apps/archives/:
     zip.js and tar.js read, unpack and write ZIP, TAR and GZIP archives in the browser, app.js draws the window. Laid out like a desktop archive
     manager: a toolbar, a location bar, the list with columns, a status bar; the menus are in the top bar. --}}
<x-layout-window app="archives" title="Archives" :styles="['archives.css']" :scripts="['zip.js', 'tar.js', 'app.js']">
<div class="app arc" id="app">
  <header class="arc-title" id="titlebar">
    <span class="arc-title-icon" id="tbIcon" aria-hidden="true"></span>
    <span class="arc-title-name" id="tbName">Archives</span>
    <nav class="arc-menubar" id="menubar" aria-label="Menus" hidden></nav>
    <span class="spacer"></span>
    <span class="arc-title-controls" id="tbControls"></span>
  </header>
  <header class="arc-bar" id="bar">
    <button type="button" class="arc-tb arc-icon" data-act="new" title="New archive (Ctrl+N)" aria-label="New archive"><span data-ico="arc-new"></span></button>
    <span class="arc-split">
      <button type="button" class="arc-tb" data-act="open" title="Open an archive (Ctrl+O)"><span data-ico="open"></span>Open</button>
      <button type="button" class="arc-tb arc-caret" data-act="recent" title="Recent archives" aria-label="Recent archives" aria-haspopup="menu"><span data-ico="down" data-size="12"></span></button>
    </span>
    <span class="arc-sep" aria-hidden="true"></span>
    <button type="button" class="arc-tb" data-act="add" title="Add files or a folder to this archive" aria-haspopup="menu" disabled><span data-ico="arc-add"></span>Add Files</button>
    <button type="button" class="arc-tb" data-act="extract" title="Extract the selection, or everything (Ctrl+E)" disabled><span data-ico="arc-extract"></span>Extract</button>
    <span class="spacer"></span>
    <button type="button" class="arc-tb arc-icon" data-act="find" title="Find (Ctrl+F)" aria-label="Find" aria-pressed="false" disabled><span data-ico="search"></span></button>
  </header>
  <div class="arc-find" id="findBar" hidden>
    <label class="search"><span data-ico="search" data-size="14"></span><input class="input" id="search" type="search" placeholder="Find in this archive" aria-label="Find in this archive" autocomplete="off"></label>
  </div>
  <nav class="arc-loc" id="path" aria-label="Location in the archive" hidden></nav>
  <main class="arc-main" id="main"></main>
  <footer class="arc-status" id="status" hidden></footer>
  <div class="arc-dropveil" aria-hidden="true"><span id="dropText">Drop an archive to open it</span></div>
</div>
</x-layout-window>
