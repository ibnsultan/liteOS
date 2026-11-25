/* LiteOS icon set: 24×24 stroke paths. LOS_icon(name, size) returns an <svg> string. */
(function () {
  const P = {
    folder: 'M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
    doc: 'M7 3h7l4 4v14H7z M14 3v4h4 M9.5 12h6 M9.5 16h6',
    sheet: 'M4 5h16v14H4z M4 10h16 M4 15h16 M10 5v14',
    slides: 'M3 5h18 M5 5v10h14V5 M12 15v4 M9 21l3-2 3 2',
    code: 'M9 8l-4 4 4 4 M15 8l4 4-4 4 M13.5 5.5l-3 13',
    media: 'M4 5h16v14H4z M10 9.5v5l4.5-2.5z',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z M3 12h18 M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9 M12 3c-2.5 2.5-3.8 5.5-3.8 9s1.3 6.5 3.8 9',
    pen: 'M14.5 5.5l4 4L9 19H5v-4z M12.5 7.5l4 4',
    note: 'M6 4h12v16H6z M9 8h6 M9 12h6 M9 16h3',
    settings: 'M4 7h10 M18 7h2 M4 17h4 M12 17h8 M16 5v4 M10 15v4',
    image: 'M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15.5 9h.01',
    video: 'M4 5h16v14H4z M10 9.5v5l4.5-2.5z',
    music: 'M9 18V6l10-2v12 M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
    pdf: 'M7 3h7l4 4v14H7z M14 3v4h4 M9 13h1.5a1.5 1.5 0 0 1 0 3H9v-5 M14 11v5',
    file: 'M7 3h7l4 4v14H7z M14 3v4h4',
    archive: 'M4 4h16v4H4z M5 8v12h14V8 M10 12h4',
    home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
    desktop: 'M3 5h18v11H3z M8 20h8 M12 16v4',
    download: 'M12 4v12 M7 11l5 5 5-5 M4 20h16',
    upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
    trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5',
    search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z M16 16l5 5',
    plus: 'M12 5v14 M5 12h14',
    minus: 'M5 12h14',
    x: 'M6 6l12 12 M18 6L6 18',
    check: 'M5 12l4 4 10-10',
    max: 'M5 5h14v14H5z',
    restore: 'M8 8h11v11H8z M5 16V5h11',
    back: 'M15 6l-6 6 6 6',
    forward: 'M9 6l6 6-6 6',
    up: 'M12 19V5 M6 11l6-6 6 6',
    down: 'M6 9l6 6 6-6',
    reload: 'M4 12a8 8 0 1 0 2.3-5.7 M4 4v4h4',
    list: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
    grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
    panel: 'M3 4h18v16H3z M15 4v16',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    moreV: 'M12 5h.01 M12 12h.01 M12 19h.01',
    cut: 'M6 6a2.5 2.5 0 1 0 0 .01z M6 18a2.5 2.5 0 1 0 0 .01z M8 7.5L20 18 M8 16.5L20 6',
    copy: 'M8 8h12v12H8z M16 8V4H4v12h4',
    paste: 'M8 4h8v3H8z M6 5H5v16h14V5h-1',
    rename: 'M4 20h4L19 9l-4-4L4 16z M13 7l4 4',
    share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.6 13.5l6.8 4 M15.4 6.5l-6.8 4',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    sunset: 'M3 19h18 M7 15a5 5 0 0 1 10 0 M12 5v3 M5.2 9.2l1.6 1.6 M18.8 9.2l-1.6 1.6 M2 15h2 M20 15h2',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3',
    keyboard: 'M3 6h18v12H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10',
    mouse: 'M12 3a6 6 0 0 0-6 6v6a6 6 0 0 0 12 0V9a6 6 0 0 0-6-6z M12 7v4',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    ear: 'M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0 M10 9a2 2 0 0 1 4 0',
    captions: 'M3 6h18v12H3z M10 10.5a2 2 0 1 0 0 3 M17 10.5a2 2 0 1 0 0 3',
    zoom: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z M16 16l5 5 M10.5 7.5v6 M7.5 10.5h6',
    caret: 'M8 4h2v16H8 M6 4h6 M6 20h6 M14 9h6 M14 15h4',
    glass: 'M4 9h11v11H4z M9 4h11v11 M9 4v5 M15 15h5',
    pin: 'M15 3.5l5.5 5.5-2.2.8-3.6 3.6.4 4.4-1.6 1.6-8-8 1.6-1.6 4.4.4 3.6-3.6z M9 15l-5 5',
    unpin: 'M15 3.5l5.5 5.5-2.2.8-3.6 3.6.4 4.4-1.6 1.6-8-8 1.6-1.6 4.4.4 3.6-3.6z M9 15l-5 5 M3 3l18 18',
    lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    power: 'M12 3v8 M7 6.5a7 7 0 1 0 10 0',
    logout: 'M10 4H5v16h5 M14 8l4 4-4 4 M18 12H9',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4 3.6-6 8-6s8 2 8 6',
    users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 19c0-3 2.7-5 6-5s6 2 6 5 M16 5.5a3 3 0 0 1 0 5.5 M18 14c2 .6 3 2.3 3 5',
    palette: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z M7.5 11h.01 M10 7h.01 M15 7h.01',
    taskbar: 'M3 4h18v16H3z M3 16h18 M7 18h.01',
    apps: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
    bell: 'M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7 M10 20a2 2 0 0 0 4 0',
    storage: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    shield: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z M9 12l2 2 4-4',
    access: 'M12 4.5h.01 M5 8l7 1.5L19 8 M12 9.5V14 M9 21l3-7 3 7',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v6 M12 7.5h.01',
    server: 'M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
    /* Quick settings tiles: one family, drawn for each other on the same 24 grid, outline only, same stroke and size */
    'qs-dark': 'M19.5 14.6A7.5 7.5 0 1 1 9.4 4.5a6 6 0 0 0 10.1 10.1z',
    'qs-night': 'M3.5 18.5h17 M7.5 18.5a4.5 4.5 0 0 1 9 0 M12 7.5v2.5 M6.7 10.7l1.5 1.5 M17.3 10.7l-1.5 1.5 M3.5 15h2 M18.5 15h2',
    'qs-focus': 'M6.5 16v-4.5a5.5 5.5 0 0 1 11 0V16l1.5 2h-14z M10 20.5a2 2 0 0 0 4 0',
    'qs-taskbar': 'M3.5 5h17v14h-17z M3.5 15.5h17 M7.5 17.25h.01 M10.5 17.25h.01 M13.5 17.25h.01',
    'qs-glass': 'M9.5 3.5h11v11h-11z M14.5 14.5v6h-11v-11h6',
    'qs-access': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7.25h.01 M7.5 9.5l4.5 1 4.5-1 M12 10.5V14 M9.75 17.5L12 14l2.25 3.5',
    'qs-bluetooth': 'M7 7.5l10 9-5 4.5V3l5 4.5-10 9',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
    contrast: 'M12 3a9 9 0 1 0 0 18z M12 3a9 9 0 0 1 0 18',
    volume: 'M4 9v6h4l5 4V5L8 9z M16.5 8.5a5 5 0 0 1 0 7',
    mute: 'M4 9v6h4l5 4V5L8 9z M17 9l5 6 M22 9l-5 6',
    play: 'M8 5v14l11-7z',
    pause: 'M6 5h4v14H6z M14 5h4v14h-4z',
    prev: 'M6 5h2v14H6z M20 5v14L9 12z',
    next: 'M16 5h2v14h-2z M4 5v14l11-7z',
    expand: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
    undo: 'M9 7L4 12l5 5 M4 12h11a5 5 0 0 1 0 10h-2',
    redo: 'M15 7l5 5-5 5 M20 12H9a5 5 0 0 0 0 10h2',
    bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7z M7 12h7a3.5 3.5 0 0 1 0 7H7z',
    italic: 'M10 5h8 M6 19h8 M14 5l-4 14',
    underline: 'M7 4v7a5 5 0 0 0 10 0V4 M5 20h14',
    strike: 'M5 12h14 M16 6.5C15 5 13.5 4.5 12 4.5c-2.5 0-4 1.3-4 3 0 4 8 2.5 8 7 0 2-1.8 3.5-4.5 3.5-1.8 0-3.5-.8-4.5-2',
    alignLeft: 'M4 6h16 M4 10h10 M4 14h16 M4 18h10',
    alignCenter: 'M4 6h16 M7 10h10 M4 14h16 M7 18h10',
    alignRight: 'M4 6h16 M10 10h10 M4 14h16 M10 18h10',
    ul: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
    ol: 'M10 6h10 M10 12h10 M10 18h10 M4 5l1.5-1V9 M4 15h3l-3 4h3',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    table: 'M4 5h16v14H4z M4 10h16 M4 15h16 M10 5v14',
    text: 'M5 5h14 M12 5v14 M9 19h6',
    square: 'M4 4h16v16H4z',
    circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    line: 'M5 19L19 5',
    arrow: 'M5 19L19 5 M10 5h9v9',
    eraser: 'M7 21h12 M5.5 14.5l7-7 5 5-7 7H8z M12.5 7.5l3-3 5 5-3 3',
    highlighter: 'M9 11l-5 5v4h4l5-5 M9 11l6-6 4 4-6 6z M15 5l4 4',
    pointer: 'M5 3l14 8-6 2-2 6z',
    fill: 'M5 13l7-7 6 6-7 7z M19 15c0 1.5 1 2.5 1 3.5a1 1 0 0 1-2 0c0-1 1-2 1-3.5z',
    sigma: 'M18 5H7l6 7-6 7h11',
    chart: 'M4 20h16 M7 16v-5 M12 16V7 M17 16v-8',
    'tb-taskmgr': 'M3.5 4.5h17v12h-17z M9 20h6 M12 16.5V20 M6 11h2.5l1.5-3 2.5 6 1.5-3h4',
    'tb-cog': 'M18.79 10.31L21.1 10.63L21.1 13.37L18.79 13.69L18 15.61L19.4 17.47L17.47 19.4L15.61 18L13.69 18.79L13.37 21.1L10.63 21.1L10.31 18.79L8.39 18L6.53 19.4L4.6 17.47L6 15.61L5.21 13.69L2.9 13.37L2.9 10.63L5.21 10.31L6 8.39L4.6 6.53L6.53 4.6L8.39 6L10.31 5.21L10.63 2.9L13.37 2.9L13.69 5.21L15.61 6L17.47 4.6L19.4 6.53L18 8.39z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    filter: 'M4 5h16l-6 8v6l-4-2v-4z',
    external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
    home2: 'M3 11l9-8 9 8 M5 9v11h14V9',
    present: 'M7 4v16l13-8z',
    save: 'M5 4h11l3 3v13H5z M8 4v5h7V4 M8 20v-6h8v6',
    open: 'M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5V11 M3 17.5V8 M3 19l3-8h16l-3 8z',
    menu: 'M4 6h16 M4 12h16 M4 18h16',
    terminal: 'M4 5h16v14H4z M7 9l3 3-3 3 M12 15h5',
    calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
    region: 'M4 8V5h3 M10 5h4 M17 5h3v3 M20 11v2 M20 16v3h-3 M14 19h-4 M7 19H4v-3 M4 13v-2',
    window: 'M4 5h16v14H4z M4 9h16',
    screen: 'M3 5h18v11H3z M8 20h8 M12 16v4',
    crop: 'M7 3v14h14 M3 7h14v14',
    record: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    micOff: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3 M4 4l16 16',
    stop: 'M7 7h10v10H7z',
    pixelate: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
    camera: 'M4 8h3.5l1.5-2.5h6L16.5 8H20v11H4z M12 10.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    camcorder: 'M3 7h12v10H3z M15 10.5L21 7v10l-6-3.5',
    timerOff: 'M7.5 5.2A8 8 0 0 1 18.8 16.5 M16.6 18.8A8 8 0 0 1 5.2 7.4 M12 8v3 M10 2.5h4 M4 4l16 16',
    shuffle: 'M4 7h3c3 0 4 10 8 10h5 M4 17h3c1.5 0 2.5-2 3.5-4 M14 7h6 M17 4l3 3-3 3 M17 14l3 3-3 3',
    repeat: 'M4 12V9a3 3 0 0 1 3-3h12 M16 3l3 3-3 3 M20 12v3a3 3 0 0 1-3 3H5 M8 21l-3-3 3-3',
    heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
    zoomIn: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z M16 16l5 5 M10.5 7.5v6 M7.5 10.5h6',
    zoomOut: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z M16 16l5 5 M7.5 10.5h6',
    rotate: 'M20 12a8 8 0 1 1-2.3-5.7 M20 4v4h-4',
  };
  window.LOS_ICON_PATHS = P;
  window.LOS_icon = function (name, size, cls) {
    const d = P[name] || P.file;
    const s = size || 16;
    return '<svg class="ico ' + (cls || '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"></path></svg>';
  };
})();

/* LiteOS system icons: every icon the OS itself shows (app icons, Settings, the shell, places, file types, the tray)
   comes from the icon set in /icons/liteos, by role, through its map.json (App\Support\SystemIcons hands the resolved
   table over as LOS_CONFIG.systemIcons). Each theme has its own folder, so the file follows <html data-theme>:
   - LOS_sysIcon(role, { theme, symbolic }) is the icon's URL ("app.sheets", "place.downloads", "mime.xlsx");
   - LOS_fileIcon(name) is the role for a file name, by extension;
   - LOS_sysIconImg(role, size, { symbolic, cls, alt }) is an <img> that swaps to the other theme's file by itself.
   An unknown role gets the fallback icon; a role with no symbolic variant, the full-colour one. In-app toolbar icons
   are not system icons and keep using LOS_icon above. */
(function () {
  const cfg = () => (window.LOS_CONFIG && window.LOS_CONFIG.systemIcons) || { base: '/icons/liteos/', icons: {}, symbolic: {}, extensions: {}, fallback: 'mime.generic' };
  const theme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  function url(role, opts) {
    const c = cfg(), o = opts || {};
    const rel = (o.symbolic && c.symbolic[role]) || c.icons[role] || c.icons[c.fallback] || '';
    return c.base + (o.theme === 'dark' || o.theme === 'light' ? o.theme : theme()) + '/' + rel + '.svg';
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  window.LOS_sysIcon = url;
  window.LOS_hasSysIcon = (role) => !!cfg().icons[role];
  window.LOS_fileIcon = function (name) {
    const c = cfg(), m = /\.([^./]+)$/.exec(String(name || ''));
    return (m && c.extensions[m[1].toLowerCase()]) || c.fallback;
  };
  window.LOS_sysIconImg = function (role, size, opts) {
    const o = opts || {}, s = size || 16;
    return '<img class="sysico ' + esc(o.cls || '') + '" data-los-icon="' + esc(role) + '"' + (o.symbolic ? ' data-los-symbolic=""' : '') +
      ' src="' + esc(url(role, o)) + '" width="' + s + '" height="' + s + '" alt="' + esc(o.alt || '') + '" draggable="false">';
  };
  /* The shell's glyph names (LOS_icon) that stand for something the icon set has. LOS_sysGlyph draws those from the
     set and anything else (arrows and chevrons, checks, more) as the glyph, so system menus and buttons can keep their names. */
  const GLYPH_ROLES = {
    power: 'shell.shutdown', logout: 'shell.logout', lock: 'shell.lock', search: 'shell.search', bell: 'shell.notifications',
    trash: 'shell.trash', apps: 'shell.launcher', settings: 'app.settings', user: 'settings.user', users: 'settings.accounts',
    palette: 'settings.personalisation', taskbar: 'settings.taskbar', storage: 'settings.storage', access: 'settings.accessibility',
    server: 'settings.system', info: 'action.properties', folder: 'place.folder', open: 'place.folder-open', home: 'place.home',
    desktop: 'place.desktop', clock: 'place.recent', doc: 'mime.document', sheet: 'mime.spreadsheet', slides: 'mime.presentation',
    image: 'mime.image', video: 'mime.video', music: 'mime.audio', pdf: 'mime.pdf', archive: 'mime.archive', file: 'mime.text',
    note: 'app.notes', globe: 'app.browser', code: 'app.code', media: 'app.media', pen: 'app.board', star: 'status.starred',
    copy: 'action.copy', cut: 'action.cut', paste: 'action.paste', rename: 'action.rename', download: 'action.download',
    upload: 'action.upload', save: 'action.save', reload: 'action.refresh', rotate: 'action.rotate', plus: 'action.add', minus: 'action.remove', x: 'action.delete', grid: 'action.view-grid',
    list: 'action.view-list', share: 'action.share', undo: 'action.undo', redo: 'action.redo', zoomIn: 'action.zoom-in', zoomOut: 'action.zoom-out',
  };
  window.LOS_GLYPH_ROLES = GLYPH_ROLES;
  /** A system icon for a glyph name (or a role): the set's file as an <img class="ico sysico">, or the glyph when the set has none. */
  window.LOS_sysGlyph = function (name, size, cls) {
    const role = cfg().icons[name] ? name : GLYPH_ROLES[name];
    if (!role || !cfg().icons[role]) return window.LOS_icon(name, size, cls);
    const s = size || 16;
    return '<img class="ico sysico ' + esc(cls || '') + '" src="' + esc(url(role)) + '" width="' + s + '" height="' + s + '" alt="" draggable="false">';
  };
  /** When the theme changes, every icon from the set on the page follows: its file moves to the other theme's folder. */
  function refresh() {
    const c = cfg(), now = theme(), other = now === 'dark' ? 'light' : 'dark';
    const from = c.base + other + '/', to = c.base + now + '/';
    document.querySelectorAll('img[data-los-icon]').forEach((img) => {
      const next = url(img.dataset.losIcon, { symbolic: img.hasAttribute('data-los-symbolic') });
      if (img.getAttribute('src') !== next) img.setAttribute('src', next);
    });
    document.querySelectorAll('img[src^="' + from + '"]').forEach((img) => img.setAttribute('src', to + img.getAttribute('src').slice(from.length)));
  }
  window.LOS_refreshSysIcons = refresh;
  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
