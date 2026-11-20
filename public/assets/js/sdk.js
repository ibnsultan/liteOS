/*
 * LiteOS app SDK — loaded in every app window by resources/views/layouts/window.blade.php, after LOS_CONFIG,
 * icons.js and apps.js.
 *
 * Apps run in an iframe inside a shell window. When the shell is present the SDK
 * forwards calls to it (window.parent.LiteOSHost); opened on its own, it falls
 * back to plain fetch + browser dialogs so apps can still be developed directly.
 */
(function () {
  'use strict';

  let host = null;
  try {
    if (window.parent && window.parent !== window && window.parent.LiteOSHost) host = window.parent.LiteOSHost;
  } catch (e) { host = null; }

  const params = new URLSearchParams(location.search);
  const winId = params.get('win') || null;
  const BASE = window.LOS_BASE;
  const endpoint = (action) => window.LOS_endpoint(action);

  // ------------------------------------------------------------------ api
  // Opened on its own (no desktop around it), the app calls LiteOS directly: same routes and reply shape as the
  // shell's api() in os.js, with the CSRF token printed into the page.
  async function standaloneApi(action, data, query) {
    const isRead = data === undefined;
    let url = endpoint(action);
    if (query && Object.keys(query).length) url += '?' + new URLSearchParams(query).toString();
    const opts = { credentials: 'same-origin', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } };
    if (!isRead) {
      opts.method = 'POST';
      opts.headers['X-CSRF-TOKEN'] = window.LOS_CONFIG.csrf;
      if (Object.prototype.toString.call(data) === '[object FormData]') opts.body = data;
      else { opts.body = JSON.stringify(data || {}); opts.headers['Content-Type'] = 'application/json'; }
    }
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({ success: false, message: 'Unexpected response from the server.' }));
    if (!res.ok || !json.success) throw new Error(json.message || 'Request failed');
    return json.result;
  }

  /**
   * Call the LiteOS API. Pass `data` for actions that change things (POST);
   * omit it for read actions and put parameters in `query`.
   */
  function api(action, data, query) {
    if (host) return host.api(action, data, query);
    return standaloneApi(action, data, query);
  }

  const q = (action, query) => api(action, undefined, query);

  // ------------------------------------------------------------------ utils
  const util = {
    basename: (p) => String(p).replace(/\/+$/, '').split('/').pop() || '/',
    dirname: (p) => { const s = String(p).replace(/\/+$/, ''); const i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i); },
    join: (...parts) => ('/' + parts.join('/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1'),
    ext: (name) => (String(name).includes('.') ? String(name).split('.').pop().toLowerCase() : ''),
    stem: (name) => { const b = util.basename(name); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; },
    formatSize(bytes) {
      if (bytes == null) return '';
      const u = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0; let n = bytes;
      while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
      // 1023.99 MB would round to "1024 MB": move up a unit instead
      if (i > 0 && Math.round(n) >= 1024 && i < u.length - 1) { n /= 1024; i++; }
      return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
    },
    formatDate(ts) {
      if (!ts) return '';
      const d = new Date(ts * 1000);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const y = new Date(now); y.setDate(now.getDate() - 1);
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (sameDay) return 'Today, ' + time;
      if (d.toDateString() === y.toDateString()) return 'Yesterday, ' + time;
      return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
    },
    escape(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    debounce(fn, ms) {
      let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
    },
    /** Read a File/Blob as base64 (without the data: prefix). */
    toBase64(blob) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    },
  };

  // ------------------------------------------------------------------ files
  const fs = {
    list: (path) => q('fs.list', { path: path || '/' }),
    stat: (path) => q('fs.stat', { path }),
    /** -> { content: string, entry }. opts.track=false keeps it out of Recent files. */
    read: (path, opts) => q('fs.read', opts && opts.track === false ? { path, track: '0' } : { path }),
    /** Save text. opts.overwrite=false fails if the file exists. -> entry */
    write: (path, content, opts) => api('fs.write', { path, content, overwrite: !(opts && opts.overwrite === false) }),
    /** Save binary data given as base64. -> entry */
    writeBase64: (path, base64, opts) => api('fs.write', { path, content: base64, encoding: 'base64', overwrite: !(opts && opts.overwrite === false) }),
    mkdir: (path) => api('fs.mkdir', { path }),
    rename: (path, name) => api('fs.rename', { path, name }),
    move: (paths, dest) => api('fs.move', { paths, dest }),
    copy: (paths, dest) => api('fs.copy', { paths, dest }),
    /** Moves to Trash. */
    remove: (paths) => api('fs.delete', { paths: [].concat(paths) }),
    /** Upload a FileList / File[] into a folder. -> entries */
    upload(dir, files) {
      const fd = new FormData();
      fd.append('path', dir);
      Array.from(files).forEach((f) => fd.append('files[]', f, f.name));
      return api('fs.upload', fd);
    },
    /** kind: '' | 'image' | 'video' | 'audio' */
    search: (query, kind, limit) => q('fs.search', { q: query || '', kind: kind || '', limit: limit || 200 }),
    recent: () => q('fs.recent'),
    usage: () => q('fs.usage'),
    /** The storage this device has: [{ id, name, path, kind, used, quota, icon (drive path of an .ico, or null) }]. */
    drives: () => q('fs.drives'),
    /** URL to use in <img>, <video>, <audio> or for downloading. */
    rawUrl: (path, download) => endpoint('fs.raw') + '?path=' + encodeURIComponent(path) + (download ? '&download=1' : ''),
    trash: {
      list: () => q('trash.list'),
      restore: (ids) => api('trash.restore', { ids }),
      purge: (ids) => api('trash.purge', { ids: ids || [] }),
    },
  };

  // ------------------------------------------------------------------ window
  const win = {
    id: winId,
    setTitle(title) { if (host && winId) host.win.setTitle(winId, title); else document.title = title; },
    close() { if (host && winId) host.win.close(winId); else window.close(); },
    /** Mark unsaved changes; the shell asks before closing a dirty window. */
    setDirty(dirty) { if (host && winId) host.win.setDirty(winId, !!dirty); },
    /**
     * For apps whose manifest sets window.reportsReady: the window stays covered by the opening screen after the page
     * loads, until loaded() is called. Until then, loading(text, progress) shows what the app is doing under its icon
     * ("Reading the workbook", 0.45). Each call keeps the cover up another 15 seconds.
     */
    loading(text, progress) { if (host && winId && host.win.loading) host.win.loading(winId, text, progress); },
    loaded() { if (host && winId && host.win.loaded) host.win.loaded(winId); },
    /**
     * Menus shown in the top bar while this window is focused, merged with the
     * standard File / View / Window / Help menus:
     *   setMenus([{ label: 'File', items: [{ label: 'Save', key: 'Ctrl+S', icon: 'save', action }, 'sep', …] }])
     */
    setMenus(menus) { if (host && winId && host.win.setMenus) host.win.setMenus(winId, menus); },
    /** Width (px) of the shell's window buttons in a custom title bar (apps with chrome: 'custom'). */
    controlsWidth: host && winId ? 132 : 0,
    /**
     * Make `el` drag the window (custom title bars). `isHandle(target)` can restrict which
     * targets start a drag, e.g. only empty space. Double-click maximises / restores.
     */
    dragRegion(el, isHandle) {
      if (!host || !winId || !host.win.dragStart) return;
      const ok = (t) => !isHandle || isHandle(t);
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !ok(e.target)) return;
        e.preventDefault();
        host.win.dragStart(winId, e.screenX, e.screenY, e.clientX / Math.max(1, window.innerWidth), e.clientY);
        el.setPointerCapture(e.pointerId);
        const move = (ev) => host.win.dragMove(winId, ev.screenX, ev.screenY);
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          host.win.dragEnd(winId);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      });
      el.addEventListener('dblclick', (e) => { if (ok(e.target)) host.win.toggleMax(winId); });
    },
  };

  // ------------------------------------------------------------------ system volume
  // The master volume (top bar / Quick settings) scales every <audio>/<video> in the app.
  // An element can carry data-app-volume="0..1" for its own level within that.
  function masterVolume(s) { return !s || s.muted ? 0 : (s.volume == null ? 80 : s.volume) / 100; }
  function applyVolume(el) {
    const v = masterVolume(current.settings);
    const own = el.dataset && el.dataset.appVolume != null ? Math.max(0, Math.min(1, +el.dataset.appVolume)) : 1;
    try { el.volume = Math.max(0, Math.min(1, v * own)); } catch (e) { /* ignore */ }
  }
  document.addEventListener('play', (e) => { if (e.target && 'volume' in e.target) applyVolume(e.target); }, true);
  const applyAllVolumes = () => document.querySelectorAll('audio, video').forEach(applyVolume);

  // ------------------------------------------------------------------ app switcher keys
  // Alt+` / Alt+Tab pressed inside an app go to the shell's window switcher.
  if (host && host.switcher) {
    document.addEventListener('keydown', (e) => {
      if ((e.altKey && (e.key === 'Tab' || e.code === 'Backquote')) || (e.key === 'Escape' && host.switcher.open)) {
        if (host.switcher.key({ key: e.key, code: e.code, altKey: e.altKey, shiftKey: e.shiftKey, preventDefault: () => {} })) { e.preventDefault(); e.stopImmediatePropagation(); }
      }
    }, true);
    document.addEventListener('keyup', (e) => { if (e.key === 'Alt' && host.switcher.open) host.switcher.release(); }, true);
  }

  // ------------------------------------------------------------------ dialogs
  const dialog = {
    /** Pick a file. opts: { title, accept: ['ldoc'], startIn: '/Documents' } -> path | null */
    open(opts) {
      if (host) return host.dialog.open(opts || {}, winId);
      return Promise.resolve(window.prompt('Path to open', (opts && opts.startIn) || '/Documents/'));
    },
    /** Pick a save location. opts: { title, defaultName, ext, startIn } -> path | null */
    save(opts) {
      if (host) return host.dialog.save(opts || {}, winId);
      return Promise.resolve(window.prompt('Save as', '/Documents/' + ((opts && opts.defaultName) || 'Untitled')));
    },
    /** Pick a folder. opts: { title, startIn } -> path | null */
    folder(opts) {
      if (host) return host.dialog.folder(opts || {}, winId);
      return Promise.resolve(window.prompt('Folder', '/'));
    },
    /** opts: { title, message, okLabel, danger } -> boolean */
    confirm(opts) {
      if (typeof opts === 'string') opts = { message: opts };
      if (host) return host.dialog.confirm(opts, winId);
      return Promise.resolve(window.confirm(opts.message || opts.title));
    },
    /** opts: { title, label, value, okLabel } -> string | null */
    prompt(opts) {
      if (typeof opts === 'string') opts = { label: opts };
      if (host) return host.dialog.prompt(opts, winId);
      return Promise.resolve(window.prompt(opts.label || opts.title, opts.value || ''));
    },
    alert(opts) {
      if (typeof opts === 'string') opts = { message: opts };
      if (host) return host.dialog.alert(opts, winId);
      window.alert(opts.message); return Promise.resolve();
    },
  };

  // ------------------------------------------------------------------ settings / theme
  let current = host ? host.state : { user: null, settings: {}, system: {} };
  const listeners = [];

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

  function effectiveTheme(s) {
    if (s.theme === 'auto') return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return s.theme === 'dark' ? 'dark' : 'light';
  }
  function applyTheme(s) {
    if (!s) return;
    const root = document.documentElement;
    root.dataset.theme = effectiveTheme(s);
    root.dataset.glass = s.transparency === false ? 'off' : 'on';
    if (s.accent) root.style.setProperty('--accent', s.accent);
    applyA11y(root, s);
    const zoom = { default: 1, large: 1.1, larger: 1.22 }[s.textSize] || 1;
    document.body && (document.body.style.zoom = zoom === 1 ? '' : String(zoom));
  }

  if (host) {
    host.subscribe((state) => {
      current = state;
      applyTheme(state.settings);
      applyAllVolumes();
      listeners.forEach((fn) => { try { fn(state.settings, state); } catch (e) { console.error(e); } });
    });
  }

  // ------------------------------------------------------------------ popup menu helper
  /**
   * Show a context menu at a MouseEvent or {x, y}. items: [{ label, icon, key, danger, disabled, checked, action }],
   * { label, icon, items: [...] } for a submenu, or 'sep' (see menu.js). Returns a function that closes it.
   */
  function menu(items, at) { return window.LOS_menu.open(items, at); }
  function closeMenu() { window.LOS_menu.close(); }

  // Clicking anywhere inside an app brings its window to the front and closes shell menus (launcher etc.).
  // pointerdown too: an app that cancels pointerdown (a canvas editor) suppresses mousedown.
  const raise = () => { if (host && host.focusWindow && winId) host.focusWindow(winId); };
  document.addEventListener('pointerdown', raise, true);
  document.addEventListener('mousedown', raise, true);
  // A click in a frame inside the app (a web page in the Browser) never reaches this document, but it moves focus
  // into that frame: this window blurs while its document still holds the focus.
  // When focus leaves for another window, the shell isn't told: ask it to look.
  window.addEventListener('blur', () => setTimeout(() => {
    if (document.hasFocus()) raise();
    else if (host && host.focusChanged) host.focusChanged();
  }, 0));

  // ------------------------------------------------------------------ public API
  const LiteOS = {
    inShell: !!host,
    args: Object.fromEntries(params.entries()),
    get user() { return current.user; },
    get settings() { return current.settings || {}; },
    get system() { return current.system || {}; },
    api,
    fs,
    win,
    dialog,
    menu,
    closeMenu,
    util,
    /** An in-app toolbar glyph (LiteOS's own line icons). */
    icon: (name, size, cls) => window.LOS_icon(name, size, cls),
    /** A system icon's URL from the icon set, by role: LiteOS.sysIcon('place.downloads'). */
    sysIcon: (role, opts) => window.LOS_sysIcon(role, opts),
    /** A system icon for a glyph name or role, as markup (the set's file, or the glyph when the set has none). */
    sysGlyph: (name, size, cls) => window.LOS_sysGlyph(name, size, cls),
    /** A file or folder's icon from the icon set, as an <img>, size × size. */
    fileTile: (entry, size, cls) => window.LOS_fileTile(entry, size, cls),
    /** Open an app: LiteOS.open('documents', { path: '/Documents/a.ldoc' }) */
    open(appId, args) { if (host) host.openApp(appId, args || {}); else location.href = BASE + 'apps/' + appId + '?' + new URLSearchParams(args || {}); },
    /** Open a file with its default app. */
    openFile(path) { if (host) host.openFile(path); },
    /**
     * Notification. Second argument is a type ('info' | 'success' | 'error') or options:
     *   { type, title, image (URL or a drive path like '/Pictures/a.jpg'), imageShape: 'round',
     *     actions: [{ label: 'Open', action }] }  (text buttons along the bottom; each closes the notification)
     * The app's icon and name are added automatically.
     */
    notify(message, opts) {
      const o = typeof opts === 'string' ? { type: opts } : Object.assign({}, opts || {});
      o.type = o.type || 'info';
      o.win = winId;
      if (host) host.notify(message, o); else console.log('[notify]', o.title || '', message);
    },
    /** Save user settings (partial). */
    saveSettings(changes) { return host ? host.saveSettings(changes) : api('settings.save', { settings: changes }); },
    onSettings(fn) { listeners.push(fn); },
    /** Run fn once the DOM is ready and the theme is applied. */
    ready(fn) {
      const run = async () => {
        if (!host) {
          try {
            const s = await q('auth.status');
            current = { user: s.user, settings: s.settings || {}, system: s.system || {} };
          } catch (e) { /* not signed in */ }
        }
        applyTheme(current.settings);
        fn(LiteOS);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
    },
  };

  window.LiteOS = LiteOS;
})();
