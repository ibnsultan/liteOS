/* LiteOS Notes — each note is a text/Markdown file in /Notes. */
LiteOS.ready((OS) => {
  'use strict';
  const U = OS.util;
  const $ = (s) => document.querySelector(s);
  const DIR = '/Notes';
  const NOTE_EXTS = ['md', 'txt', 'markdown'];

  const listEl = $('#list');
  const ta = $('#text');
  const searchEl = $('#search');
  const stateEl = $('#saveState');

  $('#searchIco').outerHTML = OS.icon('search', 15);
  $('#newBtn').innerHTML = OS.icon('plus', 17);
  $('#delBtn').innerHTML = OS.icon('trash', 16);
  $('#emptyIco').outerHTML = OS.icon('note', 40);

  /** @type {{path:string,name:string,mtime:number,content:string,dirty:boolean,fresh:boolean,deleted:boolean}[]} */
  let notes = [];
  let otherNames = new Set(); // non-note files in /Notes (avoid clashing on rename)
  let cur = null;
  let chain = Promise.resolve();
  let loaded = false;

  OS.win.setTitle('Notes');

  // ------------------------------------------------------------------ names
  function titleOf(content) {
    const line = String(content).split(/\r?\n/).find((l) => l.trim() !== '');
    return line ? line.replace(/^\s*#{1,6}\s+/, '').trim() : '';
  }
  function previewOf(content) {
    const lines = String(content).split(/\r?\n/).filter((l) => l.trim() !== '');
    return lines.slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  }
  function safeFileBase(title) {
    let s = String(title)
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '');
    if (s.length > 60) s = s.slice(0, 60).trim();
    s = s.replace(/[. ]+$/, '');
    return s || 'Untitled';
  }
  function takenNames(except) {
    const set = new Set(otherNames);
    notes.forEach((n) => { if (n !== except && !n.deleted) set.add(n.name.toLowerCase()); });
    return set;
  }
  function uniqueName(base, ext, except) {
    const taken = takenNames(except);
    let name = base + '.' + ext;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = base + ' ' + i + '.' + ext;
    return name;
  }

  // ------------------------------------------------------------------ loading
  async function ensureDir() {
    try {
      return await OS.fs.list(DIR);
    } catch (e) {
      await OS.fs.mkdir(DIR);
      return [];
    }
  }
  async function loadAll() {
    const entries = await ensureDir();
    const files = entries.filter((e) => e.type === 'file' && NOTE_EXTS.includes((e.ext || '').toLowerCase()));
    otherNames = new Set(entries.filter((e) => !files.includes(e)).map((e) => e.name.toLowerCase()));
    notes = files.map((e) => ({ path: e.path, name: e.name, mtime: e.mtime || 0, content: '', dirty: false, fresh: false, deleted: false }));
    // Read contents a few at a time.
    let i = 0;
    async function worker() {
      while (i < notes.length) {
        const n = notes[i++];
        try { n.content = String((await OS.fs.read(n.path, { track: false })).content || ''); } catch (e) { n.content = ''; }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    loaded = true;
  }

  // ------------------------------------------------------------------ rendering
  function sorted() { return notes.filter((n) => !n.deleted).sort((a, b) => b.mtime - a.mtime); }
  function visible() {
    const q = searchEl.value.trim().toLowerCase();
    const all = sorted();
    return q ? all.filter((n) => n.content.toLowerCase().includes(q) || n.name.toLowerCase().includes(q)) : all;
  }
  function renderList() {
    const all = sorted();
    const vis = visible();
    if (!all.length) {
      listEl.innerHTML = '<div class="list-msg">' + (loaded ? 'No notes' : 'Loading…') + '</div>';
    } else if (!vis.length) {
      listEl.innerHTML = '<div class="list-msg">No notes match “' + U.escape(searchEl.value.trim()) + '”</div>';
    } else {
      listEl.innerHTML = vis.map((n, i) => {
        const t = titleOf(n.content) || 'New note';
        const p = previewOf(n.content) || (n.content.trim() ? '' : 'No additional text');
        return '<button class="note-item' + (n === cur ? ' selected' : '') + '" role="option" aria-selected="' + (n === cur) + '" data-i="' + i + '">' +
          '<div class="n-title">' + U.escape(t) + '</div>' +
          '<div class="n-meta"><span class="n-date">' + U.escape(shortDate(n.mtime)) + '</span><span class="n-prev">' + U.escape(p) + '</span></div></button>';
      }).join('');
      listEl._vis = vis;
    }
    const c = all.length;
    $('#count').textContent = c + (c === 1 ? ' note' : ' notes');
    const none = loaded && !all.length;
    $('#empty').hidden = !none;
    $('#editor').hidden = none || !cur;
    if (!none && !cur) { $('#empty').hidden = false; $('#empty .empty-title').textContent = 'Select a note'; }
    else $('#empty .empty-title').textContent = 'No notes yet';
  }
  const renderListSoon = U.debounce(renderList, 150);

  function shortDate(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const diff = (now - d) / 86400000;
    if (diff < 6) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : '2-digit' });
  }

  function setState(kind, text) {
    stateEl.className = 'save-state ' + kind;
    stateEl.innerHTML = (kind === 'ok' ? OS.icon('check', 13) : '') + U.escape(text);
  }
  function updateDirtyFlag() {
    const any = notes.some((n) => n.dirty && !n.deleted);
    OS.win.setDirty(any);
  }

  function showNote(n) {
    cur = n;
    if (n) {
      ta.value = n.content;
      $('#noteDate').textContent = U.formatDate(n.mtime);
      setState(n.dirty ? 'busy' : 'ok', n.dirty ? 'Editing…' : 'Saved');
      OS.win.setTitle((titleOf(n.content) || 'New note') + ' — Notes');
    } else {
      ta.value = '';
      OS.win.setTitle('Notes');
    }
    renderList();
  }

  // ------------------------------------------------------------------ saving
  function queueSave(n) {
    chain = chain.then(() => doSave(n)).catch(() => {});
    return chain;
  }
  async function doSave(n) {
    if (!n || n.deleted || !n.dirty) return;
    const content = n.content;
    n.dirty = false;
    if (n === cur) setState('busy', 'Saving…');
    try {
      const entry = await OS.fs.write(n.path, content);
      if (entry && entry.mtime) n.mtime = entry.mtime;
      // The file name follows the first line.
      const ext = U.ext(n.name) || 'md';
      const base = safeFileBase(titleOf(content));
      const curBase = U.stem(n.name);
      const plain = base === curBase;
      const numbered = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\d+$').test(curBase);
      if (!plain && !numbered) {
        let name = uniqueName(base, ext, n);
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const e2 = await OS.fs.rename(n.path, name);
            n.path = e2.path || U.join(DIR, name);
            n.name = e2.name || name;
            break;
          } catch (err) {
            otherNames.add(name.toLowerCase()); // something else holds that name; try the next one
            name = uniqueName(base, ext, n);
          }
        }
      }
      if (n === cur && !n.dirty) {
        setState('ok', 'Saved');
        $('#noteDate').textContent = U.formatDate(n.mtime);
      }
    } catch (e) {
      n.dirty = true;
      if (n === cur) setState('err', 'Not saved');
      OS.notify(e.message, { type: 'error', title: 'Couldn’t save note' });
    }
    updateDirtyFlag();
    renderListSoon();
  }
  const saveSoon = U.debounce(() => { if (cur) queueSave(cur); }, 800);

  function flushCurrent() {
    if (cur && cur.dirty) return queueSave(cur);
    return chain;
  }

  // ------------------------------------------------------------------ actions
  async function leaveCurrent() {
    const prev = cur;
    await flushCurrent();
    // Drop notes that were created here and left empty.
    if (prev && prev.fresh && !prev.deleted && prev.content.trim() === '') {
      prev.deleted = true;
      try { await OS.fs.remove(prev.path); } catch (e) { /* ignore */ }
    }
  }
  async function select(n) {
    if (n === cur) return;
    await leaveCurrent();
    showNote(n);
  }
  async function newNote() {
    await leaveCurrent();
    if (searchEl.value) searchEl.value = '';
    const name = uniqueName('Untitled', 'md', null);
    try {
      const entry = await OS.fs.write(U.join(DIR, name), '', { overwrite: false });
      const n = { path: entry.path || U.join(DIR, name), name: entry.name || name, mtime: entry.mtime || Date.now() / 1000, content: '', dirty: false, fresh: true, deleted: false };
      notes.push(n);
      showNote(n);
      ta.focus();
    } catch (e) {
      // Folder may have gone away; recreate it once.
      try { await ensureDir(); } catch (e2) { /* ignore */ }
      OS.notify(e.message, { type: 'error', title: 'Couldn’t create note' });
    }
  }
  async function deleteNote() {
    if (!cur) return;
    const n = cur;
    const ok = await OS.dialog.confirm({
      title: 'Delete note?',
      message: '“' + (titleOf(n.content) || 'New note') + '” will be moved to the Trash.',
      okLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    await chain;
    try {
      await OS.fs.remove(n.path);
      n.deleted = true;
      n.dirty = false;
      updateDirtyFlag();
      const rest = visible();
      showNote(rest[0] || null);
      OS.notify('You can restore the note from the Trash in Files.', { type: 'success', title: 'Note moved to Trash' });
    } catch (e) {
      OS.notify(e.message, { type: 'error', title: 'Couldn’t delete note' });
    }
  }

  // ------------------------------------------------------------------ events
  ta.addEventListener('input', () => {
    if (!cur) return;
    cur.content = ta.value;
    cur.dirty = true;
    cur.fresh = cur.fresh && ta.value.trim() === '';
    cur.mtime = Date.now() / 1000;
    setState('busy', 'Editing…');
    OS.win.setDirty(true);
    OS.win.setTitle((titleOf(cur.content) || 'New note') + ' — Notes');
    renderListSoon();
    saveSoon();
  });
  // Tab inserts a tab character instead of leaving the editor.
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      if (!document.execCommand('insertText', false, '\t')) ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end');
    }
  });
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('.note-item');
    if (!b || !listEl._vis) return;
    const n = listEl._vis[+b.dataset.i];
    if (n) select(n);
  });
  listEl.addEventListener('contextmenu', (e) => {
    const b = e.target.closest('.note-item');
    if (!b || !listEl._vis) return;
    e.preventDefault();
    const n = listEl._vis[+b.dataset.i];
    OS.menu([
      { label: 'Open', icon: 'note', action: () => select(n) },
      { label: 'Delete', icon: 'trash', danger: true, action: async () => { await select(n); deleteNote(); } },
    ], e);
  });
  searchEl.addEventListener('input', renderList);
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = visible(); if (v[0]) select(v[0]); }
    if (e.key === 'Escape') { searchEl.value = ''; renderList(); }
  });
  $('#newBtn').addEventListener('click', newNote);
  $('#emptyNew').addEventListener('click', newNote);
  $('#delBtn').addEventListener('click', deleteNote);
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); flushCurrent(); }
    else if (mod && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
    else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); searchEl.focus(); searchEl.select(); }
  });
  window.addEventListener('pagehide', () => { if (cur && cur.dirty) queueSave(cur); });

  // ------------------------------------------------------------------ start
  renderList();
  (async () => {
    try {
      await loadAll();
    } catch (e) {
      loaded = true;
      OS.notify(e.message, { type: 'error', title: 'Couldn’t load notes' });
    }
    // Opened from the jump list's "New note": start a fresh note straight away.
    if (OS.args.new === '1') { newNote(); return; }
    const want = OS.args.path;
    const first = (want && notes.find((n) => n.path.toLowerCase() === String(want).toLowerCase())) || sorted()[0] || null;
    showNote(first);
    if (first) ta.focus();
  })();
});
