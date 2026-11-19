{{-- Slides: the app window's page (AppsController). Its scripts and styles are in public/assets/apps/slides/. --}}
<x-layout-window app="slides" title="Slides" :styles="['slides.css']" :scripts="['app.js']">
<div class="app slides" id="app">
  <div class="toolbar" id="toolbar" role="toolbar" aria-label="Slide tools">
    <button class="btn btn-ghost btn-sm" id="fileBtn">File</button>
    <span class="sep"></span>
    <button class="btn btn-ghost btn-sm" id="newSlideBtn" title="New slide (Ctrl+M)">New slide</button>
    <button class="icon-btn caret-btn" id="layoutBtn" title="New slide with layout" aria-label="New slide with layout" data-icon="down"></button>
    <span class="sep"></span>
    <button class="icon-btn" data-cmd="text" title="Text box" aria-label="Insert text box" data-icon="text"></button>
    <button class="icon-btn" data-cmd="shape" title="Shape" aria-label="Insert shape" data-icon="square"></button>
    <button class="icon-btn" data-cmd="image" title="Image" aria-label="Insert image" data-icon="image"></button>
    <span class="sep"></span>
    <input class="input size-input" id="fontSize" type="number" min="6" max="400" step="1" title="Font size" aria-label="Font size">
    <button class="icon-btn" data-cmd="bold" title="Bold (Ctrl+B)" aria-label="Bold" data-icon="bold"></button>
    <button class="icon-btn" data-cmd="italic" title="Italic (Ctrl+I)" aria-label="Italic" data-icon="italic"></button>
    <button class="icon-btn" data-cmd="underline" title="Underline (Ctrl+U)" aria-label="Underline" data-icon="underline"></button>
    <span class="icon-btn color-btn" title="Text colour"><span class="glyph">A</span><span class="bar" id="colorBar"></span><input type="color" id="textColor" aria-label="Text colour"></span>
    <button class="icon-btn" data-cmd="alignLeft" title="Align left" aria-label="Align left" data-icon="alignLeft"></button>
    <button class="icon-btn" data-cmd="alignCenter" title="Align centre" aria-label="Align centre" data-icon="alignCenter"></button>
    <button class="icon-btn" data-cmd="alignRight" title="Align right" aria-label="Align right" data-icon="alignRight"></button>
    <span class="sep"></span>
    <button class="icon-btn" data-cmd="forward" title="Bring forward" aria-label="Bring forward" data-icon="up"></button>
    <button class="icon-btn" data-cmd="backward" title="Send backward" aria-label="Send backward" data-icon="down"></button>
    <button class="icon-btn" data-cmd="delete" title="Delete (Del)" aria-label="Delete" data-icon="trash"></button>
    <span class="spacer"></span>
    <span class="counter" id="counter"></span>
    <span class="save-state" id="saveState"></span>
    <button class="btn present-btn" id="presentBtn" title="Present (F5)">Present</button>
  </div>

  <div class="split">
    <nav class="rail" id="rail" tabindex="0" aria-label="Slides"></nav>
    <main class="center">
      <div class="stage" id="stage">
        <div class="slide-wrap" id="wrap">
          <div class="slide" id="canvas"></div>
          <div class="sel-layer" id="selLayer"></div>
        </div>
      </div>
      <div class="notes">
        <label for="notes">Speaker notes</label>
        <textarea id="notes" placeholder="Click to add speaker notes"></textarea>
      </div>
    </main>
    <aside class="panel" id="panel" aria-label="Format">
      <div class="panel-tabs"><span class="panel-tab active">Format</span></div>
      <div class="panel-body" id="panelBody"></div>
    </aside>
  </div>
</div>
</x-layout-window>
