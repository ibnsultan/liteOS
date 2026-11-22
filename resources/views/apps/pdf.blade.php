{{-- PDF Viewer: the app window's page (AppsController). Its scripts and styles are in public/assets/apps/pdf/; pdf.js
     (public/assets/vendor/pdfjs-<version>/, npm run vendor) is loaded by app.js with import() when a PDF opens. --}}
<x-layout-window app="pdf" title="PDF Viewer" :vendor="['pdfjs-6.5.438/pdf_viewer.css']" :styles="['pdf.css']" :scripts="['organize.js', 'app.js']">
<div class="app pv" id="app">
  <header class="pv-title" id="titlebar">
    <span class="pv-title-icon" id="tbIcon" aria-hidden="true"></span>
    <span class="pv-title-name" id="tbName">PDF Viewer</span>
    <span class="spacer"></span>
    <span class="pv-title-controls" id="tbControls"></span>
  </header>

  <div class="pv-toolbar" id="toolbar" role="toolbar" aria-label="PDF Viewer" hidden>
    <button type="button" class="icon-btn pv-tb" data-act="side" id="sideBtn" title="Pages and outline (F4)" aria-label="Pages and outline" aria-pressed="true"></button>
    <button type="button" class="icon-btn pv-tb" data-act="back" id="backBtn" title="Back (Alt+Left)" aria-label="Back" disabled></button>
    <button type="button" class="icon-btn pv-tb" data-act="forward" id="fwdBtn" title="Forward (Alt+Right)" aria-label="Forward" disabled></button>
    <span class="sep"></span>
    <label class="pv-pageno"><input class="input" id="pageNo" inputmode="numeric" aria-label="Page number" value="1"><span id="pageCount">of 1</span></label>
    <span class="sep"></span>
    <button type="button" class="icon-btn pv-tb" data-act="zoom-out" title="Zoom out (Ctrl+−)" aria-label="Zoom out"></button>
    <button type="button" class="combo pv-zoom" id="zoomBtn" aria-haspopup="listbox" aria-expanded="false" aria-label="Zoom"><span id="zoomText">100%</span></button>
    <button type="button" class="icon-btn pv-tb" data-act="zoom-in" title="Zoom in (Ctrl+=)" aria-label="Zoom in"></button>
    <button type="button" class="icon-btn pv-tb" data-act="fit" id="fitBtn" title="Fit to width" aria-label="Fit to width"></button>
    <button type="button" class="icon-btn pv-tb" data-act="rotate" title="Rotate (Ctrl+])" aria-label="Rotate"></button>
    <button type="button" class="icon-btn pv-tb" data-act="layout" id="layoutBtn" title="Page layout" aria-label="Page layout" aria-haspopup="menu"></button>
    <button type="button" class="icon-btn pv-tb" data-act="present" title="Presentation (F5)" aria-label="Presentation"></button>
    <button type="button" class="icon-btn pv-tb" data-act="organize" title="Organise pages" aria-label="Organise pages"></button>
    <span class="sep"></span>
    <div class="pv-tools-group" id="markTools" role="group" aria-label="Mark up">
      <button type="button" class="pv-tool" data-tool="highlight" aria-pressed="false" title="Highlight text"><span data-ico="pv-hl"></span><span class="pv-tool-name">Highlight</span><span class="pv-chip" id="hlChip"></span></button>
      <button type="button" class="pv-tool" data-tool="ink" aria-pressed="false" title="Draw"><span data-ico="pv-ink"></span><span class="pv-tool-name">Draw</span></button>
      <button type="button" class="pv-tool" data-tool="text" aria-pressed="false" title="Add text"><span data-ico="pv-text"></span><span class="pv-tool-name">Text</span></button>
      <button type="button" class="pv-tool" data-tool="image" title="Add a picture"><span data-ico="pv-image"></span><span class="pv-tool-name">Picture</span></button>
      <button type="button" class="pv-tool" data-tool="sign" aria-haspopup="menu" title="Sign"><span data-ico="pv-sign"></span><span class="pv-tool-name">Sign</span></button>
      <button type="button" class="icon-btn pv-tb pv-opts" data-act="tool-options" id="toolOpts" title="Colour and size" aria-label="Colour and size" hidden></button>
    </div>
    <button type="button" class="icon-btn pv-tb" data-act="undo" id="undoBtn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled></button>
    <button type="button" class="icon-btn pv-tb" data-act="redo" id="redoBtn" title="Redo (Ctrl+Y)" aria-label="Redo" disabled></button>
    <span class="spacer"></span>
    <button type="button" class="btn btn-primary pv-save" data-act="save" id="saveBtn" title="Save (Ctrl+S)" hidden>Save</button>
    <button type="button" class="icon-btn pv-tb" data-act="find" id="findBtn" title="Find (Ctrl+F)" aria-label="Find"></button>
    <button type="button" class="icon-btn pv-tb" data-act="print" id="printBtn" title="Print (Ctrl+P)" aria-label="Print"></button>
    <button type="button" class="icon-btn pv-tb" data-act="more" title="More" aria-label="More"></button>
  </div>

  <div class="pv-body" id="body" hidden>
    <aside class="pv-side" id="side">
      <div class="pv-side-head">
        <div class="seg" role="tablist" aria-label="Side pane">
          <button type="button" role="tab" data-tab="pages" class="active" aria-selected="true">Pages</button>
          <button type="button" role="tab" data-tab="outline" aria-selected="false">Outline</button>
          <button type="button" role="tab" data-tab="notes" aria-selected="false">Notes</button>
          <button type="button" role="tab" data-tab="attachments" aria-selected="false" hidden>Files</button>
          <button type="button" role="tab" data-tab="layers" aria-selected="false" hidden>Layers</button>
        </div>
      </div>
      <div class="pv-thumbs" id="thumbs" role="listbox" aria-label="Pages"></div>
      <div class="pv-outline" id="outline" role="tree" aria-label="Outline" hidden></div>
      <div class="pv-list" id="notes" role="list" aria-label="Your marks" hidden></div>
      <div class="pv-list" id="attachments" role="list" aria-label="Attached files" hidden></div>
      <div class="pv-list" id="layers" role="list" aria-label="Layers" hidden></div>
    </aside>
    <main class="pv-stage" id="stage">
      <div class="pv-viewer" id="viewerContainer" tabindex="0">
        <div id="viewer" class="pdfViewer"></div>
      </div>
      <div class="pv-find" id="find" role="search" hidden>
        <label class="search"><span id="findIco"></span><input class="input" id="findInput" type="search" placeholder="Find in document" aria-label="Find in document" autocomplete="off"></label>
        <span class="pv-find-count" id="findCount" aria-live="polite"></span>
        <button type="button" class="icon-btn" data-act="find-prev" title="Previous (Shift+Enter)" aria-label="Previous match"></button>
        <button type="button" class="icon-btn" data-act="find-next" title="Next (Enter)" aria-label="Next match"></button>
        <button type="button" class="pv-find-opt" data-act="find-case" aria-pressed="false" title="Match case">Aa</button>
        <button type="button" class="pv-find-opt pv-whole" data-act="find-word" aria-pressed="false" title="Whole words">ab</button>
        <button type="button" class="icon-btn" data-act="find-close" title="Close (Esc)" aria-label="Close find"></button>
      </div>
      <div class="pv-pageinfo" id="pageInfo" aria-hidden="true"></div>
      <div class="pv-present-hint" id="presentHint" hidden>Presentation · arrow keys or click to move, Esc to leave</div>
      <div class="pv-loading" id="loading" hidden><span class="pv-spinner"></span><span id="loadingText">Opening</span></div>
    </main>
  </div>

  <div class="pv-start" id="start" hidden></div>
  <div class="pv-dropveil" aria-hidden="true"><span class="pv-dropveil-in"><span data-ico="pv-upload"></span><span class="pv-dropveil-title">Drop to open</span><span class="pv-dropveil-sub">Several PDFs or pictures are combined into one</span></span></div>

  <section class="pv-org" id="organize" aria-label="Organise pages" hidden>
    <div class="pv-org-bar" role="toolbar" aria-label="Pages">
      <button type="button" class="pv-tool" data-org="back"><span data-ico="pv-back"></span>Back</button>
      <span class="sep"></span>
      <button type="button" class="pv-tool" data-org="insert" aria-haspopup="menu"><span data-ico="pv-plus"></span>Insert</button>
      <button type="button" class="pv-tool" data-org="rotl"><span data-ico="pv-rotl"></span>Rotate left</button>
      <button type="button" class="pv-tool" data-org="rotr"><span data-ico="pv-rotate"></span>Rotate right</button>
      <button type="button" class="pv-tool" data-org="extract"><span data-ico="pv-extract"></span>Extract</button>
      <button type="button" class="pv-tool" data-org="split"><span data-ico="pv-split"></span>Split</button>
      <button type="button" class="pv-tool danger" data-org="delete"><span data-ico="trash"></span>Delete</button>
      <span class="spacer"></span>
      <button type="button" class="btn" data-org="copy">Save a copy…</button>
      <button type="button" class="btn btn-primary" data-org="save">Save</button>
    </div>
    <div class="pv-org-grid" id="orgGrid" role="listbox" aria-multiselectable="true" aria-label="Pages"></div>
    <div class="pv-org-status"><span id="orgStatus"></span><span>Drag pages to reorder them, or drop PDFs and pictures here to add them</span></div>
  </section>
</div>
</x-layout-window>
