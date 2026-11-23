/*
 * LiteOS Archives: see what is inside a ZIP archive and extract it.
 *
 * Everything happens in this page: the archive is read in pieces from the drive (zip.js), each file is decompressed
 * here, checked (its size, how much it grew, its checksum) and only then sent to the drive with fs.upload, one file at
 * a time. The server never unpacks anything. The admin's limits (Settings › System › Archives, LOS_CONFIG.archiveLimits)
 * are checked twice: against what the archive declares before anything is written, then against the bytes really
 * produced while unpacking, since declared sizes can lie.
 *
 * Arguments: path (the archive to open), extract: 'here' (Files' Extract Here: unpack next to the archive, then
 * close) or 'to' (Files' Extract To…: ask where, unpack, then close).
 */
LiteOS.ready((OS) => {
  'use strict';

  const Z = window.ArcZip;
  const T = window.ArcTar;
  const ARCHIVE = /\.(zip|tar|tgz|gz|7z|rar)$/i;
  const ACCEPT = ['zip', 'tar', 'tgz', 'gz', '7z', 'rar'];
  // 7z, RAR and password-protected ZIPs are read by libarchive (WebAssembly), loaded only when one is opened
  const LIBARCHIVE = (window.LOS_CONFIG && window.LOS_CONFIG.base ? window.LOS_CONFIG.base : '/') + 'assets/vendor/libarchive-2.0.2/libarchive.js';
  let libModule = null;
  const loadLib = () => (libModule = libModule || import(LIBARCHIVE));
  /** The archive's name without its archive extension ("photos.tar.gz" -> "photos"). */
  const stemOf = (n) => n.replace(/\.(tar\.gz|tgz|tar|zip|gz|7z|rar)$/i, '');
  /** Why an entry can't be extracted here, or "" (each engine knows its own). */
  const unsup = (e) => (st.kind === 'zip' ? Z.unsupported(e) : st.kind === 'lib' ? (e.encrypted ? 'Password-protected 7z and RAR files aren’t supported yet.' : '') : T.unsupported(e));
  const U = OS.util;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = U.escape;
  if (OS.inShell) document.documentElement.classList.add('in-shell');

  const MB = 1024 * 1024;
  const L = (window.LOS_CONFIG && window.LOS_CONFIG.archiveLimits) || { totalMB: 4096, fileMB: 1024, ratio: 100, entries: 20000 };
  const LIMITS = { total: L.totalMB * MB, file: L.fileMB * MB, ratio: L.ratio, entries: L.entries };
  const OPEN_DIR = '/.apps/archives/open'; // files opened from inside an archive are copied here first

  const P = window.LOS_ICON_PATHS || {};
  Object.assign(P, {
    'arc-lock': 'M7 11V8a5 5 0 0 1 10 0v3 M5 11h14v10H5z',
    'arc-warn': 'M12 3l10 18H2z M12 10v5 M12 18h.01',
    'arc-extract': 'M4 8h16v12H4z M3 4h18v4H3z M12 11v6 M9 14l3 3 3-3',
    'arc-home': 'M4 11l8-7 8 7 M6 9.5V20h12V9.5 M10 20v-5h4v5',
    'arc-new': 'M6 3h8l5 5v13H6z M14 3v5h5 M12.5 11v7 M9 14.5h7',
    'arc-add': 'M4 8h16v12H4z M3 4h18v4H3z M12 10.5v7 M8.5 14h7',
  });
  const ico = (n, s) => OS.icon(n, s || 16);

  // what is open: the archive, its tree, where we are in it and what is picked
  const st = {
    name: '', path: null, src: null, entries: [], tree: null,
    folder: '', sel: new Set(), anchor: null, sort: { key: 'name', asc: true }, query: '', busy: false,
    back: [], fwd: [], packed: false, recent: [],
  };
  const STATE = '/.apps/archives/state.json'; // recent archives and the view chosen
  async function loadState() {
    try { const j = JSON.parse((await OS.fs.read(STATE, { track: false })).content); st.recent = Array.isArray(j.recent) ? j.recent.slice(0, 10) : []; st.packed = !!j.packed; } catch (e) { /* first run */ }
  }
  async function saveState() {
    try {
      for (const d of ['/.apps', '/.apps/archives']) { try { await OS.fs.mkdir(d); } catch (e) { /* there */ } }
      await OS.fs.write(STATE, JSON.stringify({ recent: st.recent, packed: st.packed }));
    } catch (e) { /* not kept this time */ }
  }

  // ------------------------------------------------------------------ the tree
  /** Folders as nodes: { name, path, dirs: Map, files: [entry], size, packed, mtime }. Folders only implied by a
   * file's path are made too. Entries with unsafe names are kept apart (they are never extracted). */
  function buildTree(entries) {
    const root = { name: '', path: '', dirs: new Map(), files: [], size: 0, packed: 0, mtime: 0 };
    const dirOf = (path) => {
      let node = root;
      if (!path) return node;
      let at = '';
      for (const part of path.split('/')) {
        at = at ? at + '/' + part : part;
        if (!node.dirs.has(part)) node.dirs.set(part, { name: part, path: at, dirs: new Map(), files: [], size: 0, packed: 0, mtime: 0, entry: null });
        node = node.dirs.get(part);
      }
      return node;
    };
    for (const e of entries) {
      if (!e.path) continue;
      if (e.dir) { const d = dirOf(e.path); d.entry = e; d.mtime = Math.max(d.mtime, e.mtime); continue; }
      const cut = e.path.lastIndexOf('/');
      dirOf(cut < 0 ? '' : e.path.slice(0, cut)).files.push(e);
    }
    (function sum(node) {
      for (const d of node.dirs.values()) { sum(d); node.size += d.size; node.packed += d.packed; node.mtime = Math.max(node.mtime, d.mtime); }
      for (const f of node.files) { node.size += f.size; node.packed += f.packed || 0; node.mtime = Math.max(node.mtime, f.mtime); }
    })(root);
    return root;
  }
  function nodeAt(path) {
    let node = st.tree;
    if (!path) return node;
    for (const part of path.split('/')) { node = node && node.dirs.get(part); }
    return node || st.tree;
  }
  /** Every file entry under a folder node, and every folder (as its path). */
  function walk(node, files, dirs) {
    dirs.push(node.path);
    for (const d of node.dirs.values()) walk(d, files, dirs);
    for (const f of node.files) files.push(f);
  }
  const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
  const fileExt = (n) => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };

  // ------------------------------------------------------------------ opening
  async function openPath(path) {
    let entry;
    try { entry = await OS.fs.stat(path); } catch (ex) {
      // gone: it leaves the recent list (and the taskbar's jump list) too
      if (st.recent.includes(path)) { st.recent = st.recent.filter((x) => x !== path); saveState(); }
      return fail('Couldn’t open “' + baseName(path) + '”', 'It was moved or deleted.');
    }
    const src = OS.fs.isUsb(path) ? Z.blobSource(await OS.fs.readBlob(path)) : await Z.urlSource(OS.fs.rawUrl(path), entry.size);
    return load(src, entry.name || baseName(path), path);
  }
  async function load(src, name, path) {
    setBusy('Reading ' + name + '…');
    let zip;
    try {
      const head = await src.read(0, Math.min(src.size, 512));
      const tarish = (head[0] === 0x1f && head[1] === 0x8b) || T.looksTar(head);
      const sevenZip = head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc && head[3] === 0xaf;
      const rar = head[0] === 0x52 && head[1] === 0x61 && head[2] === 0x72 && head[3] === 0x21;
      if (st.lib) { st.lib.close(); st.lib = null; }
      if (sevenZip || rar) zip = await libOpen(src, name, sevenZip ? '7z' : 'rar');
      else if (tarish) zip = await T.open(src, { name, maxBytes: LIMITS.total, maxRatio: LIMITS.ratio });
      else {
        zip = await Z.open(src);
        zip.kind = 'zip';
        if (zip.entries.some((e) => e.encrypted)) zip = await libOpen(src, name, 'zip'); // password-protected: libarchive decrypts it
      }
      if (!zip) { setBusy(null); return false; } // the password was asked for and not given
    } catch (ex) { setBusy(null); return fail('Couldn’t open “' + name + '”', ex.message); }
    setBusy(null);
    if (zip.entries.length > LIMITS.entries) {
      return fail('Too many files', 'This archive has ' + zip.entries.length.toLocaleString() + ' files. The limit is ' + LIMITS.entries.toLocaleString() + '.');
    }
    if (zip.lib) st.lib = zip.lib;
    Object.assign(st, { name, path, src, kind: zip.kind, comment: zip.comment || '', entries: zip.entries, tree: buildTree(zip.entries), folder: '', query: '', anchor: null, back: [], fwd: [] });
    st.sel.clear();
    $('#search').value = '';
    setTitle(name);
    if (path) { st.recent = [path].concat(st.recent.filter((x) => x !== path)).slice(0, 10); saveState(); }
    render();
    return true;
  }
  async function fail(title, message) {
    await OS.dialog.alert({ title, message, kind: 'error' });
    return false;
  }
  async function pickArchive() {
    const path = await OS.dialog.open({ title: 'Open an archive', accept: ACCEPT, startIn: st.path ? U.dirname(st.path) : '/Downloads' });
    if (path) openPath(path);
  }

  // ------------------------------------------------------------------ drawing
  function rowsHere() {
    const q = st.query.toLowerCase();
    let items;
    if (q) {
      // search: every file and folder in the archive whose name matches
      items = [];
      (function find(node) {
        for (const d of node.dirs.values()) { if (d.name.toLowerCase().includes(q)) items.push({ kind: 'dir', node: d }); find(d); }
        for (const f of node.files) if (baseName(f.path).toLowerCase().includes(q)) items.push({ kind: 'file', entry: f });
      })(st.tree);
    } else {
      const node = nodeAt(st.folder);
      items = [...node.dirs.values()].map((d) => ({ kind: 'dir', node: d })).concat(node.files.map((f) => ({ kind: 'file', entry: f })));
    }
    const { key, asc } = st.sort;
    const val = (it) => {
      const o = it.kind === 'dir' ? it.node : it.entry;
      if (key === 'name') return baseName(o.path).toLowerCase();
      if (key === 'type') return it.kind === 'dir' ? '' : fileExt(o.path);
      return o[key] || 0;
    };
    items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      const x = val(a), y = val(b);
      const c = typeof x === 'string' ? x.localeCompare(y, undefined, { numeric: true }) : x - y;
      return asc ? c : -c;
    });
    return items;
  }
  const pathOf = (it) => (it.kind === 'dir' ? 'd:' + it.node.path : 'f:' + it.entry.path);

  const typeOf = (n) => { const x = fileExt(n); return x ? x.toUpperCase() + ' file' : 'File'; };
  const objects = (n) => n.toLocaleString() + (n === 1 ? ' object' : ' objects');

  function render() {
    const open = !!st.tree;
    $('#path').hidden = !open;
    $('#status').hidden = !open;
    $('[data-act="extract"]').disabled = !open || st.busy;
    $('[data-act="add"]').disabled = !open || st.busy || !st.path || st.kind === 'gz' || st.kind === 'lib';
    $('[data-act="find"]').disabled = !open;
    setMenus();
    if (!open) {
      setTitle('Archives'); // nothing open: the window is just the app
      $('#findBar').hidden = true;
      $('#main').innerHTML = '<div class="arc-empty">' + OS.fileTile({ name: 'a.zip', type: 'file' }, 64) +
        '<h2>No archive open</h2><p>Open an archive (ZIP, TAR, GZIP, 7z or RAR) to see what’s inside, or drop one on this window.</p>'  + '</div>';
      return;
    }
    renderPath();
    const items = rowsHere();
    document.documentElement.classList.toggle('arc-packed', st.packed);
    const head = (k, label, cls) => '<button type="button" class="arc-h ' + (cls || '') + (st.sort.key === k ? ' on' : '') + '" data-sort="' + k + '"><span>' + label + '</span>' +
      (st.sort.key === k ? ico(st.sort.asc ? 'down' : 'up', 12) : '') + '</button>';
    const unsafe = st.entries.filter((e) => !e.path).length;
    const date = (t) => (t ? esc(new Date(t * 1000).toLocaleString([], { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })) : '');
    $('#main').innerHTML = '<div class="arc-list" role="grid" aria-multiselectable="true" aria-label="' + esc(st.name) + '">' +
      '<div class="arc-row arc-head" role="row">' + head('name', 'Name') + head('size', 'Size') + head('type', 'Type') + head('mtime', 'Modified') + (st.packed ? head('packed', 'Packed') : '') + '</div>' +
      '<div class="arc-body" id="rows" tabindex="0">' +
      (items.length ? items.map((it) => {
        const id = pathOf(it);
        const on = st.sel.has(id);
        if (it.kind === 'dir') {
          const d = it.node;
          return '<div class="arc-row' + (on ? ' on' : '') + '" role="row" aria-selected="' + on + '" data-id="' + esc(id) + '" title="' + esc(d.path) + '">' +
            '<span class="arc-name">' + OS.fileTile({ name: d.name, type: 'dir' }, 18) + '<span>' + esc(d.name) + '</span>' + (st.query ? '<small>' + esc(d.path) + '</small>' : '') + '</span>' +
            '<span class="arc-c">' + U.formatSize(d.size) + '</span><span class="arc-c">Folder</span><span class="arc-c">' + date(d.mtime) + '</span>' +
            (st.packed ? '<span class="arc-c">' + (st.kind === 'tgz' ? '' : U.formatSize(d.packed)) + '</span>' : '') + '</div>';
        }
        const f = it.entry;
        const n = baseName(f.path);
        const why = unsup(f) || (f.link ? 'It is a link, which is never extracted.' : '');
        return '<div class="arc-row' + (on ? ' on' : '') + (why ? ' dim' : '') + '" role="row" aria-selected="' + on + '" data-id="' + esc(id) + '" title="' + esc(why || f.path) + '">' +
          '<span class="arc-name">' + OS.fileTile({ name: n, type: 'file' }, 18) + '<span>' + esc(n) + '</span>' + (why ? ico(f.encrypted ? 'arc-lock' : 'arc-warn', 14) : '') + (st.query ? '<small>' + esc(f.path.slice(0, -n.length - 1) || '') + '</small>' : '') + '</span>' +
          '<span class="arc-c">' + U.formatSize(f.size) + '</span><span class="arc-c">' + esc(typeOf(n)) + '</span><span class="arc-c">' + date(f.mtime) + '</span>' +
          (st.packed ? '<span class="arc-c">' + (f.packed == null ? '' : U.formatSize(f.packed)) + '</span>' : '') + '</div>';
      }).join('') : '<div class="arc-none">' + (st.query ? 'Nothing in this archive matches “' + esc(st.query) + '”.' : (st.entries.length ? 'This folder is empty.' : 'This archive is empty.')) + '</div>') +
      '</div></div>';
    renderStatus(items, unsafe);
  }
  /** The location bar: Back, Forward, Up and Home, then the folder inside the archive as a path you can type. */
  function renderPath() {
    const btn = (act, glyph, label, off) => '<button type="button" class="arc-tb' + (label ? '' : ' arc-icon') + '" data-act="' + act + '"' + (off ? ' disabled' : '') + ' title="' + esc(TITLES[act]) + '" aria-label="' + esc(TITLES[act]) + '">' + ico(glyph, 16) + (label ? '<span>' + label + '</span>' : '') + '</button>';
    $('#path').innerHTML = btn('back', 'back', 'Back', !st.back.length) + btn('fwd', 'forward', '', !st.fwd.length) +
      '<span class="arc-sep" aria-hidden="true"></span>' + btn('up', 'up', '', !st.folder || !!st.query) + btn('home', 'arc-home', '', !st.folder && !st.query) +
      '<span class="arc-sep" aria-hidden="true"></span><label class="arc-locl" for="locIn">Location:</label>' +
      '<span class="arc-locbox">' + OS.fileTile({ name: 'x', type: 'dir' }, 16) +
      '<input class="arc-locin" id="locIn" spellcheck="false" autocomplete="off" value="' + esc(st.query ? 'Find: ' + st.query : '/' + (st.folder ? st.folder + '/' : '')) + '"' + (st.query ? ' readonly' : '') + '></span>';
  }
  const TITLES = { back: 'Back (Alt+Left)', fwd: 'Forward (Alt+Right)', up: 'Up one level (Alt+Up)', home: 'The top of the archive (Alt+Home)' };
  function renderStatus(items, unsafe) {
    const picked = selection();
    const text = st.sel.size
      ? objects(st.sel.size) + ' selected (' + U.formatSize(picked.size) + ')'
      : objects(items.length) + ' (' + U.formatSize(items.reduce((a, it) => a + (it.kind === 'dir' ? it.node.size : it.entry.size), 0)) + ')';
    $('#status').innerHTML = '<span>' + esc(text) + '</span>' +
      (unsafe ? '<span class="arc-warnline">' + ico('arc-warn', 14) + unsafe + (unsafe === 1 ? ' unsafe item' : ' unsafe items') + ' will be left out</span>' : '') +
      '<span class="spacer"></span><span>' + esc(U.formatSize(st.tree.size) + ' unpacked · ' + U.formatSize(st.src.size) + ' archive') + '</span>';
  }
  /** The picked rows as file entries and folder paths, plus their size. */
  function selection() {
    const files = [];
    const dirs = [];
    for (const id of st.sel) {
      if (id.startsWith('d:')) walk(nodeAt(id.slice(2)), files, dirs);
      else { const e = st.entries.find((x) => x.path === id.slice(2)); if (e) files.push(e); }
    }
    return { files, dirs, size: files.reduce((a, f) => a + f.size, 0) };
  }

  // ------------------------------------------------------------------ menus (the top bar)
  function setMenus() {
    const open = !!st.tree;
    const sortItem = (k, label) => ({ label, checked: st.sort.key === k, disabled: !open, action: () => { st.sort = { key: k, asc: k === 'name' || k === 'type' }; render(); } });
    menuDefs = ([
      { label: 'Archive', items: [
        { label: 'New…', icon: 'plus', key: 'Ctrl+N', action: newArchive },
        { label: 'Open…', icon: 'open', key: 'Ctrl+O', action: pickArchive },
        { label: 'Open recent', icon: 'clock', disabled: !st.recent.length, action: () => recentMenu() },
        'sep',
        { label: 'Extract…', icon: 'download', key: 'Ctrl+E', disabled: !open, action: extractCmd },
        { label: 'Extract all…', disabled: !open, action: () => extractAll() },
        { label: 'Test archive', disabled: !open, action: testArchive },
        { label: 'Comment…', disabled: !open || st.kind !== 'zip', action: editComment },
        'sep',
        { label: 'Close', icon: 'x', key: 'Ctrl+W', action: () => OS.win.close() },
      ] },
      { label: 'Edit', items: [
        { label: 'Select all', key: 'Ctrl+A', disabled: !open, action: () => { rowsHere().map(pathOf).forEach((x) => st.sel.add(x)); showSel(); } },
        { label: 'Deselect all', key: 'Shift+Ctrl+A', disabled: !open, action: () => { st.sel.clear(); showSel(); } },
        'sep',
        { label: 'Add files…', icon: 'plus', disabled: !open || !st.path, action: () => addFromDialog(false) },
        { label: 'Add a folder…', icon: 'folder', disabled: !open || !st.path, action: () => addFromDialog(true) },
        { label: 'Delete from archive', icon: 'trash', key: 'Del', disabled: !open || !st.path || !st.sel.size, action: deleteSelected },
        'sep',
        { label: 'Find…', icon: 'search', key: 'Ctrl+F', disabled: !open, action: () => showFind(true) },
      ] },
      { label: 'View', items: [
        { label: 'Packed size', checked: st.packed, disabled: !open, action: () => { st.packed = !st.packed; saveState(); render(); } },
        'sep', sortItem('name', 'Sort by name'), sortItem('size', 'Sort by size'), sortItem('type', 'Sort by type'), sortItem('mtime', 'Sort by date modified'),
      ] },
    ]);
    if (OS.win.setMenus) OS.win.setMenus(menuDefs);
    renderMenubar();
  }
  // the shell shows an app's menus in its top bar; without one (the classic taskbar, or the top bar turned off) they
  // sit in Archives' own title bar, after the window's name; in a narrow window, one menu button holds them all
  let menuDefs = [];
  const shellShowsMenus = () => { const s = OS.settings || {}; return s.taskbar !== 'classic' && s.topbar !== false; };
  const NARROW = 700;
  function renderMenubar() {
    const bar = $('#menubar');
    if (!bar) return;
    bar.hidden = shellShowsMenus();
    document.body.classList.toggle('arc-menus-in', !bar.hidden);
    showName();
    if (bar.hidden) return;
    bar.innerHTML = window.innerWidth <= NARROW
      ? '<button type="button" class="arc-mb arc-mb-more" data-menu="all" aria-haspopup="menu" title="Menus" aria-label="Menus">' + ico('more', 16) + '</button>'
      : menuDefs.map((m, i) => '<button type="button" class="arc-mb" data-menu="' + i + '" aria-haspopup="menu">' + esc(m.label) + '</button>').join('');
  }
  $('#menubar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    const r = b.getBoundingClientRect();
    b.classList.add('open');
    const items = b.dataset.menu === 'all' ? menuDefs.map((m) => ({ label: m.label, items: m.items })) : menuDefs[+b.dataset.menu].items;
    OS.menu(items, { x: r.left, y: r.bottom + 2 });
    setTimeout(() => b.classList.remove('open'), 150);
  });
  if (OS.onSettings) OS.onSettings(renderMenubar);
  let wasNarrow = window.innerWidth <= NARROW;
  window.addEventListener('resize', () => { const n = window.innerWidth <= NARROW; if (n !== wasNarrow) { wasNarrow = n; renderMenubar(); } });

  // ------------------------------------------------------------------ title bar (chrome: custom)
  const TITLE_MAX = 15;
  /** The window's name: the whole of it to the shell (taskbar, previews), at most 15 characters in the title bar. */
  let fullName = 'Archives';
  function setTitle(name) {
    fullName = name;
    showName();
    OS.win.setTitle(name);
  }
  /** Cut to 15 characters only when the menus follow it; with the dock it has the title bar to itself. */
  function showName() {
    const el = $('#tbName');
    const cut = document.body.classList.contains('arc-menus-in') && fullName.length > TITLE_MAX;
    el.textContent = cut ? fullName.slice(0, TITLE_MAX - 1) + '…' : fullName;
    el.title = cut ? fullName : '';
  }
  (function titleBar() {
    const img = OS.sysIcon ? OS.sysIcon('app.archives') : null;
    if (img) $('#tbIcon').innerHTML = '<img src="' + esc(img) + '" alt="" width="16" height="16" draggable="false">';
    $('#tbControls').style.width = (OS.win.controlsWidth || 0) + 'px';
    OS.win.dragRegion($('#titlebar'), (t) => !t.closest('button, input'));
  })();
  function recentMenu(at) {
    const items = st.recent.length
      ? st.recent.map((p) => ({ label: baseName(p), sub: U.dirname(p), icon: 'archive', action: () => openPath(p) }))
      : [{ label: 'No recent archives', disabled: true }];
    const r = (at || $('[data-act="recent"]')).getBoundingClientRect();
    OS.menu(items, { x: r.left - 70, y: r.bottom + 2 });
  }
  function showFind(on) {
    const bar = $('#findBar');
    bar.hidden = !on;
    $('[data-act="find"]').setAttribute('aria-pressed', String(on));
    if (on) { $('#search').focus(); $('#search').select(); }
    else if (st.query) { st.query = ''; $('#search').value = ''; render(); }
  }
  /** Extract: the selection when there is one, otherwise everything. */
  function extractCmd() { if (st.sel.size) extractSelected(); else extractAll(); }

  // ------------------------------------------------------------------ busy state
  function setBusy(text) {
    st.busy = !!text;
    document.body.classList.toggle('arc-busy', st.busy);
    if (text && !st.tree) $('#main').innerHTML = '<div class="arc-empty"><p>' + esc(text) + '</p></div>';
  }

  // ------------------------------------------------------------------ list interaction
  $('#app').addEventListener('click', (e) => {
    const t = e.target;
    const act = t.closest('[data-act]');
    if (act && !act.disabled) {
      const a = act.dataset.act;
      if (a === 'open') pickArchive();
      else if (a === 'new') newArchive();
      else if (a === 'add') addMenu(act);
      else if (a === 'recent') recentMenu(act);
      else if (a === 'extract') extractCmd();
      else if (a === 'find') showFind($('#findBar').hidden);
      else if (a === 'up') goUp();
      else if (a === 'home') go('');
      else if (a === 'back') history(-1);
      else if (a === 'fwd') history(1);
      return;
    }
    const sort = t.closest('[data-sort]');
    if (sort) {
      const k = sort.dataset.sort;
      st.sort = { key: k, asc: st.sort.key === k ? !st.sort.asc : k === 'name' || k === 'type' };
      render();
      return;
    }
    const crumb = t.closest('[data-folder]');
    if (crumb) { go(crumb.dataset.folder); return; }
    const row = t.closest('.arc-row[data-id]');
    if (row) { pick(row.dataset.id, e); return; }
    if (t.closest('#rows') && !e.ctrlKey && !e.shiftKey) { st.sel.clear(); showSel(); }
  });
  $('#app').addEventListener('dblclick', (e) => {
    const row = e.target.closest('.arc-row[data-id]');
    if (row) activate(row.dataset.id);
  });
  $('#app').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.arc-row[data-id]');
    if (!row || !st.tree) return;
    e.preventDefault();
    if (!st.sel.has(row.dataset.id)) { st.sel.clear(); st.sel.add(row.dataset.id); st.anchor = row.dataset.id; showSel(); }
    const one = st.sel.size === 1 ? [...st.sel][0] : null;
    OS.menu([
      ...(one ? [{ label: 'Open', icon: 'open', key: 'Enter', action: () => activate(one) }, 'sep'] : []),
      { label: 'Extract…', icon: 'download', action: extractSelected },
      ...(st.path && st.kind !== 'lib' && st.kind !== 'gz' ? ['sep', { label: 'Delete from archive', icon: 'trash', danger: true, action: deleteSelected }] : []),
    ], { x: e.clientX, y: e.clientY });
  });
  function pick(id, e) {
    const ids = rowsHere().map(pathOf);
    if (e.shiftKey && st.anchor && ids.includes(st.anchor)) {
      const a = ids.indexOf(st.anchor), b = ids.indexOf(id);
      if (!e.ctrlKey) st.sel.clear();
      ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => st.sel.add(x));
    } else if (e.ctrlKey || e.metaKey) {
      if (st.sel.has(id)) st.sel.delete(id); else st.sel.add(id);
      st.anchor = id;
    } else {
      st.sel.clear(); st.sel.add(id); st.anchor = id;
    }
    showSel();
  }
  /** The selection shown without redrawing the rows (a redraw between the two clicks of a double-click loses it). */
  function showSel() {
    document.querySelectorAll('#rows .arc-row[data-id]').forEach((r) => {
      const on = st.sel.has(r.dataset.id);
      r.classList.toggle('cur', r.dataset.id === st.anchor);
      r.classList.toggle('on', on);
      r.setAttribute('aria-selected', String(on));
    });
    renderStatus(rowsHere(), st.entries.filter((e) => !e.path).length);
  }
  /** Opens a folder of the archive; history: false when moving through Back and Forward. */
  function go(folder, keepHistory) {
    if (!keepHistory && folder !== st.folder) { st.back.push(st.folder); st.fwd = []; }
    st.folder = folder;
    st.query = '';
    $('#search').value = '';
    st.sel.clear();
    st.anchor = null;
    render();
  }
  function goUp() {
    if (!st.folder) return;
    const cut = st.folder.lastIndexOf('/');
    const from = 'd:' + st.folder;
    go(cut < 0 ? '' : st.folder.slice(0, cut));
    st.sel.add(from);
    st.anchor = from;
    render();
  }
  function history(dir) {
    const from = dir < 0 ? st.back : st.fwd;
    const to = dir < 0 ? st.fwd : st.back;
    if (!from.length) return;
    to.push(st.folder);
    go(from.pop(), true);
  }
  // the location: type a folder of the archive and press Enter
  $('#app').addEventListener('keydown', (e) => {
    if (e.target.id !== 'locIn' || e.key !== 'Enter' || st.query) return;
    e.preventDefault();
    const want = e.target.value.replace(/^\/+|\/+$/g, '');
    const node = want ? nodeAt(want) : st.tree;
    if (want && node === st.tree) { e.target.value = '/' + (st.folder ? st.folder + '/' : ''); e.target.select(); OS.notify('There is no folder “' + want + '” in this archive.', { title: st.name }); return; }
    go(want);
  });
  function activate(id) {
    if (id.startsWith('d:')) { go(id.slice(2)); return; }
    const e = st.entries.find((x) => x.path === id.slice(2));
    if (e) openInside(e);
  }
  $('#search').addEventListener('input', (e) => { st.query = e.target.value.trim(); st.sel.clear(); render(); });
  document.addEventListener('keydown', (e) => {
    if (!st.tree || document.querySelector('dialog[open]')) return;
    const typing = e.target.matches && e.target.matches('input, textarea');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); pickArchive(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); showFind(true); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); extractCmd(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newArchive(); return; }
    if (e.key === 'Delete' && !typing && st.sel.size && st.path) { e.preventDefault(); deleteSelected(); return; }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); history(-1); return; }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); history(1); return; }
    if (e.altKey && e.key === 'Home') { e.preventDefault(); go(''); return; }
    if (typing) { if (e.key === 'Escape' && e.target.id === 'search') { showFind(false); } return; }
    const ids = rowsHere().map(pathOf);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); ids.forEach((x) => st.sel.add(x)); showSel(); return; }
    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) { e.preventDefault(); goUp(); return; }
    if (e.key === 'Enter' && st.sel.size === 1) { e.preventDefault(); activate([...st.sel][0]); return; }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      // the row menu, at the current row
      e.preventDefault();
      const id = st.anchor || ids[0];
      const el = id && document.querySelector('.arc-row[data-id="' + CSS.escape(id) + '"]');
      if (!el) return;
      if (!st.sel.has(id)) { st.sel.clear(); st.sel.add(id); st.anchor = id; showSel(); }
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.bottom }));
      return;
    }
    const page = Math.max(1, Math.floor(($('#rows') ? $('#rows').clientHeight : 280) / 28) - 1);
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, Home: -Infinity, End: Infinity }[e.key];
    if (step != null && !e.altKey) {
      e.preventDefault();
      if (!ids.length) return;
      const cur = st.anchor ? ids.indexOf(st.anchor) : -1;
      const at = step === -Infinity ? 0 : step === Infinity ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, cur + step));
      moveTo(ids[at], e.shiftKey);
      return;
    }
    // typing a name's first letters jumps to it
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      typed.text = Date.now() - typed.at > 900 ? e.key.toLowerCase() : typed.text + e.key.toLowerCase();
      typed.at = Date.now();
      const cur = st.anchor ? ids.indexOf(st.anchor) : -1;
      const order = ids.slice(cur + (typed.text.length === 1 ? 1 : 0)).concat(ids.slice(0, cur + (typed.text.length === 1 ? 1 : 0)));
      const hit = order.find((id) => baseName(id.slice(2)).toLowerCase().startsWith(typed.text));
      if (hit) moveTo(hit, false);
    }
  });
  const typed = { text: '', at: 0 };
  /** Moves the current row (with Shift, the selection grows to it) and keeps it in view. */
  function moveTo(id, extend) {
    pick(id, { shiftKey: extend, ctrlKey: false });
    const el = document.querySelector('.arc-row[data-id="' + CSS.escape(id) + '"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  // ------------------------------------------------------------------ the safety checks before writing
  /**
   * Checks what would be extracted against the admin's limits and the drive's free space, using what the archive
   * declares. -> { ok: true, files } or shows why not and resolves { ok: false }. Unsafe names are left out (and
   * said), links are left out; files that can't be unpacked here (password, other methods) are asked about.
   */
  async function precheck(files, dest) {
    const usable = files.filter((f) => f.path && !f.link);
    const blocked = usable.filter((f) => unsup(f));
    let list = usable.filter((f) => !unsup(f));
    if (blocked.length) {
      const go = await OS.dialog.confirm({
        kind: 'warning',
        title: blocked.length === 1 ? 'One file can’t be extracted' : blocked.length + ' files can’t be extracted',
        message: (blocked.length === 1 ? '“' + baseName(blocked[0].path) + '”: ' + unsup(blocked[0]) : 'They are password-protected or in a format that isn’t supported yet.') +
          (list.length ? ' Extract the rest?' : ''),
        okLabel: list.length ? 'Extract the rest' : 'OK',
      });
      if (!go || !list.length) return { ok: false };
    }
    if (!list.length) { await fail('Nothing to extract', 'There are no files here that can be extracted.'); return { ok: false }; }
    const total = list.reduce((a, f) => a + f.size, 0);
    // this account's limits: the admin's, but never more than a third of the free space on its drive, worked out now
    // (a USB drive has no quota: the admin's limits alone)
    const lim = { total: LIMITS.total, file: LIMITS.file, third: false };
    let free = null;
    if (!OS.fs.isUsb(dest)) {
      try { const u = await OS.fs.usage(); if (u && u.quota) free = Math.max(0, u.quota - u.used); } catch (ex) { /* the server still checks its quota on each upload */ }
      if (free != null && Math.floor(free / 3) < lim.total) { lim.total = Math.floor(free / 3); lim.third = true; }
      lim.file = Math.min(lim.file, lim.total);
    }
    if (total > lim.total) {
      await fail('Too much to extract', 'These files take ' + U.formatSize(total) + ' when extracted. The limit is ' + U.formatSize(lim.total) + '.');
      return { ok: false };
    }
    const big = list.find((f) => f.size > lim.file);
    if (big) {
      await fail('File too large', '“' + baseName(big.path) + '” is ' + U.formatSize(big.size) + '. The limit is ' + U.formatSize(lim.file) + '.');
      return { ok: false };
    }
    const bomb = st.kind === 'zip' ? list.find((f) => f.size > MB && f.size / Math.max(1, f.packed) > LIMITS.ratio)
      : st.kind === 'lib' && total > MB && total / Math.max(1, st.src.size) > LIMITS.ratio ? list[0] : null;
    if (bomb) {
      await fail('Possible zip bomb', '“' + baseName(bomb.path) + '” would grow ' + Math.round(bomb.size / Math.max(1, bomb.packed)).toLocaleString() + ' times. The limit is ' + LIMITS.ratio + '. Nothing was extracted.');
      return { ok: false };
    }
    return { ok: true, files: list, total, lim };
  }

  // ------------------------------------------------------------------ extracting
  /**
   * Extracts files (entries) and folders (archive paths) under dest, each written at its path with `strip` cut off
   * the front. Each file is fully decompressed and checked in this page before it is uploaded, so nothing that passes
   * a limit, or fails its checksum, ever reaches the drive.
   */
  async function extract(files, dirs, dest, strip, create) {
    const check = await precheck(files, create ? U.dirname(dest) : dest);
    if (!check.ok) return false;
    const rel = (p) => (strip && p.startsWith(strip + '/') ? p.slice(strip.length + 1) : p);
    const join = (dir, name) => (OS.fs.isUsb(dir) ? dir.replace(/\/$/, '') + '/' + name : (dir === '/' ? '' : dir) + '/' + name);
    const pathFor = (relDir) => relDir.split('/').filter(Boolean).reduce(join, dest);
    const ctl = new AbortController();
    const prog = progressDialog(ctl);
    let done = 0, written = 0, skipped = 0;
    let rule = null; // the conflict choice kept for the rest
    const listed = new Map(); // folder -> Set of lower-cased names already there
    const made = new Set();
    let destMade = !create;
    const namesIn = async (dir) => {
      if (!listed.has(dir)) {
        let names = [];
        try { names = (await OS.fs.list(dir)).map((x) => x.name.toLowerCase()); } catch (ex) { names = []; }
        listed.set(dir, new Set(names));
      }
      return listed.get(dir);
    };
    // folders are made only when a file that passed its checks is about to go in (or, for empty ones, at the end),
    // so an extraction stopped by a limit leaves nothing behind, not even its folder
    const mkdirs = async (relDir) => {
      if (!destMade) { await OS.fs.mkdir(dest); destMade = true; listed.set(dest, new Set()); }
      let at = dest;
      for (const part of relDir.split('/').filter(Boolean)) {
        const next = join(at, part);
        if (!made.has(next)) {
          const names = await namesIn(at);
          if (!names.has(part.toLowerCase())) {
            await OS.fs.mkdir(next);
            names.add(part.toLowerCase());
            listed.set(next, new Set());
          }
          made.add(next);
        }
        at = next;
      }
      return at;
    };
    const uniqueName = (names, name) => {
      const dot = name.lastIndexOf('.');
      const b = dot > 0 ? name.slice(0, dot) : name;
      const x = dot > 0 ? name.slice(dot) : '';
      for (let i = 2; ; i++) { const c = b + ' (' + i + ')' + x; if (!names.has(c.toLowerCase())) return c; }
    };
    // a write that fails because the destination went away (moved, renamed, deleted) says so
    const writeStep = async (fn) => {
      try { return await fn(); } catch (ex) {
        let gone = false;
        try { await OS.fs.stat(dest); } catch (x) { gone = true; }
        if (gone) throw new Error('The folder “' + baseName(dest) + '” was moved or deleted.');
        throw ex;
      }
    };
    try {
      // each file as the engine reaches it (a .tar.gz can only be read in order)
      await unpack(check.files, {
        maxBytes: () => Math.min(check.lim.file, check.lim.total - written), signal: ctl.signal,
        onBytes: (n) => { written += n; prog.bytes(written, check.total); },
      }, async (f, read) => {
        if (ctl.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const r = rel(f.path);
        const cut = r.lastIndexOf('/');
        const relDir = cut < 0 ? '' : r.slice(0, cut);
        const dir = pathFor(relDir);
        let name = r.slice(cut + 1);
        prog.file(name, done, check.files.length);
        const names = destMade ? await namesIn(dir) : new Set();
        let replace = false;
        if (names.has(name.toLowerCase())) {
          const choice = rule || await askConflict(name, dir);
          if (!choice) { ctl.abort(); throw new DOMException('Cancelled', 'AbortError'); }
          if (choice.all) rule = choice;
          if (choice.do === 'skip') { skipped++; done++; return; }
          if (choice.do === 'both') name = uniqueName(names, name);
          else replace = true;
        }
        // decompress and check in this page first; only a file that passed everything is sent to the drive
        const blob = await read();
        if (ctl.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        await writeStep(async () => {
          await mkdirs(relDir);
          const target = join(dir, name);
          if (replace && !OS.fs.isUsb(target)) await OS.fs.remove([target]); // the old file goes to Trash
          await OS.fs.upload(dir, [new File([blob], name, { lastModified: (f.mtime || Date.now() / 1000) * 1000 })]);
        });
        (listed.get(dir) || new Set()).add(name.toLowerCase());
        done++;
      });
      // empty folders from the archive, last
      if (!ctl.signal.aborted && (done > skipped || !check.files.length)) for (const d of dirs) { const r = rel(d); if (r) await writeStep(() => mkdirs(r)); }
    } catch (ex) {
      prog.close();
      if (ex && ex.name === 'AbortError') return report(done, check.files.length, skipped, dest, true);
      const limit = ex instanceof Z.LimitError;
      const n = done - skipped;
      await fail('Couldn’t extract the files', ex.message + (n ? ' ' + n.toLocaleString() + ' of ' + check.files.length.toLocaleString() + ' files were extracted.' : ' Nothing was extracted.'));
      return false;
    }
    prog.close();
    return report(done, check.files.length, skipped, dest, ctl.signal.aborted);
  }
  function report(done, of, skipped, dest, stopped) {
    if (stopped && done - skipped <= 0) return false; // cancelled before anything was written: nothing to say
    const unsafe = st.entries.filter((e) => !e.dir && (!e.path || e.link)).length;
    const where = OS.fs.isUsb(dest) ? dest : (dest === '/' ? 'My drive' : baseName(dest));
    const n = (done - skipped).toLocaleString();
    OS.notify((stopped ? 'Stopped after ' + n + ' of ' + of.toLocaleString() + ' files.' : n + (done - skipped === 1 ? ' file was' : ' files were') + ' extracted to ' + where + '.') + (skipped ? ' ' + skipped + ' skipped.' : '') + (unsafe ? ' ' + unsafe + (unsafe === 1 ? ' unsafe item was' : ' unsafe items were') + ' left out.' : ''), {
      type: stopped ? 'info' : 'success', title: stopped ? 'Extraction cancelled' : 'Extraction complete',
      actions: [{ label: 'Show in Files', action: () => OS.open('files', { path: dest }) }],
    });
    return !stopped;
  }

  /** Extract all: the archive's contents into a folder named after it (or straight in, when everything is already in one folder). */
  async function extractAll(destParent) {
    if (!st.tree) return false;
    const parent = destParent || await OS.dialog.folder({ title: 'Extract “' + st.name + '” to', startIn: st.path ? U.dirname(st.path) : '/Documents' });
    if (!parent) return false;
    const files = [];
    const dirs = [];
    walk(st.tree, files, dirs);
    // straight in when everything is already in one folder, or for a single .gz (one file, as gunzip leaves it)
    const oneFolder = st.kind === 'gz' || (st.tree.dirs.size === 1 && !st.tree.files.length);
    let dest = parent;
    if (!oneFolder) {
      const base = stemOf(st.name) || 'Archive';
      let names = [];
      try { names = (await OS.fs.list(parent)).map((x) => x.name.toLowerCase()); } catch (ex) { names = []; }
      let name = base;
      for (let i = 2; names.includes(name.toLowerCase()); i++) name = base + ' (' + i + ')';
      dest = (OS.fs.isUsb(parent) ? parent.replace(/\/$/, '') : (parent === '/' ? '' : parent)) + '/' + name;
    }
    return extract(files, dirs.filter(Boolean), dest, '', !oneFolder);
  }
  /** Extract selected: the picked files and folders, as they sit in the current folder, into a folder chosen. */
  async function extractSelected() {
    if (!st.sel.size) return;
    const dest = await OS.dialog.folder({ title: 'Extract to', startIn: st.path ? U.dirname(st.path) : '/Documents' });
    if (!dest) return;
    const { files, dirs } = selection();
    await extract(files, dirs, dest, st.query ? '' : st.folder);
  }

  /** A file opened from inside the archive: checked like any extraction, copied to /.apps/archives/open, then opened. */
  async function openInside(entry) {
    const why = unsup(entry) || (entry.link ? 'It is a link.' : '');
    if (why) { await fail('“' + baseName(entry.path) + '” can’t be opened', why); return; }
    const check = await precheck([entry], OPEN_DIR);
    if (!check.ok) return;
    const dir = OPEN_DIR + '/' + (st.name.replace(/[^\w .()-]+/g, '_') || 'archive');
    const ctl = new AbortController();
    const prog = entry.size > 4 * MB ? progressDialog(ctl) : null;
    try {
      if (prog) prog.file(baseName(entry.path), 0, 1);
      let w = 0;
      let blob = null;
      await unpack([entry], { maxBytes: () => check.lim.file, signal: ctl.signal, onBytes: (n) => { w += n; if (prog) prog.bytes(w, entry.size); } }, async (e, read) => { blob = await read(); });
      for (const p of ['/.apps', '/.apps/archives', OPEN_DIR, dir]) { try { await OS.fs.mkdir(p); } catch (ex) { /* already there */ } }
      const target = dir + '/' + baseName(entry.path);
      await OS.fs.writeBase64(target, await (U.toBase64 || blobToB64)(blob));
      if (prog) prog.close();
      OS.openFile(target);
    } catch (ex) {
      if (prog) prog.close();
      if (ex && ex.name === 'AbortError') return;
      await fail('“' + baseName(entry.path) + '” couldn’t be opened', ex.message);
    }
  }

  // ------------------------------------------------------------------ changing an archive
  // A ZIP can't be changed in place, so a change builds the archive again: what stays is copied still compressed
  // (never unpacked), new files are compressed here. The new archive is uploaded beside the old one first, and only
  // then takes its place, so a failure part-way leaves the original as it was.
  const join = (dir, name) => (OS.fs.isUsb(dir) ? dir.replace(/\/$/, '') + '/' + name : (dir === '/' ? '' : dir) + '/' + name);

  /** Files and folders on the drive as items for the archive, under `base` (a folder of the archive, "" or "a/b/"). */
  async function gatherDrive(paths, base) {
    const items = [];
    const walkDir = async (path, name) => {
      items.push({ name: name + '/', mtime: 0 });
      for (const e of await OS.fs.list(path)) {
        if (e.path === st.path) continue; // the archive itself, inside a folder being added
        if (e.type === 'dir') await walkDir(e.path, name + '/' + e.name);
        else items.push({ name: name + '/' + e.name, read: () => OS.fs.readBlob(e.path), mtime: e.mtime, size: e.size || 0 });
      }
    };
    for (const p of paths) {
      const e = await OS.fs.stat(p);
      if (e.type === 'dir') await walkDir(p, base + e.name);
      else items.push({ name: base + e.name, read: () => OS.fs.readBlob(p), mtime: e.mtime, size: e.size || 0 });
    }
    return items;
  }
  const baseHere = () => (st.folder ? st.folder + '/' : '');

  function addMenu(btn) {
    const r = btn.getBoundingClientRect();
    OS.menu([
      { label: 'Files…', icon: 'file', action: () => addFromDialog(false) },
      { label: 'A folder…', icon: 'folder', action: () => addFromDialog(true) },
    ], { x: r.left, y: r.bottom + 2 });
  }
  async function addFromDialog(folder) {
    const start = st.path ? U.dirname(st.path) : '/Documents';
    const path = folder ? await OS.dialog.folder({ title: 'Add a folder to “' + st.name + '”', startIn: start })
      : await OS.dialog.open({ title: 'Add a file to “' + st.name + '”', startIn: start });
    if (path) addPaths([path]);
  }
  async function addPaths(paths) {
    if (paths.includes(st.path)) { await fail('Can’t add the archive to itself', '“' + st.name + '” is the archive that is open.'); paths = paths.filter((p) => p !== st.path); if (!paths.length) return; }
    let items;
    try { items = await gatherDrive(paths, baseHere()); } catch (ex) { await fail('Couldn’t add the files', ex.message); return; }
    await addItems(items);
  }
  async function addFiles(files) {
    await addItems(files.map((f) => ({ name: baseHere() + f.name, blob: f, mtime: Math.round(f.lastModified / 1000), size: f.size })));
  }
  /** New items into the archive: a name already there asks Replace, Keep both or Skip. */
  async function addItems(items) {
    if (!st.path) { await fail('Can’t change this archive', 'It isn’t on your drive. Open it from your drive to change it.'); return; }
    if (st.kind === 'gz') { await fail('Can’t add files to a .gz file', 'A .gz file holds one file. Make a .tar.gz or a ZIP instead.'); return; }
    if (st.kind === 'lib') { await fail('Can’t change this archive', 'Archives can only read this kind of archive.'); return; }
    const existing = new Map(st.entries.filter((e) => e.path && !e.dir).map((e) => [e.path.toLowerCase(), e]));
    const names = new Set(st.entries.map((e) => (e.path || e.name).replace(/\/$/, '').toLowerCase()));
    const replaced = new Set();
    const add = [];
    let rule = null;
    for (const it of items) {
      if (it.name.endsWith('/')) { if (!names.has(it.name.slice(0, -1).toLowerCase())) { add.push(it); names.add(it.name.slice(0, -1).toLowerCase()); } continue; }
      const old = existing.get(it.name.toLowerCase());
      if (old) {
        const cut = it.name.lastIndexOf('/');
        const choice = rule || await askConflict(it.name.slice(cut + 1), null, cut < 0 ? st.name : it.name.slice(0, cut), 'Replacing takes the old one out of the archive.');
        if (!choice) return;
        if (choice.all) rule = choice;
        if (choice.do === 'skip') continue;
        if (choice.do === 'replace') replaced.add(old);
        else {
          const dot = it.name.lastIndexOf('.');
          const stem = dot > cut + 1 ? it.name.slice(0, dot) : it.name;
          const ext = dot > cut + 1 ? it.name.slice(dot) : '';
          let i = 2;
          while (names.has((stem + ' (' + i + ')' + ext).toLowerCase())) i++;
          it.name = stem + ' (' + i + ')' + ext;
        }
      }
      names.add(it.name.toLowerCase());
      add.push(it);
    }
    if (!add.length) return;
    const keep = st.entries.filter((e) => !replaced.has(e)).map((e) => ({ name: e.name, entry: e }));
    const n = add.filter((x) => !x.name.endsWith('/')).length;
    await rewrite(keep.concat(add), 'Adding', n === 1 ? '1 file was added to ' + st.name + '.' : n.toLocaleString() + ' files were added to ' + st.name + '.');
  }
  async function deleteSelected() {
    if (!st.sel.size || !st.path || st.kind === 'gz' || st.kind === 'lib') return;
    const { files, dirs } = selection();
    const one = st.sel.size === 1 ? baseName([...st.sel][0].slice(2)) : null;
    const ok = await OS.dialog.confirm({
      title: one ? 'Delete “' + one + '” from the archive?' : 'Delete ' + st.sel.size + ' items from the archive?',
      message: 'This can’t be undone.', okLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    const gone = new Set(files);
    const under = dirs.filter(Boolean);
    const keep = st.entries.filter((e) => {
      if (gone.has(e)) return false;
      const p = (e.path || '').replace(/\/$/, '');
      return !under.some((d) => p === d || p.startsWith(d + '/'));
    }).map((e) => ({ name: e.name, entry: e }));
    await rewrite(keep, 'Deleting', null);
  }
  /** Builds the archive from items, saves it over the old one, and shows it again where it was. */
  async function rewrite(items, verb, said) {
    const ctl = new AbortController();
    const prog = progressDialog(ctl, verb);
    const folder = st.folder;
    try {
      const blob = await buildArchive(items, ctl.signal, prog);
      $('#progFile').textContent = 'Saving…';
      await saveOver(blob);
    } catch (ex) {
      prog.close();
      if (ex && ex.name === 'AbortError') return;
      await fail('Couldn’t change “' + st.name + '”', ex.message + ' The archive wasn’t changed.');
      return;
    }
    prog.close();
    if (await openPath(st.path) && folder && nodeAt(folder) !== st.tree) go(folder, true);
    if (said) OS.notify(said, { type: 'success', title: st.name });
  }
  /** The new archive takes the old one's place: uploaded beside it, then swapped in; the old copy isn't kept. */
  async function saveOver(blob) {
    const dir = U.dirname(st.path);
    const name = st.name;
    if (OS.fs.isUsb(st.path)) { await OS.fs.upload(dir, [new File([blob], name)]); return; } // a USB drive writes over
    const saved = (await OS.fs.upload(dir, [new File([blob], '.' + name + '.saving')]))[0];
    await OS.fs.remove([st.path]);
    await OS.fs.rename(saved.path, name);
    // the replaced archive went to Trash on the way; it was only replaced, so it is deleted for good
    try {
      const old = (await OS.fs.trash.list()).find((x) => x.original === st.path);
      if (old) await OS.fs.trash.purge([old.id]);
    } catch (ex) { /* left in Trash */ }
  }

  /** New: an empty archive saved where chosen, then opened to add files to. */
  async function newArchive() {
    const target = await OS.dialog.save({ title: 'New archive', defaultName: 'Archive.zip', ext: 'zip', types: [{ label: 'ZIP archive', ext: 'zip' }, { label: 'Compressed TAR archive', ext: 'tgz' }], startIn: st.path ? U.dirname(st.path) : '/Documents' });
    if (!target) return;
    const tar = /\.(tgz|tar\.gz)$/i.test(target);
    const name = tar ? baseName(target) : baseName(target).replace(/(\.zip)?$/i, '.zip');
    try {
      const saved = (await OS.fs.upload(U.dirname(target), [new File([tar ? await T.empty(true) : Z.empty()], name)]))[0];
      await openPath(saved.path);
    } catch (ex) { await fail('Couldn’t make the archive', ex.message); }
  }

  /** Files' Compress to ZIP: the files and folders into one archive beside them, named after them. */
  async function compress(paths) {
    if (!paths.length) return false;
    const dir = U.dirname(paths[0]);
    const base = paths.length === 1 ? baseName(paths[0]).replace(/\.[^.\/]+$/, '') || baseName(paths[0]) : (dir === '/' ? 'Archive' : baseName(dir));
    let taken = [];
    try { taken = (await OS.fs.list(dir)).map((x) => x.name.toLowerCase()); } catch (ex) { taken = []; }
    let name = base + '.zip';
    for (let i = 2; taken.includes(name.toLowerCase()); i++) name = base + ' (' + i + ').zip';
    st.name = name;
    const ctl = new AbortController();
    const prog = progressDialog(ctl, 'Compressing');
    try {
      const items = await gatherDrive(paths, '');
      const blob = await Z.build(null, items, { signal: ctl.signal, onItem: (i, n, nm) => prog.step(i, n, nm.replace(/\/$/, '')) });
      $('#progFile').textContent = 'Saving…';
      await OS.fs.upload(dir, [new File([blob], name)]);
    } catch (ex) {
      prog.close();
      st.name = '';
      if (ex && ex.name === 'AbortError') return true;
      await fail('Couldn’t make “' + name + '”', ex.message);
      return false;
    }
    prog.close();
    st.name = '';
    OS.notify('“' + name + '” was made.', { type: 'success', title: 'Compressed', actions: [{ label: 'Show in Files', action: () => OS.open('files', { path: dir, select: join(dir, name) }) }] });
    return true;
  }

  // ------------------------------------------------------------------ the engines
  /**
   * Unpacks file entries through the archive's engine, calling handle(entry, read) for each as it is reached;
   * read() gives its bytes, checked against opts.maxBytes(entry) (and, for ZIP, its compression ratio).
   */
  async function unpack(files, opts, handle) {
    if (st.kind === 'lib') {
      // libarchive unpacks each file in its worker; what it gives back is checked before anything is written
      for (const f of files) {
        await handle(f, async () => {
          const file = await libExtract(f);
          if (file.size > opts.maxBytes(f)) throw new Z.LimitError('“' + baseName(f.path) + '” is too large.');
          if (file.size > f.size) throw new Z.LimitError('“' + baseName(f.path) + '” is larger than the archive says.');
          if (opts.onBytes) opts.onBytes(file.size);
          return file;
        });
      }
      return;
    }
    if (st.kind === 'zip') {
      for (const f of files) {
        await handle(f, () => Z.extract(st.src, f, { maxBytes: opts.maxBytes(f), maxRatio: LIMITS.ratio, signal: opts.signal, onBytes: opts.onBytes }));
      }
      return;
    }
    await T.extractMany(st.kind, st.src, files, opts, handle);
  }
  /** The archive built again from items (what stays: { name, entry }; new: { name, blob | read }). */
  async function buildArchive(items, signal, prog) {
    const onItem = (i, n, name) => prog.step(i, n, name.replace(/\/$/, ''));
    if (st.kind === 'zip') return Z.build(st.src, items, { signal, onItem, comment: st.comment });
    // a TAR's files are copied by their bytes: read in one pass first, then written with the new ones
    const kept = items.filter((x) => x.entry && !x.entry.dir && x.entry.path);
    const bytes = new Map();
    if (kept.length) {
      $('#progFile').textContent = 'Reading the archive…';
      await unpack(kept.map((x) => x.entry), { maxBytes: () => LIMITS.total, signal }, async (e, read) => { bytes.set(e, await read()); });
    }
    const list = items.filter((x) => !x.entry || x.entry.dir || bytes.has(x.entry))
      .map((x) => (x.entry ? { name: x.entry.dir && !x.name.endsWith('/') ? x.name + '/' : x.name, blob: bytes.get(x.entry), mtime: x.entry.mtime } : x));
    return T.build(list, { gzip: st.kind !== 'tar', signal, onItem });
  }

  // ------------------------------------------------------------------ test and comment
  /**
   * Test archive: every file unpacked in this page and checked (its checksum where the format has one, its size),
   * nothing written. The admin's limits still apply, so a zip bomb is stopped here too.
   */
  async function testArchive() {
    if (!st.tree) return;
    const files = st.entries.filter((e) => !e.dir && e.path && !e.link && !unsup(e));
    const skipped = st.entries.filter((e) => !e.dir && e.path && !e.link && unsup(e)).length;
    if (!files.length) { await fail('Nothing to test', 'There are no files here that can be tested.'); return; }
    const ctl = new AbortController();
    const prog = progressDialog(ctl, 'Testing');
    const total = files.reduce((a, f) => a + f.size, 0);
    const bad = [];
    let done = 0, read = 0;
    try {
      await unpack(files, { maxBytes: () => LIMITS.file, signal: ctl.signal, onBytes: (n) => { read += n; prog.bytes(read, total); } }, async (f, get) => {
        prog.file(baseName(f.path), done, files.length);
        try { await get(); } catch (ex) {
          if ((ex && ex.name === 'AbortError') || ex instanceof Z.LimitError) throw ex;
          bad.push(baseName(f.path));
        }
        done++;
      });
    } catch (ex) {
      prog.close();
      if (ex && ex.name === 'AbortError') return;
      await fail('Test stopped', ex.message);
      return;
    }
    prog.close();
    const extra = skipped ? ' ' + skipped + (skipped === 1 ? ' file was' : ' files were') + ' not tested (password-protected).' : '';
    if (!bad.length) {
      await OS.dialog.alert({ kind: 'info', title: 'No errors found', message: 'All ' + done.toLocaleString() + (done === 1 ? ' file' : ' files') + ' in ' + st.name + ' are fine.' + extra });
    } else {
      const list = bad.slice(0, 5).map((n) => '“' + n + '”').join(', ') + (bad.length > 5 ? ' and ' + (bad.length - 5) + ' more' : '');
      await OS.dialog.alert({ kind: 'error', title: bad.length === 1 ? 'One file is damaged' : bad.length + ' files are damaged', message: list + (bad.length === 1 ? ' is' : ' are') + ' damaged.' + (bad.length < done ? ' The other files are fine.' : '') + extra });
    }
  }

  /** The ZIP's comment: shown, and changed when the archive is on the drive. */
  async function editComment() {
    if (st.kind !== 'zip') return;
    const canEdit = !!st.path;
    const box = nativeBox(OS.sysIcon('app.archives'), 'Comment',
      '<h2 class="dlg-title" id="cmTitle">' + esc(st.name) + '</h2>' +
      '<textarea class="input arc-comment" id="cmText" rows="6" spellcheck="true" aria-labelledby="cmTitle"' + (canEdit ? '' : ' readonly') + ' placeholder="' + (canEdit ? 'No comment yet' : 'No comment') + '">' + esc(st.comment) + '</textarea>',
      '<span class="spacer"></span><button type="button" class="btn" data-k="cancel">' + (canEdit ? 'Cancel' : 'Close') + '</button>' +
      (canEdit ? '<button type="button" class="btn is-default" data-k="save">Save</button>' : ''), 'arc-cm');
    box.setAttribute('aria-labelledby', 'cmTitle');
    const text = await new Promise((resolve) => {
      const end = (v) => { box.close(); box.remove(); resolve(v); };
      box.addEventListener('cancel', (e) => { e.preventDefault(); end(null); });
      box.addEventListener('click', (e) => {
        if (e.target.closest('[data-x]') || e.target.closest('[data-k="cancel"]')) end(null);
        else if (e.target.closest('[data-k="save"]')) end($('#cmText', box).value);
      });
      box.showModal();
      $('#cmText', box).focus();
    });
    if (text == null || text === st.comment) return;
    const old = st.comment;
    st.comment = text;
    const keep = st.entries.map((e) => ({ name: e.name, entry: e }));
    await rewrite(keep, 'Saving', 'The comment was saved.');
    if (st.comment !== text) st.comment = old;
  }

  // ------------------------------------------------------------------ libarchive: 7z, RAR, password-protected ZIP (read-only)
  /**
   * Opens an archive with libarchive: the whole file is handed to its worker (so it can't be larger than the most one
   * extraction may write), listed without unpacking, and a password asked for when the archive needs one.
   * -> { kind: 'lib', entries, lib } or null when the password wasn't given.
   */
  async function libOpen(src, name, fmt) {
    if (src.size > LIMITS.total) throw new Z.LimitError('This archive is ' + U.formatSize(src.size) + '. The largest that can be opened is ' + U.formatSize(LIMITS.total) + '.');
    setBusy('Reading ' + name + '…');
    const m = await loadLib();
    const bytes = await src.read(0, src.size);
    const reader = await m.Archive.open(new File([bytes], name));
    const lib = { reader, password: null, name, fmt, close: () => reader.close().catch(() => {}) };
    let list;
    let locked = false;
    try {
      if (fmt === 'zip') {
        // a ZIP's names are never encrypted: listed now, the password asked for when a file is unpacked
        list = await listWithPassword(lib);
      } else {
        // libarchive can't decrypt 7z or RAR: their password-protected files are listed (with a lock) but not unpacked
        locked = (await reader.hasEncryptedData()) === true;
        list = await reader.client.listFiles();
        if (!list.length && src.size > 512) throw new Error('Password-protected 7z and RAR archives aren’t supported yet.');
      }
    } catch (ex) { lib.close(); throw ex; }
    if (!list) { lib.close(); return null; }
    const entries = list.map((e, i) => {
      const name = e.path || e.fileName;
      const dir = e.type === 'DIR' || name.endsWith('/');
      return {
        name, path: Z.safePath(name), dir, link: e.type === 'SYMBOLIC_LINK' || e.type === 'HARD_LINK', encrypted: locked && !dir,
        method: 'lib', size: dir ? 0 : e.size || 0, packed: null, mtime: e.lastModified / 1e9 > 315532800 ? Math.round(e.lastModified / 1e9) : 0, offset: i, // no date (before 1980): none shown
      };
    });
    return { kind: 'lib', entries, lib };
  }
  async function listWithPassword(lib) {
    for (;;) {
      try { return await lib.reader.client.listFiles(); } catch (ex) {
        if (!/pass|encrypt|decrypt/i.test(ex && ex.message)) throw new Error('This archive is damaged, or in a form Archives can’t read.');
        if (!(await askPassword(lib, lib.password != null))) return null;
      }
    }
  }
  /** One file through libarchive; a password is asked for (again) when the archive wants one. */
  async function libExtract(f) {
    for (;;) {
      try {
        const file = await st.lib.reader.extractSingleFile(f.name);
        if (!file || (file.size === 0 && f.size > 0)) throw new Error('passphrase');
        return file;
      } catch (ex) {
        if (st.lib.fmt !== 'zip') throw new Error('“' + baseName(f.path) + '” couldn’t be unpacked. It may be password-protected or damaged.');
        if (!/pass|encrypt|decrypt/i.test(ex && ex.message)) throw new Error('“' + baseName(f.path) + '” couldn’t be unpacked: the archive is damaged.');
        if (window.__arcProg) window.__arcProg.hide(true);
        const ok = await askPassword(st.lib, st.lib.password != null);
        if (window.__arcProg) window.__arcProg.hide(false);
        if (!ok) throw new DOMException('Cancelled', 'AbortError');
      }
    }
  }
  /** The native prompt for the archive's password; again: the last one was wrong. -> true when one was given. */
  async function askPassword(lib, again) {
    const pw = await OS.dialog.prompt({
      title: again ? 'That password isn’t right' : '“' + lib.name + '” is password-protected',
      label: 'Password', type: 'password', okLabel: 'OK',
    });
    if (pw == null || pw === '') return false;
    lib.password = pw;
    await lib.reader.usePassword(pw);
    return true;
  }

  // ------------------------------------------------------------------ dialogs
  /** A dialog drawn like the desktop's message boxes: a title bar (icon, caption, close), the content, a footer of buttons. */
  function nativeBox(icon, caption, main, buttons, cls) {
    const box = document.createElement('dialog');
    box.className = 'dlg msgbox arc-dlg' + (cls ? ' ' + cls : '');
    box.innerHTML = '<div class="msg-head"><img src="' + esc(icon) + '" alt="" width="16" height="16"><span class="msg-cap">' + esc(caption) + '</span>' +
      '<button type="button" class="icon-btn msg-close" data-x aria-label="Close">' + OS.icon('x', 14) + '</button></div>' +
      '<div class="msg-main"><div class="msg-text">' + main + '</div></div><div class="dlg-actions msg-foot">' + buttons + '</div>';
    document.body.appendChild(box);
    return box;
  }
  function progressDialog(ctl, verb) {
    const box = nativeBox(OS.sysIcon('app.archives'), (verb || 'Extracting') + ' ' + (st.name || 'archive'),
      '<div class="arc-prog-file" id="progFile">Getting ready…</div>' +
      '<div class="arc-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Progress"><i id="progBar"></i></div>' +
      '<div class="arc-prog-sub"><span id="progCount"></span><span class="spacer"></span><span id="progBytes"></span></div>',
      '<button type="button" class="btn" data-cancel>Cancel</button>', 'arc-prog');
    box.setAttribute('aria-label', verb || 'Extracting');
    const stop = () => { ctl.abort(); $('[data-cancel]', box).disabled = true; $('#progFile', box).textContent = 'Stopping…'; };
    box.addEventListener('cancel', (e) => { e.preventDefault(); stop(); });
    $('[data-cancel]', box).addEventListener('click', stop);
    $('[data-x]', box).addEventListener('click', stop);
    box.showModal();
    setBusy((verb || 'Extracting') + '…');
    return window.__arcProg = {
      file(name, i, n) { $('#progFile', box).textContent = name; $('#progCount', box).textContent = (i + 1).toLocaleString() + ' of ' + n.toLocaleString(); },
      /** Progress by items, for building an archive. */
      step(i, n, name) {
        $('#progFile', box).textContent = name;
        $('#progCount', box).textContent = (i + 1).toLocaleString() + ' of ' + n.toLocaleString();
        const pct = n ? Math.round((i / n) * 100) : 0;
        $('#progBar', box).style.width = pct + '%';
        $('.arc-meter', box).setAttribute('aria-valuenow', pct);
      },
      /** Out of sight while another question (a file that exists) is asked, as a desktop does. */
      hide(on) { box.style.visibility = on ? 'hidden' : ''; },
      bytes(w, total) {
        const pct = total ? Math.min(100, Math.round((w / total) * 100)) : 0;
        $('#progBar', box).style.width = pct + '%';
        $('.arc-meter', box).setAttribute('aria-valuenow', pct);
        $('#progBytes', box).textContent = U.formatSize(w) + ' of ' + U.formatSize(total);
      },
      close() { box.close(); box.remove(); window.__arcProg = null; setBusy(null); render(); },
    };
  }
  /** A file already exists: Replace, Keep both or Skip, with "Do this for the rest". -> { do, all } | null (cancel). */
  function askConflict(name, dir, whereText, note) {
    return new Promise((resolve) => {
      const where = whereText || (OS.fs.isUsb(dir) ? dir : (dir === '/' ? 'My drive' : baseName(dir)));
      const box = nativeBox(OS.sysIcon('status.warning'), 'Archives',
        '<h2 class="dlg-title" id="cfTitle">“' + esc(name) + '” already exists</h2>' +
        '<p class="dlg-body">A file with this name is already in ' + esc(where) + '. ' + esc(note || 'Replacing moves the old one to Trash.') + '</p>' +
        '<label class="check arc-all"><input type="checkbox" id="cfAll"> Do this for the rest</label>',
        '<button type="button" class="btn" data-k="cancel">Cancel</button><span class="spacer"></span>' +
        '<button type="button" class="btn" data-k="skip">Skip</button><button type="button" class="btn" data-k="both">Keep both</button>' +
        '<button type="button" class="btn is-default" data-k="replace">Replace</button>');
      box.setAttribute('aria-labelledby', 'cfTitle');
      $('[data-x]', box).setAttribute('data-k', 'cancel');
      if (window.__arcProg) window.__arcProg.hide(true);
      const end = (v) => { box.close(); box.remove(); if (window.__arcProg) window.__arcProg.hide(false); resolve(v); };
      box.addEventListener('cancel', (e) => { e.preventDefault(); end(null); });
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-k]');
        if (!b) return;
        end(b.dataset.k === 'cancel' ? null : { do: b.dataset.k, all: $('#cfAll', box).checked });
      });
      box.showModal();
      $('[data-k="replace"]', box).focus();
    });
  }

  // ------------------------------------------------------------------ dropping an archive on the window
  let dragDepth = 0;
  const isFileDrag = (e) => e.dataTransfer && [...e.dataTransfer.types].some((t) => t === 'Files' || t === 'application/x-liteos-paths');
  document.addEventListener('dragenter', (e) => { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('arc-dropping'); });
  document.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('arc-dropping'); } });
  document.addEventListener('drop', async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('arc-dropping');
    const paths = (() => { try { return JSON.parse(e.dataTransfer.getData('application/x-liteos-paths') || '[]'); } catch (x) { return []; } })();
    if (st.tree && st.path) {
      if (paths.length) addPaths(paths);
      else if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
      return;
    }
    if (paths.length === 1 && ARCHIVE.test(paths[0])) { openPath(paths[0]); return; }
    const file = [...e.dataTransfer.files].find((f) => ARCHIVE.test(f.name)) || e.dataTransfer.files[0];
    if (!file) return;
    if (!ARCHIVE.test(file.name)) { fail('Can’t open “' + file.name + '”', 'Only ZIP, TAR, GZIP, 7z and RAR archives are supported.'); return; }
    load(Z.blobSource(file), file.name, null);
  });

  // ------------------------------------------------------------------ start
  const blobToB64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  document.querySelectorAll('[data-ico]').forEach((el) => { el.outerHTML = OS.icon(el.dataset.ico, +(el.dataset.size || 16)); });

  render();
  (async () => {
    await loadState();
    setMenus();
    // a window brought back after a reload reopens its archive (where it is now), but never extracts again
    OS.win.keepState(() => ({ path: st.path, folder: st.folder }));
    const back = OS.win.restored;
    if (back) {
      if (back.path && await openPath(back.path) && back.folder && nodeAt(back.folder) !== st.tree) go(back.folder);
      return;
    }
    const a = OS.args;
    if (a.new) { newArchive(); return; } // the jump list's New archive
    if (a.compress) { const done = await compress(String(a.compress).split('\n').filter(Boolean)); if (done) OS.win.close(); return; }
    if (!a.path) return;
    const ok = await openPath(a.path);
    if (!ok || !a.extract) return;
    // from Files: unpack, then close this window
    const parent = a.extract === 'here' ? U.dirname(a.path) : null;
    const done = await extractAll(parent);
    if (done) OS.win.close();
  })();
});
