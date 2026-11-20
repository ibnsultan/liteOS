/* LiteOS Files — file manager */
LiteOS.ready((OS) => {
  'use strict';
  const { util, fs } = OS;
  const I = (n, s) => OS.icon(n, s || 16);
  // system icons (places, the drive, file types) come from the icon set; the toolbar keeps its glyphs
  const S = (n, s) => OS.sysGlyph(n, s || 16);
  const esc = util.escape;
  const $ = (s) => document.querySelector(s);
  // the generic disk for a drive with no .ico of its own
  const DISK = OS.sysIcon('place.drive');

  const PLACES = [
    ['This device', 'device:', 'device.computer'], ['Recent', 'recent:', 'place.recent'], ['Desktop', '/Desktop', 'place.desktop'], ['Documents', '/Documents', 'place.documents'],
    ['Downloads', '/Downloads', 'place.downloads'], ['Pictures', '/Pictures', 'place.pictures'], ['Music', '/Music', 'place.music'], ['Videos', '/Videos', 'place.videos'],
  ];
  const NEW_TYPES = [
    { label: 'Document', ext: 'ldoc', name: 'Untitled document', app: 'documents' },
    { label: 'Spreadsheet', ext: 'lsheet', name: 'Untitled spreadsheet', app: 'sheets' },
    { label: 'Presentation', ext: 'lslides', name: 'Untitled presentation', app: 'slides' },
    { label: 'Text file', ext: 'txt', name: 'New text file', app: 'code' },
  ];

  const pref = (k, d) => { try { return localStorage.getItem('files.' + k) || d; } catch (e) { return d; } };
  const savePref = (k, v) => { try { localStorage.setItem('files.' + k, v); } catch (e) { /* ignore */ } };

  const st = {
    path: OS.args.path || 'device:',
    entries: [],
    sel: new Set(),
    anchor: null,
    back: [],
    fwd: [],
    view: pref('view', 'list'),
    sort: pref('sort', 'name'),
    dir: pref('dir', 'asc'),
    details: pref('details', '1') === '1',
    query: '',
    usage: null,
    renaming: null,
  };

  // Clipboard shared between Files windows (same origin parent).
  const clip = {
    get() { try { return window.parent.__losClipboard || null; } catch (e) { return clip._local || null; } },
    set(v) { try { window.parent.__losClipboard = v; } catch (e) { clip._local = v; } },
  };

  const mode = () => (st.path === 'device:' ? 'device' : st.path === 'trash:' ? 'trash' : st.path === 'recent:' ? 'recent' : st.path === 'search:' ? 'search' : 'folder');
  const isFolder = () => mode() === 'folder';

  // ------------------------------------------------------------------ chrome
  $('[data-c=back]').innerHTML = I('back');
  $('[data-c=forward]').innerHTML = I('forward');
  $('[data-c=up]').innerHTML = I('up');
  $('#search-ico').outerHTML = I('search', 14);

  function renderCmd() {
    const m = mode();
    const has = st.sel.size > 0;
    let h = '';
    if (m === 'trash') {
      h += '<button class="btn" data-c="restore"' + (has ? '' : ' disabled') + '>Restore</button>' +
        '<button class="btn" data-c="purge"' + (has ? '' : ' disabled') + '>Delete permanently</button>' +
        '<span class="spacer"></span><button class="btn btn-danger" data-c="empty">Empty Trash</button>';
    } else {
      const files = has && m !== 'device'; // a drive can't be cut, copied, renamed or trashed
      h += '<button class="btn btn-primary" data-c="new"' + (isFolder() ? '' : ' disabled') + '>New' + I('down', 12) + '</button>' +
        '<button class="btn btn-ghost" data-c="upload"' + (isFolder() ? '' : ' disabled') + '>Upload</button><span class="sep"></span>' +
        [['cut', 'Cut', 'cut', files], ['copy', 'Copy', 'copy', files], ['paste', 'Paste', 'paste', !!clip.get() && isFolder()], ['rename', 'Rename', 'rename', files && st.sel.size === 1],
          ['download', 'Download', 'download', st.sel.size === 1 && selEntries()[0] && selEntries()[0].type === 'file'], ['delete', 'Move to Trash', 'trash', files]]
          .map(([c, l, ic, en]) => '<button class="icon-btn" data-c="' + c + '" title="' + l + '" aria-label="' + l + '"' + (en ? '' : ' disabled') + (c === 'delete' ? ' style="color:var(--danger)"' : '') + '>' + I(ic) + '</button>').join('') +
        '<span class="spacer"></span>' +
        '<button class="btn btn-ghost" data-c="sort">Sort: ' + ({ name: 'Name', mtime: 'Modified', size: 'Size', type: 'Type' })[st.sort] + '</button>' +
        '<div class="seg"><button data-c="view-list" class="' + (st.view === 'list' ? 'active' : '') + '" aria-label="List view">' + I('list', 15) + '</button>' +
        '<button data-c="view-grid" class="' + (st.view === 'grid' ? 'active' : '') + '" aria-label="Grid view">' + I('grid', 15) + '</button></div>' +
        '<button class="icon-btn' + (st.details ? ' active' : '') + '" data-c="details" aria-label="Details pane" title="Details pane">' + I('panel') + '</button>';
    }
    $('#cmdbar').innerHTML = h;
  }

  function renderSide() {
    const used = st.usage;
    const pct = used ? Math.min(100, Math.round((used.used / used.quota) * 100)) : 0;
    $('#side').innerHTML = '<div class="nav-head">Places</div>' +
      PLACES.map(([n, p, ic]) => '<button class="nav-item' + (st.path === p ? ' active' : '') + '" data-go="' + p + '"' + (p.startsWith('/') ? ' data-dropdir="' + p + '"' : '') + '>' + S(ic) + n + '</button>').join('') +
      '<div class="nav-head">Other</div><button class="nav-item' + (st.path === 'trash:' ? ' active' : '') + '" data-go="trash:" data-droptrash="1">' + S('shell.trash') + 'Trash</button>' +
      '<div class="side-meter"><div class="top"><b>My drive</b><span style="color:var(--muted)">' + (used ? util.formatSize(used.used) + ' of ' + util.formatSize(used.quota) : '…') + '</span></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
  }

  function renderCrumbs() {
    const m = mode();
    let h;
    if (m === 'device') {
      h = '<button>This device</button>';
    } else if (m !== 'folder') {
      h = '<button data-go="device:">This device</button><span class="sepc">›</span><button>' + ({ trash: 'Trash', recent: 'Recent', search: 'Search results' })[m] + '</button>';
    } else {
      const parts = st.path.split('/').filter(Boolean);
      h = '<button data-go="device:">This device</button><span class="sepc">›</span><button data-go="/">My drive</button>' +
        parts.map((p, i) => '<span class="sepc">›</span><button data-go="/' + esc(parts.slice(0, i + 1).join('/')) + '">' + esc(p) + '</button>').join('');
    }
    $('#crumbs').innerHTML = h;
    $('[data-c=back]').disabled = !st.back.length;
    $('[data-c=forward]').disabled = !st.fwd.length;
    $('[data-c=up]').disabled = m !== 'folder';
  }

  // ------------------------------------------------------------------ data
  function sorted(list) {
    const k = st.sort;
    const d = st.dir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      if (mode() === 'folder' && a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      let r = 0;
      if (k === 'name') r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      else if (k === 'mtime') r = (a.mtime || a.deletedAt || 0) - (b.mtime || b.deletedAt || 0);
      else if (k === 'size') r = (a.size || 0) - (b.size || 0);
      else r = (a.ext || '').localeCompare(b.ext || '') || a.name.localeCompare(b.name);
      return r * d;
    });
  }

  async function load(path, opts) {
    opts = opts || {};
    try {
      let entries;
      if (path === 'device:') entries = (await fs.drives()).map((d) => Object.assign({}, d, { type: 'drive' }));
      else if (path === 'trash:') entries = (await fs.trash.list()).map((t) => Object.assign({}, t, { path: 'trash:' + t.id, ext: util.ext(t.name) }));
      else if (path === 'recent:') entries = await fs.recent();
      else if (path === 'search:') entries = await fs.search(st.query, '', 300);
      else entries = await fs.list(path);
      if (!opts.keepHistory && path !== st.path) { st.back.push(st.path); st.fwd = []; }
      st.path = path;
      st.entries = entries;
      if (!opts.keepSel) st.sel.clear();
      else st.sel = new Set([...st.sel].filter((p) => entries.some((e) => e.path === p)));
      render();
    } catch (e) {
      OS.notify(e.message, { type: 'error', title: 'Couldn’t open folder' });
      if (path !== '/' && !opts.fallback) load('/', { fallback: true });
    }
  }

  const refresh = () => { load(st.path, { keepHistory: true, keepSel: true }); loadUsage(); };
  const loadUsage = () => fs.usage().then((u) => { st.usage = u; renderSide(); }).catch(() => {});
  const selEntries = () => st.entries.filter((e) => st.sel.has(e.path));

  // ------------------------------------------------------------------ render
  function kindOf(e) {
    if (e.type === 'dir') return 'Folder';
    const app = window.LOS_appForFile(e.name);
    const ext = (e.ext || '').toUpperCase();
    if (window.LOS_KINDS.image.includes(e.ext)) return ext + ' image';
    if (window.LOS_KINDS.video.includes(e.ext)) return ext + ' video';
    if (window.LOS_KINDS.audio.includes(e.ext)) return ext + ' audio';
    if (e.ext === 'ldoc') return 'Document';
    if (e.ext === 'lsheet') return 'Spreadsheet';
    if (e.ext === 'lslides') return 'Presentation';
    return app ? ext + ' file' : (ext ? ext + ' file' : 'File');
  }

  function tile(e, size, radius) {
    return OS.fileTile(e, size);
  }

  function render() {
    renderCmd();
    renderSide();
    renderCrumbs();
    const m = mode();
    const title = m === 'folder' ? (st.path === '/' ? 'My drive' : util.basename(st.path)) : ({ device: 'This device', trash: 'Trash', recent: 'Recent', search: 'Search' })[m];
    // no page heading: the window title and the path bar say where you are; a note shows only when there is one
    const note = m === 'search' ? 'Results for “' + st.query + '”' : m === 'trash' ? 'Items here still use storage until you empty the Trash.' : '';
    $('#infobar').textContent = note;
    $('#infobar').hidden = !note;
    OS.win.setTitle(title + ' — Files');
    const content = $('#content');
    content.className = 'content' + (m === 'trash' ? ' trash-mode' : '') + (m === 'search' || m === 'recent' ? ' search-mode' : '');
    const list = sorted(st.entries);
    const cutSet = (() => { const c = clip.get(); return c && c.mode === 'cut' ? new Set(c.paths) : new Set(); })();

    if (m === 'device') {
      // devices and drives, like Explorer's "This PC": the drive's picture (its own .ico, or the generic disk),
      // its name, how full it is and how much is free
      content.innerHTML = '<div class="dev-head">' + I('down', 12) + 'Devices and drives</div><div class="drives">' + list.map((e) => {
        const pct = e.quota ? Math.min(100, Math.round((e.used / e.quota) * 100)) : 0;
        const pic = e.icon ? fs.rawUrl(e.icon) : DISK;
        return '<div class="drive' + (st.sel.has(e.path) ? ' sel' : '') + '" data-path="' + esc(e.path) + '" data-dropdir="' + esc(e.path) + '" title="' + esc(e.name) + '">' +
          '<img class="drive-ico" src="' + esc(pic) + '" alt="" draggable="false"><span class="drive-txt"><span class="drive-name">' + esc(e.name) + '</span>' +
          '<span class="drive-bar' + (pct >= 90 ? ' full' : '') + '"><i style="width:' + pct + '%"></i></span>' +
          '<small>' + esc(util.formatSize(Math.max(0, e.quota - e.used))) + ' free of ' + esc(util.formatSize(e.quota)) + '</small></span></div>';
      }).join('') + '</div>';
      // a drive's own icon that can't be shown falls back to the generic disk
      content.querySelectorAll('img.drive-ico').forEach((img) => { img.onerror = () => { img.onerror = null; img.src = DISK; }; });
    } else if (!list.length) {
      content.innerHTML = '<div class="empty">' + S(m === 'trash' ? 'shell.trash' : m === 'search' ? 'shell.search' : 'place.folder', 40) +
        '<div style="font-weight:600;color:var(--text)">' + (m === 'trash' ? 'Trash is empty' : m === 'search' ? 'No files found' : m === 'recent' ? 'Nothing here yet' : 'This folder is empty') + '</div>' +
        '<div>' + (m === 'folder' ? 'Drop files here, or use New and Upload.' : m === 'recent' ? 'Files you open or save show up here.' : '') + '</div></div>';
    } else if (st.view === 'grid' && m !== 'trash') {
      content.innerHTML = '<div class="grid">' + list.map((e) => {
        const isImg = e.type === 'file' && window.LOS_KINDS.image.includes(e.ext);
        return '<div class="gtile' + (st.sel.has(e.path) ? ' sel' : '') + (cutSet.has(e.path) ? ' cut' : '') + '" data-path="' + esc(e.path) + '" draggable="true"' + (e.type === 'dir' ? ' data-dropdir="' + esc(e.path) + '"' : '') + '>' +
          '<span class="thumb">' + (isImg ? '<img loading="lazy" alt="" src="' + esc(fs.rawUrl(e.path)) + '">' : tile(e, 44, 12)) + '</span>' +
          '<span class="lbl" title="' + esc(e.name) + '">' + (st.renaming === e.path ? '<input class="input rename-input" value="' + esc(e.name) + '">' : esc(e.name)) + '</span></div>';
      }).join('') + '</div>';
    } else {
      const arrow = (k) => (st.sort === k ? (st.dir === 'asc' ? ' ↑' : ' ↓') : '');
      let head;
      if (m === 'trash') head = '<div class="thead"><button data-sort="name">Name' + arrow('name') + '</button><span>Original location</span><button data-sort="mtime">Deleted' + arrow('mtime') + '</button><button data-sort="size">Size' + arrow('size') + '</button></div>';
      else if (m === 'folder') head = '<div class="thead"><button data-sort="name">Name' + arrow('name') + '</button><button data-sort="mtime">Modified' + arrow('mtime') + '</button><button data-sort="size">Size' + arrow('size') + '</button><button data-sort="type">Type' + arrow('type') + '</button></div>';
      else head = '<div class="thead"><button data-sort="name">Name' + arrow('name') + '</button><span>Location</span><button data-sort="mtime">Modified' + arrow('mtime') + '</button><button data-sort="size">Size' + arrow('size') + '</button></div>';
      content.innerHTML = head + list.map((e) => {
        const nm = '<span class="nm">' + tile(e, 26, 7) + (st.renaming === e.path ? '<input class="input rename-input" value="' + esc(e.name) + '">' : '<span>' + esc(e.name) + '</span>') + '</span>';
        let cols;
        if (m === 'trash') cols = '<span class="c">' + esc(util.dirname(e.original)) + '</span><span class="c m">' + esc(util.formatDate(e.deletedAt)) + '</span><span class="c m">' + (e.type === 'dir' ? '—' : esc(util.formatSize(e.size))) + '</span>';
        else if (m === 'folder') cols = '<span class="c">' + esc(util.formatDate(e.mtime)) + '</span><span class="c m">' + (e.type === 'dir' ? e.count + ' items' : esc(util.formatSize(e.size))) + '</span><span class="c m">' + esc(kindOf(e)) + '</span>';
        else cols = '<span class="c">' + esc(util.dirname(e.path)) + '</span><span class="c m">' + esc(util.formatDate(e.mtime)) + '</span><span class="c m">' + (e.type === 'dir' ? '—' : esc(util.formatSize(e.size))) + '</span>';
        return '<div class="frow' + (st.sel.has(e.path) ? ' sel' : '') + (cutSet.has(e.path) ? ' cut' : '') + '" data-path="' + esc(e.path) + '"' + (m !== 'trash' ? ' draggable="true"' : '') + (e.type === 'dir' && m === 'folder' ? ' data-dropdir="' + esc(e.path) + '"' : '') + '>' + nm + cols + '</div>';
      }).join('');
    }
    const ri = content.querySelector('.rename-input');
    if (ri) {
      ri.focus();
      const dot = ri.value.lastIndexOf('.');
      ri.setSelectionRange(0, dot > 0 ? dot : ri.value.length);
      ri.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finishRename(ri.value); if (ev.key === 'Escape') { st.renaming = null; render(); } });
      ri.addEventListener('blur', () => finishRename(ri.value));
      ri.addEventListener('mousedown', (ev) => ev.stopPropagation());
      ri.addEventListener('dblclick', (ev) => ev.stopPropagation());
    }
    renderDetails();
    renderStatus();
  }

  function renderStatus() {
    const n = st.entries.length;
    $('#st-count').textContent = n + (n === 1 ? ' item' : ' items');
    const sel = selEntries();
    const size = sel.reduce((a, e) => a + (e.size || 0), 0);
    $('#st-sel').textContent = sel.length ? sel.length + ' selected' + (size ? ' · ' + util.formatSize(size) : '') : '';
    $('#st-sync').textContent = st.usage ? util.formatSize(st.usage.used) + ' used' : '';
  }

  function renderDetails() {
    const d = $('#details');
    d.hidden = !st.details || mode() === 'trash' || mode() === 'device';
    if (d.hidden) return;
    const sel = selEntries();
    if (sel.length !== 1) {
      d.innerHTML = '<div class="empty" style="padding:20px">' + I('info', 32) + '<div>' + (sel.length ? sel.length + ' items selected' : 'Select a file to see its details.') + '</div></div>';
      return;
    }
    const e = sel[0];
    const isImg = e.type === 'file' && window.LOS_KINDS.image.includes(e.ext);
    d.innerHTML = '<div class="preview">' + (isImg ? '<img alt="" src="' + esc(fs.rawUrl(e.path)) + '">' : tile(e, 64, 16)) + '</div>' +
      '<div><div class="name">' + esc(e.name) + '</div><div class="hint">' + esc(kindOf(e)) + '</div></div>' +
      '<div class="row"><button class="btn btn-primary grow" data-c="open">Open</button>' + (e.type === 'file' ? '<button class="btn grow" data-c="download">Download</button>' : '') +
      '<button class="icon-btn" data-c="more" aria-label="More actions" style="border:1px solid var(--line-strong);width:32px;height:32px">' + I('more') + '</button></div>' +
      '<dl>' + (e.type === 'file' ? '<dt>Size</dt><dd>' + esc(util.formatSize(e.size)) + '</dd>' : '<dt>Contains</dt><dd>' + e.count + ' items</dd>') +
      '<dt>Modified</dt><dd>' + esc(util.formatDate(e.mtime)) + '</dd><dt>Location</dt><dd>' + esc(util.dirname(e.path) === '/' ? 'My drive' : 'My drive' + util.dirname(e.path).replace(/\//g, ' › ')) + '</dd></dl>';
  }

  // ------------------------------------------------------------------ actions
  function go(path) {
    if (path === st.path) return;
    st.renaming = null;
    load(path);
  }

  function openEntry(e) {
    if (mode() === 'trash') return;
    if (e.type === 'drive') { go(e.path); return; }
    if (e.type === 'dir') go(e.path);
    else OS.openFile(e.path);
  }

  async function newItem(t) {
    if (!isFolder()) return;
    if (!t) {
      const name = await OS.dialog.prompt({ title: 'New folder', label: 'Folder name', value: 'New folder' });
      if (!name || !name.trim()) return;
      try { const e = await fs.mkdir(util.join(st.path, name.trim())); await load(st.path, { keepHistory: true }); select([e.path]); } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t create folder' }); }
      return;
    }
    let i = 1;
    for (;;) {
      const name = t.name + (i > 1 ? ' ' + i : '') + '.' + t.ext;
      try {
        const e = await fs.write(util.join(st.path, name), '', { overwrite: false });
        await load(st.path, { keepHistory: true });
        select([e.path]);
        st.renaming = e.path; render();
        return;
      } catch (ex) {
        if (!/exists/i.test(ex.message) || i > 50) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t create file' }); return; }
        i++;
      }
    }
  }

  function select(paths) { st.sel = new Set(paths); st.anchor = paths[0] || null; render(); }

  async function finishRename(value) {
    const path = st.renaming;
    if (!path) return;
    st.renaming = null;
    const e = st.entries.find((x) => x.path === path);
    const name = value.trim();
    if (!e || !name || name === e.name) { render(); return; }
    try { const r = await fs.rename(path, name); await load(st.path, { keepHistory: true }); select([r.path]); } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t rename' }); render(); }
  }

  async function del(paths) {
    if (!paths.length) return;
    try {
      await fs.remove(paths);
      OS.notify(paths.length === 1 ? 'You can restore it from the Trash if you need it.' : 'You can restore all ' + paths.length + ' items from the Trash if you need them.', { type: 'success', title: 'Moved to Trash' });
      refresh();
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t move to Trash' }); }
  }

  async function paste(dest) {
    const c = clip.get();
    if (!c || !c.paths.length) return;
    try {
      if (c.mode === 'cut') { await fs.move(c.paths, dest); clip.set(null); }
      else await fs.copy(c.paths, dest);
      refresh();
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t paste' }); }
  }

  async function upload(files, dir) {
    files = Array.from(files || []);
    if (!files.length) return;
    dir = dir || st.path;
    OS.notify('Uploading ' + files.length + (files.length === 1 ? ' file…' : ' files…'), { title: 'Upload started' });
    try {
      await fs.upload(dir, files);
      OS.notify(files.length + (files.length === 1 ? ' file was' : ' files were') + ' added to ' + (dir === '/' ? 'My drive' : util.basename(dir)) + '.', { type: 'success', title: 'Upload complete' });
      refresh();
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Upload failed' }); }
  }

  function download(e) {
    const a = document.createElement('a');
    a.href = fs.rawUrl(e.path, true);
    a.download = e.name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function trashAction(kind, ids) {
    try {
      if (kind === 'restore') { await fs.trash.restore(ids); OS.notify('Restored items are back in their original folders.', { type: 'success', title: 'Restored from Trash' }); }
      else {
        const all = !ids;
        const ok = await OS.dialog.confirm({
          title: all ? 'Empty the Trash?' : 'Delete permanently?',
          message: all ? 'Everything in the Trash will be deleted. This can’t be undone.' : 'The selected items will be deleted. This can’t be undone.',
          okLabel: all ? 'Empty Trash' : 'Delete', danger: true,
        });
        if (!ok) return;
        await fs.trash.purge(ids || []);
      }
      refresh();
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: kind === 'restore' ? 'Couldn’t restore' : 'Couldn’t delete' }); }
  }

  const trashIds = () => selEntries().map((e) => e.id);

  function openWithMenu(e, at) {
    const items = window.LOS_APPS.filter((a) => a.id !== 'settings' && a.id !== 'files' && a.id !== 'browser')
      .map((a) => ({ label: a.name, icon: a.icon, action: () => OS.open(a.id, { path: e.path }) }));
    OS.menu(items, at);
  }

  function itemMenu(e, at) {
    if (mode() === 'trash') {
      OS.menu([
        { label: 'Restore', icon: 'reload', action: () => trashAction('restore', trashIds()) },
        { label: 'Delete permanently', icon: 'x', danger: true, action: () => trashAction('purge', trashIds()) },
      ], at);
      return;
    }
    const multi = st.sel.size > 1;
    const isImg = e.type === 'file' && window.LOS_KINDS.image.includes(e.ext);
    const items = [{ label: 'Open', icon: 'forward', key: 'Enter', action: () => selEntries().forEach(openEntry) }];
    if (e.type === 'file' && !multi) items.push({ label: 'Open with…', icon: 'apps', action: () => openWithMenu(e, at) });
    if (e.type === 'dir' && !multi) items.push({ label: 'Open in new window', icon: 'plus', action: () => OS.open('files', { path: e.path }) });
    if (mode() !== 'folder') items.push({ label: 'Show in folder', icon: 'folder', action: async () => { await load(util.dirname(e.path)); select([e.path]); } });
    items.push('sep',
      { label: 'Cut', icon: 'cut', key: 'Ctrl+X', action: () => { clip.set({ mode: 'cut', paths: [...st.sel] }); render(); } },
      { label: 'Copy', icon: 'copy', key: 'Ctrl+C', action: () => { clip.set({ mode: 'copy', paths: [...st.sel] }); render(); } });
    if (e.type === 'dir' && clip.get() && !multi) items.push({ label: 'Paste into folder', icon: 'paste', action: () => paste(e.path) });
    if (!multi) items.push({ label: 'Rename', icon: 'rename', key: 'F2', action: () => { st.renaming = e.path; render(); } });
    if (e.type === 'file' && !multi) items.push({ label: 'Download', icon: 'download', action: () => download(e) });
    if (isImg && !multi) items.push({ label: 'Set as wallpaper', icon: 'image', action: () => { OS.saveSettings({ wallpaper: 'file:' + e.path }); OS.notify(e.name + ' is now your desktop background.', { type: 'success', title: 'Wallpaper updated' }); } });
    items.push('sep', { label: 'Move to Trash', icon: 'trash', key: 'Del', danger: true, action: () => del([...st.sel]) });
    OS.menu(items, at);
  }

  // ---- This device: a drive's menu and the background's, like Explorer's "This PC"
  function driveProps(e) {
    const free = Math.max(0, e.quota - e.used);
    const pct = e.quota ? Math.round((e.used / e.quota) * 100) : 0;
    OS.dialog.alert({ title: e.name + ' properties', message: 'Used space: ' + util.formatSize(e.used) + ' (' + pct + '%)\n' +
      'Free space: ' + util.formatSize(free) + '\nCapacity: ' + util.formatSize(e.quota) });
  }
  function driveMenu(e, at) {
    OS.menu([
      { label: 'Open', icon: 'open', key: 'Enter', action: () => go(e.path) },
      { label: 'Open in new window', icon: 'plus', action: () => OS.open('files', { path: e.path }) },
      'sep',
      { label: 'Open Trash', icon: 'trash', action: () => go('trash:') },
      'sep',
      { label: 'Storage settings', icon: 'storage', action: () => OS.open('settings', { section: 'storage' }) },
      { label: 'Properties', icon: 'info', action: () => driveProps(e) },
    ], at);
  }
  function deviceMenu(at) {
    OS.menu([
      { label: 'Refresh', icon: 'reload', key: 'F5', action: refresh },
      'sep',
      { label: 'Open My drive', icon: 'folder', action: () => go('/') },
      { label: 'Recent files', icon: 'clock', action: () => go('recent:') },
      { label: 'Open Trash', icon: 'trash', action: () => go('trash:') },
      'sep',
      { label: 'Storage settings', icon: 'storage', action: () => OS.open('settings', { section: 'storage' }) },
    ], at);
  }

  function bgMenu(at) {
    if (mode() === 'trash') { OS.menu([{ label: 'Empty Trash', icon: 'trash', danger: true, action: () => trashAction('purge') }], at); return; }
    if (!isFolder()) return;
    OS.menu([
      viewItem(),
      sortItem(),
      'sep',
      { label: 'Refresh', icon: 'reload', key: 'F5', action: refresh },
      { label: 'Paste', icon: 'paste', key: 'Ctrl+V', disabled: !clip.get(), action: () => paste(st.path) },
      'sep',
      { label: 'New', icon: 'plus', items: newItems() },
      { label: 'Upload files', icon: 'upload', action: () => $('#upload').click() },
    ], at);
  }

  // View and Sort by, as submenus (the background menu) and on their own (toolbar buttons)
  const VIEWS = [['grid', 'Icons', 'grid', 'Ctrl+Shift+2'], ['list', 'Details', 'list', 'Ctrl+Shift+6']];
  const SORTS = [['name', 'Name'], ['mtime', 'Date modified'], ['size', 'Size'], ['type', 'Type']];
  function setView(v) { st.view = v; savePref('view', v); render(); }
  function toggleDetails() { st.details = !st.details; savePref('details', st.details ? '1' : '0'); render(); }
  function viewItems() {
    return [
      ...VIEWS.map(([v, label, icon, key]) => ({ label, icon, key, checked: st.view === v, action: () => setView(v) })),
      'sep',
      { label: 'Details pane', icon: 'panel', key: 'Alt+Shift+P', checked: st.details, action: toggleDetails },
    ];
  }
  function sortItems() {
    return [
      ...SORTS.map(([k, label]) => ({ label, checked: st.sort === k, action: () => { if (st.sort !== k) setSort(k); } })),
      'sep',
      { label: 'Ascending', checked: st.dir === 'asc', action: () => setDir('asc') },
      { label: 'Descending', checked: st.dir === 'desc', action: () => setDir('desc') },
    ];
  }
  // "New" entries for the file types whose app is installed (a missing app must not break the menu).
  const newTypeItems = () => NEW_TYPES.filter((t) => window.LOS_app(t.app))
    .map((t) => ({ label: t.label, icon: window.LOS_app(t.app).icon, action: () => newItem(t) }));
  function newItems() {
    return [
      { label: 'Folder', icon: 'folder', action: () => newItem(null) },
      'sep',
      ...newTypeItems(),
    ];
  }
  const viewItem = () => ({ label: 'View', icon: 'grid', items: viewItems() });
  const sortItem = () => ({ label: 'Sort by', icon: 'filter', items: sortItems() });
  function setDir(d) { st.dir = d; savePref('dir', d); render(); }

  function newMenu(at) {
    OS.menu([
      { label: 'Folder', icon: 'folder', action: () => newItem(null) },
      'sep',
      ...newTypeItems(),
    ], at);
  }

  function sortMenu(at) { OS.menu(sortItems(), at); }

  function setSort(k) {
    if (st.sort === k) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
    else { st.sort = k; st.dir = k === 'mtime' || k === 'size' ? 'desc' : 'asc'; }
    savePref('sort', st.sort); savePref('dir', st.dir);
    render();
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-c],[data-go],[data-sort]');
    if (!b || b.disabled) return;
    if (b.dataset.go) { go(b.dataset.go); return; }
    if (b.dataset.sort) { setSort(b.dataset.sort); return; }
    const sel = selEntries();
    const rect = b.getBoundingClientRect();
    const at = { x: rect.left, y: rect.bottom + 4 };
    switch (b.dataset.c) {
      case 'back': if (st.back.length) { st.fwd.push(st.path); load(st.back.pop(), { keepHistory: true }); } break;
      case 'forward': if (st.fwd.length) { st.back.push(st.path); load(st.fwd.pop(), { keepHistory: true }); } break;
      case 'up': go(st.path === '/' ? 'device:' : util.dirname(st.path)); break;
      case 'new': newMenu(at); break;
      case 'upload': $('#upload').click(); break;
      case 'cut': clip.set({ mode: 'cut', paths: [...st.sel] }); render(); break;
      case 'copy': clip.set({ mode: 'copy', paths: [...st.sel] }); OS.notify('Paste in any folder to make a copy.', { title: 'Ready to paste' }); render(); break;
      case 'paste': paste(st.path); break;
      case 'rename': if (sel[0]) { st.renaming = sel[0].path; render(); } break;
      case 'download': if (sel[0]) download(sel[0]); break;
      case 'delete': del([...st.sel]); break;
      case 'sort': sortMenu(at); break;
      case 'view-list': setView('list'); break;
      case 'view-grid': setView('grid'); break;
      case 'details': toggleDetails(); break;
      case 'open': if (sel[0]) openEntry(sel[0]); break;
      case 'more': if (sel[0]) itemMenu(sel[0], at); break;
      case 'restore': trashAction('restore', trashIds()); break;
      case 'purge': trashAction('purge', trashIds()); break;
      case 'empty': trashAction('purge'); break;
      default: break;
    }
  });

  const content = $('#content');
  content.addEventListener('mousedown', (ev) => {
    const row = ev.target.closest('[data-path]');
    if (!row) {
      if (ev.button === 0 && !ev.target.closest('.thead')) { st.sel.clear(); render(); }
      return;
    }
    const p = row.dataset.path;
    if (ev.button === 2) { if (!st.sel.has(p)) select([p]); return; }
    if (ev.shiftKey && st.anchor) {
      const list = sorted(st.entries).map((e) => e.path);
      const a = list.indexOf(st.anchor);
      const b = list.indexOf(p);
      st.sel = new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1));
      render();
    } else if (ev.ctrlKey || ev.metaKey) {
      if (st.sel.has(p)) st.sel.delete(p); else st.sel.add(p);
      st.anchor = p; render();
    } else if (!st.sel.has(p) || st.sel.size > 1) {
      // Keep a multi-selection when starting a drag.
      if (!st.sel.has(p)) select([p]);
    }
  });
  content.addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-path]');
    if (row && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && st.sel.size > 1) select([row.dataset.path]);
  });
  content.addEventListener('dblclick', (ev) => {
    const row = ev.target.closest('[data-path]');
    if (!row) return;
    const e = st.entries.find((x) => x.path === row.dataset.path);
    if (e) openEntry(e);
  });
  $('#main').addEventListener('contextmenu', (ev) => {
    if (ev.target.closest('input')) return;
    ev.preventDefault();
    const row = ev.target.closest('[data-path]');
    if (mode() === 'device') {
      const e = row && st.entries.find((x) => x.path === row.dataset.path);
      if (e) { select([e.path]); driveMenu(e, ev); } else { if (st.sel.size) { st.sel.clear(); render(); } deviceMenu(ev); }
      return;
    }
    if (row) {
      const e = st.entries.find((x) => x.path === row.dataset.path);
      if (e) itemMenu(e, ev);
    } else bgMenu(ev);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.target.closest('input, textarea')) return;
    const sel = selEntries();
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ev.key === 'F5' || (ctrl && ev.key.toLowerCase() === 'r')) { ev.preventDefault(); refresh(); return; }
    if (ctrl && ev.shiftKey && (ev.code === 'Digit2' || ev.code === 'Digit6')) { ev.preventDefault(); setView(ev.code === 'Digit2' ? 'grid' : 'list'); return; }
    if (ev.altKey && ev.shiftKey && ev.code === 'KeyP') { ev.preventDefault(); toggleDetails(); return; }
    if (mode() === 'device') { if (ev.key === 'Enter' && sel.length) { ev.preventDefault(); sel.forEach(openEntry); } return; }
    if (ev.key === 'Delete' && sel.length) { ev.preventDefault(); if (mode() === 'trash') trashAction('purge', trashIds()); else del([...st.sel]); }
    else if (ev.key === 'F2' && sel.length === 1 && mode() !== 'trash') { ev.preventDefault(); st.renaming = sel[0].path; render(); }
    else if (ev.key === 'Enter' && sel.length) { ev.preventDefault(); sel.forEach(openEntry); }
    else if (ev.key === 'Backspace' && isFolder()) { ev.preventDefault(); go(st.path === '/' ? 'device:' : util.dirname(st.path)); }
    else if (ctrl && ev.key.toLowerCase() === 'a') { ev.preventDefault(); select(st.entries.map((e) => e.path)); }
    else if (ctrl && ev.key.toLowerCase() === 'c' && sel.length && mode() !== 'trash') { clip.set({ mode: 'copy', paths: [...st.sel] }); render(); }
    else if (ctrl && ev.key.toLowerCase() === 'x' && sel.length && mode() !== 'trash') { clip.set({ mode: 'cut', paths: [...st.sel] }); render(); }
    else if (ctrl && ev.key.toLowerCase() === 'v' && isFolder()) { paste(st.path); }
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const list = sorted(st.entries).map((e) => e.path);
      if (!list.length) return;
      ev.preventDefault();
      const cur = list.indexOf([...st.sel].pop());
      const next = Math.max(0, Math.min(list.length - 1, cur + (ev.key === 'ArrowDown' ? 1 : -1)));
      select([list[cur === -1 ? 0 : next]]);
      const el = content.querySelector('[data-path="' + CSS.escape(list[cur === -1 ? 0 : next]) + '"]');
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  });

  // Search
  const search = $('#search');
  search.addEventListener('input', util.debounce(() => {
    st.query = search.value.trim();
    if (st.query) { if (st.path === 'search:') load('search:', { keepHistory: true }); else load('search:'); }
    else if (st.path === 'search:') { st.fwd = []; load(st.back.pop() || '/', { keepHistory: true }); }
  }, 300));

  // Upload input
  $('#upload').addEventListener('change', (ev) => { upload(ev.target.files); ev.target.value = ''; });

  // Drag and drop: OS files -> upload; internal items -> move into folders / trash.
  const main = $('#main');
  // Drag & drop. Dragged items travel in the drag data (MIME below), so another Files
  // window can receive them; local dragPaths only tells "this window started the drag".
  const DND = 'application/x-liteos-paths';
  let dragPaths = null;
  const typesOf = (ev) => Array.from((ev.dataTransfer && ev.dataTransfer.types) || []);
  const isInternal = (ev) => typesOf(ev).includes(DND);
  const isExternalFiles = (ev) => !isInternal(ev) && typesOf(ev).includes('Files');

  // Desktop icons are dragged by the shell (not HTML drag and drop): it asks this window what is under the pointer, in
  // this window's coordinates. Returns a folder path, 'trash:', or null; 'hover' marks the target, 'leave' clears it.
  window.__losDropAt = (x, y, phase) => {
    document.querySelectorAll('.drop').forEach((n) => n.classList.remove('drop'));
    main.classList.remove('dragover');
    if (phase === 'leave') return null;
    const el = document.elementFromPoint(x, y);
    const target = el && el.closest('[data-dropdir],[data-droptrash]');
    if (target) { target.classList.add('drop'); return target.dataset.droptrash ? 'trash:' : target.dataset.dropdir; }
    if (isFolder() && el && main.contains(el)) { main.classList.add('dragover'); return st.path; }
    return null;
  };

  // All Files windows refresh when any of them moves, copies or uploads.
  const sync = ('BroadcastChannel' in window) ? new BroadcastChannel('liteos-files') : null;
  if (sync) sync.onmessage = () => refresh();
  const announce = () => { if (sync) sync.postMessage('changed'); };

  document.addEventListener('dragstart', (ev) => {
    const row = ev.target.closest('[data-path]');
    if (!row || mode() === 'trash') return;
    if (!st.sel.has(row.dataset.path)) select([row.dataset.path]);
    dragPaths = [...st.sel];
    ev.dataTransfer.effectAllowed = 'copyMove';
    ev.dataTransfer.setData(DND, JSON.stringify(dragPaths));
    ev.dataTransfer.setData('text/plain', dragPaths.join('\n'));
  });
  document.addEventListener('dragend', () => { dragPaths = null; document.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); main.classList.remove('dragover'); });

  document.addEventListener('dragover', (ev) => {
    const target = ev.target.closest('[data-dropdir],[data-droptrash]');
    const internal = isInternal(ev);
    const external = isExternalFiles(ev);
    document.querySelectorAll('.drop').forEach((x) => { if (x !== target) x.classList.remove('drop'); });
    // Can't drop a folder onto itself (only knowable for drags that started in this window).
    const ontoSelf = target && dragPaths && dragPaths.includes(target.dataset.dropdir);
    if (target && (internal || external) && !ontoSelf) {
      ev.preventDefault();
      target.classList.add('drop');
      ev.dataTransfer.dropEffect = ev.ctrlKey ? 'copy' : 'move';
      main.classList.remove('dragover');
    } else if (isFolder() && main.contains(ev.target) && (external || (internal && !dragPaths))) {
      // Files from the computer, or items dragged in from another Files window: drop into this folder.
      ev.preventDefault();
      ev.dataTransfer.dropEffect = internal ? (ev.ctrlKey ? 'copy' : 'move') : 'copy';
      main.classList.add('dragover');
    }
  });
  document.addEventListener('dragleave', (ev) => { if (!ev.relatedTarget || !document.contains(ev.relatedTarget)) main.classList.remove('dragover'); });

  document.addEventListener('drop', async (ev) => {
    const target = ev.target.closest('[data-dropdir],[data-droptrash]');
    main.classList.remove('dragover');
    document.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
    if (isExternalFiles(ev)) {
      ev.preventDefault();
      const dir = target && target.dataset.dropdir ? target.dataset.dropdir : (isFolder() ? st.path : null);
      if (dir) { await upload(ev.dataTransfer.files, dir); announce(); }
      return;
    }
    if (!isInternal(ev)) return;
    ev.preventDefault();
    let paths = [];
    try { paths = JSON.parse(ev.dataTransfer.getData(DND) || '[]'); } catch (e) { paths = []; }
    if (!paths.length) return;
    const local = !!dragPaths;
    dragPaths = null;
    if (target && target.dataset.droptrash) { await del(paths); announce(); return; }
    const dest = target && target.dataset.dropdir ? target.dataset.dropdir : (!local && isFolder() ? st.path : null);
    if (!dest) return;
    try {
      if (ev.ctrlKey) await fs.copy(paths, dest); else await fs.move(paths, dest);
      refresh();
      announce();
      if (!local) OS.notify((ev.ctrlKey ? 'Copied ' : 'Moved ') + paths.length + (paths.length === 1 ? ' item' : ' items') + ' to ' + (dest === '/' ? 'My drive' : util.basename(dest)) + '.', { type: 'success', title: ev.ctrlKey ? 'Items copied' : 'Items moved' });
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: ev.ctrlKey ? 'Couldn’t copy items' : 'Couldn’t move items' }); }
  });

  // Theme changes don't need a re-render (CSS variables), but settings like wallpaper don't affect Files.
  load(st.path === 'trash:' || st.path === 'device:' || st.path.startsWith('/') ? st.path : 'device:', { keepHistory: true }).then(() => {
    // Other apps can ask Files to highlight a file: LiteOS.open('files', { path: dir, select: file })
    if (OS.args.select && st.entries.some((e) => e.path === OS.args.select)) select([OS.args.select]);
  });
  loadUsage();
});
