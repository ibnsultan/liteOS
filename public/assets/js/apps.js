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
  window.LOS_endpoint = function (action) {
    const [area, verb] = String(action).split('.');
    return BASE + (area === 'auth' ? 'auth/' : 'os/' + area + '/') + verb;
  };

  /** App that opens a file by default (by extension), or null. */
  window.LOS_appForFile = function (name) {
    const ext = String(name).split('.').pop().toLowerCase();
    if (!String(name).includes('.')) return null;
    return window.LOS_APPS.find((a) => a.exts.includes(ext)) || null;
  };

  /** A file entry's icon from the system icon set: a folder, or the file type by extension. */
  window.LOS_fileRole = (entry) => (entry.type === 'dir' ? 'place.folder' : window.LOS_fileIcon(entry.name));
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
