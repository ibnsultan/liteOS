/* LiteOS Files — file manager */
LiteOS.ready((OS) => {
  'use strict';
  // inside the desktop, the window is Mica (os.css) and files.css lets it through
  if (OS.inShell) document.documentElement.classList.add('in-shell');
  const { util, fs } = OS;
  const I = (n, s) => OS.icon(n, s || 16);
  // system icons (places, the drive, file types) come from the icon set; the toolbar keeps its glyphs
  const S = (n, s) => OS.sysGlyph(n, s || 16);
  const esc = util.escape;
  const $ = (s) => document.querySelector(s);
  // the generic disk for a drive with no .ico of its own
  const DISK = OS.sysIcon('place.drive');

  // The navigation pane, as in Explorer: Home, the folders pinned to Quick access, then This PC as a tree (its drives
  // and their folders, opened with the arrows) and the Trash. The pins are a user setting, so every Files window and
  // every device sees the same list.
  const SPECIAL = { '/Desktop': 'place.desktop', '/Documents': 'place.documents', '/Downloads': 'place.downloads', '/Pictures': 'place.pictures', '/Music': 'place.music', '/Videos': 'place.videos' };
  const DEFAULT_PINS = ['/Desktop', '/Downloads', '/Documents', '/Pictures', '/Music', '/Videos'];
  const pins = () => (Array.isArray(OS.settings.quickAccess) ? OS.settings.quickAccess : DEFAULT_PINS);
  const isPinned = (p) => pins().includes(p);
  const setPinned = (p, on) => OS.saveSettings({ quickAccess: pins().filter((x) => x !== p).concat(on ? [p] : []) });
  const folderIcon = (p) => SPECIAL[p] || 'place.folder';
  // where a folder is, for Home's Quick access: "My drive", "My drive › Documents"
  const where = (p) => { const d = util.dirname(p); return d === '/' ? 'My drive' : 'My drive' + d.replace(/\//g, ' › '); };
  const NEW_TYPES = [
    { label: 'Document', ext: 'ldoc', name: 'Untitled document', app: 'documents' },
    { label: 'Spreadsheet', ext: 'lsheet', name: 'Untitled spreadsheet', app: 'sheets' },
    { label: 'Presentation', ext: 'lslides', name: 'Untitled presentation', app: 'slides' },
    { label: 'Text file', ext: 'txt', name: 'New text file', app: 'code' },
  ];

  const pref = (k, d) => { try { return localStorage.getItem('files.' + k) || d; } catch (e) { return d; } };
  const savePref = (k, v) => { try { localStorage.setItem('files.' + k, v); } catch (e) { /* ignore */ } };

  // after a reload: the folder that was open (OS.win.keepState below)
  const kept = OS.win.restored || {};
  const st = {
    path: (typeof kept.path === 'string' && kept.path) || OS.args.path || 'home:',
    entries: [],
    sel: new Set(),
    anchor: null,
    back: [],
    fwd: [],
    view: pref('view', 'list'),
    sort: pref('sort', 'name'),
    dir: pref('dir', 'asc'),
    details: pref('details', '0') === '1',          // the Details pane: closed until the user opens it
    query: '',
    usage: null,
    renaming: null,
    // the This PC tree: which branches are open (This PC shows its drives; each drive stays folded until opened), and the folders under each
    tree: { open: new Set((() => { try { return JSON.parse(pref('tree', '["device:"]')); } catch (e) { return ['device:']; } })()), kids: new Map() },
    fold: new Set(pref('fold', '').split(',').filter(Boolean)), // Home sections the user folded away
  };

  // Clipboard shared between Files windows (same origin parent).
  const clip = {
    get() { try { return window.parent.__losClipboard || null; } catch (e) { return clip._local || null; } },
    set(v) { try { window.parent.__losClipboard = v; } catch (e) { clip._local = v; } },
  };

  const mode = () => (st.path === 'home:' ? 'home' : st.path === 'device:' ? 'device' : st.path === 'trash:' ? 'trash' : st.path === 'recent:' ? 'recent' : st.path === 'search:' ? 'search' : isUsb(st.path) ? 'usb' : 'folder');
  const isFolder = () => mode() === 'folder';

  // ------------------------------------------------------------------ USB drives (LiteLink)
  // On a LiteLink thin client, LiteLink's window.LiteLink offers the USB drives plugged into the device: they show under
  // This PC next to My drive, open like folders (usb:<drive>:/path), copy to and from My drive, and eject. All of it
  // waits for LiteLink to be detected and to allow USB drives; without it (an ordinary PC) none of this runs and Files
  // is as it always was. A drive is read only unless the connection allows writing (no rename or delete either way).
  const LL = OS.device.api; // window.LiteLink on a LiteLink device, null elsewhere (sdk.js)
  const usb = { on: false, write: false, drives: [], free: new Map(), ejected: new Set() };
  const isUsb = (p) => typeof p === 'string' && p.startsWith('usb:');
  const usbParse = (p) => { const m = /^usb:([^:]+):(\/.*)$/.exec(p || ''); return m ? { id: m[1], path: m[2] } : null; };
  const usbPath = (id, path) => 'usb:' + id + ':' + (path || '/');
  const usbDrive = (id) => usb.drives.find((d) => d.id === id);
  const usbName = (id) => (usbDrive(id) || {}).name || 'USB drive';
  const usbEntry = (d) => ({ name: d.name, path: usbPath(d.id, '/'), type: 'drive', usb: true, id: d.id, size: d.size, fstype: d.fstype, model: d.model });
  const usbDrives = () => (usb.on ? usb.drives.map(usbEntry) : []);
  // where something is, read out: "KINGSTON", "KINGSTON › Reports"
  const usbWhere = (p) => { const u = usbParse(p); return usbName(u.id) + (u.path === '/' ? '' : u.path.replace(/\//g, ' › ')); };
  // a folder's parent: the drive's top folder goes up to This PC
  const parentOf = (p) => { if (isUsb(p)) { const u = usbParse(p); return u.path === '/' ? 'device:' : usbPath(u.id, util.dirname(u.path)); } return p === '/' ? 'device:' : util.dirname(p); };
  const usbWritableHere = () => mode() === 'usb' && usb.write;
  // where items can be dropped or pasted: a My drive folder, or a folder on a drive that may be written
  const canDropOn = (p) => typeof p === 'string' && (p.startsWith('/') || (isUsb(p) && usb.write));
  const canPasteHere = () => isFolder() || usbWritableHere();

  async function usbList(p) {
    const u = usbParse(p);
    if (!LL || !u) throw new Error('USB drives are only available on a LiteLink device.');
    const list = await LL.storage.browse(u.id, u.path);
    if (list.free != null) usb.free.set(u.id, list.free);
    return list.map((e) => ({ name: e.name, path: usbPath(u.id, util.join(u.path, e.name)), type: e.dir ? 'dir' : 'file',
      ext: e.dir ? '' : util.ext(e.name), size: e.size, mtime: e.mtime, usb: true }));
  }
  // one item on a drive (its type), from its folder's listing
  async function usbStat(p) {
    const u = usbParse(p);
    if (u.path === '/') return { name: usbName(u.id), path: p, type: 'dir', usb: true }; // the whole drive, as a folder
    const name = util.basename(u.path);
    const e = (await usbList(parentOf(p))).find((x) => x.name === name);
    if (!e) throw new Error('“' + name + '” isn’t on the USB drive any more.');
    return e;
  }

  // Drive → My drive: each file is read from the drive and uploaded with the usual upload; folders are made as they go.
  async function usbImport(paths, dest) {
    let n = 0;
    const copy = async (e, dir) => {
      if (e.type === 'dir') {
        const target = util.join(dir, e.name);
        await fs.mkdir(target).catch(async (ex) => { if (!(await fs.list(dir)).some((x) => x.name === e.name && x.type === 'dir')) throw ex; });
        for (const k of await usbList(e.path)) await copy(k, target);
      } else {
        const u = usbParse(e.path);
        const blob = await LL.storage.read(u.id, u.path);
        await fs.upload(dir, [new File([blob], e.name, { lastModified: (e.mtime || 0) * 1000 })]);
        n++;
      }
    };
    const from = usbName(usbParse(paths[0]).id);
    OS.notify('Copying from ' + from + '…', { title: 'Copy started' });
    try {
      for (const p of paths) await copy(st.entries.find((x) => x.path === p) || await usbStat(p), dest);
      OS.notify(n + (n === 1 ? ' file was' : ' files were') + ' copied from ' + from + ' to ' + (dest === '/' ? 'My drive' : util.basename(dest)) + '.', { type: 'success', title: 'Copy complete' });
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t copy from ' + from }); }
    refresh();
    announce();
  }

  // My drive (or files from the computer) → a drive: written through LiteLink; folders are made as they go.
  async function usbExport(items, dest) {
    const d = usbParse(dest);
    let n = 0;
    const put = async (e, dir) => {
      const target = util.join(dir, e.name);
      if (e.type === 'dir') {
        await LL.storage.mkdir(d.id, target).catch(async (ex) => { if (!(await LL.storage.browse(d.id, dir)).some((x) => x.name === e.name && x.dir)) throw ex; });
        for (const k of await fs.list(e.path)) await put(k, target);
      } else {
        const data = e.file || await (await fetch(fs.rawUrl(e.path))).blob();
        await LL.storage.write(d.id, target, data, { overwrite: false });
        n++;
      }
    };
    const to = usbName(d.id);
    OS.notify('Copying to ' + to + '…', { title: 'Copy started' });
    try {
      for (const e of items) await put(e, d.path);
      OS.notify(n + (n === 1 ? ' file was' : ' files were') + ' copied to ' + to + '.', { type: 'success', title: 'Copy complete' });
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t copy to ' + to }); }
    refresh();
    announce();
  }
  // My drive paths (pasted or dropped) → entries with their type
  const driveItems = (paths) => Promise.all(paths.map((p) => st.entries.find((x) => x.path === p) || fs.stat(p)));

  // Opening a file on a drive copies it to Downloads first, then opens it there with its app.
  async function usbOpen(e) {
    try {
      const u = usbParse(e.path);
      const blob = await LL.storage.read(u.id, u.path);
      const [made] = await fs.upload('/Downloads', [new File([blob], e.name, { lastModified: (e.mtime || 0) * 1000 })]);
      OS.openFile((made && made.path) || util.join('/Downloads', e.name));
      announce();
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t open ' + e.name }); }
  }
  async function usbDownload(e) {
    try {
      const u = usbParse(e.path);
      const url = URL.createObjectURL(await LL.storage.read(u.id, u.path));
      const a = document.createElement('a');
      a.href = url; a.download = e.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t download ' + e.name }); }
  }
  // A new folder on a drive, named in place like one on My drive. LiteLink can't rename on a drive, so the folder is
  // made once it has its name (Enter, a click elsewhere, or Escape for "New folder"), shimmering until the drive has it.
  function usbNewFolder() {
    if (!usbWritableHere()) return;
    const taken = new Set(st.entries.map((x) => x.name.toLowerCase()));
    let name = '';
    for (let i = 1; i <= 50 && !name; i++) { const n = 'New folder' + (i > 1 ? ' (' + i + ')' : ''); if (!taken.has(n.toLowerCase())) name = n; }
    if (!name) return;
    const u = usbParse(st.path);
    const path = usbPath(u.id, util.join(u.path, name));
    st.entries = st.entries.concat({ name, path, type: 'dir', ext: '', size: 0, count: 0, mtime: Math.floor(Date.now() / 1000), usb: true, usbNew: true });
    st.renaming = path;
    select([path]);
  }
  async function usbMakeFolder(e, name) {
    const u = usbParse(e.path);
    const where = usbPath(u.id, util.dirname(u.path));
    if (/[\\/]/.test(name)) { OS.notify('A folder name can’t contain / or \\.', { type: 'error', title: 'Couldn’t create folder' }); name = e.name; }
    e.shown = name; e.pending = true;
    render();
    try {
      await LL.storage.mkdir(u.id, util.join(util.dirname(u.path), name));
      if (st.path === where) { await load(where, { keepHistory: true, quiet: true }); select([usbPath(u.id, util.join(util.dirname(u.path), name))]); }
      announce();
    } catch (ex) {
      st.entries = st.entries.filter((x) => x !== e);
      st.sel.delete(e.path);
      render();
      OS.notify(ex.message, { type: 'error', title: 'Couldn’t create folder' });
    }
  }
  async function usbEject(id) {
    const name = usbName(id);
    try {
      await LL.storage.eject(id);
      OS.notify(name + ' can be removed from the device now.', { type: 'success', title: 'Safe to remove' });
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t eject ' + name }); }
  }
  const FS_NAMES = { vfat: 'FAT32', fat: 'FAT32', exfat: 'exFAT', ntfs: 'NTFS', ntfs3: 'NTFS' };
  async function usbProps(e) {
    let free = usb.free.get(e.id);
    if (free == null) { // not opened yet: its top folder's listing says how much is free
      try { const top = await LL.storage.browse(e.id, '/'); if (top.free != null) { free = top.free; usb.free.set(e.id, free); } } catch (ex) { /* unknown */ }
    }
    propsDialog({ name: e.name, icon: OS.sysIcon('place.removable'), type: 'USB Drive',
      fs: FS_NAMES[(e.fstype || '').toLowerCase()] || (e.fstype || '').toUpperCase(), capacity: e.size, free, eject: () => usbEject(e.id) });
  }

  // Every Files window hears the drive events; one notification is enough, so the first window to see an event says
  // it and the others stay quiet (a marker on the shell window, as the shared clipboard does).
  function usbNote(key, show) {
    try {
      const seen = window.parent.__losUsbNotes || (window.parent.__losUsbNotes = {});
      if (seen[key] && Date.now() - seen[key] < 3000) return;
      seen[key] = Date.now();
    } catch (e) { /* not in the shell: just say it */ }
    show();
  }

  // The drives plugged in now (an ejected one stays plugged in but is left out until it's plugged in again).
  // This PC and the tree follow; a window inside a drive that went away goes back to This PC.
  async function usbRefresh() {
    try { usb.drives = (await LL.storage.list()).filter((d) => !usb.ejected.has(d.id)); } catch (e) { usb.drives = []; }
    const here = usbParse(st.path);
    if (here && !usbDrive(here.id)) load('device:');
    else if (mode() === 'device') load('device:', { keepHistory: true, keepSel: true, quiet: true });
    if (st.tree.open.has('device:')) await loadKids('device:');
    renderSide();
  }
  if (LL) {
    LL.ready.then((caps) => {
      const access = caps && caps.storage && caps.storage.usb;
      if (!access) return; // USB drives are off for this connection
      usb.on = true;
      usb.write = access === 'write';
      LL.on('device-added', (d) => {
        if (d && d.id) usbNote('added:' + d.id, () => OS.notify((d.name || 'A USB drive') + ' is connected.', {
          title: 'USB drive connected', actions: [{ label: 'Open', action: () => go(usbPath(d.id, '/')) }] }));
        usbRefresh();
      });
      LL.on('device-removed', (d) => {
        if (d && d.id) {
          // pulled out without Eject: say so (after Eject, "Safe to remove" has been said already)
          if (!usb.ejected.has(d.id) && usbDrive(d.id)) {
            const name = usbName(d.id);
            usbNote('removed:' + d.id, () => OS.notify(name + ' was removed. Eject a drive before unplugging it, so nothing being copied is lost.', { title: 'USB drive removed' }));
          }
          usb.ejected.delete(d.id);
        }
        usbRefresh();
      });
      LL.on('device-ejected', (d) => { if (d) usb.ejected.add(d.id); usbRefresh(); });
      usbRefresh();
    }, () => {});
  }

  // ------------------------------------------------------------------ chrome
  $('[data-c=back]').innerHTML = I('back');
  $('[data-c=forward]').innerHTML = I('forward');
  $('[data-c=up]').innerHTML = I('up');
  $('#search-ico').outerHTML = I('search', 14);

  // The command bar, laid out like Explorer's: New (with Upload beside it), the actions on the selection as icons,
  // Sort and View, a "more" menu, and the Details pane at the far end; groups split by thin lines. Plain buttons with
  // no frame: they fill on hover.
  const EJECT_ICON = '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5 5 13h14z M5 18h14"/></svg>';
  const SORT_ICON = '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M3.5 7.5 7 4l3.5 3.5M17 20V4M13.5 16.5 17 20l3.5-3.5"/></svg>';
  const cmdBtn = (c, label, icon, on, chev) => '<button class="cmd-btn" data-c="' + c + '"' + (on ? '' : ' disabled') + '>' + icon + '<span>' + label + '</span>' + (chev ? '<span class="chev">' + I('down', 12) + '</span>' : '') + '</button>';
  const cmdIcon = (c, label, icon, on) => '<button class="icon-btn cmd-ico" data-c="' + c + '" title="' + label + '" aria-label="' + label + '"' + (on ? '' : ' disabled') + '>' + I(icon) + '</button>';
  function renderCmd() {
    const m = mode();
    const has = st.sel.size > 0;
    let h = '';
    if (m === 'trash') {
      h += cmdBtn('empty', 'Empty Trash', I('trash'), true) + '<span class="sep"></span>' +
        cmdBtn('restore', 'Restore', I('undo'), has) + cmdBtn('purge', 'Delete permanently', I('x'), has);
    } else {
      const files = has && m !== 'device' && !selEntries().some((e) => e.pin); // a drive (or a pin on Home) can't be cut, copied, renamed or trashed
      const onUsb = m === 'usb'; // a USB drive: copy only (no cut, rename or trash); New folder and Paste when it may be written
      const sortable = m !== 'home';
      const one = st.sel.size === 1 && selEntries()[0];
      const writable = isFolder() || usbWritableHere();
      // Eject: inside a drive, or with a drive selected in This PC
      const ejectId = onUsb ? usbParse(st.path).id : (m === 'device' && one && one.usb ? one.id : null);
      // no Upload on a LiteLink thin client: it would open the device's own files (sticks come in through This PC)
      h += cmdBtn('new', onUsb ? 'New folder' : 'New', I('plus'), writable) + (LL ? '' : cmdIcon('upload', 'Upload', 'upload', writable)) + '<span class="sep"></span>' +
        cmdIcon('cut', 'Cut', 'cut', files && !onUsb) + cmdIcon('copy', 'Copy', 'copy', files) + cmdIcon('paste', 'Paste', 'paste', !!clip.get() && canPasteHere()) +
        cmdIcon('rename', 'Rename', 'rename', files && !onUsb && st.sel.size === 1) + cmdIcon('download', 'Download', 'download', !!one && one.type === 'file') +
        cmdIcon('delete', 'Move to Trash', 'trash', files && !onUsb) + '<span class="sep"></span>' +
        (ejectId ? cmdBtn('eject', 'Eject', EJECT_ICON, true) + '<span class="sep"></span>' : '') +
        cmdBtn('sort', 'Sort', SORT_ICON, sortable, true) +
        cmdBtn('view', 'View', I(VIEWS.find(([v]) => v === curView())[2]), sortable, true) + '<span class="sep"></span>' +
        cmdIcon('more', 'See more', 'more', true);
    }
    h += '<span class="spacer"></span>' + (m === 'trash' || m === 'device' ? '' :
      '<button class="cmd-btn' + (st.details ? ' active' : '') + '" data-c="details" aria-pressed="' + st.details + '" title="Details pane (Alt+Shift+P)">' + I('panel') + '<span>Details</span></button>');
    $('#cmdbar').innerHTML = h;
  }
  // the bar's "more" menu: selection, refresh and opening elsewhere
  function moreMenu(at) {
    const all = st.entries.map((e) => e.path);
    OS.menu([
      { label: 'Select all', key: 'Ctrl+A', disabled: !all.length, action: () => select(all) },
      { label: 'Select none', disabled: !st.sel.size, action: () => select([]) },
      { label: 'Invert selection', disabled: !all.length, action: () => select(all.filter((p) => !st.sel.has(p))) },
      'sep',
      { label: 'Refresh', icon: 'reload', key: 'F5', action: refresh },
      { label: 'Open in new window', icon: 'plus', action: () => OS.open('files', { path: st.path }) },
      ...(isFolder() ? [{ label: 'Open with Code', icon: 'code', action: () => OS.open('code', { folder: st.path }) }] : []),
    ], at);
  }

  // One row of the pane. Every row has the arrow's slot, so the icons line up; tree rows (depth set) fill it.
  function sideRow(path, label, role, o) {
    o = o || {};
    const tree = o.depth != null;
    const kids = st.tree.kids.get(path);
    const leaf = o.leaf || (kids && !kids.length);
    const tw = '<span class="tw' + (tree && !leaf ? (st.tree.open.has(path) ? ' open' : '') : ' none') + '"' + (tree && !leaf ? ' data-tw="' + esc(path) + '"' : '') + '>' + (tree ? I('forward', 12) : '') + '</span>';
    const drop = path === 'trash:' ? ' data-droptrash="1"' : canDropOn(path) ? ' data-dropdir="' + esc(path) + '"' : '';
    return '<button class="nav-item tv' + (st.path === path ? ' active' : '') + '" data-go="' + esc(path) + '"' + drop + (tree ? ' style="--d:' + o.depth + '"' : '') + ' title="' + esc(label) + '">' +
      tw + S(role) + '<span class="nm">' + esc(label) + '</span>' + (o.pin ? '<span class="pinmark">' + I('pin', 12) + '</span>' : '') + '</button>';
  }
  function treeRows(path, depth) {
    const kids = st.tree.open.has(path) && st.tree.kids.get(path);
    if (!kids) return '';
    return kids.map((k) => sideRow(k.path, k.name, k.type === 'drive' ? (k.usb ? 'place.removable' : 'place.drive') : folderIcon(k.path), { depth, leaf: k.type === 'dir' && k.count === 0 }) + treeRows(k.path, depth + 1)).join('');
  }
  function renderSide() {
    const side = $('#side');
    const top = side.scrollTop;
    side.innerHTML = sideRow('home:', 'Home', 'place.home') + '<div class="side-sep"></div>' +
      pins().map((p) => sideRow(p, util.basename(p), folderIcon(p), { pin: true })).join('') + (pins().length ? '<div class="side-sep"></div>' : '') +
      sideRow('device:', 'This PC', 'device.computer', { depth: 0 }) + treeRows('device:', 1) +
      sideRow('trash:', 'Trash', 'place.trash', { depth: 0, leaf: true });
    side.scrollTop = top;
  }
  // The folders under a branch of the tree (the drives, under This PC), fetched when it is opened.
  async function loadKids(path) {
    try {
      const list = path === 'device:' ? (await fs.drives()).map((d) => Object.assign({}, d, { type: 'drive' })).concat(usbDrives())
        : (await (isUsb(path) ? usbList(path) : fs.list(path))).filter((e) => e.type === 'dir' && !e.name.startsWith('.'))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      st.tree.kids.set(path, list);
    } catch (e) { st.tree.kids.set(path, []); } // gone, or can't be read: nothing to open
  }
  async function toggleTree(path) {
    if (st.tree.open.has(path)) st.tree.open.delete(path);
    else {
      st.tree.open.add(path);
      if (!st.tree.kids.has(path)) await loadKids(path);
    }
    savePref('tree', JSON.stringify([...st.tree.open]));
    renderSide();
  }
  // a folder just listed: its branch in the tree and its count in its parent's (so its arrow shows) are known now
  function syncTree(path, entries) {
    st.tree.kids.set(path, entries.filter((e) => e.type === 'dir' && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
    const up = st.tree.kids.get(parentOf(path));
    const me = up && up.find((k) => k.path === path);
    if (me && me.type === 'dir') me.count = entries.length;
  }
  // after a change on the drive: fetch the open branches again
  const loadTree = () => Promise.all([...st.tree.open].map(loadKids)).then(renderSide);

  function renderCrumbs() {
    const m = mode();
    let h;
    if (m === 'home') {
      h = '<button>Home</button>';
    } else if (m === 'device') {
      h = '<button>This PC</button>';
    } else if (m !== 'folder' && m !== 'usb') {
      h = '<button data-go="device:">This PC</button><span class="sepc">›</span><button>' + ({ trash: 'Trash', recent: 'Recent', search: 'Search results' })[m] + '</button>';
    } else if (m === 'usb') {
      const u = usbParse(st.path);
      const parts = u.path.split('/').filter(Boolean);
      h = '<button data-go="device:">This PC</button><span class="sepc">›</span><button data-go="' + esc(usbPath(u.id, '/')) + '">' + esc(usbName(u.id)) + '</button>' +
        parts.map((p, i) => '<span class="sepc">›</span><button data-go="' + esc(usbPath(u.id, '/' + parts.slice(0, i + 1).join('/'))) + '">' + esc(p) + '</button>').join('');
    } else {
      const parts = st.path.split('/').filter(Boolean);
      h = '<button data-go="device:">This PC</button><span class="sepc">›</span><button data-go="/">My drive</button>' +
        parts.map((p, i) => '<span class="sepc">›</span><button data-go="/' + esc(parts.slice(0, i + 1).join('/')) + '">' + esc(p) + '</button>').join('');
    }
    $('#crumbs').innerHTML = h;
    $('[data-c=back]').disabled = !st.back.length;
    $('[data-c=forward]').disabled = !st.fwd.length;
    $('[data-c=up]').disabled = m !== 'folder' && m !== 'usb';
  }

  // ------------------------------------------------------------------ data
  function sorted(list) {
    if (mode() === 'home') return list.slice(); // Quick access in pin order, then Recent, newest first
    const k = st.sort;
    const d = st.dir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      if ((mode() === 'folder' || mode() === 'usb') && a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      if (mode() === 'device' && !!a.usb !== !!b.usb) return a.usb ? 1 : -1; // My drive first, then the USB drives
      let r = 0;
      if (k === 'name') r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      else if (k === 'mtime') r = (a.mtime || a.deletedAt || 0) - (b.mtime || b.deletedAt || 0);
      else if (k === 'size') r = (a.size || 0) - (b.size || 0);
      else r = (a.ext || '').localeCompare(b.ext || '') || a.name.localeCompare(b.name);
      return r * d;
    });
  }

  // Opening a folder that takes a moment shows it's working, as Explorer does: after a short wait the pointer turns
  // to "working" and a bar runs along the address bar. Only the latest request draws: a folder opened after another
  // still loading wins. A refresh in the background (another window changed something) shows nothing.
  let loadSeq = 0;
  let busyTimer = 0;
  const setBusy = (on) => { clearTimeout(busyTimer); if (on) busyTimer = setTimeout(() => document.body.classList.add('loading'), 150); else document.body.classList.remove('loading'); };
  async function load(path, opts) {
    opts = opts || {};
    const seq = ++loadSeq;
    if (!opts.quiet) setBusy(true);
    try {
      let entries;
      if (path === 'home:') entries = await homeEntries();
      else if (path === 'device:') entries = (await fs.drives()).map((d) => Object.assign({}, d, { type: 'drive' })).concat(usbDrives());
      else if (isUsb(path)) entries = await usbList(path);
      else if (path === 'trash:') entries = (await fs.trash.list()).map((t) => Object.assign({}, t, { path: 'trash:' + t.id, ext: util.ext(t.name) }));
      else if (path === 'recent:') entries = await fs.recent();
      else if (path === 'search:') entries = await fs.search(st.query, '', 300);
      else entries = await fs.list(path);
      if (seq !== loadSeq) return; // another folder was asked for meanwhile
      if (opts.quiet && st.renaming && path === st.path) return; // a name is being typed: the rename reloads
      if (!opts.keepHistory && path !== st.path) { st.back.push(st.path); st.fwd = []; }
      st.path = path;
      st.entries = entries;
      if (path.startsWith('/') || isUsb(path)) syncTree(path, entries);
      if (!opts.keepSel) st.sel.clear();
      else st.sel = new Set([...st.sel].filter((p) => entries.some((e) => e.path === p)));
      render();
    } catch (e) {
      if (seq !== loadSeq) return;
      OS.notify(e.message, { type: 'error', title: 'Couldn’t open folder' });
      if (path !== '/' && !opts.fallback) load(isUsb(path) ? 'device:' : '/', { fallback: true });
    } finally {
      if (seq === loadSeq) setBusy(false);
    }
  }

  const refresh = () => { load(st.path, { keepHistory: true, keepSel: true, quiet: true }); loadUsage(); loadTree(); };
  const loadUsage = () => fs.usage().then((u) => { st.usage = u; renderStatus(); }).catch(() => {});
  // Home: the pinned folders, then the files opened or saved lately
  async function homeEntries() {
    const recent = await fs.recent().catch(() => []);
    return pins().map((p) => ({ name: util.basename(p), path: p, type: 'dir', pin: true })).concat((recent || []).slice(0, 40));
  }
  const selEntries = () => st.entries.filter((e) => st.sel.has(e.path));
  // what Delete acts on: a pin on Home is a shortcut to its folder, so it isn't trashed from there
  const selPaths = () => selEntries().filter((e) => !e.pin).map((e) => e.path);

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
    const usbHere = m === 'usb' && usbParse(st.path);
    const title = m === 'folder' ? (st.path === '/' ? 'My drive' : util.basename(st.path))
      : usbHere ? (usbHere.path === '/' ? usbName(usbHere.id) : util.basename(usbHere.path))
        : ({ home: 'Home', device: 'This PC', trash: 'Trash', recent: 'Recent', search: 'Search' })[m];
    // no page heading: the window title and the path bar say where you are; a note shows only when there is one
    const note = m === 'search' ? 'Results for “' + st.query + '”' : m === 'trash' ? 'Items here still use storage until you empty the Trash.' : '';
    $('#infobar').textContent = note;
    $('#infobar').hidden = !note;
    OS.win.setTitle(title + ' — Files');
    const content = $('#content');
    content.className = 'content' + (m === 'trash' ? ' trash-mode' : '') + (m === 'search' || m === 'recent' || m === 'home' ? ' search-mode' : '');
    const list = sorted(st.entries);
    const cutSet = (() => { const c = clip.get(); return c && c.mode === 'cut' ? new Set(c.paths) : new Set(); })();

    if (m === 'home') {
      // Home, as in Explorer: the pinned folders as tiles (where each one is, and its pin), then the recent files
      const sec = (key, label, body) => '<section class="home-sec"><button class="home-head" data-fold="' + key + '" aria-expanded="' + !st.fold.has(key) + '">' + I('down', 12) + label + '</button>' + (st.fold.has(key) ? '' : body) + '</section>';
      const qa = list.filter((e) => e.pin);
      const rec = list.filter((e) => !e.pin);
      content.innerHTML = sec('qa', 'Quick access', qa.length ? '<div class="items v-qa">' + qa.map((e) => '<div class="it' + (st.sel.has(e.path) ? ' sel' : '') + '" data-path="' + esc(e.path) + '" data-dropdir="' + esc(e.path) + '">' +
          '<span class="ic">' + tile(e, 48) + '</span><span class="tx"><span class="lbl" title="' + esc(e.name) + '">' + esc(e.name) + '</span><small>' + esc(where(e.path)) + '</small><small class="pinmark">' + I('pin', 12) + '</small></span></div>').join('') + '</div>'
        : '<div class="home-note">Pin folders here from their menu: Pin to Quick access.</div>') +
        sec('recent', 'Recent', rec.length ? listHtml(rec, 'recent', cutSet, true) : '<div class="home-note">Files you open or save show up here.</div>');
    } else if (m === 'device') {
      // devices and drives, like Explorer's "This PC": the drive's picture (its own .ico, or the generic disk),
      // its name, how full it is and how much is free
      content.innerHTML = '<div class="dev-head">' + I('down', 12) + 'Devices and drives</div><div class="drives">' + list.map((e) => {
        if (e.usb) {
          // a USB drive on the LiteLink device: how full it is once it has been opened (free space comes with a listing)
          const free = usb.free.get(e.id);
          const upct = free != null && e.size ? Math.min(100, Math.round(((e.size - free) / e.size) * 100)) : null;
          return '<div class="drive' + (st.sel.has(e.path) ? ' sel' : '') + '" data-path="' + esc(e.path) + '"' + (usb.write ? ' data-dropdir="' + esc(e.path) + '"' : '') + ' title="' + esc(e.name) + '">' +
            '<img class="drive-ico" src="' + esc(OS.sysIcon('place.removable')) + '" alt="" draggable="false"><span class="drive-txt"><span class="drive-name">' + esc(e.name) + '</span>' +
            (upct != null ? '<span class="drive-bar' + (upct >= 90 ? ' full' : '') + '"><i style="width:' + upct + '%"></i></span><small>' + esc(util.formatSize(free)) + ' free of ' + esc(util.formatSize(e.size)) + '</small>'
              : '<small>USB drive · ' + esc(util.formatSize(e.size)) + '</small>') + '</span></div>';
        }
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
        '<div>' + (m === 'folder' ? (LL ? 'Use New to make a file or folder here.' : 'Drop files here, or use New and Upload.') : m === 'usb' && usb.write ? 'Drop files here, or paste from My drive.' : m === 'recent' ? 'Files you open or save show up here.' : '') + '</div></div>';
    } else if (curView() !== 'list') {
      const v = curView();
      const isImg = (e) => e.type === 'file' && window.LOS_KINDS.image.includes(e.ext);
      const name = (e) => (st.renaming === e.path ? '<input class="input rename-input" value="' + esc(e.name) + '">' : esc(e.shown || e.name));
      const size = (e) => (e.type === 'dir' ? (e.count != null ? e.count + (e.count === 1 ? ' item' : ' items') : '') : util.formatSize(e.size));
      // the picture: a big icon view shows an image's own thumbnail; everything else is the bare file icon, no plate behind it
      const pic = (e, px) => (px >= 48 && isImg(e) && !e.usb ? '<img class="pic" loading="lazy" alt="" draggable="false" src="' + esc(fs.rawUrl(e.path)) + '" style="max-width:' + px + 'px;max-height:' + px + 'px">' : tile(e, px));
      const px = ICON_VIEWS[v] || (v === 'tiles' ? 48 : v === 'content' ? 40 : 20);
      content.innerHTML = '<div class="items v-' + v + '">' + list.map((e) => {
        let inner;
        if (v === 'tiles') inner = '<span class="ic">' + pic(e, px) + '</span><span class="tx"><span class="lbl" title="' + esc(e.name) + '">' + name(e) + '</span><small>' + esc(kindOf(e)) + '</small><small>' + esc(size(e)) + '</small></span>';
        else if (v === 'content') inner = '<span class="ic">' + pic(e, px) + '</span><span class="tx"><span class="lbl" title="' + esc(e.name) + '">' + name(e) + '</span><small>' + esc(m === 'folder' || m === 'usb' ? kindOf(e) : util.dirname(e.path)) + '</small></span>' +
          '<span class="tx r"><small>Date modified: ' + esc(util.formatDate(e.mtime)) + '</small><small>' + (e.type === 'dir' ? '' : 'Size: ' + esc(size(e))) + '</small></span>';
        else inner = '<span class="ic">' + pic(e, px) + '</span><span class="lbl" title="' + esc(e.name) + '">' + name(e) + '</span>';
        return '<div class="it' + (st.sel.has(e.path) ? ' sel' : '') + (cutSet.has(e.path) ? ' cut' : '') + (e.pending ? ' pending' : '') + '" data-path="' + esc(e.path) + '" draggable="' + !e.pending + '"' + (e.type === 'dir' && canDropOn(e.path) ? ' data-dropdir="' + esc(e.path) + '"' : '') + '>' + inner + '</div>';
      }).join('') + '</div>';
    } else {
      content.innerHTML = listHtml(list, m, cutSet);
    }
    const ri = content.querySelector('.rename-input');
    if (ri) {
      ri.focus();
      const dot = ri.value.lastIndexOf('.');
      ri.setSelectionRange(0, dot > 0 ? dot : ri.value.length);
      ri.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finishRename(ri.value); if (ev.key === 'Escape') finishRename(ri.defaultValue); });
      ri.addEventListener('blur', () => finishRename(ri.value));
      ri.addEventListener('mousedown', (ev) => ev.stopPropagation());
      ri.addEventListener('dblclick', (ev) => ev.stopPropagation());
    }
    renderDetails();
    renderStatus();
  }

  // Details: a header (its buttons sort, except on Home) and one row per item
  function listHtml(list, m, cutSet, plain) {
    const arrow = (k) => (st.sort === k ? (st.dir === 'asc' ? ' ↑' : ' ↓') : '');
    const hb = (k, label) => (plain ? '<span>' + label + '</span>' : '<button data-sort="' + k + '">' + label + arrow(k) + '</button>');
    let head;
    if (m === 'trash') head = '<div class="thead">' + hb('name', 'Name') + '<span>Original location</span>' + hb('mtime', 'Deleted') + hb('size', 'Size') + '</div>';
    else if (m === 'folder' || m === 'usb') head = '<div class="thead">' + hb('name', 'Name') + hb('mtime', 'Modified') + hb('size', 'Size') + hb('type', 'Type') + '</div>';
    else head = '<div class="thead">' + hb('name', 'Name') + '<span>Location</span>' + hb('mtime', 'Modified') + hb('size', 'Size') + '</div>';
    return head + list.map((e) => {
      const nm = '<span class="nm">' + tile(e, 26, 7) + (st.renaming === e.path ? '<input class="input rename-input" value="' + esc(e.name) + '">' : '<span>' + esc(e.shown || e.name) + '</span>') + '</span>';
      let cols;
      if (m === 'trash') cols = '<span class="c">' + esc(util.dirname(e.original)) + '</span><span class="c m">' + esc(util.formatDate(e.deletedAt)) + '</span><span class="c m">' + (e.type === 'dir' ? '—' : esc(util.formatSize(e.size))) + '</span>';
      else if (m === 'folder' || m === 'usb') cols = '<span class="c">' + esc(util.formatDate(e.mtime)) + '</span><span class="c m">' + (e.type === 'dir' ? (e.count != null ? e.count + ' items' : '—') : esc(util.formatSize(e.size))) + '</span><span class="c m">' + esc(kindOf(e)) + '</span>';
      else cols = '<span class="c">' + esc(where(e.path)) + '</span><span class="c m">' + esc(util.formatDate(e.mtime)) + '</span><span class="c m">' + (e.type === 'dir' ? '—' : esc(util.formatSize(e.size))) + '</span>';
      return '<div class="frow' + (st.sel.has(e.path) ? ' sel' : '') + (cutSet.has(e.path) ? ' cut' : '') + (e.pending ? ' pending' : '') + '" data-path="' + esc(e.path) + '"' + (m !== 'trash' && !e.pending ? ' draggable="true"' : '') + (e.type === 'dir' && (m === 'folder' || m === 'usb') && canDropOn(e.path) ? ' data-dropdir="' + esc(e.path) + '"' : '') + '>' + nm + cols + '</div>';
    }).join('');
  }

  function renderStatus() {
    const n = st.entries.length;
    $('#st-count').textContent = n + (n === 1 ? ' item' : ' items');
    const sel = selEntries();
    const size = sel.reduce((a, e) => a + (e.size || 0), 0);
    $('#st-sel').textContent = sel.length ? sel.length + ' selected' + (size ? ' · ' + util.formatSize(size) : '') : '';
    const here = mode() === 'usb' && usbParse(st.path);
    const free = here && usb.free.get(here.id);
    $('#st-sync').textContent = here ? (free != null ? util.formatSize(free) + ' free' : '') + (usb.write ? '' : (free != null ? ' · ' : '') + 'Read only')
      : st.usage ? util.formatSize(st.usage.used) + ' used' : '';
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
    const isImg = e.type === 'file' && !e.usb && window.LOS_KINDS.image.includes(e.ext);
    const loc = e.usb ? usbWhere(parentOf(e.path)) : util.dirname(e.path) === '/' ? 'My drive' : 'My drive' + util.dirname(e.path).replace(/\//g, ' › ');
    d.innerHTML = '<div class="preview">' + (isImg ? '<img alt="" src="' + esc(fs.rawUrl(e.path)) + '">' : tile(e, 64, 16)) + '</div>' +
      '<div><div class="name">' + esc(e.name) + '</div><div class="hint">' + esc(kindOf(e)) + '</div></div>' +
      '<div class="row"><button class="btn btn-primary grow" data-c="open">Open</button>' + (e.type === 'file' ? '<button class="btn grow" data-c="download">Download</button>' : '') +
      '<button class="icon-btn" data-c="more" aria-label="More actions" style="border:1px solid var(--line-strong);width:32px;height:32px">' + I('more') + '</button></div>' +
      '<dl>' + (e.type === 'file' ? '<dt>Size</dt><dd>' + esc(util.formatSize(e.size)) + '</dd>' : (e.count != null ? '<dt>Contains</dt><dd>' + e.count + ' items</dd>' : '')) +
      '<dt>Modified</dt><dd>' + esc(util.formatDate(e.mtime)) + '</dd><dt>Location</dt><dd>' + esc(loc) + '</dd></dl>';
  }

  // ------------------------------------------------------------------ actions
  function go(path) {
    if (path === st.path) return;
    st.renaming = null;
    load(path);
  }

  function openEntry(e) {
    if (mode() === 'trash' || e.pending) return;
    if (e.type === 'drive') { go(e.path); return; }
    if (e.type === 'dir') go(e.path);
    else if (e.usb) usbOpen(e);
    else OS.openFile(e.path);
  }

  // A new folder or file shows at once, its icon shimmering while it is made, with its name open for typing over
  // ("New folder", "New folder (2)"…); a name typed before it exists is used once it does (finishRename).
  async function newItem(t) {
    if (!isFolder()) return;
    const taken = new Set(st.entries.map((x) => x.name.toLowerCase()));
    let name = '';
    for (let i = 1; i <= 50 && !name; i++) {
      const n = t ? t.name + (i > 1 ? ' ' + i : '') + '.' + t.ext : 'New folder' + (i > 1 ? ' (' + i + ')' : '');
      if (!taken.has(n.toLowerCase())) name = n;
    }
    if (!name) return;
    const path = util.join(st.path, name);
    const entry = { name, path, type: t ? 'file' : 'dir', ext: t ? t.ext : '', size: 0, count: 0, mtime: Math.floor(Date.now() / 1000), pending: true };
    entry.made = t ? fs.write(path, '', { overwrite: false }) : fs.mkdir(path);
    entry.made.catch(() => {}); // reported below
    st.entries = st.entries.concat(entry);
    st.renaming = path;
    select([path]);
    try { await entry.made; } catch (ex) {
      st.entries = st.entries.filter((x) => x !== entry);
      if (st.renaming === path) st.renaming = null;
      st.sel.delete(path);
      render();
      OS.notify(ex.message, { type: 'error', title: t ? 'Couldn’t create file' : 'Couldn’t create folder' });
      return;
    }
    announce();
    // still being named: stop the shimmer without redrawing (that would reset the box being typed in)
    if (st.renaming === path) {
      entry.pending = false;
      const row = content.querySelector('[data-path="' + CSS.escape(path) + '"]');
      if (row) { row.classList.remove('pending'); row.setAttribute('draggable', 'true'); }
    } else entry.pending = false; // named already: finishRename takes it from here
  }

  function select(paths) { st.sel = new Set(paths); st.anchor = paths[0] || null; render(); }

  async function finishRename(value) {
    const path = st.renaming;
    if (!path) return;
    st.renaming = null;
    const e = st.entries.find((x) => x.path === path);
    const name = value.trim();
    if (e && e.usbNew) { delete e.usbNew; usbMakeFolder(e, name || e.name); return; } // a new folder on a drive
    if (e && e.made) {
      // a new item: show the name typed while it is still being made, then wait for it
      if (e.pending && name && name !== e.name) { e.shown = name; render(); }
      try { await e.made; } catch (ex) { return; } // newItem reports it and takes the item away
      e.pending = false;
      delete e.made;
      if (!name || name === e.name) { await load(st.path, { keepHistory: true, keepSel: true, quiet: true }); return; }
    }
    if (!e || !name || name === e.name) { render(); return; }
    try { const r = await fs.rename(path, name); await load(st.path, { keepHistory: true }); select([r.path]); announce(); }
    catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t rename' }); e.shown = ''; render(); }
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
    // to or from a USB drive: always a copy (a drive's items can't be cut)
    if (isUsb(dest)) { if (usb.write) usbExport(await driveItems(c.paths.filter((p) => !isUsb(p))).catch(() => []), dest); return; }
    if (c.paths.some(isUsb)) { usbImport(c.paths.filter(isUsb), dest); return; }
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
    if (isUsb(dir)) { if (usb.write) await usbExport(files.map((f) => ({ name: f.name, file: f })), dir); return; } // from the computer onto a drive
    OS.notify('Uploading ' + files.length + (files.length === 1 ? ' file…' : ' files…'), { title: 'Upload started' });
    try {
      await fs.upload(dir, files);
      OS.notify(files.length + (files.length === 1 ? ' file was' : ' files were') + ' added to ' + (dir === '/' ? 'My drive' : util.basename(dir)) + '.', { type: 'success', title: 'Upload complete' });
      refresh();
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Upload failed' }); }
  }

  function download(e) {
    if (e.usb) { usbDownload(e); return; }
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
    if (e.usb) { usbItemMenu(e, at); return; }
    const multi = st.sel.size > 1;
    const isImg = e.type === 'file' && window.LOS_KINDS.image.includes(e.ext);
    const items = [{ label: 'Open', icon: 'forward', key: 'Enter', action: () => selEntries().forEach(openEntry) }];
    if (e.type === 'file' && !multi) items.push({ label: 'Open with…', icon: 'apps', action: () => openWithMenu(e, at) });
    if (e.pin) { folderMenu(e.path, at); return; }
    if (e.type === 'dir' && !multi) items.push({ label: 'Open in new window', icon: 'plus', action: () => OS.open('files', { path: e.path }) }, pinItem(e.path));
    if (!multi && window.LOS_opensWithCode(e.name, e.type === 'dir')) items.push({ label: 'Open with Code', icon: 'code', action: () => OS.open('code', e.type === 'dir' ? { folder: e.path } : { path: e.path }) });
    // ZIP archives are unpacked by Archives, in the browser (it checks the admin's limits, then uploads file by file)
    if (e.type === 'file' && !multi && ['zip', 'tar', 'tgz', 'gz', '7z', 'rar'].includes(e.ext)) {
      items.push({ label: 'Extract Here', icon: 'archive', action: () => OS.open('archives', { path: e.path, extract: 'here' }) },
        { label: 'Extract To…', icon: 'archive', action: () => OS.open('archives', { path: e.path, extract: 'to' }) });
    }
    items.push({ label: 'Compress to ZIP', icon: 'archive', action: () => OS.open('archives', { compress: [...st.sel].join(String.fromCharCode(10)) }) });
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

  // An item on a USB drive: open it, copy it (Paste in My drive), or copy it straight to a folder there
  function usbItemMenu(e, at) {
    const multi = st.sel.size > 1;
    const paths = () => [...st.sel].filter(isUsb);
    const items = [{ label: 'Open', icon: 'forward', key: 'Enter', action: () => selEntries().forEach(openEntry) }];
    if (e.type === 'dir' && !multi) items.push({ label: 'Open in new window', icon: 'plus', action: () => OS.open('files', { path: e.path }) });
    items.push('sep',
      { label: 'Copy', icon: 'copy', key: 'Ctrl+C', action: () => { clip.set({ mode: 'copy', paths: paths() }); render(); } },
      { label: 'Copy to My drive…', icon: 'folder', action: async () => {
        const dest = await OS.dialog.folder({ title: 'Copy to', startIn: '/' });
        if (dest) usbImport(paths(), dest);
      } });
    if (e.type === 'dir' && !multi && usb.write && clip.get()) items.push({ label: 'Paste into folder', icon: 'paste', action: () => paste(e.path) });
    if (e.type === 'file' && !multi) items.push({ label: 'Download', icon: 'download', action: () => download(e) });
    OS.menu(items, at);
  }

  // a folder in the pane or a pin on Home: open it, or pin and unpin it
  function pinItem(p) {
    return isPinned(p) ? { label: 'Unpin from Quick access', icon: 'unpin', action: () => setPinned(p, false) } : { label: 'Pin to Quick access', icon: 'pin', action: () => setPinned(p, true) };
  }
  function folderMenu(p, at) {
    const items = [{ label: 'Open', icon: 'open', action: () => go(p) }, { label: 'Open in new window', icon: 'plus', action: () => OS.open('files', { path: p }) }];
    if (p !== '/' && !isUsb(p)) items.push('sep', pinItem(p)); // pins follow the user to other devices: never a USB drive's folder
    OS.menu(items, at);
  }

  // ---- This PC: a drive's menu and the background's, like Explorer's "This PC"
  function driveProps(e) {
    propsDialog({ name: e.name, icon: e.icon ? fs.rawUrl(e.icon) : DISK, type: 'LiteOS Drive', capacity: e.quota, free: Math.max(0, e.quota - e.used) });
  }
  // A drive's properties, as in Explorer: what it is, used and free space (in bytes and short, with their colours),
  // the capacity, and a ring showing how full it is. My drive and USB drives share it; a USB drive also has Eject.
  // Its own dialog (not OS.dialog.alert) because it needs the layout; it follows the system dialog look (dialog.css).
  function propsDialog(o) {
    const bytes = (v) => Number(v || 0).toLocaleString('en-US') + ' bytes';
    // three significant figures, as Explorer shows them: 68.0 KB, 7.48 GB, 512 MB
    const short = (v) => {
      v = Number(v || 0);
      if (v < 1024) return v + ' bytes';
      const units = ['KB', 'MB', 'GB', 'TB'];
      let i = -1;
      do { v /= 1024; i++; } while (v >= 1000 && i < units.length - 1);
      return v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2) + ' ' + units[i];
    };
    const known = o.free != null && o.capacity > 0;
    const used = known ? Math.max(0, o.capacity - o.free) : 0;
    const pct = known ? Math.min(1, used / o.capacity) : 0;
    const full = pct >= 0.9;
    const C = 2 * Math.PI * 34;
    const ring = '<svg class="pr-ring" viewBox="0 0 88 88" width="88" height="88" aria-hidden="true"><circle class="pr-free" cx="44" cy="44" r="34"/>' +
      (pct > 0 ? '<circle class="pr-used' + (full ? ' full' : '') + '" cx="44" cy="44" r="34" stroke-dasharray="' + Math.max(1.5, C * pct).toFixed(2) + ' ' + C.toFixed(2) + '" transform="rotate(-90 44 44)"/>' : '') + '</svg>';
    // Laid out like Explorer's General page: the icon and name, Type and File system, Used and Free space with their
    // colours, Capacity, then the ring with the drive's name under it and Eject where Explorer has Details
    const row = (k, v, s, sw) => '<span class="pr-sw' + (sw ? ' ' + sw : '') + '"></span><span class="pr-k">' + esc(k) + ':</span><span class="pr-v">' + esc(v) + '</span><span class="pr-s">' + esc(s || '') + '</span>';
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg pr-dlg';
    dlg.setAttribute('aria-labelledby', 'pr-title');
    dlg.innerHTML = '<h2 class="dlg-title" id="pr-title">' + esc(o.name) + ' Properties</h2>' +
      // Explorer's tabs; only General has anything yet, the others show but can't be chosen
      '<div class="pr-tabs" role="tablist"><button class="pr-tab" role="tab" aria-selected="true">General</button>' +
        ['Tools', 'Hardware', 'Sharing', 'Customize'].map((t) => '<button class="pr-tab" role="tab" aria-selected="false" disabled title="Not available yet">' + t + '</button>').join('') +
      '</div><div class="dlg-body">' +
      '<div class="pr-head"><img src="' + esc(o.icon) + '" width="36" height="36" alt="" draggable="false"><input class="input pr-name" value="' + esc(o.name) + '" readonly aria-label="Name"></div>' +
      '<div class="pr-grid pr-info">' + row('Type', o.type) + (o.fs ? row('File system', o.fs) : '') + '</div>' +
      '<div class="pr-grid">' + (known ? row('Used space', bytes(used), short(used), 'used' + (full ? ' full' : '')) + row('Free space', bytes(o.free), short(o.free), 'free')
        : row('Used space', 'Open the drive to see it')) + '</div>' +
      '<div class="pr-grid pr-cap">' + row('Capacity', bytes(o.capacity), short(o.capacity)) + '</div>' +
      '<div class="pr-chart">' + (known ? ring : '') + '<div class="pr-foot"><span class="pr-cap-name">' + esc(o.label || o.name) + '</span>' +
        (o.eject ? '<button class="btn" data-a="eject">Eject</button>' : '') + '</div></div></div>' +
      '<div class="dlg-actions"><button class="btn is-default" data-a="ok" autofocus>OK</button><button class="btn" data-a="cancel">Cancel</button></div>';
    dlg.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-a]');
      if (!a) return;
      dlg.close(); // OK and Cancel both just close: nothing here can be changed yet
      if (a.dataset.a === 'eject') o.eject();
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function driveMenu(e, at) {
    if (e.usb) {
      OS.menu([
        { label: 'Open', icon: 'open', key: 'Enter', action: () => go(e.path) },
        { label: 'Open in new window', icon: 'plus', action: () => OS.open('files', { path: e.path }) },
        'sep',
        { label: 'Eject', action: () => usbEject(e.id) },
        'sep',
        { label: 'Properties', icon: 'info', action: () => usbProps(e) },
      ], at);
      return;
    }
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
    if (mode() === 'usb') {
      const u = usbParse(st.path);
      OS.menu([viewItem(), sortItem(), 'sep', { label: 'Refresh', icon: 'reload', key: 'F5', action: refresh }]
        .concat(usb.write ? [{ label: 'Paste', icon: 'paste', key: 'Ctrl+V', disabled: !clip.get(), action: () => paste(st.path) }, 'sep',
          { label: 'New folder', icon: 'folder', action: usbNewFolder }] : [])
        .concat(['sep', { label: 'Eject ' + usbName(u.id), action: () => usbEject(u.id) }]), at);
      return;
    }
    if (!isFolder()) return;
    OS.menu([
      viewItem(),
      sortItem(),
      'sep',
      { label: 'Refresh', icon: 'reload', key: 'F5', action: refresh },
      { label: 'Paste', icon: 'paste', key: 'Ctrl+V', disabled: !clip.get(), action: () => paste(st.path) },
      'sep',
      { label: 'New', icon: 'plus', items: newItems() },
      ...(LL ? [] : [{ label: 'Upload files', icon: 'upload', action: () => $('#upload').click() }]), // not on a LiteLink thin client
    ].concat(window.LOS_opensWithCode(st.path, true) ? ['sep', { label: 'Open with Code', icon: 'code', action: () => OS.open('code', { folder: st.path }) }] : []), at);
  }

  // View and Sort by, as submenus (the background menu) and on their own (toolbar buttons)
  // the Explorer set; 'grid' (medium icons) and 'list' (details) keep their old names so saved choices still apply
  const VIEWS = [['xl', 'Extra large icons', 'square'], ['lg', 'Large icons', 'square'], ['grid', 'Medium icons', 'grid'], ['sm', 'Small icons', 'grid'],
    ['compact', 'List', 'ul'], ['list', 'Details', 'list'], ['tiles', 'Tiles', 'grid'], ['content', 'Content', 'table']]
    .map(([v, label, icon], i) => [v, label, icon, 'Ctrl+Shift+' + (i + 1)]);
  const ICON_VIEWS = { xl: 96, lg: 64, grid: 48, sm: 20 };
  // the Trash only has a details view (it needs the original location and deleted columns)
  const curView = () => (mode() === 'trash' || !VIEWS.some(([v]) => v === st.view) ? 'list' : st.view);
  const viewLabel = () => VIEWS.find(([v]) => v === curView())[1];
  const SORTS = [['name', 'Name'], ['mtime', 'Date modified'], ['size', 'Size'], ['type', 'Type']];
  function setView(v) { st.view = v; savePref('view', v); render(); }
  function toggleDetails() { st.details = !st.details; savePref('details', st.details ? '1' : '0'); render(); }
  function viewItems() {
    return [
      ...VIEWS.map(([v, label, icon, key]) => ({ label, icon, key, checked: curView() === v, disabled: mode() === 'trash' && v !== 'list', action: () => setView(v) })),
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
    const tw = ev.target.closest('[data-tw]');
    if (tw) { toggleTree(tw.dataset.tw); return; }
    const fold = ev.target.closest('[data-fold]');
    if (fold) {
      const k = fold.dataset.fold;
      if (st.fold.has(k)) st.fold.delete(k); else st.fold.add(k);
      savePref('fold', [...st.fold].join(','));
      render();
      return;
    }
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
      case 'up': go(parentOf(st.path)); break;
      case 'new': if (mode() === 'usb') usbNewFolder(); else newMenu(at); break;
      case 'eject': {
        const one = sel.length === 1 && sel[0];
        const id = mode() === 'usb' ? usbParse(st.path).id : one && one.usb ? one.id : null;
        if (id) usbEject(id);
        break;
      }
      case 'upload': $('#upload').click(); break;
      case 'cut': clip.set({ mode: 'cut', paths: [...st.sel] }); render(); break;
      case 'copy': clip.set({ mode: 'copy', paths: [...st.sel] }); OS.notify('Paste in any folder to make a copy.', { title: 'Ready to paste' }); render(); break;
      case 'paste': paste(st.path); break;
      case 'rename': if (sel[0]) { st.renaming = sel[0].path; render(); } break;
      case 'download': if (sel[0]) download(sel[0]); break;
      case 'delete': del(selPaths()); break;
      case 'sort': sortMenu(at); break;
      case 'view': OS.menu(viewItems(), at); break;
      case 'details': toggleDetails(); break;
      case 'more': moreMenu(at); break;
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
      if (ev.button === 0 && !ev.target.closest('.thead, .home-head, input') && ev.clientX < content.getBoundingClientRect().left + content.clientWidth) marquee(ev); // not on the scrollbar
      return;
    }
    const p = row.dataset.path;
    // in Details, a press beside the name (not on it) draws a selection rectangle, as in Explorer
    if (ev.button === 0 && row.classList.contains('frow') && !ev.target.closest('.nm > *, input') && !ev.shiftKey) { ev.preventDefault(); marquee(ev, p); return; }
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
  // Drag on empty space to draw a selection rectangle: it selects every item it touches, in any view (Ctrl keeps
  // what was selected), and scrolls the list when the pointer goes past its top or bottom edge.
  function marquee(ev, clickPath) { // clickPath: a Details row pressed beside its name; a plain click there selects it
    const keep = ev.ctrlKey || ev.metaKey ? new Set(st.sel) : new Set();
    const cr = () => content.getBoundingClientRect();
    const toContent = (x, y) => { const r = cr(); return { x: x - r.left + content.scrollLeft, y: y - r.top + content.scrollTop }; };
    const start = toContent(ev.clientX, ev.clientY);
    let last = { x: ev.clientX, y: ev.clientY };
    let mq = null;
    let raf = 0;
    if (!keep.size && st.sel.size) { st.sel.clear(); render(); }
    const draw = () => {
      const p = toContent(last.x, last.y);
      if (!mq && Math.abs(p.x - start.x) + Math.abs(p.y - start.y) < 4) return;
      if (!mq) { mq = document.createElement('div'); mq.className = 'marquee'; content.appendChild(mq); }
      const x = Math.min(start.x, p.x); const y = Math.min(start.y, p.y);
      const w = Math.abs(p.x - start.x); const h = Math.abs(p.y - start.y);
      Object.assign(mq.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      const r0 = cr();
      st.sel = new Set(keep);
      content.querySelectorAll('[data-path]').forEach((el) => {
        const r = el.getBoundingClientRect();
        const t = r.top - r0.top + content.scrollTop; const l = r.left - r0.left + content.scrollLeft;
        const hit = l < x + w && l + r.width > x && t < y + h && t + r.height > y;
        if (hit) st.sel.add(el.dataset.path);
        el.classList.toggle('sel', st.sel.has(el.dataset.path));
      });
    };
    // keep scrolling while the pointer is held past the edge
    const tick = () => {
      const r = cr();
      const dy = last.y < r.top + 8 ? -Math.min(30, r.top + 8 - last.y) : last.y > r.bottom - 8 ? Math.min(30, last.y - r.bottom + 8) : 0;
      if (dy) { content.scrollTop += dy; draw(); }
      raf = requestAnimationFrame(tick);
    };
    const move = (e) => { last = { x: e.clientX, y: e.clientY }; draw(); };
    const up = () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (mq) { mq.remove(); st.anchor = [...st.sel][0] || null; render(); }
      else if (clickPath) { if (keep.size) { if (keep.has(clickPath)) keep.delete(clickPath); else keep.add(clickPath); st.sel = keep; st.anchor = clickPath; render(); } else select([clickPath]); }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    raf = requestAnimationFrame(tick);
  }

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
  $('#side').addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const b = ev.target.closest('[data-go]');
    if (!b) return;
    const p = b.dataset.go;
    if (p === 'device:') deviceMenu(ev);
    else if (p === 'trash:') OS.menu([{ label: 'Open', icon: 'open', action: () => go(p) }, 'sep', { label: 'Empty Trash', icon: 'trash', danger: true, action: () => trashAction('purge') }], ev);
    else if (p.startsWith('/')) folderMenu(p, ev);
    else if (isUsb(p)) {
      const u = usbParse(p);
      const d = usbDrive(u.id);
      if (u.path === '/' && d) driveMenu(usbEntry(d), ev); else folderMenu(p, ev);
    }
    else OS.menu([{ label: 'Open', icon: 'open', action: () => go(p) }], ev);
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
    if (ctrl && ev.shiftKey && /^Digit[1-8]$/.test(ev.code)) { ev.preventDefault(); if (mode() !== 'trash') setView(VIEWS[+ev.code.slice(5) - 1][0]); return; }
    if (ev.altKey && ev.shiftKey && ev.code === 'KeyP') { ev.preventDefault(); toggleDetails(); return; }
    if (mode() === 'device') { if (ev.key === 'Enter' && sel.length) { ev.preventDefault(); sel.forEach(openEntry); } return; }
    // a USB drive's items can't be trashed, renamed or cut
    if (mode() === 'usb' && (ev.key === 'Delete' || ev.key === 'F2' || (ctrl && ev.key.toLowerCase() === 'x'))) return;
    if (ev.key === 'Delete' && sel.length) { ev.preventDefault(); if (mode() === 'trash') trashAction('purge', trashIds()); else del(selPaths()); }
    else if (ev.key === 'F2' && sel.length === 1 && mode() !== 'trash' && !sel[0].pin) { ev.preventDefault(); st.renaming = sel[0].path; render(); }
    else if (ev.key === 'Enter' && sel.length) { ev.preventDefault(); sel.forEach(openEntry); }
    else if (ev.key === 'Backspace' && (isFolder() || mode() === 'usb')) { ev.preventDefault(); go(parentOf(st.path)); }
    else if (ctrl && ev.key.toLowerCase() === 'a') { ev.preventDefault(); select(st.entries.map((e) => e.path)); }
    else if (ctrl && ev.key.toLowerCase() === 'c' && sel.length && mode() !== 'trash') { clip.set({ mode: 'copy', paths: [...st.sel] }); render(); }
    else if (ctrl && ev.key.toLowerCase() === 'x' && sel.length && mode() !== 'trash') { clip.set({ mode: 'cut', paths: [...st.sel] }); render(); }
    else if (ctrl && ev.key.toLowerCase() === 'v' && canPasteHere()) { paste(st.path); }
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
    // desktop icons are moved by the shell on the server: never onto a USB drive
    if (target && !isUsb(target.dataset.dropdir)) { target.classList.add('drop'); return target.dataset.droptrash ? 'trash:' : target.dataset.dropdir; }
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
    } else if (canPasteHere() && main.contains(ev.target) && (external || (internal && !dragPaths))) {
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
      if (LL) return; // the thin client's own files don't come in (LiteLink device)
      const dir = target && target.dataset.dropdir ? target.dataset.dropdir : (canPasteHere() ? st.path : null);
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
    if (target && target.dataset.droptrash) { if (!paths.some(isUsb)) { await del(paths); announce(); } return; }
    const dest = target && target.dataset.dropdir ? target.dataset.dropdir : (!local && canPasteHere() ? st.path : null);
    if (!dest) return;
    // to or from a USB drive: a copy, whatever the keys
    if (isUsb(dest)) { const mine = paths.filter((p) => !isUsb(p)); if (mine.length && usb.write) usbExport(await driveItems(mine).catch(() => []), dest); return; }
    if (paths.some(isUsb)) { usbImport(paths.filter(isUsb), dest); return; }
    try {
      if (ev.ctrlKey) await fs.copy(paths, dest); else await fs.move(paths, dest);
      refresh();
      announce();
      if (!local) OS.notify((ev.ctrlKey ? 'Copied ' : 'Moved ') + paths.length + (paths.length === 1 ? ' item' : ' items') + ' to ' + (dest === '/' ? 'My drive' : util.basename(dest)) + '.', { type: 'success', title: ev.ctrlKey ? 'Items copied' : 'Items moved' });
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: ev.ctrlKey ? 'Couldn’t copy items' : 'Couldn’t move items' }); }
  });

  // Theme changes don't need a re-render (CSS variables), but settings like wallpaper don't affect Files.
  OS.win.keepState(() => ({ path: st.path === 'search:' ? (st.back[st.back.length - 1] || 'home:') : st.path, scroll: $('#content').scrollTop }));
  // a USB drive's folder (after a reload, or opened in a new window) only where LiteLink is: it lists the drives first
  const start = ['home:', 'device:', 'trash:', 'recent:'].includes(st.path) || st.path.startsWith('/') ? st.path : isUsb(st.path) && LL ? st.path : 'home:';
  (isUsb(start) ? LL.ready.then(() => LL.storage.list()).then((d) => { usb.drives = d; }, () => {}) : Promise.resolve())
    .then(() => load(start, { keepHistory: true })).then(() => {
    if (kept.scroll > 0) $('#content').scrollTop = kept.scroll;
    // Other apps can ask Files to highlight a file: LiteOS.open('files', { path: dir, select: file })
    if (OS.args.select && st.entries.some((e) => e.path === OS.args.select)) select([OS.args.select]);
  });
  loadUsage();
  loadTree();
  // pins changed (here, in another Files window or on another device): the pane and Home follow
  let pinKey = JSON.stringify(pins());
  OS.onSettings(() => {
    const k = JSON.stringify(pins());
    if (k === pinKey) return;
    pinKey = k;
    renderSide();
    if (mode() === 'home') load('home:', { keepHistory: true, keepSel: true });
  });
});
