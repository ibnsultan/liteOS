{{-- Whiteboard: the app window's page (AppsController). Its scripts and styles are in public/assets/apps/board/. --}}
<x-layout-window app="board" title="Whiteboard" :styles="['board.css']" :scripts="['app.js']">
<div class="app">
  <div class="toolbar wb-toolbar">
    <button class="btn btn-sm" id="openImg" title="Open an image as the background">Open image</button>
    <button class="btn btn-sm btn-primary" id="save" title="Save as PNG (Ctrl+S)">Save</button>
    <button class="icon-btn" id="more" title="More" aria-label="More"><span data-icon="more"></span></button>
    <span class="sep"></span>
    <button class="icon-btn" id="undo" title="Undo (Ctrl+Z)" aria-label="Undo"><span data-icon="undo"></span></button>
    <button class="icon-btn" id="redo" title="Redo (Ctrl+Y)" aria-label="Redo"><span data-icon="redo"></span></button>
    <span class="spacer"></span>
    <div class="seg" id="bgSeg" role="radiogroup" aria-label="Background">
      <button data-bg="plain" role="radio">Plain</button>
      <button data-bg="dots" role="radio">Dots</button>
      <button data-bg="lines" role="radio">Lines</button>
    </div>
    <span class="sep"></span>
    <button class="btn btn-sm" id="clear" title="Clear the board">Clear</button>
  </div>

  <div class="wb-stage grow" id="stage">
    <canvas id="bgCanvas" aria-hidden="true"></canvas>
    <canvas id="inkCanvas" aria-hidden="true"></canvas>
    <canvas id="liveCanvas" role="img" aria-label="Drawing board"></canvas>
    <div class="wb-cursor" id="cursor" hidden></div>

    <div class="wb-palette wb-float" id="tools" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      <button class="icon-btn" data-tool="pen" title="Pen (P)" aria-label="Pen"><span data-icon="pen"></span></button>
      <button class="icon-btn" data-tool="hl" title="Highlighter (H)" aria-label="Highlighter"><span data-icon="highlighter"></span></button>
      <button class="icon-btn" data-tool="eraser" title="Eraser (E)" aria-label="Eraser"><span data-icon="eraser"></span></button>
      <span class="wb-hsep"></span>
      <button class="icon-btn" data-tool="line" title="Line (L)" aria-label="Line"><span data-icon="line"></span></button>
      <button class="icon-btn" data-tool="arrow" title="Arrow (A)" aria-label="Arrow"><span data-icon="arrow"></span></button>
      <button class="icon-btn" data-tool="rect" title="Rectangle (R)" aria-label="Rectangle"><span data-icon="square"></span></button>
      <button class="icon-btn" data-tool="ellipse" title="Ellipse (O)" aria-label="Ellipse"><span data-icon="circle"></span></button>
      <button class="icon-btn" data-tool="text" title="Text (T)" aria-label="Text"><span data-icon="text"></span></button>
    </div>

    <div class="wb-props wb-float" id="props">
      <div class="wb-swatches" id="swatches" role="radiogroup" aria-label="Colour"></div>
      <label class="wb-custom" title="Custom colour"><input type="color" id="customColor" value="#16171A" aria-label="Custom colour"></label>
      <span class="sep"></span>
      <div class="wb-sizes" id="sizes" role="radiogroup" aria-label="Stroke size"></div>
      <span class="sep"></span>
      <button class="btn btn-sm btn-ghost wb-fill" id="fill" title="Fill shapes" aria-pressed="false">Fill</button>
    </div>
  </div>
</div>
</x-layout-window>
