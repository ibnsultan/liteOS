/*
 * LiteOS PDF Viewer: reading PDFs with pdf.js (Mozilla, Apache-2.0), vendored in public/assets/vendor/pdfjs-<version>/
 * by `npm run vendor` and loaded with import() the first time a PDF opens.
 *
 * A PDF on the drive is read by its raw URL, which the server answers in byte ranges, so pdf.js fetches only what the
 * pages on screen need. pdf.js's own viewer component (PDFViewer) draws the pages near the screen with their text
 * layer, finds text and follows links; this file is the window around it: the toolbar, the side pane (thumbnails and
 * outline), the find bar, zoom, printing, the start screen with the recent list, and the password dialog.
 *
 * JavaScript inside PDFs never runs (no scripting manager); links to the web ask first and open in Browser.
 * What it keeps (the recent list, each file's last page and zoom) is in /.apps/pdf/state.json.
 */
LiteOS.ready((OS) => {
  'use strict';

  const U = OS.util;
  const esc = U.escape;
  const $ = (s, el) => (el || document).querySelector(s);
  const PDFJS = window.LOS_BASE + 'assets/vendor/pdfjs-6.5.438/';
  // where links to other files on the drive point (an address that is never fetched: clicks on it are caught)
  const DRIVE_BASE = location.origin + '/__drive__';
  const STATE_DIR = '/.apps/pdf';
  const STATE_FILE = STATE_DIR + '/state.json';
  const MAX_RECENT = 30;
  const ZOOMS = [0.25, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  if (OS.inShell) document.documentElement.classList.add('in-shell');

  // ------------------------------------------------------------------ glyphs (in-app toolbar icons, LiteOS's line style)
  const P = window.LOS_ICON_PATHS || {};
  Object.assign(P, {
    'pv-side': 'M4 4h16v16H4z M9 4v16',
    'pv-minus': 'M5 12h14',
    'pv-plus': 'M5 12h14 M12 5v14',
    'pv-fitw': 'M3 12h18 M7 8l-4 4 4 4 M17 8l4 4-4 4',
    'pv-fitp': 'M6 3h12v18H6z M9 9l3-3 3 3 M9 15l3 3 3-3',
    'pv-rotate': 'M20 12a8 8 0 1 1-2.3-5.7 M20 4v4h-4',
    'pv-find': 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z M16 16l5 5',
    'pv-print': 'M7 8V3h10v5 M7 17H4v-7h16v7h-3 M7 14h10v7H7z',
    'pv-up': 'M6 15l6-6 6 6',
    'pv-down': 'M6 9l6 6 6-6',
    'pv-right': 'M9 6l6 6-6 6',
    'pv-x': 'M6 6l12 12 M18 6L6 18',
    'pv-open': 'M3 7h6l2 2h10v10H3z',
    'pv-back': 'M15 18l-6-6 6-6',
    'pv-hl': 'M5 19h5 M14.5 5.5l4 4L10 18H6v-4z',
    'pv-ink': 'M3 17c3-6 5 2 8-3s5-6 7-1 M18 13l3 3',
    'pv-text': 'M5 6V4h14v2 M12 4v16 M9 20h6',
    'pv-image': 'M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4 M15.5 8.5h.01',
    'pv-sign': 'M3 18c2-5 4-9 6-9s-1 8 1 8 3-4 4-4 1 3 3 3 2-1 4-1 M3 21h18',
    'pv-undo': 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
    'pv-redo': 'M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3',
    'pv-drop': 'M6 9l6 6 6-6',
    'pv-combine': 'M8 3H4v18h4 M16 3h4v18h-4 M12 8v8 M8 12h8',
    'pv-fill': 'M4 4h16v16H4z M8 9h8 M8 13h5 M14 17l2 2 4-4',
    'pv-home': 'M4 11l8-7 8 7 M6 9.5V20h12V9.5 M10 20v-6h4v6',
    'pv-scan': 'M4 8V5a1 1 0 0 1 1-1h3 M16 4h3a1 1 0 0 1 1 1v3 M20 16v3a1 1 0 0 1-1 1h-3 M8 20H5a1 1 0 0 1-1-1v-3 M4 12h16',
    'pv-cut': 'M12 4v16 M8 8l-4 4 4 4 M16 8l4 4-4 4',
    'pv-merge': 'M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3 M10 8h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1z',
    'pv-clock': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
    'pv-star': 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
    'pv-desktop': 'M3 4h18v12H3z M8 20h8 M12 16v4',
    'pv-folder': 'M3 7h6l2 2h10v10H3z',
    'pv-download': 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
    'pv-menu': 'M4 7h16 M4 12h16 M4 17h16',
    'pv-drive': 'M5.5 5h13l2.5 8v6H3v-6z M3 13h18 M16.5 16h1.5',
    'pv-usb': 'M7.5 10h9v11h-9z M9.5 3h5v7h-5z M11 5.5v1.5 M13 5.5v1.5',
    'pv-upload': 'M12 16V5 M7 10l5-5 5 5 M5 20h14',
    'pv-grid': 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
    'pv-list': 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
    'pv-newpdf': 'M6 3h8l4 4v14H6z M14 3v4h4 M12 11v6 M9 14h6',
    'pv-organize': 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
    'pv-rotl': 'M4 12a8 8 0 1 0 2.3-5.7 M4 4v4h4',
    'pv-extract': 'M7 3h7l4 4v8 M14 3v4h4 M5 21V9 M2 18l3 3 3-3',
    'pv-split': 'M4 4h7v16H4z M13 4h7v16h-7z',
    'pv-blank': 'M6 3h8l4 4v14H6z M14 3v4h4',
    'pv-pictures': 'M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4',
    'pv-more': 'M5 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z M12 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z M19 10.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z',
    'pv-fwd': 'M9 6l6 6-6 6',
    'pv-layout': 'M3 5h8v14H3z M13 5h8v14h-8z',
    'pv-present': 'M3 4h18v12H3z M8 20h8 M12 16v4 M10 8.5v4l3.5-2z',
    'pv-clip': 'M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7.1',
    'pv-eye': 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    'pv-eyeoff': 'M3 3l18 18 M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4 M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  });
  const ico = (n, s) => OS.icon(n, s || 17);
  document.querySelectorAll('.pv-tb[data-act]').forEach((b) => {
    const map = { side: 'pv-side', back: 'pv-back', forward: 'pv-fwd', 'zoom-out': 'pv-minus', 'zoom-in': 'pv-plus', fit: 'pv-fitw', rotate: 'pv-rotate', layout: 'pv-layout', present: 'pv-present', organize: 'pv-organize', find: 'pv-find', print: 'pv-print', more: 'pv-more' };
    if (map[b.dataset.act]) b.innerHTML = ico(map[b.dataset.act]);
  });
  document.querySelectorAll('[data-ico]').forEach((el) => { el.outerHTML = ico(el.dataset.ico); });
  $('#undoBtn').innerHTML = ico('pv-undo');
  $('#redoBtn').innerHTML = ico('pv-redo');
  $('#toolOpts').innerHTML = ico('pv-drop', 14);
  $('#zoomBtn').insertAdjacentHTML('beforeend', OS.icon('down', 12));
  $('#findIco').outerHTML = OS.icon('search', 14);
  $('[data-act="find-prev"]').innerHTML = ico('pv-up', 15);
  $('[data-act="find-next"]').innerHTML = ico('pv-down', 15);
  $('[data-act="find-close"]').innerHTML = ico('pv-x', 14);

  // ------------------------------------------------------------------ title bar (chrome: custom)
  (function titleBar() {
    const img = OS.sysIcon ? OS.sysIcon('app.pdf') : null;
    $('#tbIcon').innerHTML = img ? '<img src="' + esc(img) + '" alt="" width="16" height="16" draggable="false">' : ico('pv-side', 16);
    $('#tbControls').style.width = (OS.win.controlsWidth || 0) + 'px';
    OS.win.dragRegion($('#titlebar'), (t) => !t.closest('button, input'));
  })();
  function setTitle(name) {
    $('#tbName').textContent = name || 'PDF Viewer';
    OS.win.setTitle(name || 'PDF Viewer');
  }

  // ------------------------------------------------------------------ state on the drive
  const store = { recent: [], files: {}, signatures: [], starred: [], home: { view: 'grid', sort: 'opened' } };
  async function loadStore() {
    try {
      const r = await OS.fs.read(STATE_FILE, { track: false });
      const s = JSON.parse(String(r.content || '{}'));
      if (Array.isArray(s.recent)) store.recent = s.recent.slice(0, MAX_RECENT);
      if (s.files && typeof s.files === 'object') store.files = s.files;
      if (Array.isArray(s.signatures)) store.signatures = s.signatures;
      if (Array.isArray(s.starred)) store.starred = s.starred;
      if (s.home && typeof s.home === 'object') store.home = Object.assign(store.home, s.home);
    } catch (e) { /* first start */ }
  }
  let saving = Promise.resolve();
  function saveStore() {
    // only the files still in the recent list keep their place
    const keep = new Set(store.recent.map((r) => r.path));
    Object.keys(store.files).forEach((k) => { if (!keep.has(k)) delete store.files[k]; });
    const text = JSON.stringify(store);
    saving = saving.then(async () => {
      try { await OS.fs.write(STATE_FILE, text); } catch (e) {
        try { await OS.fs.mkdir('/.apps'); } catch (e2) { /* there */ }
        try { await OS.fs.mkdir(STATE_DIR); } catch (e2) { /* there */ }
        try { await OS.fs.write(STATE_FILE, text); } catch (e3) { console.warn('PDF Viewer: could not keep its state', e3); }
      }
    });
  }
  const saveStoreSoon = U.debounce(saveStore, 1500);

  // ------------------------------------------------------------------ pdf.js
  let lib = null; // pdfjsLib
  let ui = null; // pdf_viewer's exports
  async function loadPdfJs() {
    if (lib) return;
    lib = await import(PDFJS + 'pdf.min.js');
    globalThis.pdfjsLib = lib; // the viewer component reads it from there
    lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    ui = await import(PDFJS + 'pdf_viewer.js');
  }

  const container = $('#viewerContainer');
  let eventBus = null;
  let linkService = null;
  let findController = null;
  let viewer = null;
  let doc = null; // PDFDocumentProxy
  let uiManager = null; // pdf.js's annotation editor manager, for this document
  let task = null; // the loading task
  let current = null; // { path, name, size } or { name, data } for a file dropped from this device

  async function ensureViewer() {
    await loadPdfJs();
    if (viewer) return;
    eventBus = new ui.EventBus();
    linkService = new ui.PDFLinkService({ eventBus, externalLinkTarget: ui.LinkTarget.BLANK });
    findController = new ui.PDFFindController({ eventBus, linkService });
    viewer = new ui.PDFViewer({
      container,
      viewer: $('#viewer'),
      eventBus,
      linkService,
      findController,
      removePageBorders: true,
      textLayerMode: 1,
      annotationMode: lib.AnnotationMode.ENABLE_FORMS,
      imageResourcesPath: PDFJS + 'images/',
      // thin clients have about 2 GB: no page canvas over 16 megapixels (the viewer draws a sharper detail of the part
      // on screen when zoomed past that)
      maxCanvasPixels: 16777216,
      // marking up: pdf.js's annotation editor (highlight, ink, free text, pictures), saved into the file
      annotationEditorMode: lib.AnnotationEditorType.NONE,
      annotationEditorHighlightColors: HIGHLIGHTS.map(([n, c]) => n + '=' + c).join(','),
      enableHighlightFloatingButton: false,
    });
    eventBus.on('annotationeditoruimanager', (e) => { uiManager = e.uiManager; });
    eventBus.on('editingstateschanged', (e) => editStates(e.details));
    eventBus.on('annotationeditormodechanged', (e) => markTool(e.mode));
    linkService.setViewer(viewer);
    // jumps by links and the outline go into the back and forward history
    const goDest = linkService.goToDestination.bind(linkService);
    linkService.goToDestination = (dest) => { pushHistory(); return goDest(dest); };
    const goPage = linkService.goToPage.bind(linkService);
    linkService.goToPage = (val) => { pushHistory(); return goPage(val); };
    eventBus.on('pagesinit', () => {
      const saved = current && current.path ? Object.assign({}, store.files[current.path]) : null;
      if (pendingPage && current && pendingPage.path === current.path && saved) saved.page = pendingPage.page;
      pendingPage = null;
      viewer.currentScaleValue = saved && saved.scale ? saved.scale : 'auto';
      if (saved && saved.page > 1 && saved.page <= doc.numPages) viewer.currentPageNumber = saved.page;
      if (saved && saved.rotation) viewer.pagesRotation = saved.rotation;
      if (saved && saved.scroll != null && saved.scroll !== ui.ScrollMode.PAGE) viewer.scrollMode = saved.scroll;
      if (saved && saved.spread != null) viewer.spreadMode = saved.spread;
      buildLayers(); // the viewer's layer settings exist from here
      showLoading(false);
    });
    eventBus.on('pagechanging', (e) => { pageChanged(e.pageNumber); });
    eventBus.on('scalechanging', (e) => { zoomChanged(e.scale, e.presetValue); });
    eventBus.on('rotationchanging', () => { remember(); });
    eventBus.on('updatefindmatchescount', (e) => findCount(e.matchesCount));
    eventBus.on('updatefindcontrolstate', (e) => { findCount(e.matchesCount, e.state); });
  }

  // ------------------------------------------------------------------ opening
  async function openPath(path) {
    closeAllPops();
    // the file's details and the PDF engine at the same time (each a request of its own)
    const [entry] = await Promise.all([OS.fs.stat(path).catch(() => null), ensureViewer().catch(() => null)]);
    if (!entry) {
      dropRecent(path);
      if (!doc) backToStart(); // nothing open: the start screen, not an empty window
      OS.dialog.alert({ title: 'The PDF isn’t there', message: '“' + U.basename(path) + '” couldn’t be found. It may have been moved, renamed or deleted.' });
      return;
    }
    // Each request to LiteOS costs a few hundred milliseconds. Up to 16 MB, one streamed request (pdf.js draws as the
    // bytes arrive) beats several ranges; past that, only the ranges the pages on screen need are read, 1 MB at a time.
    const big = entry.size > 16 * 1048576;
    const file = { path, name: entry.name || U.basename(path), size: entry.size, mtime: entry.mtime };
    // a PDF on a USB stick (LiteLink device) is read from the stick whole, then handed to pdf.js
    if (OS.fs.isUsb(path)) {
      let data;
      try { data = new Uint8Array(await (await OS.fs.readBlob(path)).arrayBuffer()); } catch (e) {
        OS.dialog.alert({ title: 'The PDF couldn’t be opened', message: e.message });
        return;
      }
      await open(file, { data });
      return;
    }
    await open(file, {
      url: OS.fs.rawUrl(path),
      disableRange: !big,
      disableStream: big,
      disableAutoFetch: big,
      rangeChunkSize: 1048576,
    });
  }
  async function openData(name, buffer) {
    await open({ name, data: true, size: buffer.byteLength }, { data: new Uint8Array(buffer) });
  }

  async function open(file, source) {
    if (!(await keepOrDiscard())) return;
    showReader();
    showLoading(true, 'Opening ' + file.name);
    try { await ensureViewer(); } catch (e) {
      console.error(e);
      showLoading(false);
      OS.dialog.alert({ title: 'PDF Viewer couldn’t start', message: 'Its PDF engine didn’t load. Check that LiteOS has been set up with npm run vendor.' });
      return;
    }
    await closeDoc();
    current = file;
    setTitle(file.name);
    if (OS.win.setItem) OS.win.setItem(file.path ? { kind: 'file', name: file.path } : null);
    task = lib.getDocument(Object.assign({
      cMapUrl: PDFJS + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: PDFJS + 'standard_fonts/',
      wasmUrl: PDFJS + 'wasm/',
      iccUrl: PDFJS + 'iccs/',
      enableXfa: false,
      // links to other files ("report.pdf", "../data.xlsx") resolve against the PDF's folder on the drive
      docBaseUrl: file.path ? DRIVE_BASE + U.dirname(file.path).split('/').map(encodeURIComponent).join('/').replace(/\/?$/, '/') : undefined,
    }, source));
    let wrong = false;
    task.onPassword = async (setPassword, reason) => {
      showLoading(false);
      wrong = wrong || reason === lib.PasswordResponses.INCORRECT_PASSWORD;
      const pw = await passwordDialog(file.name, reason === lib.PasswordResponses.INCORRECT_PASSWORD);
      if (pw == null) { task.destroy(); return; }
      showLoading(true, 'Opening ' + file.name);
      setPassword(pw);
    };
    task.onProgress = ({ loaded, total }) => { if (total) showLoading(true, 'Opening ' + file.name + ' · ' + Math.round((100 * loaded) / total) + '%'); };
    try {
      doc = await task.promise;
    } catch (e) {
      showLoading(false);
      if (e && e.name === 'PasswordException') { backToStart(); return; }
      if (!task || task.destroyed) { backToStart(); return; }
      console.error(e);
      const damaged = e && e.name === 'InvalidPDFException';
      await OS.dialog.alert({ title: damaged ? '“' + file.name + '” isn’t a PDF PDF Viewer can read' : 'Couldn’t open “' + file.name + '”', message: damaged ? 'The file may be damaged, or not be a PDF.' : (e && e.message) || 'Something went wrong while reading it.' });
      backToStart();
      return;
    }
    await storeReady; // where this file was left
    setDirty(false);
    doc.annotationStorage.onSetModified = () => { checkDirty(); notesSoon(); };
    doc.annotationStorage.onResetModified = () => setDirty(false);
    doc.annotationStorage.onAnnotationEditor = () => notesSoon();
    viewer.setDocument(doc);
    linkService.setDocument(doc, null);
    $('#pageCount').textContent = 'of ' + doc.numPages;
    $('#pageNo').value = '1';
    buildThumbs();
    buildOutline();
    buildAttachments();
    applyPermissions();
    hist.back = []; hist.fwd = []; histButtons();
    labels = null;
    doc.getPageLabels().then((l) => { if (l && l.some((x, i) => x && x !== String(i + 1))) { labels = l; viewer.setPageLabels(l); pageChanged(viewer.currentPageNumber); } }).catch(() => {});
    if (file.path && !OS.fs.isUsb(file.path)) addRecent(file.path, file.name, doc.numPages, file.mtime); // a stick may not be there next time
    renderNotes();
    if (pendingTool) { const t = pendingTool; pendingTool = null; setTimeout(() => startTool(t), 400); }
    if (findOpen) runFind('');
  }
  async function closeDoc() {
    if (task) { try { await task.destroy(); } catch (e) { /* gone */ } }
    task = null;
    doc = null;
    if (viewer) { viewer.setDocument(null); linkService.setDocument(null); }
    thumbsObserver.disconnect();
    $('#thumbs').innerHTML = '';
    $('#outline').innerHTML = '';
  }

  // ------------------------------------------------------------------ screens
  function showReader() {
    document.body.classList.remove('pv-home-on');
    $('#start').hidden = true;
    $('#toolbar').hidden = false;
    $('#body').hidden = false;
  }
  async function backToStart() {
    if (!(await keepOrDiscard())) return;
    await closeDoc();
    current = null;
    setTitle('');
    if (OS.win.setItem) OS.win.setItem(null);
    $('#toolbar').hidden = true;
    $('#body').hidden = true;
    renderStart();
    document.body.classList.add('pv-home-on');
    $('#start').hidden = false;
  }
  function showLoading(on, text) {
    $('#loading').hidden = !on;
    if (text) $('#loadingText').textContent = text;
  }

  // ------------------------------------------------------------------ the home screen
  // A side bar (Home, Recent, Starred, and the places PDFs are), a search of the drive's PDFs, New PDF and Open file
  // along the top; Home has a greeting and a drop target, the tools, then the recent PDFs as first-page previews
  // (or a list), sorted by when they were opened, name or folder, each with a star.
  const W = 'fill="#fff"';
  const SOFT = 'fill="#fff" fill-opacity=".45"';
  const LINE = 'fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  // each tool its own colour and a small two-tone picture of what it does, drawn on a 32-unit grid
  const TOOLS = [
    { id: 'combine', colour: '#7E57C2', name: 'Combine files', text: 'Put several PDFs and pictures into one',
      art: '<rect ' + SOFT + ' x="3" y="5" width="9" height="12" rx="1.5"/><rect ' + SOFT + ' x="3" y="19" width="9" height="9" rx="1.5"/><path ' + LINE + ' d="M13 11h3l3 5M13 23.5h3l3-5"/><rect ' + W + ' x="19" y="8" width="10" height="16" rx="1.5"/>' },
    { id: 'pictures', colour: '#2E9D57', name: 'Create from scans', text: 'Make a PDF from scanned pages or photos',
      art: '<rect ' + SOFT + ' x="3" y="7" width="15" height="12" rx="1.5"/><circle ' + W + ' cx="7.5" cy="11" r="1.6"/><path ' + W + ' d="M3 17l4.5-4 3.5 3 2.5-2 4.5 4v.5H3z"/><path ' + LINE + ' d="M11 22l3.5 3.5L18 22M14.5 25.5V20"/><path ' + W + ' d="M20 9h6l3 3v16H20z"/>' },
    { id: 'split', colour: '#0277BD', name: 'Split', text: 'Pull pages out into separate files',
      art: '<rect ' + W + ' x="3" y="6" width="11" height="20" rx="1.5"/><rect ' + SOFT + ' x="18" y="6" width="11" height="20" rx="1.5"/><path ' + LINE + ' d="M16 4v24" stroke-dasharray="2 3"/><path ' + LINE + ' d="M7 11h4M7 15h4M22 11h4M22 15h4"/>' },
    { id: 'organize', colour: '#00897B', name: 'Organise pages', text: 'Reorder, rotate, delete and extract',
      art: '<rect ' + W + ' x="4" y="4" width="10" height="11" rx="1.5"/><rect ' + SOFT + ' x="18" y="4" width="10" height="11" rx="1.5"/><rect ' + SOFT + ' x="4" y="18" width="10" height="11" rx="1.5"/><rect ' + W + ' x="17.5" y="18.5" width="11" height="10" rx="1.5" transform="rotate(12 23 23.5)"/>' },
    { id: 'sign', colour: '#3F51B5', name: 'Fill & sign', text: 'Fill in forms, add your signature',
      art: '<rect ' + SOFT + ' x="5" y="4" width="18" height="24" rx="2"/><path ' + LINE + ' d="M9 10h10M9 14h7"/><path ' + LINE + ' d="M7 23c2-4 3-5 4-5s0 4 1.5 4 2.5-3 3.5-3 1 2 3 2"/><path ' + W + ' d="M22.5 9.5l3 3-8 8-4 1 1-4z"/>' },
    { id: 'markup', colour: '#E8A100', name: 'Mark up', text: 'Highlight, draw and add text',
      art: '<rect ' + SOFT + ' x="4" y="20" width="18" height="6" rx="1.5"/><path ' + W + ' d="M19 4.5l6 6-9.5 9.5H10v-5.5z"/><path fill="#E8A100" d="M18.4 8.1l3.5 3.5-1.4 1.4-3.5-3.5z"/><path ' + LINE + ' d="M6 28h20"/>' },
    { id: 'print', colour: '#546E7A', name: 'Print', text: 'Choose a PDF and print it',
      art: '<path ' + SOFT + ' d="M9 4h14v7H9z"/><rect ' + W + ' x="4" y="10" width="24" height="12" rx="2.5"/><circle fill="#546E7A" cx="23.5" cy="14.5" r="1.3"/><rect ' + W + ' x="9" y="18" width="14" height="10" rx="1"/><path stroke="#546E7A" stroke-width="1.6" stroke-linecap="round" d="M12 22h8M12 25h5"/>' },
  ];
  const TOOL_GLYPH = { combine: 'pv-merge', pictures: 'pv-scan', split: 'pv-cut', organize: 'pv-organize', sign: 'pv-sign', markup: 'pv-hl', print: 'pv-print' };
  const PLACES = [['/Desktop', 'Desktop', 'pv-desktop'], ['/Documents', 'Documents', 'pv-folder'], ['/Downloads', 'Downloads', 'pv-download']];
  const home = { view: 'home', folder: null, query: '', results: null, navOpen: false };

  // the drives under Locations: My drive, then the USB drives of a LiteLink device (none elsewhere), kept up to date
  const USBX = window.LOS_usb || null;
  let myDrive = 'My drive';
  let usbDrives = [];
  const isUsbPath = (p) => /^usb:[^:]+:\//.test(p || '');
  function drives() {
    return [{ path: '/', label: myDrive, icon: 'pv-drive' }].concat(usbDrives.map((d) => ({ path: d.path || 'usb:' + d.id + ':/', label: d.name || 'USB drive', icon: 'pv-usb' })));
  }
  /** The place or drive a folder is in (the one with the longest matching path). */
  function rootOf(folder) {
    const all = PLACES.map(([path, label, icon]) => ({ path, label, icon })).concat(drives());
    const inside = (r) => folder === r.path || folder.startsWith(r.path.endsWith('/') ? r.path : r.path + '/');
    return all.filter(inside).sort((a, b) => b.path.length - a.path.length)[0] || { path: folder, label: U.basename(folder) || folder };
  }
  /** [{ label, path }] from the place or drive down to the folder. */
  function crumbs(folder) {
    const r = rootOf(folder);
    const out = [{ label: r.label, path: r.path }];
    let at = r.path.endsWith('/') ? r.path.slice(0, -1) : r.path;
    folder.slice(r.path.length).split('/').filter(Boolean).forEach((name) => { at += '/' + name; out.push({ label: name, path: at }); });
    return out;
  }
  function parentDir(p) {
    const m = /^(usb:[^:]+:)(\/.*)$/.exec(p || '');
    if (m) return m[1] + (U.dirname(m[2]) || '/');
    return U.dirname(p) || '/';
  }
  const whereOf = (path) => crumbs(parentDir(path)).map((c) => c.label).join(' › ');
  async function refreshDrives() {
    try { const mine = ((await OS.fs.drives()) || []).find((d) => d.path === '/'); if (mine && mine.name) myDrive = mine.name; } catch (e) { /* keep the name */ }
    try { usbDrives = USBX ? (await USBX.drives()) || [] : []; } catch (e) { usbDrives = []; }
    // a USB drive pulled out while it was open goes back to Home
    if (home.view === 'folder' && isUsbPath(home.folder) && !usbDrives.some((d) => home.folder.startsWith(d.path || 'usb:' + d.id + ':'))) { home.view = 'home'; home.folder = null; }
    if (document.querySelector('.pv-home-nav')) renderStart();
  }
  if (USBX && USBX.onChange) USBX.onChange(refreshDrives);
  refreshDrives();
  const isStarred = (path) => store.starred.includes(path);

  /** A file as the home lists it: from the recent list, or a PDF found in a folder or a search. */
  function fileItem(path, name, extra) {
    const r = store.recent.find((x) => x.path === path);
    const f = store.files[path] || {};
    return Object.assign({ path, name: name || (r && r.name) || U.basename(path), pages: r && r.pages, page: f.page || 1, when: r ? r.when : (extra && extra.mtime ? extra.mtime * 1000 : 0), thumb: r && r.thumb }, extra || {});
  }
  function sorted(items) {
    const by = store.home.sort;
    const list = items.slice();
    if (by === 'name') list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    else if (by === 'folder') list.sort((a, b) => U.dirname(a.path).localeCompare(U.dirname(b.path)) || a.name.localeCompare(b.name));
    else list.sort((a, b) => b.when - a.when);
    return list;
  }
  function thumbHtml(it) {
    const [file, ver] = String(it.thumb || '').split('?');
    return it.thumb
      ? '<img src="' + esc(OS.fs.rawUrl(THUMB_DIR + '/' + file) + (ver ? '&' + ver : '')) + '" alt="" loading="lazy" draggable="false" data-name="' + esc(it.name) + '">'
      : OS.fileTile({ name: it.name, type: 'file' }, 48);
  }
  function itemsHtml(items, withAdd) {
    const list = store.home.view === 'list';
    const rows = items.map((it) => {
      const where = whereOf(it.path);
      const star = isStarred(it.path);
      const sub = (it.pages ? (it.pages === 1 ? '1 page' : (it.page > 1 ? 'Page ' + it.page + ' of ' + it.pages : it.pages + ' pages')) : '') + (it.when ? (it.pages ? ' · ' : '') + U.formatDate(Math.round(it.when / 1000)) : '');
      const acts = '<span class="pv-file-acts"><button type="button" class="icon-btn pv-star' + (star ? ' on' : '') + '" data-star="' + esc(it.path) + '" aria-pressed="' + star + '" title="' + (star ? 'Remove the star' : 'Star') + '" aria-label="' + (star ? 'Remove the star from ' : 'Star ') + esc(it.name) + '">' + ico('pv-star', 15) + '</button>' +
        '<button type="button" class="icon-btn" data-filemenu="' + esc(it.path) + '" title="More" aria-label="More for ' + esc(it.name) + '">' + ico('pv-more', 15) + '</button></span>';
      if (list) {
        return '<div class="pv-row-file" role="listitem"><button type="button" class="pv-row-open" data-open="' + esc(it.path) + '" title="' + esc(it.path) + '">' +
          '<span class="pv-row-ico">' + OS.fileTile({ name: it.name, type: 'file' }, 28) + '</span>' +
          '<span class="pv-row-name">' + esc(it.name) + '</span><span class="pv-row-where">' + esc(where) + '</span><span class="pv-row-sub">' + esc(sub) + '</span></button>' + acts + '</div>';
      }
      return '<div class="pv-card" role="listitem"><button type="button" class="pv-card-open" data-open="' + esc(it.path) + '" title="' + esc(it.path) + '">' +
        '<span class="pv-card-thumb' + (it.thumb ? '' : ' none') + '"><span class="pv-badge">PDF</span>' + thumbHtml(it) + '</span>' +
        '<span class="pv-card-name">' + esc(it.name) + '</span><span class="pv-card-sub">' + esc(sub) + '</span>' +
        '<span class="pv-card-where">' + ico('pv-folder', 13) + esc(where) + '</span></button>' + acts + '</div>';
    }).join('');
    return '<div class="' + (list ? 'pv-rows' : 'pv-cards') + '" role="list">' + rows + '</div>';
  }
  function sectionHead(title, count, controls) {
    return '<div class="pv-sec-head"><h2 class="pv-sec-title">' + esc(title) + '</h2>' + (count != null ? '<span class="pv-count">' + count + (count === 1 ? ' PDF' : ' PDFs') + '</span>' : '') + '<span class="spacer"></span>' + (controls ? viewControls() : '') + '</div>';
  }
  /** The folder being browsed, as a trail back to its place or drive, each step a button. */
  function folderHead(folder, count) {
    const trail = crumbs(folder);
    return '<div class="pv-sec-head"><nav class="pv-crumbs" aria-label="Folder">' + trail.map((c, i) => i < trail.length - 1
      ? '<button type="button" class="pv-crumb" data-dir="' + esc(c.path) + '">' + esc(c.label) + '</button><span class="pv-crumb-sep" aria-hidden="true">›</span>'
      : '<h2 class="pv-sec-title">' + esc(c.label) + '</h2>').join('') + '</nav>' +
      (count != null ? '<span class="pv-count">' + count + (count === 1 ? ' PDF' : ' PDFs') + '</span>' : '') + '<span class="spacer"></span>' + viewControls() + '</div>';
  }
  function viewControls() {
    const names = { opened: 'Last opened', name: 'Name', folder: 'Folder' };
    return '<button type="button" class="combo pv-sort" id="homeSort" aria-haspopup="listbox" aria-expanded="false" aria-label="Sort by"><span>' + names[store.home.sort] + '</span>' + OS.icon('down', 12) + '</button>' +
      '<div class="seg" role="radiogroup" aria-label="View"><button type="button" role="radio" data-homeview="grid" class="' + (store.home.view === 'grid' ? 'active' : '') + '" aria-checked="' + (store.home.view === 'grid') + '" title="Previews" aria-label="Previews">' + ico('pv-grid', 14) + '</button>' +
      '<button type="button" role="radio" data-homeview="list" class="' + (store.home.view === 'list' ? 'active' : '') + '" aria-checked="' + (store.home.view === 'list') + '" title="List" aria-label="List">' + ico('pv-list', 14) + '</button></div>';
  }

  async function renderStart() {
    // the main folders and the drives, flat: a folder inside one lights the one it's in
    const cur = home.view === 'folder' && home.folder ? rootOf(home.folder).path : null;
    const navRow = (view, label, icon, folder) => {
      const on = home.view === view && (view !== 'folder' || cur === folder);
      return '<button type="button" class="pv-nav-row' + (on ? ' on' : '') + '" data-nav="' + view + '"' + (folder ? ' data-folder="' + esc(folder) + '"' : '') + (on ? ' aria-current="page"' : '') + '>' + ico(icon, 16) + '<span>' + esc(label) + '</span></button>';
    };
    const nav = '<nav class="pv-home-nav" aria-label="PDF Viewer">' +
      navRow('home', 'Home', 'pv-home') + navRow('recent', 'Recent', 'pv-clock') + navRow('starred', 'Starred', 'pv-star') +
      '<div class="pv-nav-head">Locations</div>' +
      PLACES.map(([p, l, i]) => navRow('folder', l, i, p)).join('') +
      '<div class="pv-nav-head">Drives</div>' +
      drives().map((d) => navRow('folder', d.label, d.icon, d.path)).join('') +
      // narrow windows fold the side bar to its icons: this opens it over the page, which keeps its size
      '<button type="button" class="pv-nav-row pv-nav-toggle" data-navtoggle aria-expanded="' + home.navOpen + '" title="' + (home.navOpen ? 'Collapse' : 'Expand') + '">' + ico('pv-menu', 16) + '<span>Collapse</span></button></nav>';
    const top = '<div class="pv-home-top"><label class="search pv-home-search">' + OS.icon('search', 15) +
      '<input class="input" id="homeSearch" type="search" placeholder="Search PDFs on your drive" aria-label="Search PDFs on your drive" autocomplete="off" value="' + esc(home.query) + '"></label>' +
      '<span class="spacer"></span><button type="button" class="btn" data-act="new">' + ico('pv-plus', 15) + 'New PDF</button>' +
      '<button type="button" class="btn btn-primary" data-act="open">' + ico('pv-folder', 15) + 'Open file</button></div>';
    $('#start').innerHTML = '<div class="pv-home' + (home.navOpen ? ' nav-open' : '') + '">' + nav + '<div class="pv-home-main">' + top + '<div class="pv-home-body" id="homeBody"></div></div></div>';
    await renderBody();
    if (home.view === 'search') { const s = $('#homeSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }
  async function renderBody() {
    const body = $('#homeBody');
    if (!body) return;
    const recent = sorted(store.recent.map((r) => fileItem(r.path, r.name)));
    if (home.view === 'home') {
      const h = new Date().getHours();
      const hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      const first = OS.user && OS.user.name ? String(OS.user.name).split(' ')[0] : '';
      body.innerHTML = '<div class="pv-hero"><div class="pv-hello"><h1>' + esc(hello + (first ? ', ' + first : '')) + '</h1>' +
        '<p>Pick up where you left off, or bring in a PDF to read, mark up, combine or sign. Drop PDFs or pictures anywhere in this window: several are combined.</p></div></div>' +
        '<div class="pv-sec-head"><h2 class="pv-sec-title">Tools</h2></div>' +
        '<div class="pv-hub-tools" role="list">' + TOOLS.map((t) =>
          '<button type="button" class="pv-hub-tool" role="listitem" data-hub="' + t.id + '"><span class="pv-hub-ico">' + ico(TOOL_GLYPH[t.id], 20) + '</span>' +
          '<span class="pv-hub-text"><span class="pv-hub-name">' + esc(t.name) + '</span><span class="pv-hub-desc">' + esc(t.text) + '</span></span></button>').join('') + '</div>' +
        sectionHead('Recent', recent.length, true) + itemsHtml(recent.slice(0, 11), true);
    } else if (home.view === 'recent') {
      body.innerHTML = sectionHead('Recent', recent.length, true) + (recent.length ? itemsHtml(recent, true) : '<div class="pv-home-empty">PDFs you open show here, each opening where you left it.</div>');
    } else if (home.view === 'starred') {
      const items = sorted(store.starred.map((p) => fileItem(p)));
      body.innerHTML = sectionHead('Starred', items.length, true) + (items.length ? itemsHtml(items) : '<div class="pv-home-empty">Star a PDF to keep it here: the star is on each file.</div>');
    } else if (home.view === 'folder') {
      // browsing: the folder's own folders, then its PDFs (nothing else)
      const folder = home.folder;
      body.innerHTML = folderHead(folder, null) + '<div class="pv-home-empty">Looking in this folder…</div>';
      let entries = [];
      let failed = null;
      try { entries = (await OS.fs.list(folder)) || []; } catch (e) { failed = e; }
      if (home.view !== 'folder' || home.folder !== folder) return;
      const dirs = entries.filter((e) => e.type === 'dir' && !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const items = sorted(entries.filter((e) => e.type !== 'dir' && /\.pdf$/i.test(e.name)).map((e) => fileItem(e.path, e.name, { mtime: e.mtime })));
      body.innerHTML = folderHead(folder, items.length || !dirs.length ? items.length : null) +
        (failed ? '<div class="pv-home-empty">This folder couldn’t be opened: ' + esc(failed.message || String(failed)) + '</div>'
          : (dirs.length ? '<div class="pv-dirs" role="list" aria-label="Folders">' + dirs.map((d) =>
              '<button type="button" class="pv-dirtile" role="listitem" data-dir="' + esc(d.path) + '" title="' + esc(d.name) + '">' + OS.fileTile({ name: d.name, type: 'dir' }, 20) + '<span>' + esc(d.name) + '</span></button>').join('') + '</div>' : '') +
            (items.length ? itemsHtml(items) : !dirs.length ? '<div class="pv-home-empty">There are no folders or PDFs here.</div>' : ''));
    } else if (home.view === 'search') {
      body.innerHTML = sectionHead('Results for “' + home.query + '”', home.results ? home.results.length : null, true) +
        (!home.results ? '<div class="pv-home-empty">Searching…</div>' : home.results.length ? itemsHtml(sorted(home.results)) : '<div class="pv-home-empty">No PDFs on your drive match “' + esc(home.query) + '”.</div>');
    }
  }
  const runSearch = U.debounce(async () => {
    const q = home.query;
    if (!q) return;
    let found = [];
    try { found = await OS.fs.search(q, '', 200); } catch (e) { found = []; }
    if (q !== home.query) return;
    home.results = (found || []).filter((e) => e.type !== 'dir' && /\.pdf$/i.test(e.name)).map((e) => fileItem(e.path, e.name, { mtime: e.mtime }));
    renderBody();
  }, 250);

  $('#start').addEventListener('input', (e) => {
    if (e.target.id !== 'homeSearch') return;
    home.query = e.target.value.trim();
    if (home.query) {
      home.view = 'search';
      home.results = null;
      $('#start').querySelectorAll('.pv-nav-row.on').forEach((r) => { r.classList.remove('on'); r.removeAttribute('aria-current'); });
      renderBody();
      runSearch();
    }
    else { home.view = 'home'; renderStart(); }
  });
  $('#start').addEventListener('click', (e) => {
    const t = e.target;
    const nav = t.closest('[data-nav]');
    if (t.closest('[data-navtoggle]')) { setNavOpen(!home.navOpen); return; }
    if (home.navOpen && (nav || !t.closest('.pv-home-nav'))) setNavOpen(false);
    if (nav) { home.view = nav.dataset.nav; home.folder = nav.dataset.folder || null; home.query = ''; renderStart(); return; }
    const dir = t.closest('[data-dir]');
    if (dir) { home.view = 'folder'; home.folder = dir.dataset.dir; home.query = ''; renderStart(); return; }
    const star = t.closest('[data-star]');
    if (star) { toggleStar(star.dataset.star); return; }
    const fm = t.closest('[data-filemenu]');
    if (fm) { fileMenu(fm, fm.dataset.filemenu); return; }
    const op = t.closest('[data-open]');
    if (op) { openPath(op.dataset.open); return; }
    const hv = t.closest('[data-homeview]');
    if (hv) { store.home.view = hv.dataset.homeview; saveStore(); renderBody(); return; }
    if (t.closest('#homeSort')) { sortMenu(t.closest('#homeSort')); return; }
    const act = t.closest('[data-act]');
    if (act && act.dataset.act === 'open') { openDialog(); return; }
    if (act && act.dataset.act === 'new') { newPdf(); return; }
    const tool = t.closest('[data-hub]');
    if (!tool) return;
    const id = tool.dataset.hub;
    if (id === 'combine' || id === 'pictures') organizer.open(id);
    else { pendingTool = id === 'markup' ? 'highlight' : id; openDialog(); }
  });
  // a preview that can't be loaded (its picture gone) shows the file's icon instead of a broken image
  $('#start').addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.closest('.pv-card-thumb')) return;
    const box = img.parentNode;
    box.classList.add('none');
    img.outerHTML = OS.fileTile({ name: img.dataset.name || 'x.pdf', type: 'file' }, 48);
  }, true);

  function setNavOpen(on) {
    home.navOpen = on;
    const box = $('#start').querySelector('.pv-home');
    if (box) box.classList.toggle('nav-open', on);
    document.body.classList.toggle('pv-nav-open', on);
    const btn = $('#start').querySelector('[data-navtoggle]');
    if (btn) { btn.setAttribute('aria-expanded', String(on)); btn.title = on ? 'Collapse' : 'Expand'; }
  }
  $('#start').addEventListener('keydown', (e) => { if (e.key === 'Escape' && home.navOpen) { setNavOpen(false); const b = $('#start').querySelector('[data-navtoggle]'); if (b) b.focus(); } });
  // a window made wide again shows the whole side bar anyway
  window.matchMedia('(max-width: 900px)').addEventListener('change', (e) => { if (!e.matches && home.navOpen) setNavOpen(false); });

  function toggleStar(path) {
    store.starred = isStarred(path) ? store.starred.filter((p) => p !== path) : [path].concat(store.starred);
    saveStore();
    renderBody();
  }
  function fileMenu(btn, path) {
    const r = btn.getBoundingClientRect();
    const inRecent = store.recent.some((x) => x.path === path);
    OS.menu([
      { label: 'Open', icon: 'open', action: () => openPath(path) },
      { label: 'Show in Files', icon: 'folder', action: () => OS.open('files', { path: parentDir(path), select: path }) },
      'sep',
      { label: isStarred(path) ? 'Remove the star' : 'Star', icon: 'star', action: () => toggleStar(path) },
      ...(inRecent ? [{ label: 'Remove from Recent', icon: 'pv-x', action: () => { dropRecent(path); renderBody(); } }] : []),
    ], { x: r.right - 200, y: r.bottom + 2 });
  }
  function sortMenu(btn) {
    const r = btn.getBoundingClientRect();
    const item = (k, l) => ({ label: l, checked: store.home.sort === k, action: () => { store.home.sort = k; saveStore(); renderBody(); } });
    OS.menu([item('opened', 'Last opened'), item('name', 'Name'), item('folder', 'Folder')], { x: r.left, y: r.bottom + 2 });
  }

  // a new PDF: one blank A4 page, saved where the user says, then opened
  async function newPdf() {
    const target = await OS.dialog.save({ title: 'New PDF', defaultName: 'Untitled.pdf', ext: 'pdf', startIn: home.view === 'folder' && home.folder ? home.folder : '/Documents' });
    if (!target) return;
    try {
      showLoading(true, 'Making the PDF');
      if (!window.PDFLib) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = window.LOS_BASE + 'assets/vendor/pdf-lib-1.17.1.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const out = await window.PDFLib.PDFDocument.create();
      out.addPage([595.28, 841.89]);
      out.setProducer('LiteOS PDF Viewer');
      await OS.fs.writeBase64(target, toBase64(await out.save()));
      showLoading(false);
      await openPath(target);
    } catch (e) { showLoading(false); OS.notify('The new PDF couldn’t be made.', 'error'); }
  }

  let pendingTool = null; // a hub tool waiting for its PDF to open

  // the first page as a small picture, for the hub (once per file, again when the file changes)
  const THUMB_DIR = STATE_DIR + '/thumbs';
  const hashOf = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16); };
  async function keepThumb(path, mtime) {
    const r = store.recent.find((x) => x.path === path);
    if (!r || (r.thumb && r.thumbOf === mtime)) return;
    const d = doc;
    try {
      const page = await d.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 360 / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport: vp }).promise;
      const url = canvas.toDataURL('image/jpeg', 0.8);
      const name = hashOf(path) + '.jpg';
      try { await OS.fs.mkdir(THUMB_DIR); } catch (e) { /* there */ }
      await OS.fs.writeBase64(THUMB_DIR + '/' + name, url.split(',')[1]);
      r.thumb = name + '?v=' + (mtime || Date.now());
      r.thumbOf = mtime;
      saveStore();
    } catch (e) { /* no picture: the file icon shows */ }
  }

  async function openDialog() {
    const path = await OS.dialog.open({ title: 'Open a PDF', accept: ['pdf'], startIn: current && current.path ? U.dirname(current.path) : '/Documents' });
    if (path) openPath(path);
  }
  function addRecent(path, name, pages, mtime) {
    const was = store.recent.find((r) => r.path === path) || {};
    store.recent = [{ path, name, pages, when: Date.now(), thumb: was.thumb, thumbOf: was.thumbOf }].concat(store.recent.filter((r) => r.path !== path)).slice(0, MAX_RECENT);
    saveStore();
    keepThumb(path, mtime);
  }
  function dropRecent(path) { store.recent = store.recent.filter((r) => r.path !== path); saveStore(); }

  // a PDF dropped on the window from this device opens from memory (Save a copy puts it on the drive)
  document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.body.classList.add('pv-dropping'); } });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('pv-dropping'); });
  // the Organise view's own drop stops the event before the document sees it: clear the veil on the way down
  document.addEventListener('drop', () => document.body.classList.remove('pv-dropping'), true);
  document.addEventListener('dragend', () => document.body.classList.remove('pv-dropping'), true);
  document.addEventListener('drop', async (e) => {
    document.body.classList.remove('pv-dropping');
    const all = e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : [];
    const f = all[0];
    if (!f) return;
    e.preventDefault();
    // several PDFs or pictures dropped on the home screen: combine them
    if (all.length > 1 && !doc && organizer && !organizer.active) { organizer.openWith(all); return; }
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { OS.notify('Only PDF files open here.', 'error'); return; }
    openData(f.name, await f.arrayBuffer());
  });

  // ------------------------------------------------------------------ pages, zoom, rotation
  let labels = null; // page labels (i, ii, 1, 2…) when the PDF has its own
  const labelOf = (n) => (labels && labels[n - 1] ? labels[n - 1] : String(n));
  function pageChanged(n) {
    if (document.activeElement !== $('#pageNo')) $('#pageNo').value = labelOf(n);
    $('#pageCount').textContent = labels ? '(' + n + ' of ' + (doc ? doc.numPages : 1) + ')' : 'of ' + (doc ? doc.numPages : 1);
    const info = $('#pageInfo');
    info.textContent = 'Page ' + labelOf(n) + (labels ? ' (' + n + ' of ' + (doc ? doc.numPages : 1) + ')' : ' of ' + (doc ? doc.numPages : 1));
    followOutline(n);
    info.classList.add('show');
    clearTimeout(pageChanged.t);
    pageChanged.t = setTimeout(() => info.classList.remove('show'), 1200);
    markThumb(n);
    remember();
  }
  const ZOOM_NAMES = { auto: 'Automatic', 'page-width': 'Fit width', 'page-fit': 'Fit page', 'page-actual': 'Actual size' };
  function zoomChanged(scale, preset) {
    $('#zoomText').textContent = preset && ZOOM_NAMES[preset] ? ZOOM_NAMES[preset] : Math.round(scale * 100) + '%';
    const fitW = viewer && viewer.currentScaleValue === 'page-width';
    const fb = $('#fitBtn');
    fb.innerHTML = ico(fitW ? 'pv-fitp' : 'pv-fitw');
    fb.title = fitW ? 'Fit page' : 'Fit to width';
    fb.setAttribute('aria-label', fb.title);
    remember();
  }
  /** The page, zoom and rotation of the open file, for next time. */
  function remember() {
    if (!viewer || !current || !current.path || !doc) return;
    const v = viewer.currentScaleValue;
    if (presenting) return; // presentation's own layout isn't kept
    store.files[current.path] = { page: viewer.currentPageNumber, scale: typeof v === 'string' && isNaN(+v) ? v : +(+v).toFixed(3), rotation: viewer.pagesRotation || 0, scroll: viewer.scrollMode, spread: viewer.spreadMode };
    saveStoreSoon();
  }
  function zoomStep(dir) {
    if (!viewer || !doc) return;
    const s = viewer.currentScale;
    const next = dir > 0 ? ZOOMS.find((z) => z > s + 0.001) : [...ZOOMS].reverse().find((z) => z < s - 0.001);
    if (next) viewer.currentScaleValue = next;
  }
  $('#pageNo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const typed = $('#pageNo').value.trim();
      // a label (iv, A-3) when the PDF has them, else the page's number
      let n = labels ? labels.findIndex((l) => l && l.toLowerCase() === typed.toLowerCase()) + 1 : 0;
      if (!n) n = parseInt(typed, 10);
      if (doc && n >= 1 && n <= doc.numPages) { pushHistory(); viewer.currentPageNumber = n; }
      else $('#pageNo').value = viewer ? labelOf(viewer.currentPageNumber) : 1;
      container.focus();
    } else if (e.key === 'Escape') { $('#pageNo').value = labelOf(viewer.currentPageNumber); container.focus(); }
  });
  $('#pageNo').addEventListener('focus', () => $('#pageNo').select());
  $('#pageNo').addEventListener('blur', () => { if (viewer) $('#pageNo').value = labelOf(viewer.currentPageNumber); });

  // Ctrl+wheel (and a touchpad's pinch, which arrives as one) zooms
  container.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (!viewer || !doc) return;
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
    const next = Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], viewer.currentScale * factor));
    viewer.updateScale ? viewer.updateScale({ scaleFactor: next / viewer.currentScale, origin: [e.clientX, e.clientY] }) : (viewer.currentScaleValue = next);
  }, { passive: false });

  // ------------------------------------------------------------------ thumbnails
  const thumbsEl = $('#thumbs');
  const thumbsObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) drawThumb(en.target); });
  }, { root: thumbsEl, rootMargin: '300px 0px' });
  function buildThumbs() {
    thumbsObserver.disconnect();
    const n = doc.numPages;
    let html = '';
    for (let i = 1; i <= n; i++) {
      html += '<button type="button" class="pv-thumb" role="option" data-page="' + i + '" aria-label="Page ' + i + '" aria-selected="false">' +
        '<span class="pv-thumb-page"><canvas width="0" height="0"></canvas></span><span class="pv-thumb-no">' + i + '</span></button>';
    }
    thumbsEl.innerHTML = html;
    // a first guess at the shape from page 1 until each is drawn
    doc.getPage(1).then((p) => {
      const vp = p.getViewport({ scale: 1 });
      thumbsEl.style.setProperty('--thumb-ratio', String(vp.height / vp.width));
    }).catch(() => {});
    thumbsEl.querySelectorAll('.pv-thumb').forEach((t) => thumbsObserver.observe(t));
  }
  async function drawThumb(btn) {
    if (btn.dataset.drawn || !doc) return;
    btn.dataset.drawn = '1';
    thumbsObserver.unobserve(btn);
    const d = doc;
    try {
      const page = await d.getPage(+btn.dataset.page);
      if (d !== doc) return;
      const base = page.getViewport({ scale: 1 });
      const scale = (120 * (window.devicePixelRatio || 1)) / base.width;
      const vp = page.getViewport({ scale });
      const canvas = btn.querySelector('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      btn.querySelector('.pv-thumb-page').style.aspectRatio = vp.width + ' / ' + vp.height;
      await page.render({ canvas, viewport: vp, annotationMode: lib.AnnotationMode.ENABLE }).promise;
      page.cleanup();
    } catch (e) { btn.dataset.drawn = ''; }
  }
  function markThumb(n) {
    const prev = thumbsEl.querySelector('.pv-thumb.on');
    if (prev) { prev.classList.remove('on'); prev.setAttribute('aria-selected', 'false'); }
    const t = thumbsEl.querySelector('.pv-thumb[data-page="' + n + '"]');
    if (!t) return;
    t.classList.add('on');
    t.setAttribute('aria-selected', 'true');
    // keep the current page's thumbnail in view, unless the pane is being scrolled by hand
    const r = t.getBoundingClientRect();
    const pr = thumbsEl.getBoundingClientRect();
    if (r.top < pr.top || r.bottom > pr.bottom) t.scrollIntoView({ block: 'nearest' });
  }
  thumbsEl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-page]');
    if (t && viewer) viewer.currentPageNumber = +t.dataset.page;
  });
  thumbsEl.addEventListener('keydown', (e) => {
    if (!viewer || !doc) return;
    const n = viewer.currentPageNumber;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); if (n < doc.numPages) { viewer.currentPageNumber = n + 1; thumbsEl.querySelector('[data-page="' + (n + 1) + '"]').focus(); } }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); if (n > 1) { viewer.currentPageNumber = n - 1; thumbsEl.querySelector('[data-page="' + (n - 1) + '"]').focus(); } }
  });

  // ------------------------------------------------------------------ outline
  async function buildOutline() {
    const el = $('#outline');
    let items = null;
    try { items = await doc.getOutline(); } catch (e) { items = null; }
    if (!items || !items.length) { el.innerHTML = '<div class="pv-side-empty">This PDF has no outline.</div>'; return; }
    let n = 0;
    const nodes = new Map();
    const branch = (list, depth) => list.map((it) => {
      const id = 'o' + (n++);
      nodes.set(id, it);
      const kids = it.items && it.items.length;
      return '<div class="pv-node" role="treeitem" aria-expanded="' + (kids ? 'false' : '') + '" data-node="' + id + '">' +
        '<div class="pv-node-row" style="padding-left:' + (6 + depth * 16) + 'px">' +
        (kids ? '<button type="button" class="pv-twisty" data-twist aria-label="Expand">' + ico('pv-right', 13) + '</button>' : '<span class="pv-twisty"></span>') +
        '<button type="button" class="pv-node-name" data-go="' + id + '"' + (it.bold ? ' style="font-weight:600"' : '') + '>' + esc(it.title || 'Untitled') + '</button></div>' +
        (kids ? '<div class="pv-kids" role="group" hidden>' + branch(it.items, depth + 1) + '</div>' : '') + '</div>';
    }).join('');
    el.innerHTML = branch(items, 0);
    el._nodes = nodes;
    // each item's page, for the outline to follow the page being read
    outlinePages = [];
    const d = doc;
    for (const [id, it] of nodes) {
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await d.getDestination(dest);
        if (!Array.isArray(dest)) continue;
        const ref = dest[0];
        const index = typeof ref === 'number' ? ref : await d.getPageIndex(ref);
        if (d !== doc) return;
        outlinePages.push({ id, page: index + 1 });
      } catch (e) { /* a destination that doesn't resolve */ }
    }
    if (viewer) followOutline(viewer.currentPageNumber);
  }
  let outlinePages = [];
  /** Mark the outline item the page being read belongs to (the last one starting on or before it, or its visible parent). */
  function followOutline(n) {
    const el = $('#outline');
    if (!outlinePages.length || !el._nodes) return;
    let best = null;
    for (const o of outlinePages) if (o.page <= n && (!best || o.page >= best.page)) best = o;
    el.querySelectorAll('.pv-node-name.here').forEach((x) => x.classList.remove('here'));
    if (!best) return;
    let node = el.querySelector('[data-node="' + best.id + '"]');
    // inside a collapsed branch: its nearest visible ancestor
    for (let p = node.parentElement.closest('.pv-node'); p; p = p.parentElement.closest('.pv-node')) if (p.getAttribute('aria-expanded') === 'false') node = p;
    node.querySelector(':scope > .pv-node-row .pv-node-name').classList.add('here');
  }
  $('#outline').addEventListener('click', (e) => {
    const tw = e.target.closest('[data-twist]');
    if (tw) {
      const node = tw.closest('.pv-node');
      const open = node.getAttribute('aria-expanded') !== 'true';
      node.setAttribute('aria-expanded', String(open));
      node.querySelector(':scope > .pv-kids').hidden = !open;
      return;
    }
    const go = e.target.closest('[data-go]');
    if (!go || !linkService) return;
    const it = $('#outline')._nodes.get(go.dataset.go);
    $('#outline').querySelectorAll('.pv-node-name.on').forEach((x) => x.classList.remove('on'));
    go.classList.add('on');
    if (it.dest) linkService.goToDestination(it.dest);
    else if (it.url) openExternal(it.url);
  });

  // side pane tabs and the toggle
  $('#side').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    $('#side').querySelectorAll('[data-tab]').forEach((b) => { const on = b === t; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    $('#thumbs').hidden = t.dataset.tab !== 'pages';
    $('#outline').hidden = t.dataset.tab !== 'outline';
    $('#attachments').hidden = t.dataset.tab !== 'attachments';
    $('#notes').hidden = t.dataset.tab !== 'notes';
    $('#layers').hidden = t.dataset.tab !== 'layers';
  });
  function toggleSide(force) {
    const show = force != null ? force : $('#side').hidden;
    $('#side').hidden = !show;
    $('#sideBtn').setAttribute('aria-pressed', String(show));
    $('#sideBtn').classList.toggle('active', show);
  }

  // ------------------------------------------------------------------ back and forward
  const hist = { back: [], fwd: [] };
  const here = () => ({ page: viewer.currentPageNumber, top: container.scrollTop, left: container.scrollLeft });
  function pushHistory() {
    if (!viewer || !doc || jumping) return;
    const h = here();
    const last = hist.back[hist.back.length - 1];
    if (!last || last.page !== h.page || Math.abs(last.top - h.top) > 40) hist.back.push(h);
    if (hist.back.length > 50) hist.back.shift();
    hist.fwd = [];
    histButtons();
  }
  let jumping = false;
  function travel(from, to) {
    if (!viewer || !from.length) return;
    to.push(here());
    const h = from.pop();
    jumping = true;
    viewer.currentPageNumber = h.page;
    requestAnimationFrame(() => { container.scrollTop = h.top; container.scrollLeft = h.left; jumping = false; });
    histButtons();
  }
  function histButtons() {
    $('#backBtn').disabled = !hist.back.length;
    $('#fwdBtn').disabled = !hist.fwd.length;
  }

  // ------------------------------------------------------------------ page layout
  function layoutMenu(btn) {
    if (!viewer) return;
    const r = btn.getBoundingClientRect();
    const sm = ui.ScrollMode;
    const sp = ui.SpreadMode;
    const scroll = (mode, label) => ({ label, checked: viewer.scrollMode === mode, action: () => { viewer.scrollMode = mode; remember(); } });
    const spread = (mode, label) => ({ label, checked: viewer.spreadMode === mode, disabled: viewer.scrollMode === sm.WRAPPED || viewer.scrollMode === sm.HORIZONTAL, action: () => { viewer.spreadMode = mode; remember(); } });
    OS.menu([
      { header: 'Scrolling' },
      scroll(sm.VERTICAL, 'Down the page'), scroll(sm.HORIZONTAL, 'Across'), scroll(sm.WRAPPED, 'Wrapped'), scroll(sm.PAGE, 'One page at a time'),
      { header: 'Pages' },
      spread(sp.NONE, 'One page'), spread(sp.ODD, 'Two pages'), spread(sp.EVEN, 'Book (cover on its own)'),
      'sep',
      { label: 'Presentation', key: 'F5', icon: 'pv-present', action: present },
    ], { x: r.left, y: r.bottom + 2 });
  }

  // ------------------------------------------------------------------ presentation
  // The pages alone, full screen, one at a time and fitted to the screen; the layout before is put back after.
  let presenting = null;
  async function present() {
    if (!viewer || !doc || presenting) return;
    presenting = { scroll: viewer.scrollMode, spread: viewer.spreadMode, scale: viewer.currentScaleValue, page: viewer.currentPageNumber, full: false };
    // full screen where the browser allows it; where it refuses or never answers (kiosks, embedded browsers), inside
    // the window
    const stage = $('#stage');
    const full = stage.requestFullscreen ? Promise.race([stage.requestFullscreen().then(() => true, () => false), new Promise((r) => setTimeout(() => r(false), 1500))]) : Promise.resolve(false);
    presenting.full = await full;
    if (!presenting) return;
    document.body.classList.add('pv-presenting');
    viewer.scrollMode = ui.ScrollMode.PAGE;
    viewer.spreadMode = ui.SpreadMode.NONE;
    setTimeout(() => { viewer.currentScaleValue = 'page-fit'; viewer.currentPageNumber = presenting.page; }, 60);
    const hint = $('#presentHint');
    hint.hidden = false;
    clearTimeout(present.t);
    present.t = setTimeout(() => { hint.hidden = true; }, 2500);
    container.focus();
  }
  function endPresent() {
    if (!presenting) return;
    const p = presenting;
    const page = viewer.currentPageNumber;
    presenting = null;
    document.body.classList.remove('pv-presenting');
    $('#presentHint').hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    viewer.scrollMode = p.scroll;
    viewer.spreadMode = p.spread;
    viewer.currentScaleValue = p.scale;
    viewer.currentPageNumber = page;
    remember();
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && presenting && presenting.full) endPresent(); });
  $('#stage').addEventListener('click', (e) => {
    if (!presenting || e.target.closest('a, button, input, .pv-find')) return;
    if (viewer.currentPageNumber < doc.numPages) viewer.currentPageNumber += 1;
  });

  // ------------------------------------------------------------------ attachments
  async function buildAttachments() {
    const el = $('#attachments');
    const tab = $('#side [data-tab="attachments"]');
    let list = null;
    try { list = await doc.getAttachments(); } catch (e) { list = null; }
    const entries = list ? (list instanceof Map ? [...list.entries()] : Object.entries(list)) : [];
    tab.hidden = !entries.length;
    el.innerHTML = entries.map(([id, a], i) =>
      '<div class="pv-row" role="listitem"><span class="pv-row-ico">' + OS.fileTile({ name: a.filename, type: 'file' }, 24) + '</span>' +
      '<span class="pv-row-main"><span class="pv-row-name">' + esc(a.filename) + '</span>' + (a.description ? '<span class="pv-row-sub">' + esc(a.description) + '</span>' : '') + '</span>' +
      '<button type="button" class="icon-btn" data-attach="' + i + '" title="Save to the drive" aria-label="Save ' + esc(a.filename) + ' to the drive">' + OS.icon('download', 16) + '</button></div>').join('');
    el._entries = entries;
  }
  $('#attachments').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-attach]');
    if (!b) return;
    const [id, a] = $('#attachments')._entries[+b.dataset.attach];
    const ext = U.ext(a.filename);
    const target = await OS.dialog.save({ title: 'Save the attached file', defaultName: a.filename, ext: ext || undefined, startIn: '/Downloads' });
    if (!target) return;
    try {
      const bytes = a.content || await doc.getAttachmentContent(id);
      if (!bytes) throw new Error('empty');
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      await OS.fs.writeBase64(target, btoa(bin));
      OS.notify('Saved as “' + U.basename(target) + '”. Attached files aren’t opened by PDF Viewer: open it from Files if you trust it.', { title: 'File saved', actions: [{ label: 'Show in Files', action: () => OS.open('files', { path: U.dirname(target), select: target }) }] });
    } catch (err) { OS.notify('The attached file couldn’t be saved.', 'error'); }
  });

  // ------------------------------------------------------------------ layers (optional content)
  let ocConfig = null;
  // one configuration per document: the one the viewer draws with, changed in place
  async function buildLayers() {
    ocConfig = null;
    try { ocConfig = await viewer.optionalContentConfigPromise; } catch (e) { ocConfig = null; }
    if (!ocConfig) { try { ocConfig = await doc.getOptionalContentConfig(); } catch (e) { ocConfig = null; } }
    renderLayers();
  }
  function renderLayers() {
    const el = $('#layers');
    const tab = $('#side [data-tab="layers"]');
    const groups = ocConfig ? [...ocConfig] : [];
    tab.hidden = !groups.length;
    if (!groups.length) { el.innerHTML = ''; return; }
    el.innerHTML = groups.map(([id, g]) => {
      const on = g.visible !== false;
      return '<div class="pv-row" role="listitem"><button type="button" class="icon-btn" data-layer="' + esc(id) + '" aria-pressed="' + on + '" title="' + (on ? 'Hide' : 'Show') + '" aria-label="' + (on ? 'Hide ' : 'Show ') + esc(g.name || 'layer') + '">' + OS.icon(on ? 'pv-eye' : 'pv-eyeoff', 16) + '</button>' +
        '<span class="pv-row-main"><span class="pv-row-name' + (on ? '' : ' off') + '">' + esc(g.name || 'Unnamed layer') + '</span></span></div>';
    }).join('');
  }
  $('#layers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-layer]');
    if (!b || !ocConfig) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    ocConfig.setVisibility(b.dataset.layer, on);
    viewer.optionalContentConfigPromise = Promise.resolve(ocConfig);
    renderLayers();
  });

  // ------------------------------------------------------------------ marking up
  const HIGHLIGHTS = [['yellow', '#FFFF98'], ['green', '#53FFBC'], ['blue', '#80EBFF'], ['pink', '#FFCBE6'], ['red', '#FF4F5F']];
  const INKS = [['Black', '#000000'], ['Blue', '#1F4FD1'], ['Red', '#D63B41'], ['Green', '#1F9D61'], ['Orange', '#E8840C']];
  const SIZES = { ink: [['Fine', 1], ['Medium', 3], ['Thick', 6], ['Marker', 12]], text: [['Small', 10], ['Normal', 14], ['Large', 20], ['Heading', 28]] };
  const toolPrefs = { highlight: HIGHLIGHTS[0][1], inkColor: INKS[0][1], inkSize: 3, textColor: INKS[0][1], textSize: 14 };
  let activeTool = null;
  const MODE = () => lib.AnnotationEditorType;
  const TOOL_MODE = () => ({ highlight: MODE().HIGHLIGHT, ink: MODE().INK, text: MODE().FREETEXT });

  function startTool(tool) {
    if (!viewer || !doc) return;
    if (tool === 'image') { addPicture(); return; }
    if (tool === 'sign') { signMenu($('[data-tool="sign"]')); return; }
    if (tool === 'print') { print(); return; }
    if (tool === 'organize') { organizer.open('arrange'); return; }
    if (tool === 'split') { organizer.open('arrange').then(() => { const b = document.querySelector('[data-org="split"]'); if (b && !b.disabled) b.click(); }); return; }
    const mode = tool && TOOL_MODE()[tool] != null ? TOOL_MODE()[tool] : MODE().NONE;
    try { viewer.annotationEditorMode = { mode }; } catch (e) { console.error(e); return; }
    activeTool = mode === MODE().NONE ? null : tool;
    applyPrefs();
    markTool(mode);
  }
  /** The toolbar shows the tool in use (also when pdf.js changes it, e.g. Escape). */
  function markTool(mode) {
    const byMode = { [MODE().HIGHLIGHT]: 'highlight', [MODE().INK]: 'ink', [MODE().FREETEXT]: 'text' };
    activeTool = byMode[mode] || null;
    document.querySelectorAll('.pv-tool[data-tool]').forEach((b) => {
      if (!b.hasAttribute('aria-pressed')) return;
      const on = b.dataset.tool === activeTool;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('#toolOpts').hidden = !activeTool;
    $('#hlChip').style.background = toolPrefs.highlight;
    document.body.classList.toggle('pv-marking', !!activeTool);
  }
  function applyPrefs() {
    if (!uiManager) return;
    const P2 = lib.AnnotationEditorParamsType;
    try {
      if (activeTool === 'highlight') uiManager.updateParams(P2.HIGHLIGHT_COLOR, toolPrefs.highlight);
      if (activeTool === 'ink') { uiManager.updateParams(P2.INK_COLOR, toolPrefs.inkColor); uiManager.updateParams(P2.INK_THICKNESS, toolPrefs.inkSize); }
      if (activeTool === 'text') { uiManager.updateParams(P2.FREETEXT_COLOR, toolPrefs.textColor); uiManager.updateParams(P2.FREETEXT_SIZE, toolPrefs.textSize); }
    } catch (e) { /* no editor yet */ }
  }
  $('#markTools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    const t = b.dataset.tool;
    startTool(activeTool === t ? null : t);
  });

  // colour and size for the tool in use: a flyout of swatches under the button
  function toolOptions(btn) {
    closeAllPops();
    const t = activeTool;
    if (!t) return;
    const colours = t === 'highlight' ? HIGHLIGHTS.map(([n, c]) => [n[0].toUpperCase() + n.slice(1), c]) : INKS;
    const cur = t === 'highlight' ? toolPrefs.highlight : t === 'ink' ? toolPrefs.inkColor : toolPrefs.textColor;
    const sizes = SIZES[t];
    const curSize = t === 'ink' ? toolPrefs.inkSize : toolPrefs.textSize;
    const el = document.createElement('div');
    el.className = 'st-flyout pv-swatches';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Colour and size');
    el.innerHTML = '<div class="pv-sw-label">Colour</div><div class="pv-sw-row">' + colours.map(([n, c]) =>
      '<button type="button" class="pv-sw' + (c.toLowerCase() === String(cur).toLowerCase() ? ' on' : '') + '" data-colour="' + c + '" style="background:' + c + '" aria-label="' + n + '" title="' + n + '" aria-pressed="' + (c === cur) + '"></button>').join('') + '</div>' +
      (sizes ? '<div class="pv-sw-label">' + (t === 'ink' ? 'Thickness' : 'Size') + '</div><div class="seg pv-sw-sizes">' + sizes.map(([n, v]) =>
        '<button type="button" data-size="' + v + '" class="' + (v === curSize ? 'active' : '') + '">' + n + '</button>').join('') + '</div>' : '');
    document.body.appendChild(el);
    const r = btn.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(r.left - 80, window.innerWidth - el.offsetWidth - 8)) + 'px';
    el.style.top = (r.bottom + 4) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    fly = { el, btn };
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-colour]');
      const s2 = e.target.closest('[data-size]');
      if (c) {
        if (t === 'highlight') toolPrefs.highlight = c.dataset.colour; else if (t === 'ink') toolPrefs.inkColor = c.dataset.colour; else toolPrefs.textColor = c.dataset.colour;
        el.querySelectorAll('.pv-sw').forEach((x) => { x.classList.toggle('on', x === c); x.setAttribute('aria-pressed', String(x === c)); });
      } else if (s2) {
        if (t === 'ink') toolPrefs.inkSize = +s2.dataset.size; else toolPrefs.textSize = +s2.dataset.size;
        el.querySelectorAll('[data-size]').forEach((x) => x.classList.toggle('active', x === s2));
      } else return;
      applyPrefs();
      markTool(viewer.annotationEditorMode);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeAllPops(); btn.focus(); } });
    el.querySelector('button').focus();
  }

  let canUndo = false;
  function editStates(d) {
    canUndo = !!d.hasSomethingToUndo;
    $('#undoBtn').disabled = !d.hasSomethingToUndo;
    $('#redoBtn').disabled = !d.hasSomethingToRedo;
    checkDirty();
    notesSoon();
  }
  /** Edited only when saving would write something: turning on a tool makes the file's own marks editable (pdf.js
   *  marks its storage modified then), but an untouched mark has nothing to write. */
  const checkDirty = U.debounce(() => {
    if (!doc) return;
    let n = 0;
    try { const ser = doc.annotationStorage.serializable; n = ser && ser.map ? ser.map.size : 0; } catch (e) { n = 1; }
    // a stroke still being drawn isn't in the storage yet, but it can be undone: it counts
    const edited = !!n || canUndo;
    if (edited !== dirty) setDirty(edited);
  }, 150);

  // a picture (or a signature) is put on the page as pdf.js does with a pasted image: centred on the page in view,
  // then moved and resized like any mark
  function placeImage(file) {
    if (!uiManager || !uiManager.currentLayer) { OS.notify('Scroll to a page first, then add the picture.', 'error'); return; }
    const dt = new DataTransfer();
    dt.items.add(file);
    uiManager.paste({ preventDefault() {}, clipboardData: dt });
  }
  async function addPicture() {
    const path = await OS.dialog.open({ title: 'Add a picture', accept: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'], startIn: '/Pictures' });
    if (!path) return;
    try {
      const blob = await (await fetch(OS.fs.rawUrl(path))).blob();
      placeImage(new File([blob], U.basename(path), { type: blob.type || 'image/png' }));
    } catch (e) { OS.notify('That picture couldn’t be added.', 'error'); }
  }

  // ------------------------------------------------------------------ signatures
  // Drawn, typed or from a picture, placed as a picture of the signature; kept (if asked) in /.apps/pdf/signatures/
  const SIG_DIR = STATE_DIR + '/signatures';
  function signMenu(btn) {
    const r = btn.getBoundingClientRect();
    const saved = store.signatures || [];
    OS.menu([
      ...(saved.length ? [{ header: 'Your signatures' }] : []),
      ...saved.map((s) => ({ label: s.name, img: OS.fs.rawUrl(SIG_DIR + '/' + s.file), action: () => useSignature(s) })),
      ...(saved.length ? ['sep'] : []),
      { label: 'Add a signature…', icon: 'pv-sign', action: () => signatureDialog() },
      ...(saved.length ? [{ label: 'Remove a saved signature', items: saved.map((s) => ({ label: s.name, danger: true, action: () => forgetSignature(s) })) }] : []),
    ], { x: r.left, y: r.bottom + 2 });
  }
  async function useSignature(s) {
    try {
      const blob = await (await fetch(OS.fs.rawUrl(SIG_DIR + '/' + s.file))).blob();
      placeImage(new File([blob], s.file, { type: 'image/png' }));
    } catch (e) { OS.notify('That signature couldn’t be read.', 'error'); }
  }
  async function forgetSignature(s) {
    store.signatures = (store.signatures || []).filter((x) => x !== s);
    saveStore();
    try { await OS.fs.remove(SIG_DIR + '/' + s.file); } catch (e) { /* gone already */ }
  }
  function signatureDialog() {
    const box = document.createElement('dialog');
    box.className = 'dlg dlg-wide pv-sigdlg';
    box.setAttribute('aria-labelledby', 'sigTitle');
    box.innerHTML = '<form method="dialog"><h2 class="dlg-title" id="sigTitle">Add a signature</h2><div class="dlg-body">' +
      '<div class="seg" role="tablist"><button type="button" role="tab" data-sigtab="draw" class="active">Draw</button><button type="button" role="tab" data-sigtab="type">Type</button><button type="button" role="tab" data-sigtab="picture">Picture</button></div>' +
      '<div class="pv-sigpad" data-sigpane="draw"><canvas width="880" height="260" aria-label="Draw your signature here"></canvas><span class="pv-sigline"></span><button type="button" class="btn btn-sm btn-ghost pv-sigclear" data-sigclear>Clear</button></div>' +
      '<div data-sigpane="type" hidden><label class="field"><span>Your name</span><input class="input" name="signame" maxlength="60" autocomplete="name"></label><div class="pv-sigtyped" aria-hidden="true"></div></div>' +
      '<div data-sigpane="picture" hidden><button type="button" class="btn" data-sigpick>Choose a picture of your signature…</button><div class="pv-sigpic"></div></div>' +
      '<label class="pv-sigkeep"><input type="checkbox" name="keep" checked> Keep it for next time</label>' +
      '</div><div class="dlg-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn is-default">Add</button></div></form>';
    document.body.appendChild(box);
    const pad = box.querySelector('canvas');
    const ctx = pad.getContext('2d');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = '#13235B';
    let drawing = false; let drew = false; let tab = 'draw'; let picture = null;
    const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
    pad.addEventListener('pointerdown', (e) => { drawing = true; drew = true; pad.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y); ctx.stroke(); });
    pad.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); });
    pad.addEventListener('pointerup', () => { drawing = false; });
    const nameIn = box.querySelector('[name=signame]');
    const typed = box.querySelector('.pv-sigtyped');
    nameIn.value = (OS.user && (OS.user.name || OS.user.username)) || '';
    const showTyped = () => { typed.textContent = nameIn.value || ' '; };
    nameIn.addEventListener('input', showTyped); showTyped();
    box.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-sigtab]');
      if (t) {
        tab = t.dataset.sigtab;
        box.querySelectorAll('[data-sigtab]').forEach((b) => b.classList.toggle('active', b === t));
        box.querySelectorAll('[data-sigpane]').forEach((p) => { p.hidden = p.dataset.sigpane !== tab; });
        if (tab === 'type') nameIn.focus();
        return;
      }
      if (e.target.closest('[data-sigclear]')) { ctx.clearRect(0, 0, pad.width, pad.height); drew = false; return; }
      if (e.target.closest('[data-sigpick]')) {
        const p = await OS.dialog.open({ title: 'A picture of your signature', accept: ['png', 'jpg', 'jpeg', 'webp'], startIn: '/Pictures' });
        if (!p) return;
        picture = await (await fetch(OS.fs.rawUrl(p))).blob();
        box.querySelector('.pv-sigpic').innerHTML = '<img src="' + URL.createObjectURL(picture) + '" alt="The signature picture">';
      }
    });
    let done = false;
    const finish = () => { if (done) return; done = true; box.close(); box.remove(); };
    box.querySelector('[data-cancel]').addEventListener('click', finish);
    box.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });
    box.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      let blob = null;
      if (tab === 'draw') { if (!drew) return; blob = await trimmed(pad); }
      else if (tab === 'type') {
        const name = nameIn.value.trim();
        if (!name) { nameIn.focus(); return; }
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 300;
        const x = c.getContext('2d');
        x.fillStyle = '#13235B';
        x.font = '140px "Segoe Script", "Brush Script MT", "Lucida Handwriting", "URW Chancery L", cursive';
        x.textBaseline = 'middle';
        x.fillText(name, 30, 150);
        blob = await trimmed(c);
      } else { if (!picture) return; blob = picture; }
      const keep = box.querySelector('[name=keep]').checked;
      finish();
      const file = new File([blob], 'signature.png', { type: blob.type || 'image/png' });
      placeImage(file);
      if (keep) {
        try {
          const name = tab === 'type' ? nameIn.value.trim() : 'Signature ' + ((store.signatures || []).length + 1);
          const fname = 'sig-' + Date.now().toString(36) + '.png';
          try { await OS.fs.mkdir(SIG_DIR); } catch (err) { /* there */ }
          await OS.fs.writeBase64(SIG_DIR + '/' + fname, await OS.util.toBase64(blob));
          store.signatures = (store.signatures || []).concat([{ name, file: fname }]);
          saveStore();
        } catch (err) { OS.notify('The signature was added, but couldn’t be kept for next time.', 'error'); }
      }
    });
    box.showModal();
  }
  /** A canvas cut to what's drawn on it, as a transparent PNG. */
  function trimmed(canvas) {
    const { width: w, height: h } = canvas;
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return new Promise((r) => canvas.toBlob(r, 'image/png'));
    const pad = 8;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return new Promise((r) => out.toBlob(r, 'image/png'));
  }

  // ------------------------------------------------------------------ the Notes tab: the marks made in this file
  const KIND = { highlight: 'Highlight', ink: 'Drawing', freetext: 'Text', stamp: 'Picture', signature: 'Signature' };
  function renderNotes() {
    const el = $('#notes');
    if (!doc) { el.innerHTML = ''; return; }
    const rows = [];
    for (const [, val] of doc.annotationStorage) {
      const type = val && val.constructor && val.constructor._type;
      if (!type || (val.isEmpty && val.isEmpty())) continue;
      const page = (val.pageIndex != null ? val.pageIndex : val.parent && val.parent.pageIndex) + 1;
      let text = '';
      if (type === 'freetext') { try { text = (val.serialize(false) || {}).value || ''; } catch (e) { text = ''; } }
      const colour = val.color || '';
      rows.push({ type, page, text, colour });
    }
    rows.sort((a, b) => a.page - b.page);
    el.innerHTML = rows.length ? rows.map((r) =>
      '<button type="button" class="pv-note" role="listitem" data-notepage="' + r.page + '">' +
      '<span class="pv-note-dot" style="background:' + esc(r.colour || 'var(--muted)') + '"></span>' +
      '<span class="pv-row-main"><span class="pv-row-name">' + esc(KIND[r.type] || r.type) + ' · page ' + esc(labelOf(r.page)) + '</span>' +
      (r.text ? '<span class="pv-row-sub">“' + esc(r.text.slice(0, 80)) + '”</span>' : '') + '</span></button>').join('')
      : '<div class="pv-side-empty">Highlights, drawings, text and signatures you add show here.</div>';
  }
  const notesSoon = U.debounce(renderNotes, 300);
  $('#notes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-notepage]');
    if (b && viewer) viewer.currentPageNumber = +b.dataset.notepage;
  });

  // ------------------------------------------------------------------ saving
  let dirty = false;
  function setDirty(on) {
    dirty = !!on;
    OS.win.setDirty(dirty);
    $('#saveBtn').hidden = !dirty;
    setTitle(current ? current.name + (dirty ? ' • Edited' : '') : '');
  }
  const toBase64 = (bytes) => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  /** The file's bytes with the marks and form entries in it (an incremental save: the original bytes stay as they were). */
  async function documentBytes() {
    if (dirty || doc.annotationStorage.size) return doc.saveDocument();
    return doc.getData();
  }
  async function save() {
    if (!doc || !dirty) return true;
    // put the tool down first, so a stroke or text still being made is committed and saved with the rest
    if (activeTool) { startTool(null); await new Promise((r) => setTimeout(r, 120)); }
    if (!current.path) { await saveCopy(); return false; }
    try {
      showLoading(true, 'Saving');
      const bytes = await doc.saveDocument();
      await OS.fs.writeBase64(current.path, toBase64(bytes));
      doc.annotationStorage.resetModified();
      canUndo = false;
      setDirty(false);
      showLoading(false);
      const r = store.recent.find((x) => x.path === current.path);
      if (r) { r.thumbOf = null; keepThumb(current.path, Date.now()); }
      return true;
    } catch (e) {
      showLoading(false);
      console.error(e);
      OS.dialog.alert({ title: '“' + current.name + '” couldn’t be saved', message: 'Your marks are still here. Try Save a copy to put them in another file.' });
      return false;
    }
  }
  /** Before closing or opening another PDF over an edited one: Save, Don't save, or Cancel (one dialog, as a native app asks). */
  async function keepOrDiscard() {
    if (!dirty || !doc) return true;
    const choice = await new Promise((resolve) => {
      const box = document.createElement('dialog');
      box.className = 'dlg';
      box.setAttribute('aria-labelledby', 'keepTitle');
      box.innerHTML = '<h2 class="dlg-title" id="keepTitle">Save the changes to “' + esc(current.name) + '”?</h2>' +
        '<p class="dlg-body">Your marks and form entries will be lost if you don’t save them.</p>' +
        '<div class="dlg-actions"><button type="button" class="btn btn-danger-text" data-k="drop">Don’t save</button><span class="spacer"></span>' +
        '<button type="button" class="btn" data-k="cancel">Cancel</button><button type="button" class="btn is-default" data-k="save" autofocus>Save</button></div>';
      document.body.appendChild(box);
      const done = (v) => { box.close(); box.remove(); resolve(v); };
      box.addEventListener('click', (e) => { const b2 = e.target.closest('[data-k]'); if (b2) done(b2.dataset.k); });
      box.addEventListener('cancel', (e) => { e.preventDefault(); done('cancel'); });
      box.showModal();
      box.querySelector('[data-k="save"]').focus();
    });
    if (choice === 'save') return save();
    if (choice === 'drop') { setDirty(false); return true; }
    return false;
  }

  // ------------------------------------------------------------------ links to the web
  container.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const raw = a.getAttribute('href') || '';
    if (raw.startsWith('#')) return; // a place in this PDF: pdf.js goes there
    const href = a.href || raw;
    if (href.startsWith(DRIVE_BASE)) { e.preventDefault(); e.stopPropagation(); openDriveLink(href); return; }
    if (/^https?:|^mailto:/i.test(href)) { e.preventDefault(); e.stopPropagation(); openExternal(href); }
  }, true);
  /** A link to another file on the drive: a PDF opens here (its page when the link names one), anything else in its app. */
  function openDriveLink(href) {
    const u = new URL(href);
    const path = decodeURIComponent(u.pathname.slice('/__drive__'.length)) || '/';
    if (/\.pdf$/i.test(path)) {
      const page = /page=(\d+)/.exec(u.hash);
      if (page) pendingPage = { path, page: +page[1] };
      openPath(path);
    } else OS.openFile(path);
  }
  let pendingPage = null;
  async function openExternal(url) {
    const ok = await OS.dialog.confirm({ title: 'Open this link?', message: url, okLabel: 'Open in Browser' });
    if (ok) OS.open('browser', { url });
  }

  // ------------------------------------------------------------------ find
  let findOpen = false;
  const findOpts = { caseSensitive: false, entireWord: false };
  function showFind() {
    if (!doc) return;
    findOpen = true;
    $('#find').hidden = false;
    $('#findBtn').classList.add('active');
    const sel = String(window.getSelection() || '').trim();
    if (sel && sel.length < 100 && !sel.includes('\n')) $('#findInput').value = sel;
    $('#findInput').focus();
    $('#findInput').select();
    if ($('#findInput').value) runFind('');
  }
  function hideFind() {
    findOpen = false;
    $('#find').hidden = true;
    $('#findBtn').classList.remove('active');
    if (eventBus) eventBus.dispatch('findbarclose', { source: null });
    $('#findCount').textContent = '';
    container.focus();
  }
  function runFind(type, previous) {
    if (!eventBus) return;
    eventBus.dispatch('find', {
      source: null, type, query: $('#findInput').value, caseSensitive: findOpts.caseSensitive, entireWord: findOpts.entireWord,
      highlightAll: true, findPrevious: !!previous, matchDiacritics: false,
    });
  }
  function findCount(m, state) {
    const q = $('#findInput').value;
    const el = $('#findCount');
    if (!q) { el.textContent = ''; return; }
    if (state === 1 || (m && m.total === 0)) { el.textContent = 'No matches'; $('#findInput').classList.add('none'); return; }
    $('#findInput').classList.remove('none');
    if (m && m.total) el.textContent = (m.current || 0) + ' of ' + (m.total > 1000 ? '1,000+' : m.total);
  }
  $('#findInput').addEventListener('input', U.debounce(() => runFind(''), 120));
  $('#findInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runFind('again', e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); hideFind(); }
  });
  $('#find').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'find-next') runFind('again', false);
    else if (a === 'find-prev') runFind('again', true);
    else if (a === 'find-close') hideFind();
    else if (a === 'find-case' || a === 'find-word') {
      const k = a === 'find-case' ? 'caseSensitive' : 'entireWord';
      findOpts[k] = !findOpts[k];
      b.setAttribute('aria-pressed', String(findOpts[k]));
      runFind(a === 'find-case' ? 'casesensitivitychange' : 'entirewordchange');
    }
  });

  // ------------------------------------------------------------------ printing
  // Each page drawn as a picture at 150 dpi into a frame of its own, then the browser's print dialog for that frame.
  let printing = false;
  let canPrint = true;
  async function print() {
    if (!doc || printing) return;
    if (!canPrint) { OS.dialog.alert({ title: 'This PDF can’t be printed', message: 'Its author has turned printing off.' }); return; }
    printing = true;
    const d = doc;
    // on a LiteLink device that allows printing, the PDF itself goes to LiteOS's print dialog and the device's printers
    if (await OS.canPrint()) {
      try { await OS.print(await d.getData(), { title: (current && current.name) || 'Document' }); }
      catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t print' }); }
      finally { printing = false; }
      return;
    }
    const urls = [];
    const DPI = 150;
    try {
      for (let i = 1; i <= d.numPages; i++) {
        showLoading(true, 'Preparing to print · page ' + i + ' of ' + d.numPages);
        const page = await d.getPage(i);
        const vp = page.getViewport({ scale: DPI / 72, rotation: (page.rotate + (viewer.pagesRotation || 0)) % 360 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, viewport: vp, intent: 'print', annotationMode: lib.AnnotationMode.ENABLE_STORAGE }).promise;
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
        urls.push({ url: URL.createObjectURL(blob), w: vp.width / DPI, h: vp.height / DPI });
        canvas.width = canvas.height = 0;
        page.cleanup();
        if (d !== doc) throw new Error('closed');
      }
      showLoading(true, 'Opening the print dialog');
      const frame = document.createElement('iframe');
      frame.className = 'pv-print-frame';
      frame.setAttribute('aria-hidden', 'true');
      document.body.appendChild(frame);
      const first = urls[0];
      frame.contentDocument.open();
      frame.contentDocument.write('<!doctype html><html><head><title>' + esc(current ? current.name : 'PDF') + '</title><style>@page{size:' + first.w.toFixed(2) + 'in ' + first.h.toFixed(2) + 'in;margin:0}html,body{margin:0}img{display:block;width:100%;height:100vh;object-fit:contain;page-break-after:always;break-after:page}</style></head><body>' +
        urls.map((u) => '<img src="' + u.url + '">').join('') + '</body></html>');
      frame.contentDocument.close();
      await Promise.all([...frame.contentDocument.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
      showLoading(false);
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => { frame.remove(); urls.forEach((u) => URL.revokeObjectURL(u.url)); }, 1000);
    } catch (e) {
      urls.forEach((u) => URL.revokeObjectURL(u.url));
      showLoading(false);
      if (e.message !== 'closed') OS.notify('The PDF couldn’t be prepared for printing.', 'error');
    } finally { printing = false; }
  }
  async function applyPermissions() {
    canPrint = true;
    try {
      const perms = await doc.getPermissions();
      if (perms && !perms.includes(lib.PermissionFlag.PRINT)) canPrint = false;
    } catch (e) { /* none set */ }
    $('#printBtn').disabled = !canPrint;
  }

  // ------------------------------------------------------------------ properties
  async function properties() {
    if (!doc) return;
    let meta = {};
    try { meta = await doc.getMetadata(); } catch (e) { meta = {}; }
    const info = meta.info || {};
    const date = (s) => { const d = s && lib.PDFDateString ? lib.PDFDateString.toDateObject(s) : null; return d ? d.toLocaleString(navigator.language || undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''; };
    let size = '';
    try {
      const p = await doc.getPage(viewer.currentPageNumber);
      const vp = p.getViewport({ scale: 1 });
      const mm = (pt) => Math.round((pt / 72) * 25.4);
      size = mm(vp.width) + ' × ' + mm(vp.height) + ' mm';
      const named = { '210×297': 'A4', '148×210': 'A5', '297×420': 'A3', '216×279': 'Letter', '216×356': 'Legal' };
      const k = Math.min(mm(vp.width), mm(vp.height)) + '×' + Math.max(mm(vp.width), mm(vp.height));
      if (named[k]) size += ' (' + named[k] + ')';
    } catch (e) { /* no page */ }
    const rows = [
      ['File', current ? current.name : ''], ['Where', current && current.path ? U.dirname(current.path) : 'Opened from this device'],
      ['Size', current && current.size != null ? U.formatSize(current.size) : ''],
      ['Title', info.Title], ['Author', info.Author], ['Subject', info.Subject], ['Keywords', info.Keywords],
      ['Created', date(info.CreationDate)], ['Modified', date(info.ModDate)], ['Made with', info.Creator], ['PDF producer', info.Producer],
      ['PDF version', info.PDFFormatVersion], ['Pages', String(doc.numPages)], ['Page size', size],
      ['Fast web view', info.IsLinearized ? 'Yes' : 'No'],
    ].filter((r) => r[1]);
    const box = document.createElement('dialog');
    box.className = 'dlg dlg-wide';
    box.setAttribute('aria-labelledby', 'propTitle');
    box.innerHTML = '<h2 class="dlg-title" id="propTitle">Document properties</h2><div class="dlg-body"><dl class="pv-props">' +
      rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl></div>' +
      '<div class="dlg-actions"><button type="button" class="btn is-default" autofocus>Close</button></div>';
    document.body.appendChild(box);
    box.querySelector('.btn').addEventListener('click', () => box.close());
    box.addEventListener('close', () => box.remove());
    box.showModal();
  }

  // ------------------------------------------------------------------ password
  function passwordDialog(name, wrong) {
    return new Promise((resolve) => {
      const box = document.createElement('dialog');
      box.className = 'dlg';
      box.setAttribute('aria-labelledby', 'pwTitle');
      box.innerHTML = '<form method="dialog"><h2 class="dlg-title" id="pwTitle">“' + esc(name) + '” is protected</h2><div class="dlg-body">' +
        '<p style="margin:0">Type the password to open it. The password isn’t kept.</p>' +
        '<label class="field"><span>Password</span><input class="input' + (wrong ? ' bad' : '') + '" type="password" name="pw" autocomplete="off" autofocus></label>' +
        (wrong ? '<span class="pv-bad">That password isn’t right. Try again.</span>' : '') +
        '</div><div class="dlg-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn is-default">Open</button></div></form>';
      document.body.appendChild(box);
      let done = false;
      const finish = (v) => { if (done) return; done = true; box.close(); box.remove(); resolve(v); };
      box.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); finish(box.querySelector('[name=pw]').value); });
      box.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
      box.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
      box.showModal();
      box.querySelector('[name=pw]').focus();
    });
  }

  // ------------------------------------------------------------------ zoom flyout (a combo box as LiteOS's)
  const zoomBtn = $('#zoomBtn');
  let fly = null;
  function closeAllPops() { if (fly) { fly.el.remove(); fly.btn.setAttribute('aria-expanded', 'false'); fly = null; } }
  function openZoom() {
    closeAllPops();
    const opts = [['auto', 'Automatic'], ['page-width', 'Fit width'], ['page-fit', 'Fit page'], ['page-actual', 'Actual size'], 'sep',
      ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((z) => [String(z), Math.round(z * 100) + '%'])];
    const cur = viewer ? String(viewer.currentScaleValue) : 'auto';
    const el = document.createElement('div');
    el.className = 'st-flyout';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Zoom');
    el.innerHTML = opts.map((o) => (o === 'sep' ? '<div class="st-sep" role="separator"></div>' :
      '<button type="button" class="st-opt' + (o[0] === cur ? ' on' : '') + '" role="option" aria-selected="' + (o[0] === cur) + '" data-z="' + o[0] + '">' + o[1] + '</button>')).join('');
    document.body.appendChild(el);
    const r = zoomBtn.getBoundingClientRect();
    el.style.minWidth = Math.max(r.width, 140) + 'px';
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)) + 'px';
    el.style.top = (r.bottom + 4) + 'px';
    el.style.maxHeight = (window.innerHeight - r.bottom - 12) + 'px';
    zoomBtn.setAttribute('aria-expanded', 'true');
    fly = { el, btn: zoomBtn };
    const items = [...el.querySelectorAll('.st-opt')];
    let at = Math.max(0, items.findIndex((b) => b.classList.contains('on')));
    items[at].focus();
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-z]');
      if (!b) return;
      closeAllPops();
      if (viewer) viewer.currentScaleValue = isNaN(+b.dataset.z) ? b.dataset.z : +b.dataset.z;
      zoomBtn.focus();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); at = (at + 1) % items.length; items[at].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = (at - 1 + items.length) % items.length; items[at].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeAllPops(); zoomBtn.focus(); }
    });
  }
  zoomBtn.addEventListener('click', () => { if (fly) closeAllPops(); else openZoom(); });
  document.addEventListener('mousedown', (e) => { if (fly && !fly.el.contains(e.target) && !fly.btn.contains(e.target)) closeAllPops(); }, true);
  window.addEventListener('resize', closeAllPops);

  // ------------------------------------------------------------------ the More menu and the top bar menus
  async function saveCopy() {
    if (!doc) return;
    const target = await OS.dialog.save({ title: 'Save a copy', defaultName: current ? current.name : 'Document.pdf', ext: 'pdf', startIn: '/Documents' });
    if (!target) return;
    try {
      const bytes = await documentBytes();
      await OS.fs.writeBase64(target, toBase64(bytes));
      OS.notify('Saved as “' + U.basename(target) + '”.', { title: 'Copy saved', actions: [{ label: 'Open', action: () => openPath(target) }] });
    } catch (e) { OS.notify('The copy couldn’t be saved.', 'error'); }
  }
  function moreMenu(btn) {
    const r = btn.getBoundingClientRect();
    OS.menu([
      { label: 'Open…', key: 'Ctrl+O', icon: 'open', action: openDialog },
      { label: 'Save a copy…', key: 'Ctrl+Shift+S', icon: 'save', disabled: !doc, action: saveCopy },
      { label: 'Show in Files', icon: 'folder', disabled: !current || !current.path, action: () => OS.open('files', { path: U.dirname(current.path), select: current.path }) },
      'sep',
      { label: 'Organise pages', icon: 'pv-organize', disabled: !doc, action: () => organizer.open('arrange') },
      'sep',
      { label: 'Document properties', icon: 'info', disabled: !doc, action: properties },
      { label: 'Close document', disabled: !doc, action: backToStart },
    ], { x: r.right - 220, y: r.bottom + 2 });
  }
  function setMenus() {
    OS.win.setMenus([
      { label: 'File', items: [
        { label: 'Open…', key: 'Ctrl+O', icon: 'open', action: openDialog },
        { label: 'Save', key: 'Ctrl+S', icon: 'save', action: save },
        { label: 'Save a copy…', key: 'Ctrl+Shift+S', action: saveCopy },
        { label: 'Print…', key: 'Ctrl+P', icon: 'pv-print', action: print },
        'sep',
        { label: 'Document properties', icon: 'info', action: properties },
        { label: 'Close document', action: backToStart },
      ] },
      { label: 'View', items: [
        { label: 'Zoom in', key: 'Ctrl+=', icon: 'zoomIn', action: () => zoomStep(1) },
        { label: 'Zoom out', key: 'Ctrl+−', icon: 'zoomOut', action: () => zoomStep(-1) },
        { label: 'Actual size', key: 'Ctrl+0', action: () => { if (viewer) viewer.currentScaleValue = 'page-actual'; } },
        { label: 'Fit width', action: () => { if (viewer) viewer.currentScaleValue = 'page-width'; } },
        { label: 'Fit page', action: () => { if (viewer) viewer.currentScaleValue = 'page-fit'; } },
        'sep',
        { label: 'Rotate clockwise', key: 'Ctrl+]', icon: 'rotate', action: () => rotate(90) },
        { label: 'Rotate anticlockwise', key: 'Ctrl+[', action: () => rotate(-90) },
        'sep',
        { label: 'Pages and outline', key: 'F4', action: () => toggleSide() },
        { label: 'Back', key: 'Alt+Left', icon: 'back', action: () => travel(hist.back, hist.fwd) },
        { label: 'Forward', key: 'Alt+Right', icon: 'forward', action: () => travel(hist.fwd, hist.back) },
        { label: 'Presentation', key: 'F5', icon: 'pv-present', action: present },
        { label: 'Find…', key: 'Ctrl+F', icon: 'search', action: showFind },
      ] },
    ]);
  }
  function rotate(by) { if (viewer && doc) viewer.pagesRotation = ((viewer.pagesRotation || 0) + by + 360) % 360; }

  $('#toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === 'side') toggleSide();
    else if (a === 'zoom-in') zoomStep(1);
    else if (a === 'zoom-out') zoomStep(-1);
    else if (a === 'fit') { if (viewer) viewer.currentScaleValue = viewer.currentScaleValue === 'page-width' ? 'page-fit' : 'page-width'; }
    else if (a === 'rotate') rotate(90);
    else if (a === 'layout') layoutMenu(b);
    else if (a === 'present') present();
    else if (a === 'organize') { if (doc) organizer.open('arrange'); }
    else if (a === 'undo') { if (uiManager) uiManager.undo(); }
    else if (a === 'redo') { if (uiManager) uiManager.redo(); }
    else if (a === 'save') save();
    else if (a === 'tool-options') toolOptions(b);
    else if (a === 'back') travel(hist.back, hist.fwd);
    else if (a === 'forward') travel(hist.fwd, hist.back);
    else if (a === 'find') { if (findOpen) hideFind(); else showFind(); }
    else if (a === 'print') print();
    else if (a === 'more') moreMenu(b);
  });

  // ------------------------------------------------------------------ keyboard
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (organizer && organizer.active) return; // the Organise view has its own keys
    if (presenting) {
      const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key);
      const prev = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key);
      if (next || prev) { e.preventDefault(); viewer.currentPageNumber = Math.max(1, Math.min(doc.numPages, viewer.currentPageNumber + (next ? 1 : -1))); return; }
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); viewer.currentPageNumber = e.key === 'Home' ? 1 : doc.numPages; return; }
      if (e.key === 'Escape') { e.preventDefault(); endPresent(); return; }
    }
    if (e.altKey && !ctrl && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && doc) {
      e.preventDefault();
      if (e.key === 'ArrowLeft') travel(hist.back, hist.fwd); else travel(hist.fwd, hist.back);
      return;
    }
    if (e.key === 'F5' && doc && !ctrl && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); present(); return; }
    const inField = e.target.closest && e.target.closest('input, textarea, dialog, .st-flyout');
    if (ctrl && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'o') { e.preventDefault(); openDialog(); return; }
      if (!doc) return;
      if (k === 'f') { e.preventDefault(); showFind(); return; }
      if (k === 'p') { e.preventDefault(); print(); return; }
      if (k === 's' && e.shiftKey) { e.preventDefault(); saveCopy(); return; }
      if (k === 's') { e.preventDefault(); save(); return; }
      if (k === 'g') { e.preventDefault(); $('#pageNo').focus(); return; }
      if (k === '=' || k === '+') { e.preventDefault(); zoomStep(1); return; }
      if (k === '-' || k === '_') { e.preventDefault(); zoomStep(-1); return; }
      if (k === '0') { e.preventDefault(); viewer.currentScaleValue = 'page-actual'; return; }
      if (k === ']') { e.preventDefault(); rotate(90); return; }
      if (k === '[') { e.preventDefault(); rotate(-90); return; }
      return;
    }
    if (!doc || inField) return;
    if (e.key === 'F3') { e.preventDefault(); if (!findOpen) showFind(); else runFind('again', e.shiftKey); }
    else if (e.key === 'F4') { e.preventDefault(); toggleSide(); }
    else if (e.key === 'Escape' && findOpen) { e.preventDefault(); hideFind(); }
    else if (e.key === 'Escape' && activeTool) { e.preventDefault(); startTool(null); }
    else if ((e.key === 'Home' || e.key === 'End') && !e.target.closest('.pv-side')) { e.preventDefault(); viewer.currentPageNumber = e.key === 'Home' ? 1 : doc.numPages; }
  });

  // ------------------------------------------------------------------ the Organise view (organize.js)
  const organizer = window.PVOrganize({
    OS, U, esc, ico, $, PDFJS,
    get lib() { return lib; },
    get doc() { return doc; },
    get current() { return current; },
    setTitle, showLoading, toBase64, documentBytes, backToStart,
    async openPath(path) { await ensureViewer(); return openPath(path); },
    markSaved() { if (doc) { doc.annotationStorage.resetModified(); canUndo = false; setDirty(false); } },
  });
  document.querySelectorAll('#organize [data-ico]').forEach((el) => { el.outerHTML = ico(el.dataset.ico); });

  // ------------------------------------------------------------------ start
  OS.win.keepState(() => (current && current.path ? { path: current.path } : null));
  window.addEventListener('beforeunload', () => { if (dirty) saveStore(); });
  setMenus();
  toggleSide(true);
  const storeReady = loadStore();
  const restored = OS.win.restored;
  const startPath = OS.args.path || (restored && restored.path);
  if (startPath) openPath(startPath);
  else storeReady.then(backToStart);
});
