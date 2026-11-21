{{-- Calculator: the app window's page (AppsController). Its scripts and styles are in public/assets/apps/calculator/;
     the keypads are drawn by app.js for the mode chosen. --}}
<x-layout-window app="calculator" title="Calculator" :styles="['calc.css']" :scripts="['decimal.js', 'engine.js', 'modes.js', 'convert.js', 'app.js']">
<div class="app calc" id="app">
  <header class="calc-head">
    <button type="button" class="mode-btn" id="modeBtn" aria-haspopup="listbox" aria-expanded="false" aria-label="Mode"><span id="modeName">Standard</span><span id="modeCaret"></span></button>
    <span class="spacer"></span>
    <button type="button" class="icon-btn" id="paneBtn" title="History and memory (Ctrl+H)" aria-label="History and memory" aria-expanded="false"></button>
  </header>
  <div class="calc-body">
    <main class="calc-main" id="main"></main>
    <aside class="calc-pane" id="pane" hidden>
      <div class="pane-head">
        <div class="seg" role="tablist" aria-label="History and memory">
          <button type="button" role="tab" data-tab="history">History</button>
          <button type="button" role="tab" data-tab="memory">Memory</button>
        </div>
      </div>
      <div class="pane-list" id="paneList" role="list"></div>
      <div class="pane-foot"><button type="button" class="icon-btn" id="paneClear"></button></div>
    </aside>
  </div>
</div>
</x-layout-window>
