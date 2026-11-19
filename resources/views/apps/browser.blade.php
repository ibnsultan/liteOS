{{-- Browser: the app window's page (AppsController). Its scripts and styles are in public/assets/apps/browser/. --}}
<x-layout-window app="browser" title="Browser" :styles="['browser.css']" :scripts="['app.js']">
<div class="app">
  <div class="br-tabs" id="tabs" role="tablist" aria-label="Tabs"></div>
  <div class="toolbar br-toolbar">
    <button class="icon-btn" id="back" title="Back (Alt+Left)" aria-label="Back"></button>
    <button class="icon-btn" id="forward" title="Forward (Alt+Right)" aria-label="Forward"></button>
    <button class="icon-btn" id="reload" title="Reload (F5)" aria-label="Reload"></button>
    <button class="icon-btn" id="home" title="New tab page" aria-label="Home"></button>
    <form class="br-address" id="addrForm" autocomplete="off">
      <span class="br-addr-ico" id="addrIco"></span>
      <input class="input" id="addr" type="text" spellcheck="false" placeholder="Search or type a web address" aria-label="Address">
      <button type="button" class="br-star" id="star" title="Add to shortcuts" aria-label="Add to shortcuts"></button>
    </form>
    <button class="icon-btn" id="downloads" title="Downloads (Ctrl+J)" aria-label="Downloads"></button>
    <button class="icon-btn" id="menu" title="Menu" aria-label="Menu"></button>
  </div>
  <div class="br-progress" id="progress" hidden></div>
  <div class="br-content grow" id="content"></div>
</div>
</x-layout-window>
