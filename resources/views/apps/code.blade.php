{{-- Code: the app window's page (AppsController). The app is built in liteapps/code and installed into
     public/assets/apps/code/ (npm run install:liteos there): CodeMirror, the Markdown renderer, the terminal, the app.
     Its window draws its own title row (chrome "custom"); the shell's window buttons sit over the right end of it. --}}
<x-layout-window app="code" title="Code" :styles="['code.css']" :scripts="['codemirror.js', 'markdown.js', 'terminal.js', 'app.js']">
<div class="app code-app">
  <header class="titlebar" id="titlebar">
    <span class="tb-icon" id="tbIcon" aria-hidden="true"></span>
    <nav class="menubar" id="menubar" aria-label="App menu" hidden></nav>
    <div class="tb-nav">
      <button class="icon-btn sm" data-act="navBack" data-icon="back" id="navBack" title="Go back (Alt+Left)" disabled></button>
      <button class="icon-btn sm" data-act="navForward" data-icon="forward" id="navForward" title="Go forward (Alt+Right)" disabled></button>
    </div>
    <div class="tb-center">
      <button class="tb-search" data-act="quickOpen" id="tbSearch" title="Go to a file (Ctrl+P) or run a command (Ctrl+Shift+P)">
        <span data-icon="search" data-size="14"></span><span id="tbSearchText">Search</span>
      </button>
    </div>
    <div class="tb-tools">
      <button class="icon-btn sm" data-act="toggleSidebar" data-icon="sidebarLeft" id="tgSidebar" title="Side bar (Ctrl+B)"></button>
      <button class="icon-btn sm" data-act="togglePanel" data-icon="panelBottom" id="tgPanel" title="Panel (Ctrl+J)"></button>
      <button class="icon-btn sm" data-act="togglePreview" data-icon="sidebarRight" id="tgPreview" title="Live preview"></button>
    </div>
    <span class="tb-controls" id="tbControls"></span>
  </header>

  <div class="workbench">
    <nav class="activitybar" aria-label="Views">
      <button class="ab-btn" data-view="explorer" data-icon="files" data-size="22" title="Explorer (Ctrl+Shift+E)"></button>
      <button class="ab-btn" data-view="search" data-icon="search" data-size="22" title="Search (Ctrl+Shift+F)"></button>
      <span class="spacer"></span>
      <button class="ab-btn" data-view="settings" data-icon="settings" data-size="22" title="Settings (Ctrl+,)"></button>
    </nav>

    <aside class="sidebar" id="sidebar">
      <div class="sb-view" id="viewExplorer">
        <section class="sb-sec collapsed" id="secOpen">
          <button class="sec-head" data-sec="secOpen"><span class="caret" data-icon="caret" data-size="12"></span><span class="sec-title">Open editors</span></button>
          <div class="sec-body" id="openList"></div>
        </section>
        <section class="sb-sec grow" id="secFolder">
          <div class="sec-head" data-sec="secFolder" role="button" tabindex="0">
            <span class="caret" data-icon="caret" data-size="12"></span><span class="sec-title" id="folderTitle">No folder open</span>
            <span class="sec-tools" id="folderTools" hidden>
              <button class="icon-btn xs" data-act="treeNewFile" data-icon="newFile" title="New file"></button>
              <button class="icon-btn xs" data-act="treeNewFolder" data-icon="folderPlus" title="New folder"></button>
              <button class="icon-btn xs" data-act="treeRefresh" data-icon="reload" title="Refresh"></button>
              <button class="icon-btn xs" data-act="treeCollapse" data-icon="collapse" title="Collapse folders"></button>
            </span>
          </div>
          <div class="sec-body tree" id="tree" role="tree" tabindex="0"></div>
        </section>
        <section class="sb-sec collapsed" id="secOutline">
          <button class="sec-head" data-sec="secOutline"><span class="caret" data-icon="caret" data-size="12"></span><span class="sec-title">Outline</span></button>
          <div class="sec-body" id="outline"></div>
        </section>
      </div>

      <div class="sb-view" id="viewSearch" hidden>
        <div class="sb-head"><span>Search</span></div>
        <div class="search-form">
          <div class="search-box">
            <input class="input" id="sQuery" type="text" placeholder="Search" spellcheck="false" autocomplete="off" aria-label="Search the project">
            <button class="opt" id="sCase" title="Match case" aria-pressed="false">Aa</button>
            <button class="opt" id="sRegex" title="Use regular expression" aria-pressed="false">.*</button>
          </div>
          <div class="search-info" id="sInfo"></div>
        </div>
        <div class="search-results" id="sResults"></div>
      </div>

      <div class="sb-view" id="viewSettings" hidden>
        <div class="sb-head"><span>Settings</span></div>
        <div class="settings">
          <label class="field"><span>Font size</span>
            <select class="select" id="setFont"></select>
          </label>
          <label class="check"><input type="checkbox" id="setWrap"> Word wrap</label>
          <label class="field"><span>Indentation for new files</span>
            <select class="select" id="setIndent">
              <option value="s2">2 spaces</option>
              <option value="s4">4 spaces</option>
              <option value="t4">Tabs</option>
            </select>
          </label>
          <label class="check"><input type="checkbox" id="setDetect"> Detect indentation from the file</label>
          <label class="check"><input type="checkbox" id="setAutoPreview"> Open the preview for HTML and Markdown</label>
        </div>
      </div>
    </aside>
    <div class="sash" id="sbSash"></div>

    <main class="editor-col" id="editorCol">
      <div class="tabs" id="tabs" role="tablist"></div>
      <div class="editors" id="editors">
        <div class="watermark" id="welcome">
          <span class="wm-mark" data-icon="code" data-size="150"></span>
          <dl class="wm-keys">
            <dt>Show all commands</dt><dd><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd></dd>
            <dt>Go to file</dt><dd><kbd>Ctrl</kbd>+<kbd>P</kbd></dd>
            <dt>Open file</dt><dd><kbd>Ctrl</kbd>+<kbd>O</kbd></dd>
            <dt>Open folder</dt><dd><kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>Ctrl</kbd>+<kbd>O</kbd></dd>
            <dt>Toggle terminal</dt><dd><kbd>Ctrl</kbd>+<kbd>`</kbd></dd>
          </dl>
        </div>
      </div>
      <div class="panel-sash" id="panelSash" hidden></div>
      <section class="panel" id="panel" hidden>
        <div class="panel-head">
          <div class="panel-tabs" role="tablist">
            <button data-panel="terminal" role="tab">Terminal</button>
            <button data-panel="console" role="tab">Console</button>
            <button data-panel="problems" role="tab">Problems<span class="count" id="probCount" hidden></span></button>
            <button data-panel="output" role="tab">Output</button>
          </div>
          <span class="spacer"></span>
          <span class="panel-acts" data-for="terminal">
            <button class="btn btn-sm btn-ghost term-pick" data-act="termMenu" id="termPick" title="Switch terminal"><span id="termName">Terminal</span><span data-icon="chevronDown" data-size="12"></span></button>
            <button class="icon-btn sm" data-act="termNew" data-icon="plus" title="New terminal"></button>
            <button class="icon-btn sm" data-act="termKill" data-icon="trash" title="Close this terminal"></button>
          </span>
          <span class="panel-acts" data-for="console">
            <span class="panel-ctx" id="conCtx"></span>
            <button class="icon-btn sm" data-act="clearConsole" data-icon="eraser" title="Clear console (Ctrl+L)"></button>
          </span>
          <span class="panel-acts" data-for="output">
            <button class="icon-btn sm" data-act="clearOutput" data-icon="eraser" title="Clear output"></button>
          </span>
          <span class="panel-sep"></span>
          <button class="icon-btn sm" data-act="panelMax" data-icon="maximize" id="panelMax" title="Maximise panel"></button>
          <button class="icon-btn sm" data-act="closePanel" data-icon="x" title="Close panel"></button>
        </div>
        <div class="panel-view" data-view="terminal" id="termHost"></div>
        <div class="panel-view" data-view="console" hidden>
          <div class="con-log" id="conLog" role="log"></div>
          <div class="prompt-row">
            <span class="prompt">›</span>
            <textarea id="conInput" rows="1" spellcheck="false" autocomplete="off" aria-label="JavaScript to run" placeholder="JavaScript"></textarea>
          </div>
        </div>
        <div class="panel-view" data-view="problems" hidden><div class="prob-list" id="probList"></div></div>
        <div class="panel-view" data-view="output" hidden><div class="con-log" id="outLog" role="log"></div></div>
      </section>
    </main>

    <div class="sash sash-right" id="pvSash" hidden></div>
    <section class="preview" id="preview" hidden>
      <div class="pv-head">
        <span class="pv-title" id="pvTitle">Preview</span>
        <button class="icon-btn sm" data-act="run" data-icon="reload" title="Refresh the preview (Ctrl+Enter)"></button>
        <button class="icon-btn sm" data-act="togglePreview" data-icon="x" title="Close preview"></button>
      </div>
      <iframe id="pvFrame" sandbox="allow-scripts" title="Live preview"></iframe>
      <div class="empty pv-empty" id="pvEmpty">
        <div class="hint">Open an HTML or Markdown file to see a preview here.</div>
      </div>
    </section>
  </div>

  <footer class="statusbar code-status">
    <button class="st-btn" id="stFolder" title="Open folder"></button>
    <button class="st-btn" id="stProblems" title="Problems">No problems</button>
    <span class="st-text" id="stSaving" hidden>Saving…</span>
    <span class="spacer"></span>
    <button class="st-btn" id="stPos" title="Go to line (Ctrl+G)" hidden></button>
    <button class="st-btn" id="stIndent" title="Indentation" hidden>Spaces: 2</button>
    <span class="st-text" id="stEnc" hidden>UTF-8</span>
    <button class="st-btn" id="stEol" title="Line endings" hidden>LF</button>
    <button class="st-btn" id="stLang" title="Language" hidden>Plain text</button>
  </footer>

  <div class="palette" id="palette" hidden>
    <div class="pal-box" id="palBox" role="dialog" aria-label="Go to file or run a command">
      <div class="pal-field"><span data-icon="search" data-size="15"></span><input id="palInput" type="text" placeholder="Type a file name, or &gt; for commands" spellcheck="false" autocomplete="off" aria-controls="palList"></div>
      <div class="pal-list" id="palList" role="listbox"></div>
    </div>
  </div>
</div>
</x-layout-window>
