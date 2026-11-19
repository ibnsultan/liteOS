{{-- Notes: the app window's page (AppsController). Its scripts and styles are in public/assets/apps/notes/. --}}
<x-layout-window app="notes" title="Notes" :styles="['notes.css']" :scripts="['app.js']">
<div class="app">
  <div class="split">
    <aside class="notes-side">
      <div class="side-head">
        <label class="search grow">
          <span id="searchIco"></span>
          <input class="input" id="search" type="search" placeholder="Search notes" aria-label="Search notes" autocomplete="off">
        </label>
        <button class="icon-btn new-btn" id="newBtn" title="New note (Ctrl+Alt+N)" aria-label="New note"></button>
      </div>
      <div class="note-list" id="list" role="listbox" aria-label="Notes"></div>
      <div class="side-foot" id="count"></div>
    </aside>

    <main class="note-main">
      <div class="empty" id="empty" hidden>
        <span id="emptyIco"></span>
        <div class="empty-title">No notes yet</div>
        <div class="hint">Notes are saved as text files in your Notes folder.</div>
        <button class="btn btn-primary" id="emptyNew">New note</button>
      </div>
      <div class="note-editor" id="editor" hidden>
        <div class="editor-bar">
          <span class="note-date" id="noteDate"></span>
          <span class="spacer"></span>
          <span class="save-state" id="saveState"></span>
          <button class="icon-btn" id="delBtn" title="Delete note" aria-label="Delete note"></button>
        </div>
        <textarea id="text" spellcheck="true" placeholder="Start typing… The first line becomes the title." aria-label="Note text"></textarea>
      </div>
    </main>
  </div>
</div>
</x-layout-window>
