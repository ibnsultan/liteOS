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
    deskIcons: true, deskIconSize: 'medium', deskSort: 'name',
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
    if (!S.user) return;
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

  function deskItems() {
    return (set().desktopIcons || []).map((id) => {
      if (id === 'trash') return { id, label: 'Trash', img: window.LOS_appIconUrl('trash'), open: () => openApp('files', { path: 'trash:' }) };
      const app = window.LOS_app(id);
      if (!app) return null;
      return { id, label: id === 'files' ? 'My drive' : app.name, img: app.img, open: () => openApp(id) };
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
  async function deskNew(t) {
    try {
      if (!t) {
        const name = await promptDialog({ title: 'New folder', label: 'Folder name', value: 'New folder', okLabel: 'Create' });
        if (!name || !name.trim()) return;
        await api('fs.mkdir', { path: join('/Desktop', name.trim()) });
      } else {
        for (let i = 1; ; i++) {
          const path = join('/Desktop', t.name + (i > 1 ? ' ' + i : '') + '.' + t.ext);
          try { await api('fs.write', { path, content: '', overwrite: false }); break; } catch (e) { if (!/exists/i.test(e.message) || i > 50) throw e; }
        }
      }
      deskFilesChanged();
    } catch (e) { notify(e.message, { type: 'error', title: t ? 'Couldn\u2019t create file' : 'Couldn\u2019t create folder' }); }
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
      .concat(window.LOS_APPS.filter((a) => !a.system || a.id === 'files').map((a) => ({ id: a.id, label: a.id === 'files' ? 'My drive' : a.name, img: a.img })))
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
        .map(([k, label]) => ({ label, checked: sort === k, action: () => saveSettings({ deskSort: k }) })) },
      { label: 'Refresh', icon: 'reload', action: () => { deskFiles = []; deskFilesChanged(); } },
      'sep',
      { label: 'Next desktop background', icon: 'image', disabled: !(window.LOS_WALLPAPERS || []).length, action: nextWallpaper },
      { label: 'New', icon: 'plus', items: [{ label: 'Folder', icon: 'folder', action: () => deskNew(null) }, 'sep']
        .concat(DESK_NEW.filter((t) => window.LOS_app(t.app)).map((t) => ({ label: t.label, img: window.LOS_app(t.app).img, action: () => deskNew(t) }))) },
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
    box.innerHTML = deskItems().map((it) => '<button class="desk-icon" role="listitem" data-desk="' + it.id + '" title="' + esc(it.label) + '">' +
      '<img src="' + esc(it.img) + '" alt="" draggable="false"><span>' + esc(it.label) + '</span></button>').join('') +
      sortedDeskFiles().map((f) => '<button class="desk-icon desk-file" role="listitem" data-file="' + esc(f.path) + '" data-type="' + esc(f.type) + '" title="' + esc(f.name) + '">' +
        fileTile(f, tileSize, Math.round(tileSize / 4)) + '<span>' + esc(f.name) + '</span></button>').join('');
  }

  function selectDeskIcon(btn) {
    $$('.desk-icon.sel', root).forEach((b) => b.classList.remove('sel'));
    if (btn) { btn.classList.add('sel'); btn.focus({ preventScroll: true }); }
  }

  function openDeskIcon(btn) {
    if (btn.dataset.file) { selectDeskIcon(null); openFile(btn.dataset.file, btn.dataset.type === 'dir'); return; }
    const it = deskItems().find((x) => x.id === btn.dataset.desk);
    if (it) { selectDeskIcon(null); it.open(); }
  }

  function deskFileMenu(btn, at) {
    selectDeskIcon(btn);
    const path = btn.dataset.file;
    showMenu([
      { label: 'Open', icon: 'forward', action: () => openDeskIcon(btn) },
      { label: 'Show in Files', icon: 'folder', action: () => openApp('files', { path: '/Desktop', select: path }) },
      'sep',
      { label: 'Rename', icon: 'rename', action: async () => {
        const name = await promptDialog({ title: 'Rename', label: 'Name', value: baseName(path), okLabel: 'Rename', selectStem: btn.dataset.type !== 'dir' });
        if (!name || !name.trim() || name.trim() === baseName(path)) return;
        try { await api('fs.rename', { path, name: name.trim() }); } catch (e) { notify(e.message, { type: 'error', title: 'Couldn’t rename' }); }
      } },
      { label: 'Move to Trash', icon: 'trash', danger: true, action: async () => {
        try { await api('fs.delete', { paths: [path] }); notify('You can restore it from the Trash if you need it.', { type: 'success', title: 'Moved to Trash' }); }
        catch (e) { notify(e.message, { type: 'error', title: 'Couldn’t move to Trash' }); }
      } },
    ], at);
  }

  function deskIconMenu(btn, at) {
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
    if (b) selectDeskIcon(b);
    else if (e.target.classList.contains('wall') || e.target.classList.contains('desk-icons')) { selectDeskIcon(null); blurWindows(); }
  });
  root.addEventListener('dblclick', (e) => { const b = e.target.closest('.desk-icon'); if (b) openDeskIcon(b); });
  root.addEventListener('keydown', (e) => {
    const b = e.target.closest && e.target.closest('.desk-icon');
    if (!b) return;
    if (e.key === 'Enter') { e.preventDefault(); openDeskIcon(b); }
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
        
        '<div class="apps">' + apps.map((a) => '<button class="tb-btn' + (runningIds.has(a.id) ? ' running' : '') + (fApp === a.id ? ' focused' : '') + '" data-app="' + a.id + '" title="' + esc(a.name) + '" aria-label="' + esc(a.name) + '">' +
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
  function snapWin(w, side) {
    const a = workArea();
    if (w.max) toggleMax(w);
    w.prev = Object.assign({}, w.rect);
    w.snap = side;
    w.rect = side === 'left' ? { x: a.x, y: a.y, w: Math.round(a.w / 2), h: a.h } : { x: a.x + Math.round(a.w / 2), y: a.y, w: Math.round(a.w / 2), h: a.h };
    applyRect(w);
  }

  const helpMenu = () => ({ label: 'Help', items: [
    { label: 'Keyboard shortcuts', icon: 'info', action: () => alertDialog({ title: 'Keyboard shortcuts', message: 'Alt + Space — open the launcher. Esc — close menus and dialogs. Double-click a title bar — maximise. Drag a window to the top edge to maximise it, or to the left or right edge to snap it.' }) },
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
        { label: 'Snap to the left', icon: 'back', action: () => snapWin(w, 'left') },
        { label: 'Snap to the right', icon: 'forward', action: () => snapWin(w, 'right') },
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
    const r = w.max ? (fullMax() ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight } : workArea()) : w.rect;
    Object.assign(w.el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }

  function relayout() {
    wins.forEach((w) => { if (!w.max) clampRect(w.rect); applyRect(w); });
  }

  function openApp(appId, args) {
    const app = window.LOS_app(appId);
    if (!app) { notify('That app isn’t installed.', { type: 'error', title: 'App not found' }); return null; }
    args = args || {};
    closePops();
    if (app.single) {
      const existing = [...wins.values()].find((x) => x.app.id === appId);
      if (existing) {
        if (Object.keys(args).length) winLoading(existing), existing.iframe.src = app.entry + '?' + new URLSearchParams(Object.assign({}, args, { win: existing.id }));
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
    el.className = 'win' + (app.chrome === 'custom' ? ' win-custom' : '');
    el.dataset.id = id;
    el.setAttribute('aria-label', app.name);
    el.innerHTML = '<div class="win-bar">' + appTile(app, 20, 6, 12) + '<span class="title"></span>' +
      '<button class="ibtn ctl" data-w="min" aria-label="Minimise">' + ICON('window.minimize', 14) + '</button>' +
      '<button class="ibtn ctl" data-w="max" aria-label="Maximise">' + ICON('window.maximize', 13) + '</button>' +
      '<button class="ibtn ctl close" data-w="close" aria-label="Close">' + ICON('window.close', 14) + '</button></div>' +
      '<div class="win-body"><iframe title="' + esc(app.name) + '" allow="fullscreen; clipboard-read; clipboard-write; autoplay; picture-in-picture; encrypted-media; web-share; accelerometer; gyroscope" allowfullscreen></iframe>' +
      '<div class="win-load" role="progressbar" aria-label="Opening ' + esc(app.name) + '">' + appTile(app, 48, 12, 28) + '<span class="spin" aria-hidden="true"></span></div>' +
      '<div class="win-shield"></div></div>' +
      ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => '<div class="rz ' + d + '" data-rz="' + d + '"></div>').join('');
    const win = { id, app, el, iframe: $('iframe', el), title: app.name, dirty: false, max: false, min: false, rect, prev: null, snap: null };
    wins.set(id, win);
    $('.windows', root).appendChild(el);
    win.iframe.addEventListener('load', () => winLoaded(win));
    winLoading(win);
    win.iframe.src = app.entry + '?' + new URLSearchParams(Object.assign({}, args, { win: id }));
    setTitle(win, app.name);
    applyRect(win);
    bindWindow(win);
    focus(win);
    return win;
  }

  // Loading cover: the app's icon over the window body until its page has loaded (the frame's load event fires once
  // the SDK's ready() callbacks have run). The spinner only fades in on slow loads, so fast ones don't flicker.
  function winLoading(w) {
    const c = $('.win-load', w.el);
    if (!c) return;
    c.classList.remove('done');
    clearTimeout(w.loadTimer);
    w.loadTimer = setTimeout(() => winLoaded(w), 15000); // never leave a window covered
  }
  function winLoaded(w) {
    clearTimeout(w.loadTimer);
    const c = $('.win-load', w.el);
    if (c) requestAnimationFrame(() => c.classList.add('done'));
  }

  function openFile(path, isDir) {
    if (isDir) return openApp('files', { path });
    const app = window.LOS_appForFile(path);
    if (app) return openApp(app.id, { path });
    notify('No app can open “' + baseName(path) + '”. It will be downloaded instead.', { title: 'Downloading file' });
    window.open(rawUrl(path, true), '_blank', 'noopener');
    return null;
  }

  function setTitle(w, title) {
    w.title = title || w.app.name;
    const t = $('.title', w.el);
    t.innerHTML = esc(w.title) + (w.dirty ? '<span class="dirty" title="Unsaved changes"></span>' : '');
  }

  function focus(w) {
    if (!w) return;
    if (focusedId === w.id && !w.min && w.el.style.zIndex == zTop) return;
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
    w.min = true;
    w.el.classList.add('min');
    if (focusedId === w.id) focusTopmost(); else renderBars();
  }

  function restore(w) {
    w.min = false;
    w.el.classList.remove('min');
    focus(w);
  }

  function toggleMax(w) {
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
    wins.delete(w.id);
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
    const sx = e.clientX;
    const sy = e.clientY;
    let offX = sx - w.rect.x;
    let offY = sy - w.rect.y;
    let moved = false;
    let snap = null;
    let ghost = null;
    const target = e.target;
    target.setPointerCapture(e.pointerId);
    const a = workArea();
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
      if (!moved) { moved = true; root.classList.add('dragging'); }
      if (w.max || w.snap) {
        const prev = w.prev || w.rect;
        const ratio = Math.min(0.9, Math.max(0.1, (sx - (w.max ? 0 : w.rect.x)) / (w.max ? window.innerWidth : w.rect.w)));
        if (w.max) toggleMax(w);
        w.snap = null;
        w.rect = { x: 0, y: 0, w: prev.w, h: prev.h };
        offX = w.rect.w * ratio;
        offY = 20;
      }
      w.rect.x = Math.round(ev.clientX - offX);
      w.rect.y = Math.round(Math.max(a.y, Math.min(ev.clientY - offY, a.y + a.h - 40)));
      applyRect(w);
      snap = ev.clientY <= a.y + 2 ? 'max' : ev.clientX <= 2 ? 'left' : ev.clientX >= window.innerWidth - 3 ? 'right' : null;
      if (snap && !ghost) { ghost = document.createElement('div'); ghost.className = 'snap-ghost'; $('.windows', root).appendChild(ghost); }
      if (!snap && ghost) { ghost.remove(); ghost = null; }
      if (ghost) {
        const g = snap === 'max' ? a : snap === 'left' ? { x: a.x, y: a.y, w: a.w / 2, h: a.h } : { x: a.x + a.w / 2, y: a.y, w: a.w / 2, h: a.h };
        Object.assign(ghost.style, { left: g.x + 6 + 'px', top: g.y + 6 + 'px', width: g.w - 12 + 'px', height: g.h - 12 + 'px' });
      }
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      root.classList.remove('dragging');
      if (ghost) ghost.remove();
      if (snap === 'max') { w.prev = Object.assign({}, w.rect); toggleMax(w); }
      else if (snap) {
        w.prev = Object.assign({}, w.rect);
        w.snap = snap;
        w.rect = snap === 'left' ? { x: a.x, y: a.y, w: Math.round(a.w / 2), h: a.h } : { x: a.x + Math.round(a.w / 2), y: a.y, w: Math.round(a.w / 2), h: a.h };
        applyRect(w);
      }
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
    w.snap = null;
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

      async function load(path, how) {
        try {
          const r = await api('fs.list', undefined, { path });
          if (how === 'push' && path !== cwd) { back.push(cwd); fwd.length = 0; }
          cwd = path; entries = (r || []).filter((e) => !e.name.startsWith('.')); sel = null;
          query = ''; search.value = '';
          if (mode === 'folder') nameInput.value = folderName(cwd);
          draw();
        } catch (e) {
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
        else if (t.dataset.b === 'mkdir') {
          const n = await promptDialog({ title: 'New folder', label: 'Folder name', value: 'New folder', okLabel: 'Create' });
          if (n && n.trim()) { try { await api('fs.mkdir', { path: join(cwd, n.trim()) }); load(cwd); } catch (ex) { notify(ex.message, { type: 'error', title: 'Couldn’t create folder' }); } }
        } else if (t.dataset.b === 'cancel') done(null);
        else if (t.dataset.b === 'ok') ok();
      });
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
    if (e.key === 'Escape') { hideMenu(); if (UI.pop) closePops(); }
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
    const on = !!(S.user && fullMax() && f && !f.min && f.max);
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
      // Custom title bars: the app reports pointer positions in screen coordinates while the
      // user drags its own title area (its document keeps the pointer captured).
      dragStart(id, sx, sy, frac) {
        const w = wins.get(id);
        if (!w) return;
        focus(w);
        w.drag = { sx, sy, moved: false, frac: frac == null ? 0.5 : frac };
      },
      dragMove(id, sx, sy) {
        const w = wins.get(id);
        if (!w || !w.drag) return;
        const d = w.drag;
        if (!d.moved && Math.abs(sx - d.sx) + Math.abs(sy - d.sy) < 4) return;
        if (!d.moved) {
          d.moved = true;
          root.classList.add('dragging');
          if (w.max || w.snap) { // pull the window off the maximised / snapped position, under the pointer
            const prev = w.prev || w.rect;
            if (w.max) toggleMax(w);
            w.snap = null;
            const r = w.el.getBoundingClientRect();
            w.rect = { x: Math.round(r.left + r.width * d.frac - prev.w * d.frac), y: w.rect.y, w: prev.w, h: prev.h };
          }
          d.ox = w.rect.x; d.oy = w.rect.y; d.sx = sx; d.sy = sy;
        }
        const a = workArea();
        w.rect.x = Math.round(d.ox + (sx - d.sx));
        w.rect.y = Math.round(Math.max(a.y, Math.min(d.oy + (sy - d.sy), a.y + a.h - 40)));
        applyRect(w);
        d.top = w.rect.y <= a.y;
      },
      dragEnd(id) {
        const w = wins.get(id);
        if (!w || !w.drag) return;
        const d = w.drag;
        w.drag = null;
        root.classList.remove('dragging');
        if (d.moved && d.top && d.sy) { w.prev = Object.assign({}, w.rect); toggleMax(w); } // dropped at the top edge: maximise
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
