/*
 * LiteOS app SDK — loaded in every app window by resources/views/layouts/window.blade.php, after LOS_CONFIG,
 * icons.js and apps.js.
 *
 * Apps run in an iframe inside a shell window. When the shell is present the SDK
 * forwards calls to it (window.parent.LiteOSHost); opened on its own, it falls
 * back to plain fetch + browser dialogs so apps can still be developed directly.
 *
 * An app page framed by anything but the desktop (the Browser app pointed at LiteOS, a page inside a page) would be
 * LiteOS inside itself: it shows a line instead and starts nothing. A guest uses apps only in the desktop's windows:
 * an app page opened on its own goes back to the desktop (the server refuses it too, AppsController).
 */
(function () {
  'use strict';

  let host = null;
  try {
    if (window.parent && window.parent !== window && window.parent.LiteOSHost) host = window.parent.LiteOSHost;
  } catch (e) { host = null; }
  if (!host && window.parent !== window) {
    const stop = () => { document.body.innerHTML = '<p style="margin:0;padding:16px;font:13px/1.5 system-ui,sans-serif;color:#5a606b;text-align:center">LiteOS apps open only in LiteOS’s own windows.</p>'; };
    if (document.body) stop(); else document.addEventListener('DOMContentLoaded', stop);
    return;
  }
  if (!host && window.LOS_CONFIG && window.LOS_CONFIG.guest) {
    location.replace(window.LOS_BASE);
    return;
  }

  const params = new URLSearchParams(location.search);
  const winId = params.get('win') || null;
  const BASE = window.LOS_BASE;
  const endpoint = (action) => window.LOS_endpoint(action);

  /*
  |--------------------------------------------------------------------------
  | API
  |--------------------------------------------------------------------------
  */

  /**
   * Opened on its own (no desktop around it), the app calls LiteOS directly: same routes and reply shape as the
   * shell's api() in os.js, with the CSRF token printed into the page.
   */
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

  /*
  |--------------------------------------------------------------------------
  | Utils
  |--------------------------------------------------------------------------
  */
  const util = {
    basename: (p) => String(p).replace(/\/+$/, '').split('/').pop() || '/',
    dirname: (p) => { const s = String(p).replace(/\/+$/, ''); const i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i); },
    join: (...parts) => ('/' + parts.join('/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1'),
    ext: (name) => (String(name).includes('.') ? String(name).split('.').pop().toLowerCase() : ''),
    stem: (name) => { const b = util.basename(name); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; },
    /** 1023.99 MB would round to "1024 MB": it moves up a unit instead. */
    formatSize(bytes) {
      if (bytes == null) return '';
      const u = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0; let n = bytes;
      while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
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

  /*
  |--------------------------------------------------------------------------
  | Files
  |--------------------------------------------------------------------------
  |
  | A path on a USB stick of a LiteLink thin client ("usb:<drive>:/folder/name", from the Open / Save picker) is read
  | and written on the stick itself through LiteLink (usb.js); everything else goes to the server as always. Rename,
  | move, copy and delete have no USB version yet. Off a LiteLink device there are no usb: paths.
  |
  | Apps that read a file's bytes with fetch(fs.rawUrl(path)) (the office apps, Code) get a USB stick's file the same
  | way: on a LiteLink device only, a fetch of the raw URL of a usb: path is answered from the stick. Every other
  | request goes on untouched. <img> / <video> can't be answered like this: they use fs.objectUrl().
  |
  */
  const USB = window.LOS_usb || null;
  const onUsb = (p) => !!(USB && USB.isUsb(p));
  const NO_USB_OP = () => Promise.reject(new Error('USB drives can’t do that yet.'));
  const bytesOf = (b64) => { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  const objectUrls = new Set();
  window.addEventListener('pagehide', () => { objectUrls.forEach((u) => URL.revokeObjectURL(u)); objectUrls.clear(); });
  const fs = {
    list: (path) => (onUsb(path) ? USB.list(path) : q('fs.list', { path: path || '/' })),
    stat: (path) => (onUsb(path) ? USB.stat(path) : q('fs.stat', { path })),
    /** -> { content: string, entry }. opts.track=false keeps it out of Recent files (a stick's files never go in). */
    read: async (path, opts) => {
      if (!onUsb(path)) return q('fs.read', opts && opts.track === false ? { path, track: '0' } : { path });
      const [blob, entry] = await Promise.all([USB.readBlob(path), USB.stat(path)]);
      return { content: await blob.text(), entry };
    },
    /** Save text. opts.overwrite=false fails if the file exists. -> entry */
    write: (path, content, opts) => (onUsb(path) ? USB.write(path, String(content == null ? '' : content), opts)
      : api('fs.write', { path, content, overwrite: !(opts && opts.overwrite === false) })),
    /** Save binary data given as base64. -> entry */
    writeBase64: (path, base64, opts) => (onUsb(path) ? USB.write(path, bytesOf(base64), opts)
      : api('fs.write', { path, content: base64, encoding: 'base64', overwrite: !(opts && opts.overwrite === false) })),
    mkdir: (path) => (onUsb(path) ? USB.mkdir(path) : api('fs.mkdir', { path })),
    rename: (path, name) => (onUsb(path) ? NO_USB_OP() : api('fs.rename', { path, name })),
    move: (paths, dest) => ([].concat(paths, dest).some(onUsb) ? NO_USB_OP() : api('fs.move', { paths, dest })),
    copy: (paths, dest) => ([].concat(paths, dest).some(onUsb) ? NO_USB_OP() : api('fs.copy', { paths, dest })),
    /** Moves to Trash. */
    remove: (paths) => ([].concat(paths).some(onUsb) ? NO_USB_OP() : api('fs.delete', { paths: [].concat(paths) })),
    /** Upload a FileList / File[] into a folder. -> entries */
    upload(dir, files) {
      if (onUsb(dir)) return Promise.all(Array.from(files).map((f) => USB.write(USB.join(dir, f.name), f)));
      const fd = new FormData();
      fd.append('path', dir);
      Array.from(files).forEach((f) => fd.append('files[]', f, f.name));
      return api('fs.upload', fd);
    },
    /** Whether a path is on a USB stick of a LiteLink device. */
    isUsb: (path) => onUsb(path),
    /** A file's contents as a Blob, wherever it is. */
    readBlob: async (path) => {
      if (onUsb(path)) return USB.readBlob(path);
      const res = await fetch(fs.rawUrl(path), { credentials: 'same-origin' });
      if (!res.ok) throw new Error('“' + String(path).split('/').pop() + '” couldn’t be read.');
      return res.blob();
    },
    /**
     * A URL for <img>, <video>, <audio>: rawUrl() for a file on the drive, or a blob: URL of a file on a USB stick
     * (read whole, up to 64 MB). Freed when the window closes, or with revokeUrl().
     *
     * A guest's files are in this browser: without the guest drive's service worker only fetch() reaches them. Such a
     * blob: URL runs as LiteOS itself (the server's copy is sandboxed; this one can't be), so only pictures, video and
     * audio keep their type; a page, script or anything else is handed over as plain text.
     */
    objectUrl: async (path) => {
      if (window.LOS_CONFIG && window.LOS_CONFIG.guest && !onUsb(path) && !(navigator.serviceWorker && navigator.serviceWorker.controller)) {
        const res = await fetch(fs.rawUrl(path));
        if (!res.ok) throw new Error('“' + String(path).split('/').pop() + '” couldn’t be read.');
        const blob = await res.blob();
        const media = /^(image\/(?!svg)|video\/|audio\/)/.test(blob.type);
        const url = URL.createObjectURL(media ? blob : new Blob([blob], { type: 'text/plain' }));
        objectUrls.add(url);
        return url;
      }
      if (!onUsb(path)) return fs.rawUrl(path);
      const url = URL.createObjectURL(await USB.readBlob(path));
      objectUrls.add(url);
      return url;
    },
    revokeUrl: (url) => { if (objectUrls.delete(url)) URL.revokeObjectURL(url); },
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

  if (USB && typeof window.LiteLink === 'object' && window.LiteLink) {
    const nativeFetch = window.fetch.bind(window);
    const RAW = new URL(endpoint('fs.raw'), location.href);
    window.fetch = function (input, init) {
      try {
        const href = typeof input === 'string' || input instanceof URL ? String(input) : input && input.url;
        const u = new URL(href, location.href);
        const p = u.origin === RAW.origin && u.pathname === RAW.pathname ? u.searchParams.get('path') : null;
        if (p && USB.isUsb(p)) {
          return USB.readBlob(p).then((b) => new Response(b, { status: 200, headers: { 'Content-Type': b.type || 'application/octet-stream', 'Content-Length': String(b.size) } }));
        }
      } catch (e) { /* not a URL this answers */ }
      return nativeFetch(input, init);
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Window
  |--------------------------------------------------------------------------
  */
  const win = {
    id: winId,
    setTitle(title) { if (host && winId) host.win.setTitle(winId, title); else document.title = title; },
    close() { if (host && winId) host.win.close(winId); else window.close(); },
    /** Mark unsaved changes; the shell asks before closing a dirty window. */
    setDirty(dirty) { if (host && winId) host.win.setDirty(winId, !!dirty); },
    /**
     * What the window has open, for usage tracking (System Monitor's Usage): a file (its drive path) or a website (its
     * domain only, such as 'github.com'; never the page's address), or null when nothing is open. Without it, the
     * file the window was opened with counts.
     *   OS.win.setItem({ kind: 'file', name: path })  OS.win.setItem({ kind: 'site', name: 'github.com' })
     */
    setItem(item) { if (host && winId && host.win.setItem) host.win.setItem(winId, item || null); },
    /**
     * For apps whose manifest sets window.reportsReady: the window stays covered by the opening screen after the page
     * loads, until loaded() is called. Until then, loading(text, progress) shows what the app is doing under its icon
     * ("Reading the workbook", 0.45). Each call keeps the cover up another 15 seconds.
     */
    loading(text, progress) { if (host && winId && host.win.loading) host.win.loading(winId, text, progress); },
    loaded() { if (host && winId && host.win.loaded) host.win.loaded(winId); },
    /** Ask for another window size in pixels (kept from its top left; a maximised or snapped window stays). */
    resize(width, height) { if (host && winId && host.win.resize) host.win.resize(winId, width, height); },
    /** A single-window app opened again with arguments (a file): fn(args) gets them instead of the page reloading. */
    onArgs(fn) { if (host && winId && host.win.onArgs) host.win.onArgs(winId, fn); },
    /**
     * Menus shown in the top bar while this window is focused, merged with the
     * standard File / View / Window / Help menus:
     *   setMenus([{ label: 'File', items: [{ label: 'Save', key: 'Ctrl+S', icon: 'save', action }, 'sep', …] }])
     */
    setMenus(menus) { if (host && winId && host.win.setMenus) host.win.setMenus(winId, menus); },
    /**
     * The picture on this window's card in the taskbar previews, for apps that draw on a canvas: fn is called when
     * the cards open and returns a canvas, video or image (or a list of them, drawn one over the other, all the size
     * of the first), or null to let the shell show its own snapshot of the window. Keep it cheap: no drawing, just
     * hand over what is already on screen.
     *   LiteOS.win.preview(() => [bgCanvas, inkCanvas])
     */
    preview(fn) { win._preview = typeof fn === 'function' ? fn : null; },
    _preview: null,
    /**
     * Keep a little of the app's state across a reload of the desktop (or F5 in the app): fn returns something
     * JSON-able, at most 32 KB (the folder shown, a scroll position, the selected tab), which the next start of this
     * window reads from OS.win.restored. Called as the page goes, so keep it quick. Never put file contents in it:
     * save those to the drive.
     *   OS.win.keepState(() => ({ path: current, scroll: list.scrollTop }));
     */
    keepState(fn) { win._keep = typeof fn === 'function' ? fn : null; },
    _keep: null,
    /** What keepState handed over before this window was reloaded, or null (a fresh window). */
    get restored() {
      if (!('_restored' in win)) win._restored = host && winId && host.win.restored ? host.win.restored(winId) : null;
      return win._restored;
    },
    /** Width (px) of the shell's window buttons in a custom title bar (apps with chrome: 'custom'). */
    controlsWidth: host && winId ? 132 : 0,
    /**
     * Make `el` drag the window (custom title bars). `isHandle(target)` can restrict which
     * targets start a drag, e.g. only empty space. Double-click maximises / restores. A finger drags the window,
     * rather than the browser scrolling the page.
     */
    dragRegion(el, isHandle) {
      if (!host || !winId || !host.win.dragStart) return;
      const ok = (t) => !isHandle || isHandle(t);
      el.style.touchAction = 'none';
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

  /*
  |--------------------------------------------------------------------------
  | System volume
  |--------------------------------------------------------------------------
  |
  | The master volume (top bar / Quick settings) scales every <audio>/<video> in the app. An element can carry
  | data-app-volume="0..1" for its own level within that.
  |
  */
  function masterVolume(s) { return !s || s.muted ? 0 : (s.volume == null ? 80 : s.volume) / 100; }
  function applyVolume(el) {
    const v = masterVolume(current.settings);
    const own = el.dataset && el.dataset.appVolume != null ? Math.max(0, Math.min(1, +el.dataset.appVolume)) : 1;
    try { el.volume = Math.max(0, Math.min(1, v * own)); } catch (e) { /* ignore */ }
  }
  document.addEventListener('play', (e) => { if (e.target && 'volume' in e.target) applyVolume(e.target); }, true);
  const applyAllVolumes = () => document.querySelectorAll('audio, video').forEach(applyVolume);

  /*
  |--------------------------------------------------------------------------
  | Reload keys
  |--------------------------------------------------------------------------
  |
  | F5 and Ctrl+R inside an app reload that app (keeping what it hands to keepState), not the whole desktop. An app that
  | uses the keys itself (Files refreshes the folder) cancels the event and keeps them. Ctrl+F5 and Ctrl+Shift+R still
  | reload everything.
  |
  */
  if (host && winId && host.win.reload) {
    window.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.shiftKey || e.altKey) return;
      const f5 = e.key === 'F5' && !e.ctrlKey && !e.metaKey;
      const ctrlR = (e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R');
      if (!f5 && !ctrlR) return;
      e.preventDefault();
      host.win.reload(winId);
    });
  }

  /*
  |--------------------------------------------------------------------------
  | App switcher keys
  |--------------------------------------------------------------------------
  |
  | Alt+` / Alt+Tab pressed inside an app go to the shell's window switcher.
  |
  */
  if (host && host.switcher) {
    document.addEventListener('keydown', (e) => {
      if ((e.altKey && (e.key === 'Tab' || e.code === 'Backquote')) || (e.key === 'Escape' && host.switcher.open)) {
        if (host.switcher.key({ key: e.key, code: e.code, altKey: e.altKey, shiftKey: e.shiftKey, preventDefault: () => {} })) { e.preventDefault(); e.stopImmediatePropagation(); }
      }
    }, true);
    document.addEventListener('keyup', (e) => { if (e.key === 'Alt' && host.switcher.open) host.switcher.release(); }, true);
  }

  /*
  |--------------------------------------------------------------------------
  | Tasks
  |--------------------------------------------------------------------------
  |
  | The desktop asks every window now and then whether its page still answers (System Monitor's Not responding): the
  | answer goes back from here. Ctrl+Shift+` or Ctrl+Shift+Esc in an app opens System Monitor, as on the desktop.
  |
  | Input in the app counts as someone using the desktop (usage tracking stops after 5 minutes without any). The bytes
  | this window's page received (System Monitor › Performance › Network) are handed over every 2 seconds. Ctrl+Alt+S,
  | PrtSc, Alt+PrtSc and Shift+PrtSc in an app take a screenshot, as on the desktop.
  |
  */
  if (host) {
    window.addEventListener('message', (e) => {
      if (e.source === window.parent && e.data && e.data.los === 'ping') window.parent.postMessage({ los: 'pong' }, location.origin);
    });
    if (host.tasks && host.tasks.input) {
      let told = 0;
      const seen = () => { const now = Date.now(); if (now - told > 5000) { told = now; host.tasks.input(); } };
      ['pointerdown', 'keydown', 'wheel', 'pointermove'].forEach((t) => document.addEventListener(t, seen, { capture: true, passive: true }));
    }
    if (host.perf && typeof PerformanceObserver === 'function') {
      let got = 0;
      try {
        new PerformanceObserver((list) => { list.getEntries().forEach((e) => { got += e.transferSize || 0; }); }).observe({ type: 'resource', buffered: true });
        setInterval(() => { if (got) { host.perf.received(got); got = 0; } }, 2000);
      } catch (e) { /* not in this browser */ }
    }
    if (host.capture) {
      const prt = (e) => {
        const snip = e.ctrlKey && e.altKey && !e.shiftKey && (e.code === 'KeyS' || e.code === 'KeyR' || /^[sr]$/i.test(String(e.key)));
        if ((snip || e.key === 'PrintScreen' || e.code === 'PrintScreen') && host.capture.key({ type: e.type, key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey })) { e.preventDefault(); e.stopPropagation(); }
      };
      document.addEventListener('keydown', prt, true);
      document.addEventListener('keyup', prt, true);
    }
    if (host.tasks && host.tasks.openMonitor) {
      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'Escape' || e.code === 'Backquote' || e.key === '`' || e.key === '~')) { e.preventDefault(); host.tasks.openMonitor(); }
      }, true);
    }
  }
  const tasks = {
    /** The open windows: [{ id, app: { id, name, img }, title, dirty, min, max, focused, asleep, starting, responding, opened, rect }] */
    list: () => (host && host.tasks ? host.tasks.list() : []),
    /** What LiteOS keeps running in the background: [{ id, name, detail, since }] */
    services: () => (host && host.tasks ? host.tasks.services() : []),
    /** fn(list) whenever a window opens, closes, changes or stops answering. Returns a function that stops it. */
    watch: (fn) => (host && host.tasks ? host.tasks.subscribe(fn, winId) : () => {}),
    /** Bring a window to the front (restoring it when minimised). */
    focus: (id) => !!(host && host.tasks && host.tasks.focus(id)),
    /** Close a window as its close button does, asking about unsaved changes. -> Promise<boolean> */
    close: (id) => (host && host.tasks ? host.tasks.close(id) : Promise.resolve(false)),
    /** Close a window without asking. Ask the person first: unsaved changes are lost. -> Promise<boolean> */
    end: (id) => (host && host.tasks ? host.tasks.end(id) : Promise.resolve(false)),
  };

  /** Screenshots of the LiteOS screen (the desktop does the capturing: capture.js). */
  const capture = {
    /** Whether this browser, on this address, can capture the screen (it needs HTTPS). */
    supported: () => !!(host && host.capture && host.capture.supported()),
    /**
     * Take one. opts: { mode: 'region' | 'window' | 'screen' | 'active', delay: seconds }. This window is hidden
     * while it is taken; it is saved in /Pictures/Screenshots and copied. -> { path, width, height, copied } | null
     */
    take: (opts) => (host && host.capture ? host.capture.take(opts || {}, winId) : Promise.resolve(null)),
    /**
     * Record the screen. opts: { mode: 'region' | 'window' | 'screen' }. The area and the sound are chosen on the
     * desktop; this window is hidden until it stops. Asked again while one is under way, it stops it.
     */
    record: (opts) => (host && host.capture && host.capture.record ? host.capture.record(opts || {}, winId) : Promise.resolve(null)),
    /** Whether a recording is under way. */
    get recording() { return !!(host && host.capture && host.capture.recording); },
  };

  /** How the desktop's page is doing (System Monitor › Performance): the whole desktop, never one app. */
  const perf = {
    /** The last 5 minutes, every 2 seconds, oldest first: [{ t, mem, busy, lag, longest, tasks, rx, tx, fps }] */
    history: () => (host && host.perf ? host.perf.history() : []),
    /** { since, received, sent, memHigh } since the desktop started. */
    totals: () => (host && host.perf ? host.perf.totals() : null),
    /** fn(sample) every 2 seconds; the frame rate is counted only while something watches. Returns a function that stops it. */
    watch: (fn) => (host && host.perf ? host.perf.watch(fn, winId) : () => {}),
  };

  /*
  |--------------------------------------------------------------------------
  | Dialogs
  |--------------------------------------------------------------------------
  */
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

  /*
  |--------------------------------------------------------------------------
  | Settings / theme
  |--------------------------------------------------------------------------
  */
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
    host.subscribe(function onState(state) {
      current = state;
      applyTheme(state.settings);
      applyAllVolumes();
      listeners.forEach((fn) => { try { fn(state.settings, state); } catch (e) { console.error(e); } });
    }, winId);
  }

  /*
  |--------------------------------------------------------------------------
  | Popup menu helper
  |--------------------------------------------------------------------------
  */
  /**
   * Show a context menu at a MouseEvent or {x, y}. items: [{ label, icon, key, danger, disabled, checked, action }],
   * { label, icon, items: [...] } for a submenu, or 'sep' (see menu.js). opts: { onClose } (told once the menu goes,
   * e.g. to drop the pressed look of the button that opened it). Returns a function that closes it.
   */
  function menu(items, at, opts) { return window.LOS_menu.open(items, at, opts && typeof opts.onClose === 'function' ? { onClose: opts.onClose } : undefined); }
  function closeMenu() { window.LOS_menu.close(); }


  /**
   * Clicking anywhere inside an app brings its window to the front and closes shell menus (launcher etc.). pointerdown
   * too: an app that cancels pointerdown (a canvas editor) suppresses mousedown. A click in a frame inside the app (a
   * web page in the Browser) never reaches this document, but it moves focus into that frame: this window blurs while
   * its document still holds the focus. When focus leaves for another window, the shell isn't told: ask it to look.
   */
  const raise = () => { if (host && host.focusWindow && winId) host.focusWindow(winId); };
  document.addEventListener('pointerdown', raise, true);
  document.addEventListener('mousedown', raise, true);
  window.addEventListener('blur', () => setTimeout(() => {
    if (document.hasFocus()) raise();
    else if (host && host.focusChanged) host.focusChanged();
  }, 0));

  /*
  |--------------------------------------------------------------------------
  | The device (LiteLink)
  |--------------------------------------------------------------------------
  |
  | On a LiteLink thin client, LiteLink gives every LiteOS frame its own window.LiteLink: the device's USB drives,
  | sound, network, power, Bluetooth, printers… (docs/litelink-integration.md). OS.device wraps this frame's one.
  | Everywhere else api is null, ready gives null and has() is false, so device features stay off on an ordinary PC.
  |
  */
  const LL = typeof window.LiteLink === 'object' && window.LiteLink && window.LiteLink.version >= 1 ? window.LiteLink : null;
  let devCaps = null;
  const devReady = LL ? Promise.resolve(LL.ready).then((c) => { devCaps = c || null; return devCaps; }, () => null) : Promise.resolve(null);
  const device = Object.freeze({
    /** window.LiteLink, or null off a LiteLink device. Check has() (after ready) before using an area. */
    get api() { return LL; },
    /** Resolves to the capabilities ({ storage, audio, network, power, print, … }), or null; never rejects. */
    ready: devReady,
    /** True once the device answered. */
    get available() { return !!devCaps; },
    /** What the device and this connection allow ({} until ready). */
    get capabilities() { return devCaps || {}; },
    /** Whether an area ('storage', 'audio', 'network', 'power', 'session', 'bluetooth', 'print', …) can be used. */
    has(area) { return !!(devCaps && devCaps[area]); },
  });

  /*
  |--------------------------------------------------------------------------
  | Public API
  |--------------------------------------------------------------------------
  */
  const LiteOS = {
    device,
    inShell: !!host,
    args: Object.fromEntries(params.entries()),
    get user() { return current.user; },
    get settings() { return current.settings || {}; },
    get system() { return current.system || {}; },
    api,
    fs,
    win,
    tasks,
    perf,
    capture,
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
    /** The signed-in session: lock the screen, or sign out (the shell asks first about unsaved changes). */
    session: {
      lock() { if (host && host.lock) host.lock(); },
      signOut() { if (host && host.signOut) host.signOut(); },
    },
    /** Save user settings (partial). */
    saveSettings(changes) { return host ? host.saveSettings(changes) : api('settings.save', { settings: changes }); },
    onSettings(fn) { listeners.push(fn); },
    /**
     * Print a PDF (Blob, ArrayBuffer or bytes) with LiteOS's print dialog: on a LiteLink device that allows printing,
     * it lists the device's printers and sends it. opts: { title, copies, pages ('1-3,5') } (copies and pages are where
     * the dialog starts; the person can change them).
     * -> { job, printer } once sent, null if the person cancelled, or false when LiteOS can't print here: then print
     * the app's own way (window.print()), as before.
     */
    print(pdf, opts) { return host && host.print ? host.print.print(pdf, opts || {}, winId) : Promise.resolve(false); },
    /** Whether print() will show LiteOS's print dialog (a LiteLink device that allows printing). */
    canPrint() { return host && host.print ? host.print.available() : Promise.resolve(false); },
    /** The signed-in user's documents still waiting or printing: [{ job, printer, title, state, message }]. */
    printJobs() { return host && host.print ? host.print.jobs() : Promise.resolve([]); },
    /** Cancel one of them. */
    cancelPrintJob(job) { return host && host.print ? host.print.cancel(job) : Promise.reject(new Error('Printing isn’t available here.')); },
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
