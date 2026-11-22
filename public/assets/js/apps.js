/* LiteOS registry: shared by the shell and the apps.
 *
 * Everything here comes from window.LOS_CONFIG, which the server prints into every page before this script
 * (resources/views/partials/config.blade.php, App\Support\ClientConfig): the apps (from their manifest.json files),
 * file-type groups, wallpapers and accent colours. The globals below are the ones the shell and apps have always used.
 */
(function () {
  const CFG = window.LOS_CONFIG;
  if (!CFG) throw new Error('LiteOS: LOS_CONFIG is missing; load this page through LiteOS.');

  // URL of the LiteOS root (ends with "/"), the same in the desktop and inside app windows.
  const BASE = CFG.base;
  window.LOS_BASE = BASE;

  // ------------------------------------------------------------------ each account's browser storage
  // localStorage belongs to the browser, not to an account, so on a shared device (a guest after a user, one user
  // after another) every app would see what the last account kept there: recent files, query history, a personal
  // dictionary, alarms. Here every page signed in as an account gets a localStorage that keeps that account's keys
  // apart ("los@<username>:<key>"), with the same API (getItem, setItem, removeItem, key, length, clear, and
  // storage[key]); clear() empties only that account's. Keys kept before accounts were kept apart belong to nobody:
  // the first account that isn't the guest to sign in takes them over, and the guest never sees them. The sign-in
  // screen's own (los_auth_*, auth.js) belong to the device and stay where they are. This keeps the
  // apps' data apart; it can't stop someone with the browser's developer tools on the device itself.
  (function scopeStorage() {
    if (!CFG.account) return;
    let real;
    try { real = window.localStorage; if (!real) return; } catch (e) { return; } // storage blocked: nothing to keep apart
    const NS = 'los@';
    const prefix = NS + CFG.account + ':';
    const own = () => { const out = []; for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length)); } return out; };
    try {
      if (!CFG.guest && !real.getItem(NS + 'adopted')) {
        const legacy = [];
        for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k && !k.startsWith(NS) && !k.startsWith('los_auth_')) legacy.push(k); }
        legacy.forEach((k) => { if (real.getItem(prefix + k) == null) real.setItem(prefix + k, real.getItem(k)); real.removeItem(k); });
        real.setItem(NS + 'adopted', '1');
      }
    } catch (e) { /* full or blocked: start empty */ }
    const api = {
      getItem: (k) => real.getItem(prefix + String(k)),
      setItem: (k, v) => real.setItem(prefix + String(k), String(v)),
      removeItem: (k) => real.removeItem(prefix + String(k)),
      key: (i) => own()[i] == null ? null : own()[i],
      clear: () => own().forEach((k) => real.removeItem(prefix + k)),
    };
    const scoped = new Proxy(api, {
      get: (t, p) => (p === 'length' ? own().length : typeof p === 'symbol' || p in t ? t[p] : t.getItem(p)),
      set: (t, p, v) => { if (typeof p !== 'symbol') t.setItem(p, v); return true; },
      deleteProperty: (t, p) => { if (typeof p !== 'symbol') t.removeItem(p); return true; },
      has: (t, p) => (typeof p === 'symbol' || p in t ? p in t : t.getItem(p) !== null),
      ownKeys: () => own(),
      getOwnPropertyDescriptor: (t, p) => (typeof p !== 'symbol' && !(p in t) && t.getItem(p) !== null ? { value: t.getItem(p), writable: true, enumerable: true, configurable: true } : undefined),
    });
    try { Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: () => scoped }); } catch (e) { /* left as it is */ }
  })();

  window.LOS_KINDS = CFG.kinds;
  const { image: IMG, video: VID, audio: AUD } = CFG.kinds;

  /*
   * id, name, icon (glyph), c (colours, top → bottom), img (icon URL), entry (the app's page),
   * exts: file extensions it opens (first match is the default app), size: default window size,
   * chrome: 'standard' | 'custom', single: only one window at a time, system: part of the OS.
   */
  window.LOS_APPS = CFG.apps;
  // an app LiteOS ships has its icon in the system icon set (role app.<id>), so img follows the theme; any other app
  // keeps the icon from its own package
  window.LOS_APPS.forEach((app) => {
    const own = app.img;
    Object.defineProperty(app, 'img', { enumerable: true, configurable: true, get: () => (app.role && window.LOS_hasSysIcon(app.role) ? window.LOS_sysIcon(app.role) : own) });
  });

  window.LOS_app = function (id) {
    return window.LOS_APPS.find((a) => a.id === id) || null;
  };

  /** Icon URL for an app, or for 'trash' / 'launcher' (from the system icon set). */
  window.LOS_appIconUrl = function (id) {
    const app = window.LOS_app(id);
    if (app) return app.img;
    return id === 'trash' || id === 'launcher' ? window.LOS_sysIcon('shell.' + id) : '';
  };

  /**
   * URL of an API action: 'auth.login' → /auth/login, everything else 'a.b' → /os/a/b.
   * Reads are GET (parameters in the query string), changes are POST.
   */
  // For the Guest account the drive, the Trash and the desktop settings are kept in this browser: those actions go to
  // os/guestfs/..., which the guest drive's service worker answers (public/guest-sw.js), never the server.
  const GUEST_AREAS = { fs: true, trash: true, settings: true };
  window.LOS_endpoint = function (action) {
    const [area, verb] = String(action).split('.');
    if (area === 'auth') return BASE + 'auth/' + verb;
    return BASE + 'os/' + (CFG.guest && GUEST_AREAS[area] ? 'guestfs/' : '') + area + '/' + verb;
  };

  /** App that opens a file by default (by extension), or null. */
  window.LOS_appForFile = function (name) {
    const ext = String(name).split('.').pop().toLowerCase();
    if (!String(name).includes('.')) return null;
    return window.LOS_APPS.find((a) => a.exts.includes(ext)) || null;
  };

  /**
   * Whether a folder or file gets an "Open with Code" item in Files and on the desktop: every folder, and text or code
   * files that open in another app by default (a file Code already opens needs no second item next to Open).
   */
  window.LOS_opensWithCode = function (name, isDir) {
    const code = window.LOS_app('code');
    if (!code) return false;
    if (isDir) return true;
    const n = String(name);
    if (!n.includes('.')) return false;
    const ext = n.split('.').pop().toLowerCase();
    const textual = code.exts.concat((window.LOS_KINDS && window.LOS_KINDS.text) || [], ['svg', 'csv', 'tsv']);
    const def = window.LOS_appForFile(n);
    return textual.includes(ext) && !(def && def.id === 'code');
  };

  /** A file entry's icon from the system icon set: a folder, or the file type by extension. */
  // the drive's own top-level folders have their own pictures, as in Explorer
  const SPECIAL_DIRS = { '/Desktop': 'place.desktop', '/Documents': 'place.documents', '/Downloads': 'place.downloads', '/Pictures': 'place.pictures', '/Music': 'place.music', '/Videos': 'place.videos' };
  window.LOS_fileRole = (entry) => (entry.type === 'dir' ? (SPECIAL_DIRS[entry.path] || 'place.folder') : window.LOS_fileIcon(entry.name));
  /** A file entry's icon as an <img class="tile filetile">, size × size. */
  window.LOS_fileTile = function (entry, size, cls) {
    return '<img class="tile filetile ' + (cls || '') + '" src="' + window.LOS_sysIcon(window.LOS_fileRole(entry)) + '" width="' + size + '" height="' + size + '" alt="" draggable="false">';
  };

  /** Glyph name + colours for a file entry (older look; file icons now come from LOS_fileTile). */
  window.LOS_fileLook = function (entry) {
    if (entry.type === 'dir') return { icon: 'folder', c: ['#F6BE55', '#DC8B16'] };
    const ext = (entry.ext || String(entry.name).split('.').pop() || '').toLowerCase();
    if (IMG.includes(ext)) return { icon: 'image', c: ['#F0679A', '#C9306B'] };
    if (VID.includes(ext)) return { icon: 'video', c: ['#9A7FEA', '#6B4CCB'] };
    if (AUD.includes(ext)) return { icon: 'music', c: ['#2BB3A3', '#0F7A6E'] };
    if (ext === 'pdf') return { icon: 'pdf', c: ['#F07176', '#D63B41'] };
    if (ext === 'zip' || ext === 'rar' || ext === '7z' || ext === 'gz') return { icon: 'archive', c: ['#8C929C', '#5A606B'] };
    const app = window.LOS_appForFile(entry.name);
    if (app) return { icon: app.icon, c: app.c };
    return { icon: 'file', c: ['#A3ACBA', '#6B717C'] };
  };

  // { id, name, css } for each built-in wallpaper (config/liteos.php)
  window.LOS_WALLPAPERS = CFG.wallpapers;

  // [name, hex] accent colours for Settings and first-run setup
  window.LOS_ACCENTS = CFG.accents;
})();
