/* LiteOS desktop shell: sign-in, setup, window manager, dock/taskbar, launcher,
 * quick settings, dialogs and the host API that apps talk to (window.LiteOSHost). */
(function () {
  'use strict';

  const root = document.getElementById('os');
  const endpoint = (action) => window.LOS_endpoint(action);
  // a file on the user's drive as a URL (pictures, wallpapers, downloads)
  const rawUrl = (path, download) => endpoint('fs.raw') + '?path=' + encodeURIComponent(path) + (download ? '&download=1' : '');
  // system icons come from the icon set where it has one for the glyph name (LOS_sysGlyph), the glyph otherwise
  const ICON = (n, s, c) => window.LOS_sysGlyph(n, s, c);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  const S = { csrf: window.LOS_CONFIG.csrf, user: null, settings: null, system: {}, setupNeeded: false };
  const UI = { pop: null, lsQuery: '', recent: [], results: [], usage: null, lockShown: false };
  const subs = new Set();
  const wins = new Map();
  let zTop = 100;
  let focusedId = null;
  let winSeq = 0;
  const DEFAULTS = {
    theme: 'light', accent: '#2F6FD6', wallpaper: 'siamese', wallpaperFit: 'cover', taskbar: 'floating', align: 'center',
    iconSize: 'medium', autohide: false, labels: false, topbar: true, magnify: true, transparency: true, nightLight: false,
    dnd: false, textSize: 'default', clock24: true, pinned: ['files', 'documents', 'sheets', 'slides', 'code', 'media', 'browser', 'board'], desktopIcons: ['files', 'trash'],
    deskIcons: true, deskIconSize: 'medium', deskSort: 'name', deskLayout: {},
    quickAccess: ['/Desktop', '/Downloads', '/Documents', '/Pictures', '/Music', '/Videos'],
  };

  // ================================================================== api
  // An action ('fs.list') is a route (/os/fs/list, see LOS_endpoint): GET with `query` for reads (data undefined),
  // POST with a JSON or FormData body for changes. Replies are { success, message, result }; this returns `result`,
  // or throws the message (a plain sentence, shown to the user).
  async function api(action, data, query, retried) {
    const read = data === undefined;
    let url = endpoint(action);
    if (query && Object.keys(query).length) url += '?' + new URLSearchParams(query).toString();
    const opts = { credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } };
    if (!read) {
      opts.method = 'POST';
      opts.headers['X-CSRF-TOKEN'] = S.csrf || '';
      // Form data from an app window belongs to that iframe's realm, so `instanceof FormData` is false there.
      if (Object.prototype.toString.call(data) === '[object FormData]') opts.body = data;
      else { opts.body = JSON.stringify(data || {}); opts.headers['Content-Type'] = 'application/json'; }
    }
    let res;
    try { res = await fetch(url, opts); } catch (e) { throw new Error('Can’t reach the server. Check your connection.'); }
    const json = await res.json().catch(() => ({ success: false, message: 'Unexpected response from the server.' }));
    if (!res.ok || !json.success) {
      if (res.status === 419 && !retried) {
        const st = await api('auth.status');
        S.csrf = st.csrf;
        return api(action, data, query, true);
      }
      if (res.status === 401 && S.user) sessionLost();
      if (res.status === 423 && S.user) lockScreen(true); // locked in another tab: lock here too
      throw new Error(json.message || 'Request failed');
    }
    if (!read && /^(fs|trash)\./.test(action) && typeof deskFilesChanged === 'function') deskFilesChanged();
    return json.result;
  }

  function sessionLost() {
    S.user = null;
    notify('You were signed out. Sign in again to continue.', { type: 'error', title: 'Signed out' });
    setTimeout(() => location.reload(), 1500);
  }

  // ================================================================== helpers
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const avatar = (u, size) => '<span class="avatar" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.38) + 'px;background:' + esc(u.color || '#2F6FD6') + '">' + esc(initials(u.name)) + '</span>';
  const tileBg = (c) => 'background:linear-gradient(180deg,' + c[0] + ',' + c[1] + ')';
  const appTile = (app, size) => '<img class="appicon" src="' + app.img + '" alt="" width="' + size + '" height="' + size + '" draggable="false">';
  const fileTile = (entry, size) => window.LOS_fileTile(entry, size);
  const set = () => S.settings || DEFAULTS;
  const fmtSize = (b) => { if (b == null) return ''; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } if (i && i < 4 && Math.round(b) >= 1024) { b /= 1024; i++; } return (i ? b.toFixed(b < 10 ? 1 : 0) : b) + ' ' + u[i]; };
  const join = (a, b) => (a.replace(/\/+$/, '') + '/' + b).replace(/\/+/g, '/');
  const parent = (p) => { const s = p.replace(/\/+$/, ''); const i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i); };
  const baseName = (p) => p.replace(/\/+$/, '').split('/').pop() || '/';

  function timeStr(d) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !set().clock24 });
  }
  function dateStr(d, long) {
    return long ? d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
      : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function effectiveTheme() {
    const t = set().theme;
    if (t === 'auto') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return t === 'dark' ? 'dark' : 'light';
  }

  function wallpaperCss() {
    const w = set().wallpaper || 'siamese';
    const fit = set().wallpaperFit || 'cover';
    if (w.startsWith('file:')) {
      const url = rawUrl(w.slice(5));
      const size = fit === 'contain' ? 'contain' : fit === 'center' ? 'auto' : 'cover';
      return 'url("' + url + '") center/' + size + ' no-repeat, #1E2633';
    }
    const wp = window.LOS_WALLPAPERS.find((x) => x.id === w) || window.LOS_WALLPAPERS[0];
    return wp.css;
  }

  async function bridge(path, body) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 600);
    try {
      const r = await fetch('http://127.0.0.1:7777' + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: ctl.signal,
      });
      return r.ok;
    } catch (e) { return false; } finally { clearTimeout(t); }
  }

  // ================================================================== boot
  async function boot() {
    try {
      const s = await api('auth.status');
      Object.assign(S, { csrf: s.csrf, user: s.user, settings: s.settings, system: s.system || {}, setupNeeded: s.setupNeeded });
    } catch (e) {
      // Keep the boot screen up and retry: the server may still be starting.
      const msg = document.querySelector('#boot .boot-msg');
      if (msg) { msg.textContent = e.message + ' Retrying…'; msg.style.opacity = '.9'; }
      setTimeout(boot, 5000);
      return;
    }
    // setup and signing in are pages of their own (resources/views/auth); this page is only served signed in
    if (!S.user) { location.assign(window.LOS_BASE + (S.setupNeeded ? 'setup' : 'login')); return; }
    applyTheme();
    prepareDesktop(!!window.LOS_CONFIG.welcome);
  }

  // The boot screen is also the waiting room: the desktop is built behind it with the user's data already in hand
  // (what's on the desktop, recent files, storage), then it waits for the wallpaper, the icons and the fonts, so
  // nothing pops in or moves once it fades. Each wait has a cap, so a slow request never keeps the user out.
  const capped = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // loaded, not decode(): a page in the background never finishes decode(), and loading is the slow part anyway
  const loaded = (img) => (img.complete ? null : new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }));
  const imagesReady = (scope) => Promise.all($$('img', scope).map(loaded));
  function wallpaperReady() {
    const m = /url\(["']?([^"')]+)["']?\)/.exec(wallpaperCss());
    if (!m) return null;
    const img = new Image();
    img.src = m[1];
    return loaded(img);
  }
  async function prepareDesktop(firstRun) {
    const b = document.getElementById('boot');
    const say = (m) => { const el = b && b.querySelector('.boot-msg'); if (el) el.textContent = m; };
    if (b) b.classList.add('busy');
    // (whether the kite draws or shimmers is decided in the page itself, before the first paint: components/boot)
    say('Welcome, ' + (S.user.name || S.user.username).split(' ')[0]);
    const wall = wallpaperReady();
    await capped(Promise.allSettled([
      readDeskFiles().then((l) => { deskFiles = l; }),
      api('fs.recent').then((r) => { UI.recent = r; recentCache = { at: Date.now(), list: r }; }),
      api('fs.usage').then((u) => { UI.usage = u; }),
    ]), 6000);
    say('Setting up your desktop');
    startDesktop(false, true);
    restoreDesk(); // after a reload: the windows that were open
    await capped(Promise.all([wall, imagesReady(root), document.fonts && document.fonts.ready]), 4000);
    await capped(nextFrame(), 120); // a hidden tab draws no frames
    bootDone();
    if (firstRun) setTimeout(() => notify('Open the launcher to find your apps.', { type: 'success', title: 'Welcome to LiteOS' }), 500);
  }

  // ------------------------------------------------------------------ boot screen
  const BOOT_MIN_MS = 2000; // let the kite finish drawing before revealing the OS
  function bootDone() {
    const b = document.getElementById('boot');
    if (!b) return;
    // the kite draws in full on the first page of a visit; after signing in (a page before this one) it only fades
    let seen = false;
    try { seen = sessionStorage.getItem('los_booted') === '1'; sessionStorage.setItem('los_booted', '1'); } catch (e) { /* storage blocked */ }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wait = reduced || seen ? 0 : Math.max(0, BOOT_MIN_MS - performance.now());
    setTimeout(() => {
      b.classList.add('done');
      setTimeout(() => b.classList.add('gone'), 500);
    }, wait);
  }
  /** Bring the boot screen back with the shimmer animation and a status line. */
  function showBoot(message) {
    const b = document.getElementById('boot');
    if (!b) return;
    b.querySelector('.boot-msg').textContent = message || '';
    b.className = 'boot shimmer';
    b.setAttribute('aria-label', message || 'Please wait');
  }

  function applyTheme() {
    const r = document.documentElement;
    r.dataset.theme = S.user ? effectiveTheme() : 'light';
    r.dataset.glass = S.user && set().transparency === false ? 'off' : 'on';
    r.style.setProperty('--accent', S.user ? set().accent : '#2F6FD6');
    applyA11y(r, S.user ? set() : {});
    // Colour filters apply to the whole desktop, apps included.
    const filters = { grayscale: 'grayscale(1)', invert: 'invert(1) hue-rotate(180deg)', 'grayscale-invert': 'grayscale(1) invert(1)' };
    root.style.filter = S.user && filters[set().colorFilter] ? filters[set().colorFilter] : '';
  }

  /** Accessibility modes shared by the shell and every app (see assets/css/a11y.css). */
  function applyA11y(r, s) {
    s = s || {};
    const contrast = s.contrast === 'dark' || s.contrast === 'light' ? s.contrast : 'off';
    r.dataset.contrast = contrast;
    if (contrast !== 'off') r.style.setProperty('--accent', contrast === 'dark' ? '#FFE600' : '#0000C8');
    r.dataset.motion = s.reduceMotion ? 'reduce' : 'normal';
    r.dataset.focus = s.focusRing ? 'strong' : 'normal';
    r.dataset.cursor = s.cursorSize || 'default';
    r.dataset.captions = s.captionSize || 'medium';
    const carets = { accent: 'var(--accent)', red: '#E5484D', green: '#1F9D61', purple: '#8E4EC6' };
    if (carets[s.caretColor]) { r.dataset.caret = s.caretColor; r.style.setProperty('--caret', carets[s.caretColor]); }
    else { delete r.dataset.caret; r.style.removeProperty('--caret'); }
  }


  // ================================================================== setup & sign-in
  /**
   * The one top bar used on every screen (setup, sign-in, lock, desktop).
   * o.launcher: brand opens the launcher · o.app: focused app name · o.menus: show app menus
   * o.desktop: show volume / search / quick-settings clock (signed-in desktop)
   */
  function topbarHtml(o) {
    o = o || {};
    const name = esc(S.system.instanceName || 'LiteOS');
    const brand = o.launcher
      ? '<button class="brand" data-act="launcher" aria-label="Open launcher"><img src="assets/img/kite-blue.svg" alt="">' + name + '</button>'
      : '<span class="brand"><img src="assets/img/kite-blue.svg" alt="">' + name + '</span>';
    let left = '';
    if (o.app) {
      left += '<span class="app-name">' + esc(o.app) + '</span>';
      if (o.menus && o.menus.length) left += '<nav class="menus" aria-label="App menu">' + o.menus.map((m, i) => '<button class="mbtn" data-menu="' + i + '">' + esc(m.label) + '</button>').join('') + '</nav>';
    }
    let right;
    if (o.desktop) {
      const s = set();
      right = '<button class="tb-icon" data-act="volume" aria-label="Volume" title="Volume">' + ICON(s.muted || !s.volume ? 'mute' : 'volume', 16) + '</button>' +
        '<button class="tb-icon" data-act="launcher" aria-label="Search" title="Search (Alt+Space)">' + ICON('search', 15) + '</button>' +
        '<button class="status' + (UI.pop === 'qs' ? ' open' : '') + '" data-act="qs" aria-label="Quick settings"><span data-clock="td"></span></button>' +
        '<button class="tb-icon" data-act="power" aria-label="Power options" title="Power">' + ICON('power', 15) + '</button>';
    } else {
      right = '<span class="status static" data-clock="td"></span><button class="tb-icon" data-l="power" aria-label="Power options" title="Power">' + ICON('power', 15) + '</button>';
    }
    return '<div class="topbar glass">' + brand + left + '<span class="spacer"></span>' + right + '</div>';
  }


  function powerMenu(btn, signedIn) {
    const r = btn.getBoundingClientRect();
    const items = [];
    if (signedIn) {
      if (!UI.lockShown) items.push({ label: 'Lock', icon: 'lock', action: lockScreen });
      items.push({ label: 'Sign out', icon: 'logout', action: signOut });
    }
    items.push({ label: 'Reload', icon: 'reload', action: () => { showBoot('Restarting…'); setTimeout(() => location.reload(), 700); } });
    items.push('sep');
    items.push({ label: 'Restart device', icon: 'rotate', action: async () => {
      if (await bridge('/power', { action: 'reboot' })) showBoot('Restarting…');
      else notify('Restart isn’t available on this device.', { type: 'error', title: 'Can’t restart' });
    } });
    items.push({ label: 'Shut down', icon: 'power', action: async () => {
      if (await bridge('/power', { action: 'shutdown' })) showBoot('Shutting down…');
      else notify('Shut down isn’t available here. You can close this browser tab.', { type: 'error', title: 'Can’t shut down' });
    } });
    showMenu(items, r.top > window.innerHeight / 2 ? { x: r.left, y: r.top - 6, above: true } : { x: r.right - 210, y: r.bottom + 6 });
  }

  // ================================================================== desktop
  let clockTimer = null;

  function startDesktop(firstRun, preloaded) {
    root.innerHTML =
      '<div class="wall" data-act="wall"></div><div class="desk-icons" role="list" aria-label="Desktop"></div><div class="windows"></div><div id="bars"></div><div id="pops"></div>' +
      '<div class="toasts" aria-live="polite"></div>';
    applySettings();
    if (!preloaded) loadDeskFiles();
    if (!clockTimer) clockTimer = setInterval(() => tickClock(document), 10000);
    if (firstRun) {
      notify('Open the launcher to find your apps.', { type: 'success', title: 'Welcome to LiteOS' });
    }
  }

  function tickClock(scope) {
    const d = new Date();
    $$('[data-clock]', scope).forEach((n) => {
      const k = n.dataset.clock;
      n.textContent = k === 't' ? timeStr(d) : k === 'd' ? dateStr(d) : k === 'dl' ? dateStr(d, true)
        : k === 'td' ? dateStr(d) + '  ' + timeStr(d) : k === 'ds' ? d.toLocaleDateString() : '';
    });
  }

  function applySettings() {
    applyTheme();
    const s = set();
    const wall = $('.wall', root);
    if (wall) wall.style.background = wallpaperCss();
    let night = $('.night', root);
    if (s.nightLight && !night) { night = document.createElement('div'); night.className = 'night'; root.appendChild(night); }
    if (!s.nightLight && night) night.remove();
    applyDim();
    root.classList.toggle('classic', s.taskbar === 'classic');
    root.classList.toggle('magnify', !!s.magnify);
    root.style.setProperty('--dock-size', ({ small: 36, medium: 44, large: 54 })[s.iconSize] + 'px');
    renderBars();
    renderDesktopIcons();
    if (UI.pop) renderPop();
    relayout();
    const state = hostState();
    subs.forEach((fn) => { try { fn(state); } catch (e) { subs.delete(fn); } });
  }

  async function saveSettings(changes) {
    S.settings = Object.assign({}, set(), changes);
    applySettings();
    try {
      S.settings = await api('settings.save', { settings: changes });
      applySettings();
    } catch (e) { notify(e.message, { type: 'error', title: 'Couldn’t save settings' }); }
    return S.settings;
  }

  function workArea() {
    const s = set();
    const floating = s.taskbar !== 'classic';
    const top = floating && s.topbar ? 34 : 0;
    const bottom = s.autohide ? 0 : floating ? Math.round(parseInt(getComputedStyle(root).getPropertyValue('--dock-size') || '44', 10) + (s.labels ? 40 : 28)) + 12 : 50;
    return { x: 0, y: top, w: window.innerWidth, h: Math.max(200, window.innerHeight - top - bottom) };
  }


  // ------------------------------------------------------------------ desktop icons
  // The shortcuts the user chose in Settings › Personalisation › Desktop icons, then what is in the Desktop folder.
  let deskFiles = [];
  async function readDeskFiles() {
    let list = [];
    try { list = await api('fs.list', undefined, { path: '/Desktop' }); } catch (e) { list = []; } // no Desktop folder yet
    list = (Array.isArray(list) ? list : []).filter((f) => f && f.name && !f.name.startsWith('.'));
    return list.sort((a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  async function loadDeskFiles() {
    if (!S.user || deskPending) return; // an icon is being made and named: its own code reloads when done
    const list = await readDeskFiles();
    const key = (l) => l.map((f) => f.path + '|' + f.type).join('\n');
    if (key(list) === key(deskFiles)) return;
    deskFiles = list;
    renderDesktopIcons();
  }
  /** Something on the drive changed: look at the Desktop folder again now, and once more if more changes came meanwhile
   *  (no timer: background tabs hold timers back for a long time). */
  let deskLoading = null;
  let deskAgain = false;
  function deskFilesChanged() {
    if (deskLoading) { deskAgain = true; return; }
    deskLoading = loadDeskFiles().finally(() => { deskLoading = null; if (deskAgain) { deskAgain = false; deskFilesChanged(); } });
  }
  if ('BroadcastChannel' in window) new BroadcastChannel('liteos-files').onmessage = deskFilesChanged;
  window.addEventListener('focus', deskFilesChanged);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) deskFilesChanged(); });

  const thisPcIcon = () => (window.LOS_hasSysIcon('device.computer') ? window.LOS_sysIcon('device.computer') : window.LOS_app('files').img);
  function deskItems() {
    return (set().desktopIcons || []).map((id) => {
      if (id === 'trash') return { id, label: 'Trash', img: window.LOS_appIconUrl('trash'), open: () => openApp('files', { path: 'trash:' }) };
      const app = window.LOS_app(id);
      if (!app) return null;
      // the Files shortcut is "This PC", as in Windows: the computer, opening on its drives
      if (id === 'files') return { id, label: 'This PC', img: thisPcIcon(), open: () => openApp('files', { path: 'device:' }) };
      return { id, label: app.name, img: app.img, open: () => openApp(id) };
    }).filter(Boolean);
  }

  /** The Desktop folder's items in the order chosen in the desktop menu (Sort by), folders first like Explorer. */
  function sortedDeskFiles() {
    const by = set().deskSort || 'name';
    const ext = (f) => (f.type === 'dir' ? '' : (f.name.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase());
    const cmp = {
      name: () => 0,
      type: (a, b) => ext(a).localeCompare(ext(b)),
      size: (a, b) => (b.size || 0) - (a.size || 0),
      mtime: (a, b) => (b.mtime || 0) - (a.mtime || 0),
    }[by] || (() => 0);
    return deskFiles.slice().sort((a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1) || cmp(a, b) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  // New items from the desktop menu go in the Desktop folder, like Explorer's New on the desktop.
  const DESK_NEW = [
    { label: 'Document', ext: 'ldoc', name: 'Untitled document', app: 'documents' },
    { label: 'Spreadsheet', ext: 'lsheet', name: 'Untitled spreadsheet', app: 'sheets' },
    { label: 'Presentation', ext: 'lslides', name: 'Untitled presentation', app: 'slides' },
    { label: 'Text file', ext: 'txt', name: 'New text file', app: 'code' },
  ];
  // As in Explorer, a new item is made at once with a default name ("New folder", "New folder (2)"…), placed where the
  // desktop was right-clicked, and its name is open for typing over; Escape keeps the default.
  // The icon shows at once, its picture shimmering while the server makes the item, and its name is open for typing
  // straight away; the rename waits for the item to exist. Meanwhile the desktop isn't reloaded from the drive (that
  // would drop the icon being named).
  let deskPending = 0;
  async function deskNew(t, at) {
    const taken = new Set(deskFiles.map((f) => f.name.toLowerCase()));
    let name = '';
    for (let i = 1; i <= 50 && !name; i++) {
      const n = t ? t.name + (i > 1 ? ' ' + i : '') + '.' + t.ext : 'New folder' + (i > 1 ? ' (' + i + ')' : '');
      if (!taken.has(n.toLowerCase())) name = n;
    }
    if (!name) return;
    const path = join('/Desktop', name);
    if (at) deskPlaceAt(['file:' + path], at.x, at.y);
    const entry = { name, path, type: t ? 'file' : 'dir', ext: t ? t.ext : '', size: 0, mtime: Date.now() / 1000, pending: true };
    deskFiles = deskFiles.concat(entry);
    deskPending++;
    renderDesktopIcons();
    const made = t ? api('fs.write', { path, content: '', overwrite: false }) : api('fs.mkdir', { path });
    made.catch(() => {}); // handled below, once naming is done
    const btn = $$('.desk-icon', root).find((b) => b.dataset.file === path);
    const res = btn ? await deskRename(btn, { pending: made, entry }) : await made.then(() => ({ path }), (e) => ({ failed: e }));
    deskPending--;
    if (res && res.failed) {
      deskFiles = deskFiles.filter((f) => f !== entry);
      renderDesktopIcons();
      notify(res.failed.message, { type: 'error', title: t ? 'Couldn\u2019t create file' : 'Couldn\u2019t create folder' });
      return;
    }
    await loadDeskFiles();
    filesChanged();
    const nb = $$('.desk-icon', root).find((b) => b.dataset.file === ((res && res.path) || path));
    if (nb) selectDeskIcon(nb);
  }

  /** Give icons (by layout key) the free cells nearest to a point on screen, kept in the desktop layout. */
  function deskPlaceAt(keys, x, y) {
    const g = deskGrid();
    if (!g) return;
    const br = g.box.getBoundingClientRect();
    const c0 = Math.max(0, Math.min(g.cols - 1, Math.floor((x - br.left) / g.cw)));
    const r0 = Math.max(0, Math.min(g.rows - 1, Math.floor((y - br.top) / g.ch)));
    const layout = {};
    $$('.desk-icon', g.box).forEach((b) => { layout[b.dataset.key] = [+b.dataset.col, +b.dataset.row]; });
    const taken = new Set(Object.values(layout).map((v) => v[0] + ',' + v[1]));
    keys.forEach((k, i) => {
      const cell = freeCell(c0, Math.min(g.rows - 1, r0 + i), taken, g);
      taken.add(cell[0] + ',' + cell[1]);
      layout[k] = cell;
    });
    S.settings = Object.assign({}, set(), { deskLayout: layout });
    saveSettings({ deskLayout: layout });
  }

  // Renaming in place, as in Explorer: the icon's name becomes an edit box over the label (the stem selected, so
  // typing keeps the extension). Enter or a click elsewhere renames; Escape keeps the old name. The icon keeps its cell.
  // A new item (opts.pending: the request making it) can be named before it exists: the rename waits for it. Resolves
  // with { path } (where it ended up) or { failed } (the item couldn't be made).
  function deskRename(btn, opts) {
    opts = opts || {};
    return new Promise((resolve) => deskRenameBox(btn, opts, resolve));
  }
  function deskRenameBox(btn, opts, resolve) {
    const path = btn.dataset.file;
    const label = btn && $('span', btn);
    if (!path || !label || $('.desk-rename', root)) { resolve(opts.pending ? opts.pending.then(() => ({ path }), (e) => ({ failed: e })) : { path }); return; }
    selectDeskIcon(btn);
    const old = baseName(path);
    const r = label.getBoundingClientRect();
    const box = btn.getBoundingClientRect();
    const ta = document.createElement('textarea');
    ta.className = 'desk-rename';
    ta.value = old;
    ta.spellcheck = false;
    ta.setAttribute('aria-label', 'Name');
    Object.assign(ta.style, { left: (box.left - 4) + 'px', top: r.top - 2 + 'px', width: (box.width + 8) + 'px' });
    root.appendChild(ta);
    label.style.visibility = 'hidden';
    const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
    fit();
    ta.focus();
    const dot = old.lastIndexOf('.');
    ta.setSelectionRange(0, btn.dataset.type !== 'dir' && dot > 0 ? dot : old.length);
    let done = false;
    const finish = async (keep) => {
      if (done) return;
      done = true;
      const name = ta.value.replace(/[\r\n]+/g, ' ').trim();
      ta.remove();
      label.style.visibility = '';
      btn.focus({ preventScroll: true });
      const bad = /[\/\\]/.test(name);
      const wanted = keep || !name || name === old || bad ? '' : name;
      if (opts.pending) {
        // show the name typed while the item is still being made, then wait for it
        if (opts.entry && wanted) { opts.entry.shown = wanted; renderDesktopIcons(); }
        try { await opts.pending; } catch (e) { resolve({ failed: e }); return; }
      }
      if (bad) notify('A name can’t contain / or \\.', { type: 'error', title: 'Couldn’t rename' });
      if (!wanted) { if (opts.entry) { opts.entry.pending = false; renderDesktopIcons(); } resolve({ path }); return; }
      const lay = set().deskLayout || {};
      const cell = lay['file:' + path] || (btn.dataset.col != null ? [+btn.dataset.col, +btn.dataset.row] : null);
      try {
        const res = await api('fs.rename', { path, name });
        const to = (res && res.path) || join('/Desktop', name);
        if (cell) { // the renamed icon stays where it was
          const next = Object.assign({}, lay, { ['file:' + to]: cell });
          delete next['file:' + path];
          S.settings = Object.assign({}, set(), { deskLayout: next });
          saveSettings({ deskLayout: next });
        }
        if (opts.entry) { Object.assign(opts.entry, { name: baseName(to), path: to, shown: '', pending: false }); renderDesktopIcons(); }
        if (!opts.pending) {
          await loadDeskFiles();
          filesChanged();
          const nb = $$('.desk-icon', root).find((b) => b.dataset.file === to);
          if (nb) selectDeskIcon(nb);
        }
        resolve({ path: to });
      } catch (e) {
        notify(e.message, { type: 'error', title: 'Couldn’t rename' });
        if (opts.entry) { Object.assign(opts.entry, { shown: '', pending: false }); renderDesktopIcons(); }
        resolve({ path });
      }
    };
    ta.addEventListener('input', fit);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(false); }
      if (e.key === 'Escape') { e.preventDefault(); finish(true); }
    });
    ta.addEventListener('blur', () => finish(false));
    ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu'].forEach((ev) => ta.addEventListener(ev, (e) => e.stopPropagation()));
  }

  /** "Next desktop background": the built-in wallpaper after the current one (from a picture of your own: the first). */
  function nextWallpaper() {
    const list = window.LOS_WALLPAPERS || [];
    if (!list.length) return;
    const i = list.findIndex((w) => w.id === set().wallpaper);
    saveSettings({ wallpaper: list[(i + 1) % list.length].id });
  }

  /** The desktop's own menu (right-click on the wallpaper), laid out like the Windows desktop menu. */
  function desktopMenu(at) {
    selectDeskIcon(null);
    const s = set();
    // shortcuts that can go on the desktop: the apps and the Trash, minus those already there
    const onDesk = s.desktopIcons || [];
    const addable = [{ id: 'trash', label: 'Trash', img: window.LOS_appIconUrl('trash') }]
      .concat(window.LOS_APPS.filter((a) => !a.system || a.id === 'files').map((a) => (a.id === 'files' ? { id: a.id, label: 'This PC', img: thisPcIcon() } : { id: a.id, label: a.name, img: a.img })))
      .filter((x) => !onDesk.includes(x.id));
    const size = s.deskIconSize || 'medium';
    const sort = s.deskSort || 'name';
    showMenu([
      { label: 'View', icon: 'grid', items: [
        { label: 'Large icons', checked: size === 'large', action: () => saveSettings({ deskIconSize: 'large' }) },
        { label: 'Medium icons', checked: size === 'medium', action: () => saveSettings({ deskIconSize: 'medium' }) },
        { label: 'Small icons', checked: size === 'small', action: () => saveSettings({ deskIconSize: 'small' }) },
        'sep',
        { label: s.deskIcons === false ? 'Show desktop icons' : 'Hide desktop icons', action: () => saveSettings({ deskIcons: s.deskIcons === false }) },
      ] },
      { label: 'Sort by', icon: 'filter', items: [['name', 'Name'], ['size', 'Size'], ['type', 'Item type'], ['mtime', 'Date modified']]
        .map(([k, label]) => ({ label, checked: sort === k, action: () => saveSettings({ deskSort: k, deskLayout: {} }) })) },
      { label: 'Refresh', icon: 'reload', action: () => { deskFiles = []; deskFilesChanged(); } },
      'sep',
      { label: 'Next desktop background', icon: 'image', disabled: !(window.LOS_WALLPAPERS || []).length, action: nextWallpaper },
      { label: 'New', icon: 'plus', items: [{ label: 'Folder', icon: 'folder', action: () => deskNew(null, at) }, 'sep']
        .concat(DESK_NEW.filter((t) => window.LOS_app(t.app)).map((t) => ({ label: t.label, img: window.LOS_app(t.app).img, action: () => deskNew(t, at) }))) },
      { label: 'Add to desktop', icon: 'desktop', disabled: !addable.length, items: addable.map((x) => ({ label: x.label, img: x.img, action: () => saveSettings({ desktopIcons: onDesk.concat(x.id) }) })) },
      'sep',
      { label: 'Personalise', icon: 'palette', action: () => openApp('settings', { section: 'personalisation' }) },
      { label: 'Taskbar settings', icon: 'taskbar', action: () => openApp('settings', { section: 'taskbar' }) },
      'sep',
      { label: 'Open Desktop folder', icon: 'folder', action: () => openApp('files', { path: '/Desktop' }) },
    ], at);
  }

  function renderDesktopIcons() {
    const box = $('.desk-icons', root);
    if (!box) return;
    const s = set();
    const top = s.taskbar !== 'classic' && s.topbar ? 34 : 0;
    box.style.top = (top + 10) + 'px';
    box.style.bottom = (s.taskbar === 'classic' ? 58 : 100) + 'px';
    box.hidden = s.deskIcons === false;
    box.dataset.size = s.deskIconSize || 'medium';
    const tileSize = ({ small: 32, medium: 44, large: 60 })[box.dataset.size] || 44;
    box.innerHTML = deskItems().map((it) => '<button class="desk-icon" role="listitem" data-key="desk:' + it.id + '" data-desk="' + it.id + '" title="' + esc(it.label) + '">' +
      '<img src="' + esc(it.img) + '" alt="" draggable="false"><span>' + esc(it.label) + '</span></button>').join('') +
      sortedDeskFiles().map((f) => '<button class="desk-icon desk-file' + (f.pending ? ' pending' : '') + '" role="listitem" data-key="file:' + esc(f.path) + '" data-file="' + esc(f.path) + '" data-type="' + esc(f.type) + '" title="' + esc(f.shown || f.name) + '">' +
        fileTile(f, tileSize, Math.round(tileSize / 4)) + '<span>' + esc(f.shown || f.name) + '</span></button>').join('');
    layoutDeskIcons();
  }

  // Desktop icons sit on a grid, filled down then across like Explorer. An icon the user dragged keeps its cell
  // (settings deskLayout: { "desk:files" | "file:/Desktop/a.txt": [column, row] }); the rest fill the free cells in order.
  function deskGrid() {
    const box = $('.desk-icons', root);
    const first = box && $('.desk-icon', box);
    if (!first || box.hidden) return null;
    const cw = first.offsetWidth + 6;
    const ch = Math.max(...$$('.desk-icon', box).map((b) => b.offsetHeight)) + 6;
    return { box, cw, ch, rows: Math.max(1, Math.floor((box.clientHeight + 6) / ch)), cols: Math.max(1, Math.floor((window.innerWidth - 20) / cw)) };
  }
  function layoutDeskIcons() {
    const g = deskGrid();
    if (!g) return;
    const saved = set().deskLayout || {};
    const taken = new Set();
    const icons = $$('.desk-icon', g.box);
    const place = (b, c, r) => { b.dataset.col = c; b.dataset.row = r; taken.add(c + ',' + r); b.style.left = c * g.cw + 'px'; b.style.top = r * g.ch + 'px'; };
    const rest = [];
    icons.forEach((b) => {
      const at = saved[b.dataset.key];
      if (Array.isArray(at) && at[0] < g.cols && at[1] < g.rows && !taken.has(at[0] + ',' + at[1])) place(b, at[0], at[1]);
      else rest.push(b);
    });
    let i = 0;
    rest.forEach((b) => {
      while (taken.has(Math.floor(i / g.rows) + ',' + (i % g.rows))) i++;
      place(b, Math.floor(i / g.rows), i % g.rows);
    });
  }
  window.addEventListener('resize', debounce(layoutDeskIcons, 80));

  /** The nearest free cell to (c, r), or (c, r) itself. */
  function freeCell(c, r, taken, g) {
    for (let d = 0; d < g.cols + g.rows; d++) {
      for (let dc = -d; dc <= d; dc++) {
        for (let dr = -d; dr <= d; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== d) continue;
          const x = c + dc; const y = r + dr;
          if (x >= 0 && y >= 0 && x < g.cols && y < g.rows && !taken.has(x + ',' + y)) return [x, y];
        }
      }
    }
    return [c, r];
  }

  // Dragging icons: the selected icons move together, shown as a drag image above the windows. Dropped on a folder they
  // move into it, on the Trash they go to the Trash, on a Files window into the folder under the pointer there;
  // anywhere else on the desktop they take the nearest free cells and keep them.
  let deskDragEnded = 0;
  const filesSync = 'BroadcastChannel' in window ? new BroadcastChannel('liteos-files') : null; // open Files windows refresh
  const filesChanged = () => { if (filesSync) filesSync.postMessage('changed'); };
  /** The drop helper of an app window under the pointer (Files exposes window.__losDropAt), or null. */
  function frameDropAt(t) {
    if (!t || t.tagName !== 'IFRAME') return null;
    try { const fn = t.contentWindow && t.contentWindow.__losDropAt; return typeof fn === 'function' ? { frame: t, fn } : null; } catch (e) { return null; }
  }
  root.addEventListener('pointerdown', (e) => {
    const b = e.button === 0 && e.target.closest && e.target.closest('.desk-icon');
    if (!b || b.classList.contains('pending')) return; // still being made: nothing to move yet
    const g = deskGrid();
    if (!g) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let drag = null;
    let over = null;
    let layer = null;
    let inFrame = null; // { frame, fn, dest } while over a Files window
    b.setPointerCapture(e.pointerId);
    const leaveFrame = () => { if (inFrame) { try { inFrame.fn(0, 0, 'leave'); } catch (err) { /* frame gone */ } inFrame = null; } };
    const move = (ev) => {
      if (!drag) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
        if (!b.classList.contains('sel')) selectDeskIcon(b);
        drag = deskSel();
        // the drag image: copies of the icons in a layer above the windows; the icons themselves stay, faded
        layer = document.createElement('div');
        layer.className = 'desk-drag-layer';
        drag.forEach((x) => {
          const r = x.getBoundingClientRect();
          const c = x.cloneNode(true);
          c.classList.remove('lifted');
          Object.assign(c.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', transform: '' });
          layer.appendChild(c);
        });
        root.appendChild(layer);
        drag.forEach((x) => x.classList.add('lifted'));
        root.classList.add('desk-dragging');
      }
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      layer.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      // what's under the pointer (the drag image and the faded icons let the pointer through)
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const fr = drag.some((x) => x.dataset.file) ? frameDropAt(t) : null;
      if (!fr || (inFrame && fr.frame !== inFrame.frame)) leaveFrame();
      if (fr) {
        const r = fr.frame.getBoundingClientRect();
        let dest = null;
        try { dest = fr.fn(ev.clientX - r.left, ev.clientY - r.top, 'hover'); } catch (err) { dest = null; }
        inFrame = Object.assign(fr, { dest });
      }
      const ic = !fr && t && t.closest && t.closest('.desk-icon');
      const target = ic && !drag.includes(ic) && (ic.dataset.type === 'dir' || ic.dataset.desk === 'trash') && drag.some((x) => x.dataset.file) ? ic : null;
      if (target !== over) { if (over) over.classList.remove('drop'); over = target; if (over) over.classList.add('drop'); }
    };
    const up = async (ev) => {
      b.removeEventListener('pointermove', move);
      b.removeEventListener('pointerup', up);
      b.removeEventListener('pointercancel', up);
      if (!drag) return;
      deskDragEnded = Date.now();
      root.classList.remove('desk-dragging');
      if (layer) layer.remove();
      drag.forEach((x) => { x.classList.remove('lifted'); x.style.transform = ''; });
      if (over) over.classList.remove('drop');
      const files = drag.filter((x) => x.dataset.file).map((x) => x.dataset.file);
      if (inFrame) {
        const dest = ev.type === 'pointercancel' ? null : inFrame.dest;
        leaveFrame();
        if (dest === 'trash:') { await trashDeskFiles(drag); filesChanged(); }
        else if (dest && dest !== '/Desktop') {
          try { await api('fs.move', { paths: files, dest }); filesChanged(); }
          catch (err) { notify(err.message, { type: 'error', title: 'Couldn’t move' }); }
        }
        return;
      }
      if (over && over.dataset.desk === 'trash') { await trashDeskFiles(drag); filesChanged(); return; }
      if (over) {
        try { await api('fs.move', { paths: files, dest: over.dataset.file }); filesChanged(); }
        catch (err) { notify(err.message, { type: 'error', title: 'Couldn’t move' }); }
        return;
      }
      if (ev.type === 'pointercancel') return;
      // new cells: the same offset for each icon, the nearest free cell where that one is taken
      const dc = Math.round((ev.clientX - sx) / g.cw);
      const dr = Math.round((ev.clientY - sy) / g.ch);
      if (!dc && !dr) return;
      const taken = new Set($$('.desk-icon', g.box).filter((x) => !drag.includes(x)).map((x) => x.dataset.col + ',' + x.dataset.row));
      const layout = {};
      $$('.desk-icon', g.box).forEach((x) => { if (!drag.includes(x)) layout[x.dataset.key] = [+x.dataset.col, +x.dataset.row]; });
      drag.forEach((x) => {
        const c = Math.max(0, Math.min(g.cols - 1, +x.dataset.col + dc));
        const r = Math.max(0, Math.min(g.rows - 1, +x.dataset.row + dr));
        const at = freeCell(c, r, taken, g);
        taken.add(at[0] + ',' + at[1]);
        layout[x.dataset.key] = at;
      });
      S.settings = Object.assign({}, set(), { deskLayout: layout });
      layoutDeskIcons();
      saveSettings({ deskLayout: layout });
    };
    b.addEventListener('pointermove', move);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  });

  // Items dragged out of a Files window (their paths travel in the drag data) can be dropped on the desktop: on a
  // folder or the Trash icon, or on empty desktop, where they move to the Desktop folder and land where they were
  // dropped. Ctrl copies instead of moving, as in Files.
  const DND = 'application/x-liteos-paths';
  const hasPaths = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes(DND);
  const onDesktop = (t) => !!(t && t.closest && t.closest('.wall, .desk-icons'));
  let dndOver = null;
  const dndTarget = (t) => { const ic = t.closest && t.closest('.desk-icon'); return ic && (ic.dataset.type === 'dir' || ic.dataset.desk === 'trash') ? ic : null; };
  const dndMark = (ic) => { if (ic !== dndOver) { if (dndOver) dndOver.classList.remove('drop'); dndOver = ic; if (ic) ic.classList.add('drop'); } };
  root.addEventListener('dragover', (e) => {
    if (!hasPaths(e) || !onDesktop(e.target)) { dndMark(null); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
    dndMark(dndTarget(e.target));
  });
  root.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !root.contains(e.relatedTarget)) dndMark(null); });
  root.addEventListener('drop', async (e) => {
    if (!hasPaths(e) || !onDesktop(e.target)) return;
    e.preventDefault();
    const target = dndTarget(e.target);
    dndMark(null);
    let paths = [];
    try { paths = JSON.parse(e.dataTransfer.getData(DND) || '[]'); } catch (err) { paths = []; }
    paths = paths.filter((x) => typeof x === 'string' && x.startsWith('/'));
    if (!paths.length) return;
    const copy = e.ctrlKey;
    const done = (n, where) => notify((copy ? 'Copied ' : 'Moved ') + n + (n === 1 ? ' item' : ' items') + ' to ' + where + '.', { type: 'success', title: copy ? 'Items copied' : 'Items moved' });
    try {
      if (target && target.dataset.desk === 'trash') {
        await api('fs.delete', { paths });
        notify('You can restore ' + (paths.length === 1 ? 'it' : 'them') + ' from the Trash if you need ' + (paths.length === 1 ? 'it' : 'them') + '.', { type: 'success', title: 'Moved to Trash' });
      } else if (target) {
        const dest = target.dataset.file;
        const list = paths.filter((x) => x !== dest && parent(x) !== dest);
        if (!list.length) return;
        await api(copy ? 'fs.copy' : 'fs.move', { paths: list, dest });
        done(list.length, baseName(dest));
      } else {
        // onto empty desktop: into the Desktop folder, each in the free cell nearest to where it was dropped
        const list = paths.filter((x) => parent(x) !== '/Desktop' || copy);
        if (!list.length) return;
        const g = deskGrid();
        if (g) {
          const br = g.box.getBoundingClientRect();
          const c0 = Math.max(0, Math.min(g.cols - 1, Math.floor((e.clientX - br.left) / g.cw)));
          const r0 = Math.max(0, Math.min(g.rows - 1, Math.floor((e.clientY - br.top) / g.ch)));
          const layout = {};
          $$('.desk-icon', g.box).forEach((x) => { layout[x.dataset.key] = [+x.dataset.col, +x.dataset.row]; });
          const taken = new Set(Object.values(layout).map((v) => v[0] + ',' + v[1]));
          list.forEach((x, i) => {
            const at = freeCell(c0, Math.min(g.rows - 1, r0 + i), taken, g);
            taken.add(at[0] + ',' + at[1]);
            layout['file:/Desktop/' + baseName(x)] = at;
          });
          S.settings = Object.assign({}, set(), { deskLayout: layout });
          saveSettings({ deskLayout: layout });
        }
        await api(copy ? 'fs.copy' : 'fs.move', { paths: list, dest: '/Desktop' });
      }
      filesChanged();
    } catch (err) { notify(err.message, { type: 'error', title: copy ? 'Couldn’t copy' : 'Couldn’t move' }); }
  });

  function selectDeskIcon(btn) {
    $$('.desk-icon.sel', root).forEach((b) => b.classList.remove('sel'));
    if (btn) { btn.classList.add('sel'); btn.focus({ preventScroll: true }); }
    deskAnchor = btn;
  }
  // Several icons can be selected: Ctrl+click adds or removes one, Shift+click takes the run from the last one
  // clicked, and dragging on empty desktop draws a selection rectangle.
  let deskAnchor = null;
  const deskSel = () => $$('.desk-icon.sel', root);
  function deskClickSelect(b, e) {
    const all = $$('.desk-icon', root);
    if (e.shiftKey && deskAnchor && all.includes(deskAnchor)) {
      const [i, j] = [all.indexOf(deskAnchor), all.indexOf(b)].sort((x, y) => x - y);
      if (!(e.ctrlKey || e.metaKey)) all.forEach((x) => x.classList.remove('sel'));
      all.slice(i, j + 1).forEach((x) => x.classList.add('sel'));
      b.focus({ preventScroll: true });
    } else if (e.ctrlKey || e.metaKey) {
      b.classList.toggle('sel');
      b.focus({ preventScroll: true });
      deskAnchor = b;
    } else selectDeskIcon(b);
  }
  /** Move the selected files to the Trash (the shortcuts aren't files, so they stay). */
  async function trashDeskFiles(btns) {
    const paths = btns.filter((b) => b.dataset.file).map((b) => b.dataset.file);
    if (!paths.length) return;
    try {
      await api('fs.delete', { paths });
      notify('You can restore ' + (paths.length === 1 ? 'it' : 'them') + ' from the Trash if you need ' + (paths.length === 1 ? 'it' : 'them') + '.', { type: 'success', title: paths.length === 1 ? 'Moved to Trash' : paths.length + ' items moved to Trash' });
    } catch (e) { notify(e.message, { type: 'error', title: 'Couldn’t move to Trash' }); }
  }

  // The selection rectangle: drawn from a press on empty desktop; it selects every icon it touches (Ctrl keeps
  // what was already selected). The click that ends the drag must not clear the selection again.
  let deskMarqueeEnded = 0;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !(e.target.classList.contains('wall') || e.target.classList.contains('desk-icons'))) return;
    const box = $('.desk-icons', root);
    if (!box || box.hidden) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const keep = e.ctrlKey || e.metaKey ? new Set(deskSel()) : new Set();
    const icons = $$('.desk-icon', root).map((b) => [b, b.getBoundingClientRect()]);
    let mq = null;
    const target = e.target;
    target.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!mq && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
      if (!mq) { mq = document.createElement('div'); mq.className = 'desk-marquee'; root.appendChild(mq); closePops(); hideMenu(); }
      const x = Math.min(sx, ev.clientX);
      const y = Math.min(sy, ev.clientY);
      const w = Math.abs(ev.clientX - sx);
      const h = Math.abs(ev.clientY - sy);
      Object.assign(mq.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      icons.forEach(([b, r]) => {
        const hit = r.left < x + w && r.right > x && r.top < y + h && r.bottom > y;
        b.classList.toggle('sel', keep.has(b) || hit);
      });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (mq) {
        mq.remove();
        deskMarqueeEnded = Date.now();
        const sel = deskSel();
        deskAnchor = sel[0] || null;
        if (sel.length) sel[sel.length - 1].focus({ preventScroll: true });
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  });

  function openDeskIcon(btn) {
    if (btn.classList.contains('pending')) return; // still being made
    if (btn.dataset.file) { selectDeskIcon(null); openFile(btn.dataset.file, btn.dataset.type === 'dir'); return; }
    const it = deskItems().find((x) => x.id === btn.dataset.desk);
    if (it) { selectDeskIcon(null); it.open(); }
  }

  function deskFileMenu(btn, at) {
    selectDeskIcon(btn);
    const path = btn.dataset.file;
    showMenu([
      { label: 'Open', icon: 'forward', action: () => openDeskIcon(btn) },
      ...(window.LOS_opensWithCode(path, btn.dataset.type === 'dir') ? [{ label: 'Open with Code', icon: 'code', action: () => openApp('code', btn.dataset.type === 'dir' ? { folder: path } : { path }) }] : []),
      { label: 'Show in Files', icon: 'folder', action: () => openApp('files', { path: '/Desktop', select: path }) },
      'sep',
      { label: 'Rename', icon: 'rename', key: 'F2', action: () => deskRename(btn) },
      { label: 'Move to Trash', icon: 'trash', danger: true, action: async () => {
        try { await api('fs.delete', { paths: [path] }); notify('You can restore it from the Trash if you need it.', { type: 'success', title: 'Moved to Trash' }); }
        catch (e) { notify(e.message, { type: 'error', title: 'Couldn’t move to Trash' }); }
      } },
    ], at);
  }

  function deskIconMenu(btn, at) {
    const sel = deskSel();
    if (sel.length > 1 && sel.includes(btn)) {
      const files = sel.filter((b) => b.dataset.file);
      showMenu([
        { label: 'Open ' + sel.length + ' items', icon: 'forward', action: () => sel.forEach(openDeskIcon) },
        'sep',
        { label: files.length === sel.length ? 'Move to Trash' : 'Move ' + files.length + ' files to Trash', icon: 'trash', danger: true, disabled: !files.length, action: () => trashDeskFiles(files) },
      ], at);
      return;
    }
    if (btn.dataset.file) { deskFileMenu(btn, at); return; }
    selectDeskIcon(btn);
    const id = btn.dataset.desk;
    const items = [{ label: 'Open', icon: 'forward', action: () => openDeskIcon(btn) }];
    if (id === 'trash') items.push({ label: 'Empty Trash', icon: 'trash', danger: true, action: async () => {
      const ok = await confirmDialog({ title: 'Empty the Trash?', message: 'Everything in the Trash will be deleted. This can’t be undone.', okLabel: 'Empty Trash', danger: true });
      if (!ok) return;
      try { await api('trash.purge', { ids: [] }); notify('Everything in the Trash was permanently deleted.', { type: 'success', title: 'Trash emptied' }); } catch (e) { notify(e.message, { type: 'error', title: 'Couldn’t empty Trash' }); }
    } });
    items.push('sep',
      { label: 'Remove from desktop', icon: 'x', action: () => saveSettings({ desktopIcons: (set().desktopIcons || []).filter((x) => x !== id) }) },
      { label: 'Desktop icon settings', icon: 'settings', action: () => openApp('settings', { section: 'personalisation', focus: 'desktop' }) });
    showMenu(items, at);
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('.desk-icon');
    if (b) { if (Date.now() - deskDragEnded > 300) deskClickSelect(b, e); }
    else if (e.target.classList.contains('wall') || e.target.classList.contains('desk-icons')) {
      if (Date.now() - deskMarqueeEnded > 300) selectDeskIcon(null);
      blurWindows();
    }
  });
  root.addEventListener('dblclick', (e) => { const b = e.target.closest('.desk-icon'); if (b) openDeskIcon(b); });
  root.addEventListener('keydown', (e) => {
    const b = e.target.closest && e.target.closest('.desk-icon');
    if (!b) return;
    if (e.key === 'Enter') { e.preventDefault(); (deskSel().length ? deskSel() : [b]).forEach(openDeskIcon); }
    if (e.key === 'Delete') { e.preventDefault(); trashDeskFiles(deskSel()); }
    if (e.key === 'F2' && b.dataset.file) { e.preventDefault(); deskRename(b); }
    if (e.key === 'Escape') selectDeskIcon(null);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); $$('.desk-icon', root).forEach((x) => x.classList.add('sel')); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = $$('.desk-icon', root);
      const next = all[all.indexOf(b) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) selectDeskIcon(next);
    }
  });

  // ------------------------------------------------------------------ bars
  function dockApps() {
    const pinned = (set().pinned || []).filter((id) => window.LOS_app(id));
    const running = [...new Set([...wins.values()].map((w) => w.app.id))];
    return pinned.concat(running.filter((id) => !pinned.includes(id))).map(window.LOS_app);
  }

  function renderBars() {
    const bars = $('#bars', root);
    if (!bars) return;
    const s = set();
    const focused = wins.get(focusedId);
    const fApp = focused && !focused.min ? focused.app.id : null;
    const runningIds = new Set([...wins.values()].map((w) => w.app.id));
    const apps = dockApps();
    let html = '';
    if (s.taskbar !== 'classic') {
      if (s.topbar) {
        const fw = focused && !focused.min ? focused : null;
        html += topbarHtml({ launcher: true, desktop: true, app: fw ? fw.app.name : 'Desktop', menus: fw ? windowMenus(fw) : desktopMenus() });
      }
      const sz = parseInt(getComputedStyle(root).getPropertyValue('--dock-size'), 10) || 44;
      html += '<div class="dock-wrap' + (s.autohide ? ' hide' : '') + '"><div class="dock glass">' +
        '<button class="dock-btn launcher-btn' + (UI.pop === 'launcher' ? ' open' : '') + '" data-act="launcher" aria-label="Open launcher"><span class="tile" style="background:linear-gradient(180deg,#4D8BEA,#2F6FD6)"><img src="assets/img/kite-white.svg" alt="" style="width:58%;height:58%"></span>' +
        (s.labels ? '<span class="lbl">Apps</span>' : '') + '<span class="dot"></span><span class="dock-tip">Launcher</span></button><span class="dock-sep"></span>' +
        apps.map((a) => '<button class="dock-btn' + (runningIds.has(a.id) ? ' running' : '') + '" data-app="' + a.id + '" aria-label="' + esc(a.name) + '">' +
          '<img class="tile appicon" src="' + a.img + '" alt="" draggable="false">' + (s.labels ? '<span class="lbl">' + esc(a.name) + '</span>' : '') +
          '<span class="dot"></span><span class="dock-tip">' + esc(a.name) + '</span></button>').join('') +
        '<span class="dock-sep"></span><button class="dock-btn" data-act="trash" aria-label="Trash"><img class="tile appicon" src="' + window.LOS_appIconUrl('trash') + '" alt="" draggable="false">' +
        (s.labels ? '<span class="lbl">Trash</span>' : '') + '<span class="dot"></span><span class="dock-tip">Trash</span></button></div></div>' +
        (s.autohide ? '<div class="dock-hotzone"></div>' : '');
    } else {
      html += '<div class="taskbar glass' + (s.autohide ? ' hide' : '') + '">' +
        '<button class="start' + (UI.pop === 'launcher' ? ' open' : '') + '" data-act="launcher" aria-label="Open launcher" title="Launcher"><span class="tile"><img src="assets/img/kite-white.svg" alt=""></span></button>' +
        
        '<div class="apps">' + apps.map((a) => '<button class="tb-btn' + (runningIds.has(a.id) ? ' running' : '') + (fApp === a.id ? ' focused' : '') + '" data-app="' + a.id + '"' + (runningIds.has(a.id) ? '' : ' title="' + esc(a.name) + '"') + ' aria-label="' + esc(a.name) + '">' +
          '<img class="tile appicon" src="' + a.img + '" alt="" draggable="false"><span class="bar"></span></button>').join('') + '</div>' +
        '<div class="tray"><button class="clock' + (UI.pop === 'qs' ? ' open' : '') + '" data-act="qs" aria-label="Quick settings"><b data-clock="t"></b><span data-clock="ds"></span></button>' +
        '<button class="peek" data-act="peek" title="Show desktop" aria-label="Show desktop"></button></div></div>' +
        (s.autohide ? '<div class="dock-hotzone"></div>' : '');
    }
    bars.innerHTML = html;
    tickClock(bars);
    updateImmersive();
    if (s.autohide) {
      const zone = $('.dock-hotzone', bars);
      const bar = $('.dock-wrap, .taskbar', bars);
      const show = () => bar.classList.remove('hide');
      const hide = () => { if (!UI.pop) bar.classList.add('hide'); };
      zone.addEventListener('mouseenter', show);
      bar.addEventListener('mouseleave', hide);
      bar.addEventListener('mouseenter', show);
    }
  }

  // ------------------------------------------------------------------ popovers
  function togglePop(name) {
    UI.pop = UI.pop === name ? null : name;
    UI.lsQuery = '';
    renderPop();
    syncBarState();
    if (UI.pop === 'launcher') {
      api('fs.recent').then((r) => { UI.recent = r; if (UI.pop === 'launcher' && !UI.lsQuery) renderLauncherBody(); }).catch(() => {});
    }
    if (UI.pop === 'qs') {
      api('fs.usage').then((u) => { UI.usage = u; if (UI.pop === 'qs') renderPop(); }).catch(() => {});
    }
  }

  function closePops() {
    if (!UI.pop) return;
    UI.pop = null;
    renderPop();
    syncBarState();
  }

  /** Reflect which popover is open on the bar buttons without redrawing the bars. */
  function syncBarState() {
    $$('#bars [data-act=launcher]', root).forEach((b) => b.classList.toggle('open', UI.pop === 'launcher'));
    $$('#bars [data-act=qs]', root).forEach((b) => b.classList.toggle('open', UI.pop === 'qs'));
    root.classList.toggle('pop-open', !!UI.pop);
    if (!UI.pop) { const bar = $('#bars .dock-wrap, #bars .taskbar', root); if (bar && set().autohide && !bar.matches(':hover')) bar.classList.add('hide'); }
  }

  function popPosition(kind) {
    const s = set();
    const floating = s.taskbar !== 'classic';
    const dockH = parseInt(getComputedStyle(root).getPropertyValue('--dock-size'), 10) + (s.labels ? 40 : 28) + 24;
    if (kind === 'launcher') {
      if (floating) return 'left:0;right:0;margin:0 auto;bottom:' + dockH + 'px';
      return 'left:8px;bottom:58px';
    }
    if (floating) return s.topbar ? 'right:10px;top:42px' : 'right:10px;bottom:' + dockH + 'px';
    return 'right:10px;bottom:58px';
  }

  /**
   * Draws the open popup. Redrawing the one already on screen (a quick-settings toggle, the storage figure arriving)
   * must not replay its slide-in, or pressing a tile makes the panel blink: a redraw while it is still sliding in
   * carries on from the same point, one after that has no animation. Focus stays on the same control.
   */
  function renderPop() {
    const pops = $('#pops', root);
    const prev = UI.pop && UI.drawnPop === UI.pop && pops ? pops.querySelector('.pop:not(.closing)') : null;
    const running = prev && prev.getAnimations ? prev.getAnimations().find((x) => x.playState === 'running') : null;
    const elapsed = running ? Number(running.currentTime) || 0 : null;
    const act = prev && document.activeElement && pops.contains(document.activeElement) ? document.activeElement.dataset.act : null;
    drawPop();
    UI.drawnPop = UI.pop;
    if (!prev) return;
    const pop = pops.querySelector('.pop:not(.closing)');
    if (pop) {
      if (elapsed != null) pop.style.animationDelay = -elapsed + 'ms';
      else pop.classList.add('still');
    }
    const back = act && pops.querySelector('[data-act="' + act + '"]');
    if (back) back.focus({ preventScroll: true });
  }

  function drawPop() {
    const pops = $('#pops', root);
    if (!pops) return;
    if (!UI.pop) {
      const open = pops.querySelector('.pop:not(.closing)');
      if (!open) { pops.innerHTML = ''; return; }
      open.classList.add('closing');
      const done = () => { if (!UI.pop && open.isConnected) pops.innerHTML = ''; };
      open.addEventListener('animationend', done, { once: true });
      setTimeout(done, 320); // fallback when animations are off
      return;
    }
    if (UI.pop === 'vol') {
      const a = UI.anchor || { right: window.innerWidth - 200, bottom: 34 };
      pops.innerHTML = '<div class="pop volpop from-top" style="top:' + (a.bottom + 8) + 'px;left:' + Math.max(8, Math.min(window.innerWidth - 268, a.left - 110)) + 'px" role="dialog" aria-label="Volume">' +
        '<div class="qlabel">Volume</div>' + volumeRow() + '<small class="vol-hint">Sound from LiteOS apps</small></div>';
      return;
    }
    if (UI.pop === 'launcher') {
      const u = S.user;
      pops.innerHTML = '<div class="pop launcher" style="' + popPosition('launcher') + '" role="dialog" aria-label="Launcher">' +
        '<label class="ls-search">' + ICON('search', 16) + '<input type="text" placeholder="Search apps and files" aria-label="Search apps and files" value="' + esc(UI.lsQuery) + '"></label>' +
        '<div class="ls-body"></div>' +
        '<div class="ls-foot">' + avatar(u, 34) + '<span class="who"><b>' + esc(u.name) + '</b><small>' + (u.role === 'admin' ? 'Administrator' : 'Standard user') + ' · ' + esc(u.username) + '</small></span>' +
        '<button class="ibtn" data-act="open-settings" title="Settings" aria-label="Settings">' + ICON('settings', 18) + '</button>' +
        '<button class="ibtn" data-act="lock" title="Lock" aria-label="Lock">' + ICON('lock', 18) + '</button>' +
        '<button class="ibtn" data-act="signout" title="Sign out" aria-label="Sign out">' + ICON('power', 18) + '</button></div></div>';
      const input = $('.ls-search input', pops);
      input.addEventListener('input', () => { UI.lsQuery = input.value; launcherSearch(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const first = $('.ls-body [data-app], .ls-body [data-file]', pops); if (first) first.click(); }
        if (e.key === 'Escape') closePops();
      });
      renderLauncherBody();
      setTimeout(() => input.focus({ preventScroll: true }), 10);
    } else {
      const s = set();
      const u = S.user;
      const usage = UI.usage;
      const pct = usage ? Math.min(100, Math.round((usage.used / usage.quota) * 100)) : 0;
      pops.innerHTML = '<div class="pop qs w11' + (popPosition('qs').includes('top:') ? ' from-top' : '') + '" style="' + popPosition('qs') + '" role="dialog" aria-label="Quick settings">' +
        '<div class="qgrid">' +
        qTile('q-theme', effectiveTheme() === 'dark', 'moon', 'Dark mode') +
        qTile('q-night', s.nightLight, 'sunset', 'Night light') +
        qTile('q-dnd', s.dnd, 'bell', 'Focus', 'Do not disturb') +
        qTile('q-taskbar', s.taskbar === 'classic', 'taskbar', 'Classic taskbar') +
        qTile('q-glass', s.transparency !== false, 'glass', 'Transparency') +
        qTile('q-a11y', s.textSize && s.textSize !== 'default', 'access', 'Accessibility', 'Larger text', 'q-a11y-more') +
        '</div>' +
        '<div class="qsliders">' + sliderRow('brightness') + sliderRow('volume') + '</div>' +
        '<div class="qfoot">' + avatar(u, 30) + '<span class="meta"><b>' + esc(u.name) + '</b><small>' + (usage ? fmtSize(usage.used) + ' of ' + fmtSize(usage.quota) : 'Storage…') + '</small>' +
        '<span class="meter"><i style="width:' + pct + '%"></i></span></span>' +
        '<button class="ibtn" data-act="open-settings" title="Settings" aria-label="Settings">' + ICON('settings', 17) + '</button>' +
        '<button class="ibtn" data-act="lock" title="Lock" aria-label="Lock">' + ICON('lock', 17) + '</button>' +
        '<button class="ibtn" data-act="power" title="Power" aria-label="Power options">' + ICON('power', 17) + '</button></div></div>';
    }
  }

  // ------------------------------------------------------------------ top bar: app menus
  // ================================================================== snap groups (tiling)
  // Windows snapped to the halves and quarters of the screen form one group, laid out by a small tree: two columns
  // split by a vertical edge (T.x), and each column holds one window or two stacked ones split at its own ratio (r).
  // The edges between tiles are shared: dragging one resizes the windows on both sides. The group minimises and comes
  // forward together, a minimised one keeps its place, and when a window leaves, the window it shared a column with
  // takes its space.
  // With the floating bars, the group takes the whole screen and the bars slide away, the same as a maximised window.
  const TILE_GAP = 0; // tiles touch: a gap would let a press through to the window behind, and the edge handles sit inside each window
  const TILE_MIN_W = 360;
  const TILE_MIN_H = 200;
  const newCol = () => ({ one: null, top: null, bot: null, r: 0.5 });
  const T = { x: 0.5, l: newCol(), r: newCol() };
  const ZONES = { l: ['l', 'one'], tl: ['l', 'top'], bl: ['l', 'bot'], r: ['r', 'one'], tr: ['r', 'top'], br: ['r', 'bot'] };
  const ZONE_LABEL = { l: 'Left', r: 'Right', tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' };
  const tileArea = () => (fullMax() ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight } : workArea());
  const tiledWins = () => [...wins.values()].filter((x) => x.tile);
  const colEmpty = (c) => !c.one && !c.top && !c.bot;

  /** Where a zone is on screen with the group's current edges (also for the drag preview of an empty zone). */
  function zoneRect(zone) {
    const a = tileArea();
    const [side, slot] = ZONES[zone];
    const lw = Math.round(a.w * T.x);
    const g = TILE_GAP / 2;
    const x = side === 'l' ? a.x : a.x + lw + g;
    const w = side === 'l' ? lw - g : a.w - lw - g;
    if (slot === 'one') return { x, y: a.y, w, h: a.h };
    const th = Math.round(a.h * T[side].r);
    return slot === 'top' ? { x, y: a.y, w, h: th - g } : { x, y: a.y + th + g, w, h: a.h - th - g };
  }

  /** Bring every window's tile, class and position in line with the tree. */
  function syncTiles() {
    const where = new Map();
    ['l', 'r'].forEach((side) => ['one', 'top', 'bot'].forEach((slot) => {
      const id = T[side][slot];
      if (id && wins.has(id)) where.set(id, side === 'l' ? { one: 'l', top: 'tl', bot: 'bl' }[slot] : { one: 'r', top: 'tr', bot: 'br' }[slot]);
      else T[side][slot] = null;
    }));
    wins.forEach((w) => {
      const z = where.get(w.id) || null;
      if (w.tile === z && !z) return;
      w.tile = z;
      w.el.classList.toggle('tiled', !!z);
      if (z) w.el.dataset.tile = z; else delete w.el.dataset.tile;
      applyRect(w);
    });
    if (!where.size) { T.x = 0.5; T.l.r = 0.5; T.r.r = 0.5; }
    updateImmersive();
  }

  /** Take a window out of the group; the window it shared a column with takes the whole column. */
  function untile(w) {
    if (!w.tile) return;
    const [side, slot] = ZONES[w.tile];
    const c = T[side];
    c[slot] = null;
    if (slot !== 'one') { const other = c.top || c.bot; c.top = null; c.bot = null; if (other) c.one = other; }
    syncTiles();
  }

  /** Snap a window into a zone ('l', 'r', 'tl', 'tr', 'bl', 'br') or maximise it ('max'). */
  function snapWin(w, zone, opts) {
    hideSnapAssist();
    if (zone === 'max') { untile(w); if (!w.max) toggleMax(w); return; }
    if (w.max) toggleMax(w);
    if (w.min) { w.min = false; w.el.classList.remove('min'); }
    if (w.tile === zone) return;
    untile(w);
    const [side, slot] = ZONES[zone];
    const c = T[side];
    if (slot === 'one') { c.one = null; c.top = null; c.bot = null; } // anything in that column floats again
    else {
      const other = slot === 'top' ? 'bot' : 'top';
      if (c.one) { c[other] = c.one; c.one = null; } // the half already there moves to the other quarter
    }
    c[slot] = w.id;
    syncTiles();
    focus(w);
    if (!(opts && opts.noAssist)) setTimeout(() => showSnapAssist(), 0);
  }

  /** The zone the pointer is in while dragging a window (shell coordinates), or null. */
  function zoneAt(x, y) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const a = workArea();
    const atL = x <= 4;
    const atR = x >= W - 5;
    if (atL || atR) {
      const v = y < a.y + a.h * 0.22 ? 't' : y > a.y + a.h * 0.78 ? 'b' : '';
      return v + (atL ? 'l' : 'r');
    }
    if (y <= a.y + 2 || y <= 2) return x < W * 0.15 ? 'tl' : x > W * 0.85 ? 'tr' : 'max';
    if (y >= H - 4) return x < W * 0.15 ? 'bl' : x > W * 0.85 ? 'br' : null;
    return null;
  }

  // Snap Assist: after a snap, an empty part of the group offers the other open windows to fill it.
  let assistEl = null;
  function emptyZone() {
    if (!tiledWins().length) return null;
    for (const side of ['l', 'r']) {
      const c = T[side];
      if (colEmpty(c)) return side;
      if (!c.one && !c.top) return 't' + side;
      if (!c.one && !c.bot) return 'b' + side;
    }
    return null;
  }
  function hideSnapAssist() { if (assistEl) { assistEl.remove(); assistEl = null; } }
  function showSnapAssist() {
    hideSnapAssist();
    const zone = emptyZone();
    const list = [...wins.values()].filter((x) => !x.tile && !x.min).sort((a2, b2) => +b2.el.style.zIndex - +a2.el.style.zIndex);
    if (!zone || !list.length) return;
    const r = zoneRect(zone);
    assistEl = document.createElement('div');
    assistEl.className = 'snap-assist';
    assistEl.setAttribute('role', 'listbox');
    assistEl.setAttribute('aria-label', 'Choose a window for the ' + ZONE_LABEL[zone].toLowerCase() + ' of the screen');
    Object.assign(assistEl.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', zIndex: String(++zTop) });
    assistEl.innerHTML = '<div class="sa-list">' + list.map((x) => '<button class="sa-item" role="option" data-id="' + x.id + '">' + appTile(x.app, 32) +
      '<span>' + esc(x.title) + '</span></button>').join('') + '</div>';
    $('.windows', root).appendChild(assistEl);
    assistEl.addEventListener('click', (e) => {
      const b = e.target.closest('.sa-item');
      if (b) { const x = wins.get(b.dataset.id); if (x) snapWin(x, zone); return; }
      hideSnapAssist();
    });
    assistEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); hideSnapAssist(); } });
    const first = $('.sa-item', assistEl);
    if (first) first.focus({ preventScroll: true });
  }
  // a press anywhere else dismisses it
  document.addEventListener('pointerdown', (e) => { if (assistEl && !assistEl.contains(e.target)) hideSnapAssist(); }, true);

  /**
   * One drag session for every window: the shell's own title bar and apps that draw their own (they report the
   * pointer through the SDK). Positions are in shell coordinates. Dragging a maximised or snapped window pulls it out
   * under the pointer; dropping on an edge or corner snaps it, at the top edge maximises it.
   */
  function dragSession(w, px, py) {
    const a = workArea();
    let offX = px - w.rect.x;
    let offY = py - w.rect.y;
    let moved = false;
    let zone = null;
    let ghost = null;
    const sx = px;
    const sy = py;
    return {
      move(x, y) {
        if (!moved && Math.abs(x - sx) + Math.abs(y - sy) < 4) return;
        if (!moved) {
          moved = true;
          root.classList.add('dragging');
          hideSnapAssist();
          if (w.max || w.tile) {
            const r = w.el.getBoundingClientRect();
            const ratio = Math.min(0.9, Math.max(0.1, (sx - r.left) / Math.max(1, r.width)));
            if (w.max) toggleMax(w);
            untile(w);
            offX = Math.round(w.rect.w * ratio);
            offY = Math.min(20, Math.max(8, sy - r.top));
          }
        }
        w.rect.x = Math.round(x - offX);
        w.rect.y = Math.round(Math.max(a.y, Math.min(y - offY, a.y + a.h - 40)));
        applyRect(w);
        zone = zoneAt(x, y);
        if (zone && !ghost) { ghost = document.createElement('div'); ghost.className = 'snap-ghost'; $('.windows', root).appendChild(ghost); }
        if (!zone && ghost) { ghost.remove(); ghost = null; }
        if (ghost) {
          ghost.style.zIndex = String(zTop + 1);
          const g = zone === 'max' ? (fullMax() ? tileArea() : a) : zoneRect(zone);
          Object.assign(ghost.style, { left: g.x + 6 + 'px', top: g.y + 6 + 'px', width: g.w - 12 + 'px', height: g.h - 12 + 'px' });
        }
      },
      end() {
        root.classList.remove('dragging');
        if (ghost) ghost.remove();
        if (moved && zone) snapWin(w, zone);
      },
    };
  }

  const helpMenu = () => ({ label: 'Help', items: [
    { label: 'Keyboard shortcuts', icon: 'info', action: () => alertDialog({ title: 'Keyboard shortcuts', message: 'Alt + Space — open the launcher. Esc — close menus and dialogs. Double-click a title bar — maximise. Drag a window to the top edge to maximise it, to the left or right edge to snap it to that half, or into a corner for a quarter. Snapped windows share their edges: drag the edge between them to resize both.' }) },
    { label: 'About ' + (S.system.instanceName || 'LiteOS'), icon: 'info', action: () => openApp('settings', { section: 'about' }) },
  ] });

  /** Menus for a window: the app's own (set through the SDK) merged with standard window menus. */
  function windowMenus(w) {
    const std = {
      File: [{ label: 'New window', icon: 'plus', disabled: !!w.app.single, action: () => openApp(w.app.id) }, 'sep', { label: 'Close window', icon: 'x', action: () => closeWin(w) }],
      View: [
        { label: w.max ? 'Restore' : 'Maximise', icon: w.max ? 'window.restore' : 'window.maximize', action: () => toggleMax(w) },
        { label: 'Minimise', icon: 'minus', action: () => minimize(w) },
        'sep',
        { label: 'Snap', icon: 'grid', items: [
          ...['l', 'r', 'sep', 'tl', 'tr', 'bl', 'br'].map((z) => (z === 'sep' ? 'sep' : { label: ZONE_LABEL[z], checked: w.tile === z, action: () => snapWin(w, z) })),
          'sep',
          { label: 'Unsnap', disabled: !w.tile, action: () => untile(w) },
        ] },
      ],
    };
    // The app's own commands run in the app's frame, but this menu bar belongs to the desktop, which has focus while
    // it's open. Browsers refuse a document that doesn't have focus things like the clipboard API ("Document is not
    // focused"), so give the app's frame focus back before running one of its commands (Edit › Paste, Copy…).
    const inApp = (items) => (items || []).map((it) => {
      if (!it || typeof it !== 'object') return it;
      const out = Object.assign({}, it);
      if (it.items) out.items = inApp(it.items);
      if (typeof it.action === 'function') {
        out.action = () => {
          const frame = $('iframe', w.el);
          try { if (frame && frame.contentWindow) frame.contentWindow.focus(); } catch (e) { /* ignore */ }
          return it.action();
        };
      }
      return out;
    });
    const menus = (w.menus || []).map((m) => ({ label: m.label, items: inApp(m.items) }));
    Object.keys(std).forEach((label) => {
      const own = menus.find((m) => m.label === label);
      if (own) own.items = own.items.concat(['sep'], std[label]);
      else menus.splice(label === 'File' ? 0 : menus.length, 0, { label, items: std[label] });
    });
    menus.push({ label: 'Window', items: [...wins.values()].map((x) => ({ label: x.title, icon: x === w ? 'check' : null, action: () => restore(x) }))
      .concat(['sep', { label: 'Minimise all', icon: 'minus', action: () => wins.forEach(minimize) }]) });
    menus.push(helpMenu());
    return menus;
  }

  /** The desktop itself has no menus in the top bar: just its name. */
  function desktopMenus() { return []; }

  function openTopMenu(btn) {
    const fw = wins.get(focusedId);
    const menus = fw && !fw.min ? windowMenus(fw) : desktopMenus();
    const m = menus[+btn.dataset.menu];
    if (!m) return;
    const r = btn.getBoundingClientRect();
    btn.classList.add('open');
    UI.topMenu = btn.dataset.menu;
    showMenu(m.items, { x: r.left, y: r.bottom + 4 }, () => { btn.classList.remove('open'); UI.topMenu = null; });
  }

  // ------------------------------------------------------------------ volume (applies to audio/video inside LiteOS apps)
  /** Quick settings toggle (Windows 11 style): a rectangular button, label underneath; `more` adds a chevron half. */
  function qTile(act, on, icon, label, title, more) {
    const t = title || label;
    const main = '<button class="qtile' + (on ? ' on' : '') + (more ? ' split' : '') + '" data-act="' + act + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + esc(t) + '" title="' + esc(t) + '">' +
      '<span class="qmain">' + ICON(icon, 18) + '</span>' +
      (more ? '<span class="qchev" data-act="' + more + '" role="button" aria-label="' + esc(label) + ' settings">' + ICON('forward', 14) + '</span>' : '') + '</button>';
    return '<div class="qt">' + main + '<span class="ql">' + esc(label) + '</span></div>';
  }

  /** Slider row for Quick settings / the volume popover. kind: 'volume' | 'brightness'. */
  function sliderRow(kind) {
    const s = set();
    if (kind === 'brightness') {
      const v = s.brightness == null ? 100 : s.brightness;
      return '<div class="qvol"><span class="qico" title="Brightness">' + ICON('sun', 18) + '</span>' +
        '<input class="qrange" data-k="brightness" type="range" min="20" max="100" value="' + v + '" aria-label="Brightness" style="--v:' + Math.round((v - 20) / 0.8) + '%"><span class="qpct" data-k="brightness">' + v + '%</span></div>';
    }
    const v = s.muted ? 0 : (s.volume == null ? 80 : s.volume);
    return '<div class="qvol"><button class="ibtn" data-act="q-mute" aria-label="' + (s.muted ? 'Unmute' : 'Mute') + '">' + ICON(s.muted || !v ? 'mute' : 'volume', 18) + '</button>' +
      '<input class="qrange" data-k="volume" type="range" min="0" max="100" value="' + v + '" aria-label="Volume" style="--v:' + v + '%"><span class="qpct" data-k="volume">' + v + '%</span></div>';
  }

  /** Virtual brightness: a black overlay over everything (never fully dark). */
  function applyDim() {
    const b = set().brightness == null ? 100 : set().brightness;
    let dim = $('.screen-dim', root);
    if (b >= 100) { if (dim) dim.remove(); return; }
    if (!dim) { dim = document.createElement('div'); dim.className = 'screen-dim'; root.appendChild(dim); }
    dim.style.opacity = String(((100 - b) / 80) * 0.7);
  }
  const saveBrightness = debounce((v) => { api('settings.save', { settings: { brightness: v } }).catch(() => {}); }, 300);

  function volumeRow() { return sliderRow('volume'); }
  const saveVolume = debounce((v) => { api('settings.save', { settings: { volume: v, muted: false } }).catch(() => {}); }, 300);

  const launcherSearch = debounce(async () => {
    renderLauncherBody();
    const qv = UI.lsQuery.trim();
    if (!qv) return;
    try {
      const r = await api('fs.search', undefined, { q: qv, limit: 12 });
      if (UI.lsQuery.trim() === qv) { UI.results = r; renderLauncherBody(); }
    } catch (e) { /* ignore */ }
  }, 200);

  function renderLauncherBody() {
    const body = $('#pops .ls-body', root);
    if (!body) return;
    const qv = UI.lsQuery.trim().toLowerCase();
    const fileBtn = (f) => '<button class="ls-file" data-file="' + esc(f.path) + '" data-type="' + f.type + '">' + fileTile(f, 34, 9) +
      '<span class="meta"><b>' + esc(f.name) + '</b><small>' + esc(parent(f.path)) + '</small></span></button>';
    if (qv) {
      const apps = window.LOS_APPS.filter((a) => a.name.toLowerCase().includes(qv));
      const files = (UI.results || []).filter((f) => f.name.toLowerCase().includes(qv));
      body.innerHTML = (apps.length ? '<div class="ls-head">Apps</div><div class="ls-grid">' + apps.map((a) => '<button class="ls-app" data-app="' + a.id + '">' + appTile(a, 44, 12) + '<span>' + esc(a.name) + '</span></button>').join('') + '</div>' : '') +
        (files.length ? '<div class="ls-head">Files</div><div class="ls-files">' + files.map(fileBtn).join('') + '</div>' : '') +
        (!apps.length && !files.length ? '<div class="ls-empty">No apps or files match “' + esc(UI.lsQuery) + '”.</div>' : '');
      return;
    }
    body.innerHTML = '<div class="ls-head">All apps</div><div class="ls-grid">' +
      window.LOS_APPS.map((a) => '<button class="ls-app" data-app="' + a.id + '">' + appTile(a, 44, 12) + '<span>' + esc(a.name) + '</span></button>').join('') + '</div>' +
      '<div class="ls-head">Recent</div>' + (UI.recent.length ? '<div class="ls-files">' + UI.recent.slice(0, 6).map(fileBtn).join('') + '</div>' : '<div class="ls-empty">Files you open will show up here.</div>');
  }

  // ================================================================== windows
  function hostState() { return { user: S.user, settings: set(), system: S.system }; }

  function clampRect(r) {
    const a = workArea();
    r.w = Math.min(r.w, a.w);
    r.h = Math.min(r.h, a.h);
    r.x = Math.max(a.x - r.w + 120, Math.min(r.x, a.x + a.w - 120));
    r.y = Math.max(a.y, Math.min(r.y, a.y + a.h - 40));
    return r;
  }

  /** With the floating bars, a maximised window takes the whole screen and the bars hide (see updateImmersive). */
  const fullMax = () => set().taskbar !== 'classic';
  function applyRect(w) {
    const r = w.max ? (fullMax() ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight } : workArea()) : w.tile ? zoneRect(w.tile) : w.rect;
    Object.assign(w.el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }

  function relayout() {
    wins.forEach((w) => { if (!w.max) clampRect(w.rect); applyRect(w); });
  }

  function openApp(appId, args, opts) {
    const app = window.LOS_app(appId);
    if (!app) { notify('That app isn’t installed.', { type: 'error', title: 'App not found' }); return null; }
    args = args || {};
    opts = opts || {};
    closePops();
    if (app.single) {
      const existing = [...wins.values()].find((x) => x.app.id === appId);
      if (existing) {
        if (Object.keys(args).length) {
          existing.args = args;
          existing.asleep = false;
          existing.el.classList.remove('asleep');
          winLoading(existing);
          existing.iframe.src = app.entry + '?' + new URLSearchParams(Object.assign({}, args, { win: existing.id }));
        }
        restore(existing);
        return existing;
      }
    }
    const id = 'w' + (++winSeq);
    const a = workArea();
    const count = wins.size;
    const w = Math.min(app.size[0], a.w - 40);
    const h = Math.min(app.size[1], a.h - 24);
    // centred, each new window a step down and right of the last, but always wholly inside the work area
    const fit = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    const rect = clampRect({
      x: Math.round(fit(a.x + (a.w - w) / 2 + (count % 6) * 28 - 70, a.x + 8, a.x + a.w - w - 8)),
      y: Math.round(fit(a.y + Math.max(12, (a.h - h) / 2 - 20) + (count % 6) * 24, a.y + 8, a.y + a.h - h - 8)),
      w, h,
    });
    const el = document.createElement('section');
    // chrome: 'custom' — the app draws its own title bar (e.g. Browser tabs); the shell keeps only the controls.
    // material: 'mica' — a frosted window over the wallpaper while Transparency effects is on (os.css).
    el.className = 'win' + (app.chrome === 'custom' ? ' win-custom' : '') + (app.material === 'mica' ? ' win-mica' : '');
    el.dataset.id = id;
    el.setAttribute('aria-label', app.name);
    el.innerHTML = '<div class="win-bar">' + appTile(app, 20, 6, 12) + '<span class="title"></span>' +
      '<button class="ibtn ctl" data-w="min" aria-label="Minimise">' + ICON('window.minimize', 14) + '</button>' +
      '<button class="ibtn ctl" data-w="max" aria-label="Maximise">' + ICON('window.maximize', 13) + '</button>' +
      '<button class="ibtn ctl close" data-w="close" aria-label="Close">' + ICON('window.close', 14) + '</button></div>' +
      '<div class="win-body"><iframe title="' + esc(app.name) + '" allow="fullscreen; clipboard-read; clipboard-write; autoplay; picture-in-picture; encrypted-media; web-share; accelerometer; gyroscope; camera; microphone" allowfullscreen></iframe>' +
      '<div class="win-load" role="progressbar" aria-label="Opening ' + esc(app.name) + '">' + '<span class="ld-mark" aria-hidden="true">' + appTile(app, 48) + appTile(app, 48) + '</span>' +
      '<p class="ld-text" aria-live="polite"></p><span class="ld-bar" aria-hidden="true"><i></i></span></div>' +
      '<div class="win-shield"></div></div>' +
      ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => '<div class="rz ' + d + '" data-rz="' + d + '"></div>').join('');
    const win = { id, app, el, iframe: $('iframe', el), title: app.name, dirty: false, max: false, min: false, rect, prev: null, tile: null, args, keep: opts.keep || null };
    wins.set(id, win);
    $('.windows', root).appendChild(el);
    win.iframe.addEventListener('load', () => winPaged(win));
    if (opts.sleep) { win.asleep = true; el.classList.add('asleep'); } // brought back after a reload: its app starts when it's first shown
    else wakeWin(win, true);
    setTitle(win, opts.title || app.name);
    applyRect(win);
    bindWindow(win);
    focus(win);
    return win;
  }

  // Loading cover: the app's icon over the window body until its page has loaded (the frame's load event fires once
  // the SDK's ready() callbacks have run). The icon runs the brand's "Shimmer" loader (motion 02): it sits dimmed while a
  // band of light sweeps across a second copy of it, so any app icon works without editing the icon itself.
  // An app whose manifest sets window.reportsReady keeps the cover up after its page loads, until it calls
  // OS.win.loaded() (when what it opened is on screen); meanwhile OS.win.loading(text, progress) shows a line of text
  // and a progress bar under the icon. Each message gives it another 15 s, so a slow but busy app stays covered and
  // one that has stopped answering is uncovered anyway. One that has said nothing at all a few seconds after its page
  // loaded (it failed while starting, say) is uncovered then rather than after the full wait.
  const LOAD_WAIT = 15000, QUIET_WAIT = 3000;
  function winLoading(w) {
    const c = $('.win-load', w.el);
    if (!c) return;
    c.classList.remove('done');
    w.covered = true;
    w.heard = false;
    winLoadText(w, '', null);
    clearTimeout(w.loadTimer);
    w.loadTimer = setTimeout(() => winLoaded(w), LOAD_WAIT); // never leave a window covered
  }
  /** The frame's page has loaded: uncovered now, unless the app says when it's ready. */
  function winPaged(w) {
    if (!w.covered) return;
    // a new frame first "loads" a blank page (some browsers report that after the listener is attached): not the app yet
    try { if (w.iframe.contentWindow.location.href === 'about:blank') return; } catch (e) { /* another origin: it's the app */ }
    if (!w.app.reports) { winLoaded(w); return; }
    if (w.heard) return; // it's reporting: the wait from its last message stands
    clearTimeout(w.loadTimer);
    w.loadTimer = setTimeout(() => winLoaded(w), QUIET_WAIT);
  }
  function winLoaded(w) {
    clearTimeout(w.loadTimer);
    w.covered = false;
    const c = $('.win-load', w.el);
    if (c) requestAnimationFrame(() => c.classList.add('done'));
  }
  function winLoadText(w, text, progress) {
    const c = $('.win-load', w.el);
    if (!c) return;
    // the line is a live region: rewritten only when it changes, so screen readers don't repeat it on every update
    const line = $('.ld-text', c);
    if (line.textContent !== (text || '')) line.textContent = text || '';
    const bar = $('.ld-bar', c);
    const on = typeof progress === 'number' && isFinite(progress);
    bar.classList.toggle('on', on);
    if (!on) $('i', bar).style.width = '0';
    else $('i', bar).style.width = Math.round(Math.max(0, Math.min(1, progress)) * 100) + '%';
    if (text) c.setAttribute('aria-valuetext', text + (on ? ' ' + Math.round(progress * 100) + '%' : '')); else c.removeAttribute('aria-valuetext');
  }

  function openFile(path, isDir) {
    if (isDir) return openApp('files', { path });
    const app = window.LOS_appForFile(path);
    if (app) return openApp(app.id, { path });
    notify('No app can open “' + baseName(path) + '”. It will be downloaded instead.', { title: 'Downloading file' });
    window.open(rawUrl(path, true), '_blank', 'noopener');
    return null;
  }

  /** Start a window's app (a window brought back asleep after a reload starts it when it's first shown). */
  function wakeWin(w, fresh) {
    if (!fresh && !w.asleep) return;
    w.asleep = false;
    w.el.classList.remove('asleep');
    winLoading(w);
    w.iframe.src = w.app.entry + '?' + new URLSearchParams(Object.assign({}, w.args, { win: w.id }));
  }

  function setTitle(w, title) {
    w.title = title || w.app.name;
    const t = $('.title', w.el);
    t.innerHTML = esc(w.title) + (w.dirty ? '<span class="dirty" title="Unsaved changes"></span>' : '');
  }

  function focus(w) {
    if (!w) return;
    if (w.asleep && !w.min && !deskRestoring) wakeWin(w);
    if (focusedId === w.id && !w.min && w.el.style.zIndex == zTop) return;
    if (assistEl && !w.tile) hideSnapAssist(); // picking another window dismisses Snap Assist
    // a snapped window comes forward with the rest of its group
    if (w.tile) tiledWins().forEach((x) => { if (x !== w && !x.min) x.el.style.zIndex = String(++zTop); });
    if (focusedId && focusedId !== w.id) snapLater(wins.get(focusedId)); // the window left behind: copy it while it shows
    w.el.style.zIndex = String(++zTop);
    w.lastFocus = Date.now();
    focusedId = w.id;
    wins.forEach((x) => x.el.classList.toggle('focused', x === w));
    // The front window also gets the keyboard: an app that cancels pointerdown (a canvas editor) would otherwise leave
    // focus in the window behind, and a later click there would go unnoticed (see raiseFramed).
    if (document.activeElement !== w.iframe) { try { w.iframe.contentWindow.focus(); } catch (e) { /* ignore */ } }
    renderBars();
  }

  function focusTopmost() {
    let best = null;
    wins.forEach((x) => { if (!x.min && (!best || +x.el.style.zIndex > +best.el.style.zIndex)) best = x; });
    if (best) focus(best); else { focusedId = null; wins.forEach((x) => x.el.classList.remove('focused')); renderBars(); }
  }

  function minimize(w) {
    hideSnapAssist();
    // a snapped window keeps its place in the group while minimised, and comes back to it
    w.min = true;
    // a minimised window's card shows it as it was: if its copy is old, it is copied first, invisible but still laid
    // out (a fraction of a second), and only then taken off the screen
    if (Date.now() - (w.snapAt || 0) > SNAP_GAP && !w.snapNo && !appPreview(w) && snappable(w)) {
      w.el.classList.add('minimizing');
      const done = () => { w.el.classList.remove('minimizing'); if (w.min) w.el.classList.add('min'); };
      w.snapAt = 0;
      snapshot(w).then(done, done);
    } else w.el.classList.add('min');
    if (focusedId === w.id) focusTopmost(); else renderBars();
  }

  function restore(w) {
    w.min = false;
    w.el.classList.remove('min', 'minimizing');
    focus(w);
  }

  function toggleMax(w) {
    if (!w.max && w.tile) untile(w); // maximising takes it out of the group
    if (w.max) { w.max = false; w.el.classList.remove('max'); }
    else { w.max = true; w.el.classList.add('max'); }
    $('[data-w=max]', w.el).innerHTML = ICON(w.max ? 'window.restore' : 'window.maximize', 13);
    $('[data-w=max]', w.el).setAttribute('aria-label', w.max ? 'Restore' : 'Maximise');
    applyRect(w);
    updateImmersive();
  }

  async function closeWin(w, force) {
    if (w.dirty && !force) {
      focus(w);
      const ok = await confirmDialog({ title: 'Close ' + w.app.name + '?', message: 'You have unsaved changes in “' + w.title.replace(/ — .*$/, '') + '”. They will be lost.', okLabel: 'Close without saving', danger: true });
      if (!ok) return false;
    }
    w.el.classList.add('closing');
    if (PV.peek === w) peekWin(null);
    dropSnap(w);
    const qi = snapQ.indexOf(w);
    if (qi >= 0) snapQ.splice(qi, 1);
    wins.delete(w.id);
    if (w.tile) untile(w); // after leaving the list, so the closing window stays where it is while it fades
    if (assistEl) showSnapAssist(); // the closed window may have been one of its choices
    setTimeout(() => w.el.remove(), 120);
    if (focusedId === w.id) focusTopmost(); else renderBars();
    return true;
  }

  function bindWindow(w) {
    const bar = $('.win-bar', w.el);
    w.el.addEventListener('mousedown', () => { focus(w); closePops(); });
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      if (b.dataset.w === 'min') minimize(w);
      else if (b.dataset.w === 'max') toggleMax(w);
      else closeWin(w);
    });
    bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) toggleMax(w); });
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      startDrag(w, e);
    });
    $$('.rz', w.el).forEach((h) => h.addEventListener('pointerdown', (e) => { if (e.button === 0) startResize(w, e, h.dataset.rz); }));
  }

  function startDrag(w, e) {
    const target = e.target;
    target.setPointerCapture(e.pointerId);
    const d = dragSession(w, e.clientX, e.clientY);
    const move = (ev) => d.move(ev.clientX, ev.clientY);
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      d.end();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  function startResize(w, e, dir) {
    e.stopPropagation();
    focus(w);
    const handle = e.target;
    handle.setPointerCapture(e.pointerId);
    const start = Object.assign({}, w.rect);
    const sx = e.clientX;
    const sy = e.clientY;
    const minW = 360;
    const minH = 240;
    const a = workArea();
    root.classList.add('dragging');
    if (w.tile) { tileResize(w, handle, dir); return; }
    const move = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      const r = Object.assign({}, start);
      if (dir.includes('e')) r.w = Math.max(minW, start.w + dx);
      if (dir.includes('s')) r.h = Math.max(minH, start.h + dy);
      if (dir.includes('w')) { r.w = Math.max(minW, start.w - dx); r.x = start.x + start.w - r.w; }
      if (dir.includes('n')) { r.h = Math.max(minH, start.h - dy); r.y = start.y + start.h - r.h; if (r.y < a.y) { r.h -= a.y - r.y; r.y = a.y; } }
      w.rect = r;
      applyRect(w);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      root.classList.remove('dragging');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  /** Resizing a snapped window moves the edges it shares with the rest of the group (its outer edges have no handles). */
  function tileResize(w, handle, dir) {
    const [side, slot] = ZONES[w.tile];
    const ta = tileArea();
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const move = (ev) => {
      const xEdge = (side === 'l' && dir.includes('e')) || (side === 'r' && dir.includes('w'));
      const yEdge = (slot === 'top' && dir.includes('s')) || (slot === 'bot' && dir.includes('n'));
      if (xEdge) { const m = Math.min(0.45, TILE_MIN_W / ta.w); T.x = clamp((ev.clientX - ta.x) / ta.w, m, 1 - m); }
      if (yEdge) { const m = Math.min(0.45, TILE_MIN_H / ta.h); T[side].r = clamp((ev.clientY - ta.y) / ta.h, m, 1 - m); }
      tiledWins().forEach(applyRect);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      root.classList.remove('dragging');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  function appClicked(appId) {
    const list = [...wins.values()].filter((w) => w.app.id === appId);
    if (!list.length) { openApp(appId); return; }
    const f = wins.get(focusedId);
    if (f && f.app.id === appId && !f.min) {
      // Cycle through this app's windows, or minimise if there is only one.
      if (list.length > 1) {
        const sorted = list.sort((x, y) => +x.el.style.zIndex - +y.el.style.zIndex);
        restore(sorted[0]);
      } else minimize(f);
      return;
    }
    const top = list.sort((x, y) => +y.el.style.zIndex - +x.el.style.zIndex)[0];
    restore(top);
  }

  // ------------------------------------------------------------------ the desktop across a reload
  // A reload (F5 on the desktop, the browser's button, an accident) keeps the session but would lose every window.
  // Just before the page goes, the shell writes down what is open: each window's app, what it was opened with, its
  // place and size, maximised / snapped / minimised, the stacking order and the focus, plus whatever small state the
  // app hands over (OS.win.keepState). It goes in sessionStorage: this tab only, gone when the tab closes, a couple
  // of KB, written once at unload so it costs nothing while you work. Only references are kept, never file contents.
  // After the reload the boot screen rebuilds the windows behind it. Every one reopens through the normal path, so the
  // server checks each file again. The windows you can see start at once (the top few); the rest come back asleep
  // (their frame and icon) and start when first shown, so a dozen windows don't all load together. The record belongs
  // to the user who wrote it: another user signing in on this tab doesn't get it, and signing out clears it.
  const DESK_KEY = 'los_desk';
  const DESK_MAX_WINS = 20;
  const DESK_EAGER = 3;         // windows that start straight away after a reload; the rest wait to be shown
  const KEEP_MAX = 32 * 1024;   // an app's own state, as JSON
  let deskRestoring = false;
  let deskOff = false;
  /** The state an app hands over through OS.win.keepState(fn), if it is small enough. */
  function keepOf(w) {
    if (w.asleep) return w.keep || null; // never started since the reload: what it had then
    try {
      const fn = w.iframe.contentWindow.LiteOS && w.iframe.contentWindow.LiteOS.win._keep;
      if (!fn) return null;
      const json = JSON.stringify(fn());
      return json && json.length <= KEEP_MAX ? JSON.parse(json) : null;
    } catch (e) { return null; }
  }
  function saveDesk() {
    if (deskOff || !S.user || !$('.windows', root)) return;
    const list = [...wins.values()].sort((a, b) => +a.el.style.zIndex - +b.el.style.zIndex).slice(-DESK_MAX_WINS);
    const rec = {
      v: 1, user: S.user.username, at: Date.now(),
      tiles: { x: T.x, l: T.l.r, r: T.r.r },
      focused: list.findIndex((w) => w.id === focusedId),
      wins: list.map((w) => ({ app: w.app.id, args: w.args || {}, title: w.title, rect: w.rect, max: w.max, min: w.min, tile: w.tile, keep: keepOf(w) })),
    };
    try { if (rec.wins.length) sessionStorage.setItem(DESK_KEY, JSON.stringify(rec)); else sessionStorage.removeItem(DESK_KEY); } catch (e) { /* storage full or blocked */ }
  }
  function forgetDesk() { deskOff = true; try { sessionStorage.removeItem(DESK_KEY); } catch (e) { /* blocked */ } }
  // at unload (every frame is still alive, so apps can hand over their state) and when the tab goes to the background
  // (a browser may discard a background tab and reload it later)
  window.addEventListener('beforeunload', saveDesk);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveDesk(); });

  function restoreDesk() {
    let rec = null;
    try { rec = JSON.parse(sessionStorage.getItem(DESK_KEY) || 'null'); } catch (e) { rec = null; }
    if (!rec || rec.v !== 1 || rec.user !== S.user.username || !Array.isArray(rec.wins) || !rec.wins.length) return;
    const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
    const cleanArgs = (a) => Object.fromEntries(Object.entries(a && typeof a === 'object' ? a : {})
      .filter(([k, v]) => k !== 'win' && typeof v === 'string' && k.length < 40 && v.length < 2048).slice(0, 20));
    const list = rec.wins.slice(-DESK_MAX_WINS);
    // the top few windows that aren't minimised start now; the rest start when first shown
    const eager = new Set(list.map((s, i) => (s && !s.min ? i : -1)).filter((i) => i >= 0).slice(-DESK_EAGER));
    const made = [];
    deskRestoring = true;
    try {
      list.forEach((s, i) => {
        if (!s || !window.LOS_app(s.app)) return;
        const w = openApp(s.app, cleanArgs(s.args), { sleep: !eager.has(i), keep: s.keep && typeof s.keep === 'object' ? s.keep : null, title: typeof s.title === 'string' ? s.title.slice(0, 200) : '' });
        if (!w || made.some(([x]) => x === w)) return; // a single-window app listed twice
        if (s.rect) w.rect = clampRect({ x: num(s.rect.x, w.rect.x), y: num(s.rect.y, w.rect.y), w: Math.max(360, num(s.rect.w, w.rect.w)), h: Math.max(240, num(s.rect.h, w.rect.h)) });
        if (s.max && !w.max) toggleMax(w); else applyRect(w);
        made.push([w, s, i]);
      });
      // the snap layout: its edges, then each window back in its zone
      if (rec.tiles) {
        const r = (v) => Math.max(0.15, Math.min(0.85, num(v, 0.5)));
        T.x = r(rec.tiles.x); T.l.r = r(rec.tiles.l); T.r.r = r(rec.tiles.r);
      }
      made.forEach(([w, s]) => { if (s.tile && ZONES[s.tile] && !w.max) { const [side, slot] = ZONES[s.tile]; T[side][slot] = w.id; } });
      syncTiles();
      made.forEach(([w, s]) => { if (s.min) { w.min = true; w.el.classList.add('min'); } });
    } finally { deskRestoring = false; }
    const f = made.find(([, , i]) => i === rec.focused);
    if (f && !f[0].min) focus(f[0]); else focusTopmost();
  }

  // ------------------------------------------------------------------ window previews
  // Resting the pointer on a running app in the dock or taskbar shows a card for each of its windows: its icon, title,
  // shape and a close button. A card doesn't draw a copy of the window, which would mean rendering every app twice;
  // hovering a card "peeks" at the real window instead (shown where it is, even when minimised, with the others
  // faded out). Nothing runs until the pointer rests on a button, and the cards are removed once it leaves.
  const PV = { el: null, app: null, showT: 0, hideT: 0, peek: null };

  // The pictures on the cards. An app that draws on a canvas (Board, a playing video in Media) hands over what it
  // shows through LiteOS.win.preview(fn), copied small on each hover (a few ms). Other windows get a snapshot taken
  // when they are minimised or lose focus: in idle time, one at a time, at most once every few seconds a window,
  // kept as a small JPEG (some 10 KB). A window holding another site's page (the Browser) or a very large page
  // can't be copied cheaply, so its card keeps the icon.
  const SNAP_W = 384;          // the card's picture at twice its size, for sharp screens
  const SNAP_GAP = 4000;       // a window is copied at most this often (ms)
  const SNAP_MAX_NODES = 5000; // bigger pages keep the icon
  const snapQ = [];
  let snapBusy = false;
  const idle = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 2000 }) : (f) => setTimeout(f, 200);
  function appPreview(w) {
    try {
      const fn = w.iframe.contentWindow.LiteOS && w.iframe.contentWindow.LiteOS.win._preview;
      const src = fn ? [].concat(fn() || []).filter(Boolean) : [];
      if (!src.length) return null;
      const sw = src[0].videoWidth || src[0].naturalWidth || src[0].width;
      const sh = src[0].videoHeight || src[0].naturalHeight || src[0].height;
      if (!sw || !sh) return null;
      const c = document.createElement('canvas');
      c.width = SNAP_W; c.height = Math.round(SNAP_W * sh / sw);
      const x = c.getContext('2d');
      src.forEach((s) => x.drawImage(s, 0, 0, c.width, c.height));
      return c;
    } catch (e) { return null; }
  }
  /** Whether a window's page can be copied: our own page, loaded, with no frames of other sites, not too large. */
  function snappable(w) {
    if (w.covered || w.asleep) return null; // still opening, or not started yet
    try {
      const doc = w.iframe.contentDocument;
      if (!doc || !doc.body || doc.querySelector('iframe, frame, embed, object')) return null;
      if (doc.getElementsByTagName('*').length > SNAP_MAX_NODES) return null;
      return doc;
    } catch (e) { return null; } // another origin
  }
  function snapLater(w) {
    if (!w || w.snapNo || Date.now() - Math.max(w.snapAt || 0, w.snapTry || 0) < SNAP_GAP || snapQ.includes(w)) return;
    snapQ.push(w);
    pumpSnaps();
  }
  function pumpSnaps() {
    if (snapBusy || !snapQ.length) return;
    snapBusy = true;
    idle(async () => {
      const w = snapQ.shift();
      try { if (wins.has(w.id) && !w.min) await snapshot(w); } finally { snapBusy = false; pumpSnaps(); }
    });
  }
  async function snapshot(w) {
    w.snapTry = Date.now();
    const doc = snappable(w);
    if (!doc) return;
    const t0 = performance.now();
    try {
      const canvas = await drawPage(doc);
      if (!canvas) return;
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
      if (!blob || !wins.has(w.id)) return;
      if (w.snapUrl) URL.revokeObjectURL(w.snapUrl);
      w.snapUrl = URL.createObjectURL(blob);
      w.snapAt = Date.now();
      w.snapMs = Math.round(performance.now() - t0);
      w.snapKb = Math.round(blob.size / 1024);
      // what each copy costs, for the browser's performance tools
      try { performance.measure('liteos:window-snapshot', { start: t0, detail: { app: w.app.id, kb: w.snapKb } }); } catch (e) { /* older browsers */ }
      if (PV.el && PV.app === w.app.id) previewShow(w.app.id); // the cards are open: show it
    } catch (e) { w.snapNo = true; } // this page can't be copied: its card keeps the icon
  }
  // A page drawn as a picture: its HTML and its own stylesheets go into an SVG image, which the browser lays out and
  // paints by itself. Nothing is worked out element by element; pictures the page shows are read once and kept for
  // the next time (an SVG image can't fetch anything), and canvases are copied small.
  const snapImgs = new Map(); // address -> data: URL
  const snapCss = new WeakMap(); // page -> its styles as text
  function pageCss(doc) {
    const n = doc.styleSheets.length;
    const known = snapCss.get(doc);
    if (known && known.n === n) return known.text;
    const out = [];
    const walk = (sheet) => {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { return; } // another site's stylesheet
      for (const r of rules) { if (r.styleSheet) walk(r.styleSheet); else out.push(r.cssText); }
    };
    [...doc.styleSheets].forEach(walk);
    // inside the image the page isn't the root, so :root rules (the theme's colours) go to its <html>; a frozen
    // picture shows things where they end up, not where an animation starts
    const text = out.join('\n').replace(/:root\b/g, 'html') +
      '\n*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';
    snapCss.set(doc, { n, text });
    return text;
  }
  async function inlineImg(src) {
    if (!src || src.startsWith('data:')) return src;
    if (snapImgs.has(src)) return snapImgs.get(src);
    let url = '';
    try {
      const blob = await (await fetch(src, { credentials: 'same-origin' })).blob();
      if (blob.size < 512 * 1024) url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(''); fr.readAsDataURL(blob); });
    } catch (e) { /* not ours, or gone */ }
    if (snapImgs.size > 400) snapImgs.clear();
    snapImgs.set(src, url);
    return url;
  }
  async function drawPage(doc) {
    const de = doc.documentElement;
    const width = de.clientWidth;
    const height = de.clientHeight;
    if (!width || !height) return null;
    const clone = de.cloneNode(true);
    clone.querySelectorAll('script, style, link, iframe, video, audio, noscript').forEach((n) => n.remove());
    // what the clone doesn't carry over: typed values, ticks, and canvas pictures
    const live = doc.querySelectorAll('input, textarea, select, canvas');
    const copy = clone.querySelectorAll('input, textarea, select, canvas');
    live.forEach((el, i) => {
      const c = copy[i];
      if (!c || c.tagName !== el.tagName) return;
      if (el.tagName === 'CANVAS') {
        const img = doc.createElement('img');
        img.setAttribute('style', c.getAttribute('style') || '');
        img.className = c.className;
        if (el.width && el.height) {
          const k = Math.min(1, 600 / el.width);
          const t = document.createElement('canvas');
          t.width = Math.max(1, Math.round(el.width * k)); t.height = Math.max(1, Math.round(el.height * k));
          try { t.getContext('2d').drawImage(el, 0, 0, t.width, t.height); img.src = t.toDataURL(); } catch (e) { /* tainted */ }
        }
        img.width = el.clientWidth; img.height = el.clientHeight;
        c.replaceWith(img);
      } else if (el.tagName === 'TEXTAREA') c.textContent = el.value;
      else if (el.tagName === 'SELECT') { if (c.options[el.selectedIndex]) c.options[el.selectedIndex].setAttribute('selected', ''); }
      else if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
      else c.setAttribute('value', el.value);
    });
    await Promise.all([...clone.querySelectorAll('img')].map(async (im) => {
      const src = im.getAttribute('src');
      if (!src || src.startsWith('data:')) return;
      const url = await inlineImg(new URL(src, doc.baseURI).href);
      if (url) im.setAttribute('src', url); else im.removeAttribute('src');
      im.removeAttribute('srcset');
      im.removeAttribute('loading');
    }));
    const head = clone.querySelector('head') || clone.insertBefore(doc.createElement('head'), clone.firstChild);
    const st = doc.createElement('style');
    st.textContent = pageCss(doc);
    head.appendChild(st);
    clone.style.width = width + 'px';
    clone.style.height = height + 'px';
    const xml = new XMLSerializer().serializeToString(clone);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><foreignObject x="0" y="0" width="100%" height="100%">' + xml + '</foreignObject></svg>';
    {
      // a data: address, not a blob: one: Chrome won't let a canvas be read after drawing a blob: SVG with HTML in it
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const c = document.createElement('canvas');
      c.width = SNAP_W;
      c.height = Math.round(SNAP_W * height / width);
      const x = c.getContext('2d');
      x.fillStyle = getComputedStyle(doc.body).backgroundColor || '#fff';
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      return c;
    }
  }
  function dropSnap(w) { if (w.snapUrl) URL.revokeObjectURL(w.snapUrl); w.snapUrl = null; }
  const pvList = (appId) => [...wins.values()].filter((w) => w.app.id === appId);
  function previewShow(appId) {
    clearTimeout(PV.showT);
    const btn = $('#bars [data-app="' + appId + '"]', root);
    const list = pvList(appId);
    if (!btn || !list.length || UI.pop || SW.open || root.classList.contains('dragging')) { previewHide(); return; }
    if (!PV.el) {
      PV.el = document.createElement('div');
      PV.el.className = 'win-previews glass';
      PV.el.setAttribute('role', 'listbox');
      PV.el.setAttribute('aria-label', 'Open windows');
      PV.el.addEventListener('mouseenter', () => clearTimeout(PV.hideT));
      PV.el.addEventListener('mouseleave', previewLeave);
      PV.el.addEventListener('mouseover', (e) => { const c = e.target.closest('[data-pv]'); peekWin(c ? wins.get(c.dataset.pv) : null); });
      PV.el.addEventListener('mousedown', (e) => e.preventDefault());
      PV.el.addEventListener('click', (e) => {
        const x = e.target.closest('[data-pvx]');
        const c = e.target.closest('[data-pv]');
        if (x) { previewClose(wins.get(x.dataset.pvx)); return; }
        const w = c && wins.get(c.dataset.pv);
        previewHide();
        if (w) { if (w.min) restore(w); else focus(w); }
      });
      // a middle click closes the window, as on the Windows taskbar
      PV.el.addEventListener('auxclick', (e) => { const c = e.button === 1 && e.target.closest('[data-pv]'); if (c) previewClose(wins.get(c.dataset.pv)); });
      root.appendChild(PV.el);
    }
    PV.app = appId;
    root.classList.add('pv-showing');
    PV.el.innerHTML = list.map((w) => {
      const r = w.el.getBoundingClientRect();
      const ratio = w.min || !r.width ? 1.6 : Math.max(1, Math.min(2.2, r.width / r.height)); // the card has the window's shape
      return '<div class="pv-card' + (w.id === focusedId && !w.min ? ' on' : '') + '" data-pv="' + w.id + '" role="option" aria-label="' + esc(w.title || w.app.name) + '">' +
        '<div class="pv-head"><img src="' + w.app.img + '" alt="" draggable="false"><span>' + esc(w.title || w.app.name) + '</span>' +
        '<button class="pv-x" data-pvx="' + w.id + '" aria-label="Close window" title="Close">' + ICON('window.close', 11) + '</button></div>' +
        '<div class="pv-body' + (w.snapUrl ? ' pic' : '') + '" data-pvb="' + w.id + '" style="aspect-ratio:' + ratio.toFixed(2) + '">' +
        (w.snapUrl ? '<img class="shot" src="' + w.snapUrl + '" alt="" draggable="false">' : '<img src="' + w.app.img + '" alt="" draggable="false">') +
        (w.min ? '<small>Minimised</small>' : w.dirty ? '<small>Unsaved changes</small>' : '') + '</div></div>';
    }).join('');
    list.forEach((w) => {
      const c = appPreview(w);
      const body = c && $('[data-pvb="' + w.id + '"]', PV.el);
      if (body) { body.classList.add('pic'); c.className = 'shot'; const old = $('img', body); if (old) old.replaceWith(c); else body.prepend(c); }
      // a window never copied yet (the one in use) gets its first snapshot now, in idle time
      else if (!c && !w.snapUrl && !w.min) snapLater(w);
    });
    // above the button, kept on screen
    const b = btn.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const pw = PV.el.offsetWidth;
    PV.el.style.left = Math.max(8, Math.min(rr.width - pw - 8, b.left - rr.left + b.width / 2 - pw / 2)) + 'px';
    PV.el.style.bottom = (rr.bottom - b.top + 8) + 'px';
  }
  function previewLeave() { clearTimeout(PV.showT); clearTimeout(PV.hideT); PV.hideT = setTimeout(previewHide, 300); }
  function previewHide() {
    clearTimeout(PV.showT); clearTimeout(PV.hideT);
    peekWin(null);
    root.classList.remove('pv-showing');
    if (PV.el) { PV.el.remove(); PV.el = null; }
    PV.app = null;
  }
  async function previewClose(w) {
    if (!w) return;
    const appId = w.app.id;
    peekWin(null);
    if (w.dirty) previewHide(); // its question comes up over the window
    const closed = await closeWin(w);
    if (closed && PV.el && PV.app === appId) { if (pvList(appId).length) previewShow(appId); else previewHide(); }
  }
  function peekWin(w) {
    if (PV.peek === w) return;
    if (PV.peek) PV.peek.el.classList.remove('peeked');
    PV.peek = w && wins.has(w.id) ? w : null;
    root.classList.toggle('win-peek', !!PV.peek);
    if (PV.peek) PV.peek.el.classList.add('peeked');
  }
  root.addEventListener('mouseover', (e) => {
    const b = e.target.closest && e.target.closest('#bars [data-app]');
    if (!b) return;
    clearTimeout(PV.hideT);
    if (PV.el && PV.app === b.dataset.app) return;
    clearTimeout(PV.showT);
    // a short rest before the first cards; moving along the bar while they show switches straight away
    PV.showT = setTimeout(() => previewShow(b.dataset.app), PV.el ? 0 : 450);
  });
  root.addEventListener('mouseout', (e) => {
    const b = e.target.closest && e.target.closest('#bars [data-app]');
    if (!b || (e.relatedTarget && b.contains(e.relatedTarget))) return;
    clearTimeout(PV.showT);
    if (PV.el) previewLeave();
  });
  // pressing the button itself (open, cycle, its menu) puts the cards away
  root.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('#bars [data-app]')) previewHide(); }, true);

  // Jump list for a dock / taskbar app: quick places, recent items, tasks, then window controls.
  let recentCache = { at: 0, list: [] };
  async function recentFiles() {
    if (Date.now() - recentCache.at < 8000) return recentCache.list;
    try { recentCache = { at: Date.now(), list: await api('fs.recent') }; } catch (e) { /* offline: keep old */ }
    return recentCache.list;
  }

  // the drive's folders, with their icons from the system icon set
  const PLACE_ITEMS = [['Home', '/', 'place.home'], ['Desktop', '/Desktop', 'place.desktop'], ['Documents', '/Documents', 'place.documents'],
    ['Downloads', '/Downloads', 'place.downloads'], ['Pictures', '/Pictures', 'place.pictures'], ['Music', '/Music', 'place.music'], ['Videos', '/Videos', 'place.videos']];

  function fileItem(entry, appId, args) {
    return { label: entry.name, img: window.LOS_sysIcon(window.LOS_fileRole(entry)), title: entry.path, action: () => openApp(appId, args || { path: entry.path }) };
  }

  async function appMenu(appId, anchor) {
    const app = window.LOS_app(appId);
    if (!app) return;
    const list = [...wins.values()].filter((w) => w.app.id === appId);
    const pinned = (set().pinned || []).includes(appId);
    const recent = await recentFiles();
    const mine = recent.filter((f) => { const a2 = window.LOS_appForFile(f.name); return a2 && a2.id === appId; }).slice(0, 6);
    const items = [];
    const section = (title, rows) => { if (rows.length) { items.push({ header: title }); rows.forEach((r) => items.push(r)); } };

    if (appId === 'files') {
      section('Pinned', PLACE_ITEMS.map(([n, path, role]) => ({ label: n, img: window.LOS_sysIcon(role), action: () => openApp('files', { path }) }))
        .concat([{ label: 'Trash', icon: 'trash', color: '#8C929C', action: () => openApp('files', { path: 'trash:' }) }]));
      const folders = [...new Set(recent.map((f) => parent(f.path)))].filter((d) => !PLACE_ITEMS.some((p) => p[1] === d)).slice(0, 6);
      section('Frequent', folders.map((d) => ({ label: baseName(d), icon: 'folder', color: '#DC8B16', title: d, action: () => openApp('files', { path: d }) })));
    } else if (appId === 'settings') {
      section('Settings', [['personalisation', 'Personalisation', 'palette'], ['taskbar', 'Taskbar', 'taskbar'], ['storage', 'Storage', 'storage'], ['account', 'Accounts', 'user']]
        .concat(S.user && S.user.role === 'admin' ? [['system', 'System', 'server']] : [])
        .map(([id, n, ic]) => ({ label: n, icon: ic, action: () => openApp('settings', { section: id }) })));
    } else if (appId === 'notes') {
      const notes = recent.filter((f) => f.path.startsWith('/Notes/')).slice(0, 6);
      section('Recent notes', notes.map((f) => ({ label: f.name.replace(/\.(md|txt)$/i, ''), icon: 'note', color: '#C98F05', title: f.path, action: () => openApp('notes', { path: f.path }) })));
    } else if (appId === 'media') {
      section('Library', [['Pictures', '/Pictures', 'image', '#C9306B'], ['Music', '/Music', 'music', '#DD630A'], ['Videos', '/Videos', 'video', '#6B4CCB']]
        .map(([n, path, ic, col]) => ({ label: n, icon: ic, color: col, action: () => openApp('files', { path }) })));
      section('Recent', mine.map((f) => fileItem(f, 'media')));
    } else {
      section('Recent', mine.map((f) => fileItem(f, appId)));
    }

    const TASKS = {
      documents: [['New document', 'plus', () => openApp('documents')]],
      sheets: [['New spreadsheet', 'plus', () => openApp('sheets')]],
      slides: [['New presentation', 'plus', () => openApp('slides')]],
      board: [['New whiteboard', 'plus', () => openApp('board')]],
      notes: [['New note', 'plus', () => openApp('notes', { new: '1' })]],
      code: [['New file', 'plus', () => openApp('code')], ['Open folder…', 'open', async () => { const d = await fileDialog('folder', { title: 'Open folder' }); if (d) openApp('code', { folder: d }); }]],
      browser: [['New tab', 'plus', () => openApp('browser')]],
    };
    if (TASKS[appId]) section('Tasks', TASKS[appId].map(([n, ic, fn]) => ({ label: n, icon: ic, action: fn })));
    if (items.length && !mine.length && !['files', 'settings', 'media', 'notes'].includes(appId) && app.exts.length) {
      items.push({ note: 'Files you open in ' + app.name + ' will show up here.' });
    }

    if (items.length) items.push('sep');
    items.push({ label: app.name, img: app.img, disabled: !!(app.single && list.length), title: app.single ? '' : 'Open a new window', action: () => openApp(appId) });
    items.push({ label: pinned ? 'Unpin from taskbar' : 'Pin to taskbar', icon: pinned ? 'unpin' : 'pin', action: () => {
      const p = (set().pinned || []).slice();
      saveSettings({ pinned: pinned ? p.filter((x) => x !== appId) : p.concat(appId) });
    } });
    if (list.length) items.push({ label: list.length > 1 ? 'Close all windows' : 'Close window', icon: 'x', action: () => list.forEach((w) => closeWin(w)) });

    const r = anchor.getBoundingClientRect();
    const floating = set().taskbar !== 'classic';
    showMenu(items, { x: floating ? r.left + r.width / 2 - 130 : r.left, y: r.top - 8, above: true }, null, 'jump');
  }


  // ================================================================== menus, toasts, dialogs
  // the menus themselves (submenus, keyboard, the current-choice dot) live in menu.js, shared with the apps
  function showMenu(items, at, onClose, cls) {
    window.LOS_menu.open(items, at, { onClose, cls, parent: root, onError: (e) => notify(e.message, { type: 'error', title: 'Action failed' }) });
  }
  function hideMenu() { window.LOS_menu.close(); }

  // Short notification chime (Web Audio; no sound files needed).
  let audioCtx = null;
  function chime(type) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const vol = (set().muted ? 0 : (set().volume == null ? 80 : set().volume)) / 100 * 0.25;
      if (!vol) return;
      const notes = type === 'error' ? [440, 330] : [660, 880];
      notes.forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        const t = audioCtx.currentTime + i * 0.12;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.32);
      });
    } catch (e) { /* audio unavailable */ }
  }

  /**
   * Notification toast: header (app icon + name + close), optional image on the left,
   * optional bold title and the message. opts: { type, title, image, imageShape: 'round', win, app,
   * actions: [{ label, action }] } (buttons along the bottom, like a native toast's; each closes it)
   */
  function notify(message, opts) {
    opts = opts || {};
    const type = opts.type || 'info';
    if (S.settings && S.settings.dnd && type !== 'error') return;
    const box = $('.toasts', root) || (() => { const t = document.createElement('div'); t.className = 'toasts'; root.appendChild(t); return t; })();
    const w = opts.win ? wins.get(opts.win) : null;
    const app = w ? w.app : (opts.app ? window.LOS_app(opts.app) : null);
    const srcName = app ? app.name : (S.system.instanceName || 'LiteOS');
    const srcIcon = app ? app.img : 'assets/img/kite-blue.svg';
    let img = opts.image ? String(opts.image) : '';
    if (img.startsWith('/')) img = rawUrl(img); // a path on the user's drive
    if (img && !/^(https?:|data:image\/|blob:|assets\/)/i.test(img)) img = '';
    // Every notification has a title and a description, like a native toast. No status icons.
    const title = opts.title || ({ success: 'Done', error: 'Something went wrong' })[type] || 'Notification';
    message = message == null ? '' : String(message);
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = '<div class="nt-head"><img src="' + esc(srcIcon) + '" alt=""><span>' + esc(srcName) + '</span>' +
      '<button class="nt-x nt-more" aria-label="More options" title="More options">' + ICON('more', 14) + '</button>' +
      '<button class="nt-x nt-close" aria-label="Dismiss" title="Dismiss">' + ICON('window.close', 13) + '</button></div>' +
      '<div class="nt-body">' + (img ? '<img class="nt-img' + (opts.imageShape === 'round' ? ' round' : '') + '" src="' + esc(img) + '" alt="">' : '') +
      '<div class="nt-text"><b>' + esc(title) + '</b>' + (message ? '<p>' + esc(message) + '</p>' : '') + '</div></div>';
    const actions = Array.isArray(opts.actions) ? opts.actions.filter((a) => a && a.label).slice(0, 3) : [];
    if (actions.length) {
      const row = document.createElement('div');
      row.className = 'nt-actions';
      actions.forEach((a) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn';
        b.textContent = a.label;
        b.addEventListener('click', () => { close(); if (typeof a.action === 'function') { try { a.action(); } catch (err) { console.error(err); } } });
        row.appendChild(b);
      });
      el.appendChild(row);
    }
    const imgEl = el.querySelector('.nt-img');
    if (imgEl) imgEl.addEventListener('error', () => imgEl.remove()); // broken image: hide the image area
    box.appendChild(el);
    let timer = null;
    const close = () => { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    const secs = Math.max(5, +(set().notifyTimeout || 5));
    const arm = () => { timer = setTimeout(close, (type === 'error' || actions.length ? Math.max(10, secs) : secs) * 1000); }; // time to reach a button
    if (set().notifySound) chime(type);
    if (set().flashOnNotify) { const f = document.createElement('div'); f.className = 'a11y-flash'; document.body.appendChild(f); setTimeout(() => f.remove(), 600); }
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', arm);
    el.querySelector('.nt-close').addEventListener('click', close);
    el.querySelector('.nt-more').addEventListener('click', (e) => {
      e.stopPropagation();
      clearTimeout(timer);
      const r = e.currentTarget.getBoundingClientRect();
      showMenu([
        { label: 'Turn on Do not disturb', icon: 'bell', action: () => { saveSettings({ dnd: true }); close(); } },
        { label: 'Notification settings', icon: 'settings', action: () => { openApp('settings', { section: 'notifications' }); close(); } },
      ], { x: r.left - 180, y: r.bottom + 4 }, arm);
    });
    arm();
    const all = box.querySelectorAll('.toast:not(.out)');
    if (all.length > 4) all[0].remove();
  }


  /**
   * System dialog (see docs/ui-dialogs.md). A native <dialog> opened with showModal(): the browser traps focus and
   * makes the rest of the shell inert. Escape cancels (resolves null), focus returns to where it was afterwards.
   * `build(box, done)` fills it with .dlg-title / .dlg-body / .dlg-actions.
   */
  function modal(build, cls) {
    return new Promise((resolve) => {
      const box = document.createElement('dialog');
      box.className = 'dlg ' + (cls || '');
      root.appendChild(box);
      const prevFocus = document.activeElement;
      let closed = false;
      const done = (v) => {
        if (closed) return;
        closed = true;
        try { box.close(); } catch (e) { /* ignore */ }
        box.remove();
        if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        resolve(v);
      };
      // Escape reaches only the topmost dialog (it holds focus), so a confirm over the file picker closes just the confirm.
      box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } });
      box.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
      build(box, done);
      const title = $('.dlg-title', box);
      if (title) { title.id = 'dlg-t-' + Math.random().toString(36).slice(2, 8); box.setAttribute('aria-labelledby', title.id); }
      const body = $('.dlg-body', box);
      if (body && body.textContent.trim() && !cls) { body.id = 'dlg-b-' + Math.random().toString(36).slice(2, 8); box.setAttribute('aria-describedby', body.id); }
      const want = $('[autofocus]', box) || $('.is-default', box);
      box.showModal();
      if (want) want.focus({ preventScroll: true });
    });
  }

  /** Buttons for a dialog's action row: secondary ones first, the default (main) one last. */
  function dlgButtons(list) {
    return '<div class="dlg-actions">' + list.map((b) => '<button class="btn' + (b.cls ? ' ' + b.cls : '') + '"' +
      (b.type ? ' type="' + b.type + '"' : ' type="button"') + (b.v != null ? ' data-v="' + b.v + '"' : '') + (b.focus ? ' autofocus' : '') + '>' + esc(b.label) + '</button>').join('') + '</div>';
  }

  /**
   * Confirm. With `danger: true` the action is destructive: its button shows danger text and Cancel becomes the
   * default, so Enter never destroys anything by accident.
   */
  function confirmDialog(o) {
    return modal((box, done) => {
      const danger = !!o.danger;
      box.innerHTML = '<h2 class="dlg-title">' + esc(o.title || 'Are you sure?') + '</h2>' +
        (o.message ? '<p class="dlg-body">' + esc(o.message) + '</p>' : '') +
        dlgButtons(danger
          ? [{ label: o.okLabel || 'OK', v: 1, cls: 'btn-danger-text' }, { label: o.cancelLabel || 'Cancel', v: 0, cls: 'is-default', focus: true }]
          : [{ label: o.cancelLabel || 'Cancel', v: 0 }, { label: o.okLabel || 'OK', v: 1, cls: 'is-default', focus: true }]);
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); });
    }).then((v) => v === true);
  }

  function promptDialog(o) {
    return modal((box, done) => {
      box.innerHTML = '<form method="dialog"><h2 class="dlg-title">' + esc(o.title || 'Enter a value') + '</h2><div class="dlg-body">' +
        '<label class="field">' + (o.label ? '<span>' + esc(o.label) + '</span>' : '') + '<input class="input" autofocus type="' + esc(o.type || 'text') + '" value="' + esc(o.value || '') + '"></label></div>' +
        dlgButtons([{ label: 'Cancel', v: 0 }, { label: o.okLabel || 'OK', type: 'submit', cls: 'is-default' }]) + '</form>';
      const input = $('input', box);
      $('form', box).addEventListener('submit', (e) => { e.preventDefault(); done(input.value); });
      $('[data-v="0"]', box).addEventListener('click', () => done(null));
      setTimeout(() => {
        const dot = input.value.lastIndexOf('.');
        try { input.setSelectionRange(0, o.selectStem && dot > 0 ? dot : input.value.length); } catch (e) { /* number inputs */ }
      });
    });
  }

  function alertDialog(o) {
    return modal((box, done) => {
      box.innerHTML = '<h2 class="dlg-title">' + esc(o.title || 'LiteOS') + '</h2><p class="dlg-body">' + esc(o.message || '') + '</p>' +
        dlgButtons([{ label: o.okLabel || 'OK', cls: 'is-default', focus: true }]);
      $('button', box).addEventListener('click', () => done(true));
    });
  }

  const PLACES = PLACE_ITEMS;

  /** Short date and time for the picker's Date modified column. */
  const fmtWhen = (ts) => {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    return d.toLocaleDateString([], { year: 'numeric', month: 'numeric', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  /** The Type column: "File folder", or the app that opens it ("Sheets file"), or the extension ("PNG file"). */
  const typeName = (e) => {
    if (e.type === 'dir') return 'File folder';
    const app = window.LOS_appForFile(e.name);
    const ext = (e.ext || String(e.name).split('.').pop() || '').toLowerCase();
    return app ? app.name + ' file' : (ext ? ext.toUpperCase() + ' file' : 'File');
  };

  /**
   * File picker, laid out like the Windows Open / Save As window: a title bar (the calling app's icon, the title, ×),
   * back / forward / up, the address with its crumbs, refresh and search, a "New folder" command, the places and a
   * details list, then "File name" and the file type, with the main button and Cancel.
   * mode: 'open' | 'save' | 'folder'. Resolves to a path or null.
   */
  function fileDialog(mode, o, winId) {
    o = o || {};
    const accept = (o.accept || []).map((x) => String(x).toLowerCase().replace(/^\./, ''));
    const wantExt = o.ext ? String(o.ext).replace(/^\./, '') : '';
    const caller = winId && wins.get(winId) ? wins.get(winId).app : null;
    const title = o.title || (mode === 'save' ? 'Save as' : mode === 'folder' ? 'Select folder' : 'Open');
    const okLabel = mode === 'save' ? 'Save' : mode === 'folder' ? 'Select folder' : 'Open';
    // what the type box says: the one extension a save writes, or the kinds an open accepts
    const exts = mode === 'save' ? (wantExt ? [wantExt] : []) : accept;
    const typeLabel = !exts.length ? 'All files (*.*)'
      : (exts.length === 1 ? typeName({ type: 'file', name: 'x.' + exts[0] }) : 'Supported files') + ' (' + exts.map((x) => '*.' + x).join(';') + ')';
    return modal((box, done) => {
      let cwd = o.startIn || (o.defaultName && o.defaultName.startsWith('/') ? parent(o.defaultName) : '/Documents');
      let entries = [];
      let sel = null;
      let query = '';
      const back = [];
      const fwd = [];
      const nameValue = mode === 'save' ? (o.defaultName ? baseName(o.defaultName) : 'Untitled' + (wantExt ? '.' + wantExt : '')) : '';
      box.innerHTML =
        '<div class="fdlg-head">' + (caller ? '<img src="' + esc(caller.img) + '" alt="" width="16" height="16">' : ICON('folder', 16)) +
          '<h2 class="dlg-title">' + esc(title) + '</h2>' +
          '<button class="ibtn fdlg-close" type="button" data-b="cancel" aria-label="Close">' + ICON('window.close', 14) + '</button></div>' +
        '<div class="fdlg-nav">' +
          '<button class="ibtn" type="button" data-b="back" aria-label="Back" title="Back">' + ICON('action.back', 16) + '</button>' +
          '<button class="ibtn" type="button" data-b="fwd" aria-label="Forward" title="Forward">' + ICON('action.forward', 16) + '</button>' +
          '<button class="ibtn" type="button" data-b="up" aria-label="Up one level" title="Up one level">' + ICON('action.up', 16) + '</button>' +
          '<div class="fdlg-addr">' + ICON('folder', 16) + '<div class="crumbs"></div>' +
            '<button class="ibtn" type="button" data-b="refresh" aria-label="Refresh" title="Refresh">' + ICON('reload', 14) + '</button></div>' +
          '<label class="fdlg-search"><input type="search" aria-label="Search this folder" spellcheck="false">' + ICON('search', 14) + '</label>' +
        '</div>' +
        '<div class="fdlg-cmd"><button class="btn btn-ghost" type="button" data-b="mkdir">New folder</button></div>' +
        '<div class="dlg-body"><nav class="side" aria-label="Places">' + PLACES.map((p) => '<button type="button" data-place="' + p[1] + '">' + ICON(p[2], 16) + p[0] + '</button>').join('') + '</nav>' +
          '<div class="main"><div class="fdlg-cols" aria-hidden="true"><span>Name</span><span>Date modified</span><span>Type</span><span>Size</span></div>' +
          '<div class="list" role="listbox" aria-label="Files"></div></div></div>' +
        '<div class="fdlg-foot">' +
          '<label class="fdlg-row"><span>' + (mode === 'folder' ? 'Folder:' : 'File name:') + '</span>' +
            '<input class="input fdlg-name" spellcheck="false" autocomplete="off" value="' + esc(nameValue) + '"' + (mode === 'folder' ? ' readonly' : '') + '></label>' +
          (mode === 'folder' ? '' : '<label class="fdlg-row"><span>' + (mode === 'save' ? 'Save as type:' : 'Files of type:') + '</span>' +
            '<select class="input fdlg-type"><option>' + esc(typeLabel) + '</option></select></label>') +
          '<div class="fdlg-btns"><button class="btn is-default" type="button" data-b="ok">' + okLabel + '</button>' +
            '<button class="btn" type="button" data-b="cancel">Cancel</button></div>' +
        '</div>';
      const list = $('.list', box);
      const nameInput = $('.fdlg-name', box);
      const search = $('.fdlg-search input', box);
      const accepts = (e) => e.type === 'dir' || !accept.length || accept.includes((e.ext || '').toLowerCase());
      const folderName = (p) => (p === '/' ? 'My drive' : baseName(p));

      // a folder that takes a moment to open: the pointer says it's working and a bar runs along the address bar
      let loadSeq = 0;
      let busyTimer = 0;
      async function load(path, how) {
        const seq = ++loadSeq;
        clearTimeout(busyTimer);
        busyTimer = setTimeout(() => box.classList.add('loading'), 150);
        const idle = () => { if (seq === loadSeq) { clearTimeout(busyTimer); box.classList.remove('loading'); } };
        try {
          const r = await api('fs.list', undefined, { path });
          idle();
          if (seq !== loadSeq) return; // another folder was asked for meanwhile
          if (how === 'push' && path !== cwd) { back.push(cwd); fwd.length = 0; }
          cwd = path; entries = (r || []).filter((e) => !e.name.startsWith('.')); sel = null;
          query = ''; search.value = '';
          if (mode === 'folder') nameInput.value = folderName(cwd);
          draw();
        } catch (e) {
          idle();
          if (seq !== loadSeq) return;
          if (path !== '/') load('/', how); else list.innerHTML = '<div class="fdlg-empty">' + esc(e.message) + '</div>';
        }
      }
      function draw() {
        const parts = cwd.split('/').filter(Boolean);
        $('.crumbs', box).innerHTML = '<button type="button" data-crumb="/">My drive</button>' +
          parts.map((p, i) => '<span class="sepc">›</span><button type="button" data-crumb="/' + esc(parts.slice(0, i + 1).join('/')) + '">' + esc(p) + '</button>').join('');
        search.placeholder = 'Search ' + folderName(cwd);
        $$('.side button', box).forEach((b) => b.classList.toggle('on', b.dataset.place === cwd));
        $('[data-b=back]', box).disabled = !back.length;
        $('[data-b=fwd]', box).disabled = !fwd.length;
        $('[data-b=up]', box).disabled = cwd === '/';
        const q = query.trim().toLowerCase();
        const shown = entries
          .filter((e) => mode !== 'folder' || e.type === 'dir')
          .filter((e) => !q || e.name.toLowerCase().includes(q))
          .sort((a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true }));
        list.innerHTML = shown.length ? shown.map((e) => '<button type="button" role="option" class="item' + (sel === e ? ' sel' : '') + (accepts(e) ? '' : ' dim') + '"' +
            ' aria-selected="' + (sel === e) + '" data-i="' + entries.indexOf(e) + '">' +
            '<span class="nm">' + fileTile(e, 20, 5) + '<span>' + esc(e.name) + '</span></span>' +
            '<span class="c">' + esc(fmtWhen(e.mtime)) + '</span><span class="c">' + esc(typeName(e)) + '</span>' +
            '<span class="c sz">' + (e.type === 'dir' ? '' : esc(fmtSize(e.size))) + '</span></button>').join('')
          : '<div class="fdlg-empty">' + (q ? 'No items match your search.' : 'This folder is empty.') + '</div>';
      }
      function choose(en) {
        sel = en;
        if (mode === 'folder') nameInput.value = en.type === 'dir' ? en.name : folderName(cwd);
        else if (en.type === 'file') nameInput.value = en.name;
        draw();
      }
      async function ok() {
        if (mode === 'folder') return done(sel && sel.type === 'dir' ? sel.path : cwd);
        let name = nameInput.value.trim();
        if (mode === 'open') {
          if (sel && sel.type === 'dir' && (!name || name === sel.name)) return load(sel.path, 'push');
          if (!name) { nameInput.focus({ preventScroll: true }); return; }
          const hit = entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
          if (hit && hit.type === 'dir') return load(hit.path, 'push');
          if (hit && accepts(hit)) return done(hit.path);
          notify('“' + name + '” isn’t in this folder' + (hit ? ', or can’t be opened here' : '') + '.', { type: 'error', title: 'Can’t open file' });
          return;
        }
        if (!name) { nameInput.focus({ preventScroll: true }); return; }
        if (/[\\/<>:"|?*]/.test(name)) { notify('File names can’t contain \\ / < > : " | ? *', { type: 'error', title: 'Invalid file name' }); return; }
        if (wantExt && !name.toLowerCase().endsWith('.' + wantExt.toLowerCase())) name += '.' + wantExt;
        const existing = entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
        if (existing && existing.type === 'dir') { load(existing.path, 'push'); return; }
        if (existing) {
          const yes = await confirmDialog({ title: 'Confirm Save As', message: '“' + name + '” already exists. Do you want to replace it?', okLabel: 'Replace', danger: true });
          if (!yes) return;
        }
        done(join(cwd, name));
      }
      box.addEventListener('click', async (e) => {
        const t = e.target.closest('button');
        if (!t || t.disabled) return;
        if (t.dataset.place) load(t.dataset.place, 'push');
        else if (t.dataset.crumb) load(t.dataset.crumb, 'push');
        else if (t.dataset.i != null) { const en = entries[+t.dataset.i]; if (accepts(en)) choose(en); }
        else if (t.dataset.b === 'back') { if (back.length) { fwd.push(cwd); load(back.pop()); } }
        else if (t.dataset.b === 'fwd') { if (fwd.length) { back.push(cwd); load(fwd.pop()); } }
        else if (t.dataset.b === 'up') load(parent(cwd), 'push');
        else if (t.dataset.b === 'refresh') load(cwd);
        else if (t.dataset.b === 'mkdir') mkdirHere();
        else if (t.dataset.b === 'cancel') done(null);
        else if (t.dataset.b === 'ok') ok();
      });
      // New folder, as in Explorer: made at once as "New folder" ("New folder (2)"…) with its name open for typing over
      async function mkdirHere() {
        let path = '';
        for (let i = 1; i <= 50 && !path; i++) {
          const name = 'New folder' + (i > 1 ? ' (' + i + ')' : '');
          if (entries.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
          try { await api('fs.mkdir', { path: join(cwd, name) }); path = join(cwd, name); } catch (ex) {
            if (!/exists/i.test(ex.message)) { notify(ex.message, { type: 'error', title: 'Couldn’t create folder' }); return; }
          }
        }
        if (!path) return;
        await load(cwd);
        const en = entries.find((x) => x.path === path);
        const row = en && $('[data-i="' + entries.indexOf(en) + '"]', list);
        if (!row) return;
        choose(en);
        const label = $('.nm > span', $('[data-i="' + entries.indexOf(en) + '"]', list));
        const r = label.getBoundingClientRect();
        const inp = document.createElement('input');
        inp.className = 'input fdlg-rename';
        inp.value = baseName(path);
        inp.spellcheck = false;
        inp.setAttribute('aria-label', 'Folder name');
        // inside the dialog (a modal dialog makes everything outside it unreachable), over the row's name
        const br = box.getBoundingClientRect();
        Object.assign(inp.style, { left: r.left - br.left - 4 + 'px', top: r.top - br.top - 4 + 'px', width: Math.max(160, r.width + 40) + 'px' });
        box.appendChild(inp);
        inp.focus();
        inp.select();
        let fin = false;
        const finish = async (keep) => {
          if (fin) return;
          fin = true;
          const name = inp.value.trim();
          inp.remove();
          if (keep || !name || name === baseName(path)) return;
          try {
            const res = await api('fs.rename', { path, name });
            await load(cwd);
            const hit = entries.find((x) => x.path === ((res && res.path) || join(cwd, name)));
            if (hit) choose(hit);
          } catch (ex) { notify(ex.message, { type: 'error', title: 'Couldn’t rename' }); }
        };
        inp.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); finish(false); }
          if (e.key === 'Escape') { e.preventDefault(); finish(true); }
        });
        inp.addEventListener('blur', () => finish(false));
      }
      list.addEventListener('dblclick', (e) => {
        const t = e.target.closest('[data-i]');
        if (!t) return;
        const en = entries[+t.dataset.i];
        if (en.type === 'dir') load(en.path, 'push');
        else if (accepts(en)) { choose(en); ok(); }
      });
      search.addEventListener('input', () => { query = search.value; sel = null; draw(); });
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
      nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      setTimeout(() => {
        if (mode === 'folder') { $('[data-b=ok]', box).focus({ preventScroll: true }); return; }
        nameInput.focus({ preventScroll: true });
        const d = nameInput.value.lastIndexOf('.');
        nameInput.setSelectionRange(0, d > 0 ? d : nameInput.value.length);
      }, 20);
      load(cwd);
    }, 'fdlg');
  }

  // ================================================================== lock & sign out
  // Locking: the server locks the session (the API refuses until unlocked, a reload lands on the lock page), and the
  // lock page itself is shown in a frame over the open windows, so nothing is closed. It posts 'liteos-unlocked'
  // once the password was right (resources/views/auth/unlocked.blade.php).
  async function lockScreen(alreadyLocked) {
    if (UI.lockShown) return;
    closePops();
    hideMenu();
    let url = window.LOS_BASE + 'lock?embed=1';
    if (alreadyLocked !== true) {
      try { url = (await api('auth.lock', {})).lock; } catch (e) { notify(e.message, { type: 'error', title: 'Couldn’t lock' }); return; }
      if (UI.lockShown) return;
    }
    UI.lockShown = true;
    const el = document.createElement('div');
    el.className = 'lock-frame';
    el.innerHTML = '<iframe title="Locked" src="' + esc(url) + '"></iframe>';
    root.appendChild(el);
    const frame = $('iframe', el);
    frame.addEventListener('load', () => { try { frame.contentWindow.focus(); } catch (e) { /* ignore */ } });
    const onMessage = (e) => {
      if (e.origin !== location.origin || e.source !== frame.contentWindow || !e.data || e.data.type !== 'liteos-unlocked') return;
      window.removeEventListener('message', onMessage);
      el.classList.add('leaving');
      setTimeout(() => { el.remove(); UI.lockShown = false; }, 220);
    };
    window.addEventListener('message', onMessage);
  }

  async function signOut() {
    const dirty = [...wins.values()].filter((w) => w.dirty);
    if (dirty.length) {
      const ok = await confirmDialog({ title: 'Sign out?', message: dirty.length + ' window(s) have unsaved changes. They will be lost.', okLabel: 'Sign out', danger: true });
      if (!ok) return;
    }
    forgetDesk();
    showBoot('Signing out…');
    let next = window.LOS_BASE + 'login';
    try { next = (await api('auth.logout', {})).next || next; } catch (e) { /* ignore */ }
    setTimeout(() => location.assign(next), 600);
  }

  // ================================================================== global events
  root.addEventListener('click', (e) => {
    const t = e.target.closest('.qchev') || e.target.closest('[data-act],[data-app],[data-file],[data-menu]');
    if (!t || !root.contains(t)) return;
    if (t.closest('.dlg') || t.closest('.lock') || t.closest('.desk-icon')) return; // desktop icons open on double-click
    if (t.dataset.app) {
      if (t.closest('.pop')) openApp(t.dataset.app); else appClicked(t.dataset.app);
      return;
    }
    if (t.dataset.file) { closePops(); openFile(t.dataset.file, t.dataset.type === 'dir'); return; }
    if (t.dataset.menu != null) { closePops(); openTopMenu(t); return; }
    switch (t.dataset.act) {
      case 'launcher': togglePop('launcher'); break;
      case 'launcher-search': if (UI.pop !== 'launcher') togglePop('launcher'); break;
      case 'qs': togglePop('qs'); break;
      case 'trash': openApp('files', { path: 'trash:' }); break;
      case 'peek': { const anyVisible = [...wins.values()].some((w) => !w.min); wins.forEach((w) => (anyVisible ? minimize(w) : restore(w))); break; }
      case 'open-settings': openApp('settings'); break;
      case 'lock': lockScreen(); break;
      case 'signout': closePops(); signOut(); break;
      case 'q-theme': saveSettings({ theme: effectiveTheme() === 'dark' ? 'light' : 'dark' }); break;
      case 'q-night': saveSettings({ nightLight: !set().nightLight }); break;
      case 'q-dnd': saveSettings({ dnd: !set().dnd }); break;
      case 'q-mute': saveSettings({ muted: !set().muted }); break;
      case 'q-taskbar': saveSettings({ taskbar: set().taskbar === 'classic' ? 'floating' : 'classic' }); break;
      case 'q-glass': saveSettings({ transparency: set().transparency === false }); break;
      case 'q-a11y': saveSettings({ textSize: set().textSize && set().textSize !== 'default' ? 'default' : 'large' }); break;
      case 'q-a11y-more': closePops(); openApp('settings', { section: 'accessibility' }); break;
      case 'volume': UI.anchor = t.getBoundingClientRect(); togglePop('vol'); break;
      case 'power': powerMenu(t, true); break;
      case 'q-floating': saveSettings({ taskbar: 'floating' }); break;
      case 'q-classic': saveSettings({ taskbar: 'classic' }); break;
      default: break;
    }
  });

  root.addEventListener('mouseover', (e) => {
    const b = e.target.closest && e.target.closest('.topbar .mbtn');
    if (b && UI.topMenu != null && b.dataset.menu !== UI.topMenu) openTopMenu(b);
  });

  root.addEventListener('mousedown', (e) => {
    if (!UI.pop) return;
    if (e.target.closest('.pop') || e.target.closest('[data-act=launcher],[data-act=qs],[data-act=launcher-search],[data-act=volume]')) return;
    closePops();
  });

  root.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, textarea')) return;
    const appBtn = e.target.closest('.dock [data-app], .taskbar [data-app]');
    if (appBtn) { e.preventDefault(); appMenu(appBtn.dataset.app, appBtn); return; }
    const deskIcon = e.target.closest('.desk-icon');
    if (deskIcon) { e.preventDefault(); deskIconMenu(deskIcon, { x: e.clientX, y: e.clientY }); return; }
    if (e.target.classList.contains('wall') || e.target.classList.contains('desk-icons')) {
      e.preventDefault();
      desktopMenu({ x: e.clientX, y: e.clientY });
      return;
    }
    if (!e.target.closest('.win-body')) e.preventDefault();
  });

  // Volume slider: update live without re-rendering (so dragging isn't interrupted), save shortly after.
  root.addEventListener('input', (e) => {
    if (!e.target.classList || !e.target.classList.contains('qrange')) return;
    const v = +e.target.value;
    const k = e.target.dataset.k || 'volume';
    if (k === 'brightness') {
      S.settings = Object.assign({}, set(), { brightness: v });
      e.target.style.setProperty('--v', Math.round((v - 20) / 0.8) + '%');
      $$('.qpct[data-k=brightness]', root).forEach((x) => { x.textContent = v + '%'; });
      applyDim();
      saveBrightness(v);
      return;
    }
    S.settings = Object.assign({}, set(), { volume: v, muted: false });
    $$('.qrange[data-k=volume]', root).forEach((r) => { if (r !== e.target) r.value = v; r.style.setProperty('--v', v + '%'); });
    $$('.qpct[data-k=volume]', root).forEach((x) => { x.textContent = v + '%'; });
    const st = hostState();
    subs.forEach((fn) => { try { fn(st); } catch (x) { subs.delete(fn); } });
    saveVolume(v);
  });
  root.addEventListener('change', (e) => { if (e.target.classList && e.target.classList.contains('qrange')) renderBars(); });

  document.addEventListener('keydown', (e) => {
    if (switcherKey(e)) return;
    if (e.key === 'Escape') { hideMenu(); previewHide(); if (UI.pop) closePops(); }
    if (S.user && !UI.lockShown && e.altKey && e.code === 'Space') { e.preventDefault(); togglePop('launcher'); }
  });

  document.addEventListener('keyup', (e) => { if (e.key === 'Alt') switcherCommit(); });
  window.addEventListener('blur', () => { if (SW.open) switcherClose(); });
  // A click anywhere in a window's page (a web page inside the Browser too, or an app without the SDK) moves focus
  // into that window's frame: bring it to the front. The browser only tells the frame that lost focus, so: the shell
  // checks on its own blur and focusin, apps (the SDK) ask it to check when they lose focus, and a light check
  // catches the rest (a web page losing focus to another). Only a change of focus raises a window.
  let lastFramed = null;
  const raiseFramed = () => {
    const f = document.activeElement;
    if (f === lastFramed) return;
    lastFramed = f;
    const el = f && f.tagName === 'IFRAME' && f.closest('.win');
    const w = el && wins.get(el.dataset.id);
    if (w && w.id !== focusedId && !w.min) { focus(w); closePops(); }
  };
  document.addEventListener('focusin', (e) => { if (e.target.tagName === 'IFRAME') raiseFramed(); });
  window.addEventListener('blur', () => setTimeout(raiseFramed, 0));
  setInterval(raiseFramed, 250);
  window.addEventListener('resize', debounce(relayout, 60));

  // ================================================================== immersive maximised windows
  // With the floating top bar and dock, a focused maximised window gets the whole screen: both bars
  // slide away. They come back when the window is restored, loses focus, or the pointer touches
  // the top or bottom edge of the screen.
  function updateImmersive() {
    const f = wins.get(focusedId);
    const on = !!(S.user && fullMax() && f && !f.min && (f.max || f.tile));
    root.classList.toggle('immersive', on);
    if (!on) root.classList.remove('peek-top', 'peek-bottom');
    if (!$('.edge-zone.top', root)) {
      // thin strips above the windows layer, so they catch the pointer even over app content
      root.insertAdjacentHTML('beforeend', '<div class="edge-zone top"></div><div class="edge-zone bottom"></div>');
      $('.edge-zone.top', root).addEventListener('mouseenter', () => { peekAt.top = Date.now(); root.classList.add('peek-top'); });
      $('.edge-zone.bottom', root).addEventListener('mouseenter', () => { peekAt.bottom = Date.now(); root.classList.add('peek-bottom'); });
    }
  }
  // A revealed bar hides again as soon as the pointer is on anything else, an app included:
  // entering an app's frame reaches the shell as one mouseover on the frame (after that the app
  // keeps the events), so that single event has to be enough. While a bar slides in, the pointer
  // briefly crosses whatever is under it, so the first moments after a reveal are ignored.
  const peekAt = { top: 0, bottom: 0 };
  const PEEK_GRACE = 450;
  let peekTimer = 0;
  root.addEventListener('mouseover', (e) => {
    if (!root.classList.contains('immersive') || UI.pop) return;
    const t = e.target;
    if (t.closest && t.closest('.menu, #pops, .switcher')) return;
    const y = e.clientY;
    clearTimeout(peekTimer);
    // Decide a moment later, when a bar that was sliding in has reached its place.
    const decide = () => {
      if (!root.classList.contains('immersive') || UI.pop) return;
      const now = Date.now();
      const tb = $('#bars .topbar', root);
      const dk = $('#bars .dock-wrap .dock', root);
      // by position, so the gap under the floating dock (over the app) still counts as the dock
      const inTop = !!(t.closest && t.closest('.topbar, .edge-zone.top')) || (tb && y < tb.getBoundingClientRect().bottom);
      const inDock = !!(t.closest && t.closest('.dock-wrap .dock, .edge-zone.bottom, .dock-hotzone')) || (dk && y >= dk.getBoundingClientRect().top);
      const waitTop = !inTop && now - peekAt.top < PEEK_GRACE;
      const waitDock = !inDock && now - peekAt.bottom < PEEK_GRACE;
      if (waitTop || waitDock) { peekTimer = setTimeout(decide, PEEK_GRACE); return; }
      if (!inTop) root.classList.remove('peek-top');
      if (!inDock) root.classList.remove('peek-bottom');
    };
    peekTimer = setTimeout(decide, 1000); // linger a second before hiding again
  });
  function blurWindows() {
    if (!focusedId) return;
    focusedId = null;
    wins.forEach((x) => x.el.classList.remove('focused'));
    renderBars();
  }

  // ================================================================== app switcher
  // Alt+` (and Alt+Tab where the browser lets the page have it) shows the open windows, most
  // recently used first. Keep Alt held and press again to move on (Shift goes back); let go of
  // Alt to switch. Esc cancels. Apps forward these keys through the SDK.
  const SW = { open: false, list: [], i: 0, el: null };
  function switcherKey(e) {
    if (!S.user || UI.lockShown) return false;
    if (SW.open && e.key === 'Escape') { e.preventDefault(); switcherClose(); return true; }
    if (!e.altKey || !(e.key === 'Tab' || e.code === 'Backquote')) return false;
    e.preventDefault();
    switcherStep(e.shiftKey ? -1 : 1);
    return true;
  }
  function switcherStep(dir) {
    if (!SW.open) {
      SW.list = [...wins.values()].sort((a, b) => (b.lastFocus || 0) - (a.lastFocus || 0));
      if (!SW.list.length) return;
      SW.open = true;
      SW.i = SW.list.length > 1 ? (dir > 0 ? 1 : SW.list.length - 1) : 0;
      if (SW.list[0] && SW.list[0].min) SW.i = 0; // nothing visible is focused: start on the latest window
      closePops(); hideMenu();
      switcherRender();
      return;
    }
    SW.i = (SW.i + dir + SW.list.length) % SW.list.length;
    switcherRender();
  }
  function switcherRender() {
    if (!SW.el) {
      SW.el = document.createElement('div');
      SW.el.className = 'switcher';
      SW.el.setAttribute('role', 'listbox');
      SW.el.setAttribute('aria-label', 'Open windows');
      SW.el.addEventListener('mousedown', (e) => e.preventDefault());
      SW.el.addEventListener('click', (e) => { const b = e.target.closest('[data-sw]'); if (b) { SW.i = +b.dataset.sw; switcherCommit(); } });
      root.appendChild(SW.el);
    }
    SW.el.innerHTML = '<div class="sw-card glass">' + SW.list.map((w, i) => '<button class="sw-item' + (i === SW.i ? ' on' : '') + (w.min ? ' min' : '') + '" data-sw="' + i + '" role="option" aria-selected="' + (i === SW.i) + '">' +
      '<img src="' + w.app.img + '" alt=""><b>' + esc(w.title || w.app.name) + '</b><small>' + esc([w.title && w.title !== w.app.name ? w.app.name : '', w.min ? 'Minimised' : ''].filter(Boolean).join(' · ')) + '</small></button>').join('') + '</div>';
  }
  function switcherCommit() {
    if (!SW.open) return;
    const w = SW.list[SW.i];
    switcherClose();
    if (!w || !wins.has(w.id)) return;
    if (w.min) restore(w); else focus(w);
    const frame = $('iframe', w.el);
    try { if (frame && frame.contentWindow) frame.contentWindow.focus(); } catch (x) { /* ignore */ }
  }
  function switcherClose() { SW.open = false; if (SW.el) { SW.el.remove(); SW.el = null; } }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.user && set().theme === 'auto') applySettings(); });
  window.addEventListener('beforeunload', (e) => {
    if ([...wins.values()].some((w) => w.dirty)) { e.preventDefault(); e.returnValue = ''; }
  });

  function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }

  // ================================================================== host API for apps
  window.LiteOSHost = {
    api,
    get state() { return hostState(); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    openApp(id, args) { return !!openApp(id, args); },
    openFile(path, isDir) { openFile(path, isDir); },
    notify(msg, o) { notify(msg, o); },
    saveSettings,
    focusWindow(id) { const w = wins.get(id); if (w) focus(w); closePops(); hideMenu(); },
    focusChanged() { setTimeout(raiseFramed, 0); },
    /** Apps forward the switcher keys here (their key events don't reach the shell). */
    switcher: { key: (e) => switcherKey(e), release: () => switcherCommit(), get open() { return SW.open; } },
    win: {
      setTitle(id, t) { const w = wins.get(id); if (w) setTitle(w, t); },
      close(id) { const w = wins.get(id); if (w) closeWin(w, true); },
      /** Apps set their top-bar menus: [{ label, items: [{ label, icon, key, disabled, action } | 'sep'] }] */
      setMenus(id, menus) { const w = wins.get(id); if (w) { w.menus = Array.isArray(menus) ? menus : []; if (focusedId === id) renderBars(); } },
      setDirty(id, d) { const w = wins.get(id); if (w && w.dirty !== d) { w.dirty = d; setTitle(w, w.title); } },
      /** While the window is covered: what the app is doing (a line of text) and how far it has got (0–1, or none). */
      loading(id, text, progress) {
        const w = wins.get(id);
        if (!w || !w.covered) return;
        w.heard = true;
        winLoadText(w, String(text || '').slice(0, 120), typeof progress === 'number' ? progress : null);
        clearTimeout(w.loadTimer);
        w.loadTimer = setTimeout(() => winLoaded(w), LOAD_WAIT);
      },
      /** The app is ready to be seen: the cover goes. */
      loaded(id) { const w = wins.get(id); if (w && w.covered) winLoaded(w); },
      /** What the app handed over before a reload (OS.win.keepState), given back once. */
      restored(id) { const w = wins.get(id); if (!w || !w.keep) return null; const k = w.keep; w.keep = null; return k; },
      /** F5 / Ctrl+R in an app: reload that app only, keeping its state. */
      async reload(id) {
        const w = wins.get(id);
        if (!w) return;
        if (w.dirty) {
          const ok = await confirmDialog({ title: 'Reload ' + w.app.name + '?', message: 'You have unsaved changes in “' + w.title.replace(/ — .*$/, '') + '”. They will be lost.', okLabel: 'Reload without saving', danger: true });
          if (!ok || !wins.has(id)) return;
          w.dirty = false;
          setTitle(w, w.title);
        }
        w.keep = keepOf(w);
        winLoading(w);
        w.iframe.src = w.app.entry + '?' + new URLSearchParams(Object.assign({}, w.args, { win: w.id }));
      },
      // Custom title bars: the app reports pointer positions in screen coordinates while the user drags its own title
      // area (its document keeps the pointer captured). They become shell positions from where the drag started,
      // then the drag is the same as on a shell title bar, edge snapping included.
      dragStart(id, sx, sy, frac, fy) {
        const w = wins.get(id);
        if (!w) return;
        focus(w);
        const r = w.el.getBoundingClientRect();
        const px = r.left + r.width * (frac == null ? 0.5 : frac);
        const py = r.top + (fy == null ? 18 : fy);
        w.drag = { sx, sy, px, py, s: dragSession(w, px, py) };
      },
      dragMove(id, sx, sy) {
        const w = wins.get(id);
        if (!w || !w.drag) return;
        const d = w.drag;
        d.s.move(d.px + (sx - d.sx), d.py + (sy - d.sy));
      },
      dragEnd(id) {
        const w = wins.get(id);
        if (!w || !w.drag) return;
        const d = w.drag;
        w.drag = null;
        d.s.end();
      },
      toggleMax(id) { const w = wins.get(id); if (w) toggleMax(w); },
      isMax(id) { const w = wins.get(id); return !!(w && w.max); },
    },
    dialog: {
      open: (o, winId) => fileDialog('open', o, winId),
      save: (o, winId) => fileDialog('save', o, winId),
      folder: (o, winId) => fileDialog('folder', o, winId),
      confirm: (o) => confirmDialog(o || {}),
      prompt: (o) => promptDialog(o || {}),
      alert: (o) => alertDialog(o || {}),
    },
    /** Admin/user changes made in Settings (e.g. display name) refresh shell state. */
    refreshUser(user) { if (user) { S.user = Object.assign({}, S.user, user); renderBars(); } },
    refreshSystem(sys) { if (sys) { S.system = Object.assign({}, S.system, sys); renderBars(); } },
  };

  boot();
})();
