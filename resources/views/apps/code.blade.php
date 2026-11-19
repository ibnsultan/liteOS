{{-- Code: the app window's page (AppsController). Its scripts and styles are in public/assets/apps/code/. --}}
<x-layout-window app="code" title="Code" :styles="['code.css']" :scripts="['highlight.js', 'app.js']">
<div class="app">
  <div class="toolbar" id="toolbar">
    <button class="icon-btn active" data-act="toggleExplorer" data-icon="panelLeft" title="Toggle explorer (Ctrl+B)"></button>
    <span class="sep"></span>
    <button class="icon-btn" data-act="newFile" data-icon="plus" title="New file (Ctrl+Alt+N)"></button>
    <button class="icon-btn" data-act="openFile" data-icon="open" title="Open file (Ctrl+O)"></button>
    <button class="icon-btn" data-act="openFolder" data-icon="folder" title="Open folder"></button>
    <button class="icon-btn" data-act="save" data-icon="save" title="Save (Ctrl+S)"></button>
    <button class="icon-btn" data-act="more" data-icon="more" title="More"></button>
    <span class="spacer"></span>
    <span class="crumbs" id="crumbs"></span>
    <span class="spacer"></span>
    <button class="btn btn-sm run-btn" data-act="run" title="Refresh the live preview (Ctrl+Enter)">Run</button>
    <button class="btn btn-sm btn-ghost" data-act="toggleConsole" id="consoleBtn" title="Toggle console (Ctrl+J)">Console<span class="count" id="errCount" hidden></span></button>
    <button class="btn btn-sm btn-ghost" data-act="togglePreview" id="previewBtn" title="Toggle live preview">Preview</button>
  </div>

  <div class="split" id="split">
    <aside class="explorer" id="explorer">
      <div class="ex-head">
        <span>Explorer</span>
        <span class="spacer"></span>
        <button class="icon-btn sm" data-act="treeNewFile" data-icon="plus" title="New file in folder"></button>
        <button class="icon-btn sm" data-act="treeNewFolder" data-icon="folderPlus" title="New folder"></button>
        <button class="icon-btn sm" data-act="treeRefresh" data-icon="reload" title="Refresh"></button>
      </div>
      <div class="tree" id="tree" role="tree"></div>
    </aside>

    <main class="editor-col">
      <div class="tabs" id="tabs" role="tablist"></div>
      <div class="editors" id="editors">
        <div class="empty welcome" id="welcome">
          <span data-icon="code" data-size="40"></span>
          <div class="w-title">Code</div>
          <div class="hint">Open a file or a folder to start editing. HTML and Markdown files get a live preview.</div>
          <div class="row">
            <button class="btn btn-primary" data-act="newFile">New file</button>
            <button class="btn" data-act="openFile">Open file</button>
            <button class="btn" data-act="openFolder">Open folder</button>
          </div>
        </div>
      </div>
      <div class="console" id="console" hidden>
        <div class="con-head">
          <span class="con-tab">Console</span>
          <span class="spacer"></span>
          <button class="icon-btn sm" data-act="clearConsole" data-icon="eraser" title="Clear console"></button>
          <button class="icon-btn sm" data-act="toggleConsole" data-icon="x" title="Close console"></button>
        </div>
        <div class="con-log" id="conLog"></div>
      </div>
    </main>

    <div class="resizer" id="resizer" hidden></div>
    <section class="preview" id="preview" hidden>
      <div class="pv-head">
        <span class="pv-title">Live preview</span>
        <span class="pv-auto" id="pvAuto"><span class="dot"></span>Auto-refresh</span>
        <button class="icon-btn sm" data-act="run" data-icon="reload" title="Refresh preview"></button>
        <button class="icon-btn sm" data-act="togglePreview" data-icon="x" title="Close preview"></button>
      </div>
      <div class="pv-frame-wrap">
        <div class="pv-bar"><span data-icon="globe" data-size="12"></span><span class="pv-url" id="pvUrl">preview</span></div>
        <iframe id="pvFrame" sandbox="allow-scripts" title="Live preview"></iframe>
        <div class="empty pv-empty" id="pvEmpty">
          <div class="hint">Open an HTML or Markdown file to see a preview here.</div>
        </div>
      </div>
    </section>
  </div>

  <div class="statusbar code-status">
    <span id="stSaved">No file</span>
    <span id="stErrors" class="st-err" hidden></span>
    <span class="spacer"></span>
    <span id="stPos"></span>
    <span id="stIndent">Spaces: 2</span>
    <span>UTF-8</span>
    <button class="st-lang" id="stLang" title="Change language mode">Plain text</button>
  </div>
</div>
</x-layout-window>
