/*
|--------------------------------------------------------------------------
| Screenshot
|--------------------------------------------------------------------------
|
| LiteOS Screenshot, laid out like a snipping tool: New, picture or recording, what to capture and the delay, and
| under them the key that starts one. New takes a picture of what is chosen (a region dragged on the frozen screen, a
| window, or the whole screen) after the delay. The desktop does the capturing (OS.capture, capture.js): this window
| is hidden while it does, and the picture is saved in /Pictures/Screenshots, copied, and announced in a notification.
| A picture opened here (New, Open file, Markup and share in the notification) is marked up in the editor (markup.js).
| With recording switched on, New (or Ctrl+Alt+R anywhere) records the screen, a window or a region (OS.capture.record).
|
*/
LiteOS.ready((OS) => {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => OS.util.escape(s == null ? '' : s);
  const ico = (n, s) => OS.icon(n, s || 16);
  if (OS.inShell) document.documentElement.classList.add('in-shell');

  /** The screenshots folder, unless changed in Settings. */
  const DIR = '/Pictures/Screenshots';
  const MODES = [
    { id: 'region', label: 'Region', icon: 'region' },
    { id: 'window', label: 'Window', icon: 'window' },
    { id: 'screen', label: 'Screen', icon: 'screen' },
  ];
  const DELAYS = [0, 3, 5, 10];
  const SMALL = [500, 232];
  const TALL = [500, 600];
  const EDITOR = [980, 680];
  const delayLabel = (d) => (d ? d + ' seconds' : 'No delay');
  const st = { kind: 'picture', mode: 'region', delay: 0, taking: false, view: 'home', back: 'home' };
  try {
    const k = JSON.parse(localStorage.getItem('los.screenshot') || '{}');
    if (MODES.some((m) => m.id === k.mode)) st.mode = k.mode;
    if (DELAYS.includes(k.delay)) st.delay = k.delay;
  } catch (e) { /* nothing kept */ }
  const remember = () => { try { localStorage.setItem('los.screenshot', JSON.stringify({ mode: st.mode, delay: st.delay })); } catch (e) { /* not kept */ } };

  /*
  |--------------------------------------------------------------------------
  | Title bar
  |--------------------------------------------------------------------------
  |
  | The window's chrome is custom.
  |
  */
  (function titleBar() {
    const img = OS.sysIcon ? OS.sysIcon('app.screenshot') : null;
    if (img) $('#tbIcon').innerHTML = '<img src="' + esc(img) + '" alt="" width="16" height="16" draggable="false">';
    $('#tbControls').style.width = (OS.win.controlsWidth || 0) + 'px';
    OS.win.dragRegion($('#titlebar'), (t) => !t.closest('button, input, label'));
  })();

  $('#newBtn').innerHTML = ico('plus', 16) + '<span>New</span>';
  $('#kindPicture').innerHTML = ico('camera', 18);
  $('#kindRecording').innerHTML = ico('camcorder', 18);
  $('#moreBtn').innerHTML = ico('more', 18);
  const caret = '<span class="ss-caret">' + ico('down', 12) + '</span>';
  const keys = (...k) => k.map((x) => '<b>' + esc(x) + '</b>').join(' + ');

  /**
   * render
   *
   * Shows the picture or recording choice, what to capture, the delay and the hint under them. The delay is off for a
   * recording, as a recording starts when it is asked for.
   */
  function render() {
    const rec = st.kind === 'recording';
    const m = MODES.find((x) => x.id === st.mode);
    $('#kindPicture').classList.toggle('on', !rec);
    $('#kindRecording').classList.toggle('on', rec);
    $('#kindPicture').setAttribute('aria-pressed', String(!rec));
    $('#kindRecording').setAttribute('aria-pressed', String(rec));
    $('#modeBtn').innerHTML = ico(m.icon, 18) + caret;
    $('#modeBtn').title = m.label;
    $('#modeBtn').setAttribute('aria-label', 'What to capture: ' + m.label);
    $('#delayBtn').innerHTML = ico(st.delay ? 'clock' : 'timerOff', 18) + (st.delay ? '<span>' + st.delay + 's</span>' : '') + caret;
    $('#delayBtn').title = delayLabel(st.delay);
    $('#delayBtn').setAttribute('aria-label', 'Delay: ' + delayLabel(st.delay));
    $('#delayBtn').disabled = rec;
    $('#newBtn').disabled = st.taking;
    const hint = $('#hint');
    hint.classList.remove('warn');
    if (!OS.capture.supported()) {
      hint.textContent = window.isSecureContext ? 'This browser can’t capture the screen.' : 'Screenshots need LiteOS to be opened over HTTPS.';
      hint.classList.add('warn');
    } else if (rec) hint.innerHTML = 'Press ' + keys('Ctrl', 'Alt', 'R') + ' to start a recording';
    else hint.innerHTML = 'Press ' + keys('Ctrl', 'Alt', 'S') + ' to start a snip';
  }

  const below = (b) => { const r = b.getBoundingClientRect(); return { x: r.left, y: r.bottom + 2 }; };
  /** A drop-down's button keeps its pressed look while its menu is open. */
  const pop = (b, items, at) => { b.classList.add('open'); OS.menu(items, at || below(b), { onClose: () => b.classList.remove('open') }); };
  $('#kindPicture').addEventListener('click', () => { st.kind = 'picture'; render(); });
  $('#kindRecording').addEventListener('click', () => { st.kind = 'recording'; render(); });
  $('#modeBtn').addEventListener('click', (e) => {
    pop(e.currentTarget, MODES.map((m) => ({ label: m.label, icon: m.icon, checked: m.id === st.mode, action: () => { st.mode = m.id; remember(); render(); } })));
  });
  $('#delayBtn').addEventListener('click', (e) => {
    pop(e.currentTarget, DELAYS.map((d) => ({ label: delayLabel(d), checked: d === st.delay, action: () => { st.delay = d; remember(); render(); } })));
  });
  $('#moreBtn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ed = M.open && st.view === 'editor';
    pop(e.currentTarget, [
      { label: 'Open file', icon: 'open', key: 'Ctrl+O', action: openFile },
    ].concat(ed ? [
      { label: 'Save as', icon: 'save', key: 'Ctrl+Shift+S', action: saveAs },
      { label: 'Show in folder', icon: 'folder', disabled: !M.path, action: () => OS.open('files', { path: M.path.replace(/\/[^/]*$/, '') || '/', select: M.path }) },
      { label: 'Zoom', icon: 'zoom', items: M.zooms.map((z) => ({ label: z ? Math.round(z * 100) + '%' : 'Fit to window', checked: z === M.zoom, action: () => M.setZoom(z) })) },
    ] : []).concat(['sep', { label: 'Settings', icon: 'settings', action: showSettings }]), { x: r.right - 220, y: r.bottom + 2 });
  });

  /*
  |--------------------------------------------------------------------------
  | Views
  |--------------------------------------------------------------------------
  |
  | The views: home, editor, settings.
  |
  */
  function showView(v) {
    st.view = v;
    $('#home').hidden = v === 'settings';
    $('#homeBody').hidden = v !== 'home';
    $('#editor').hidden = v !== 'editor';
    $('#settings').hidden = v !== 'settings';
    $('#toolsWrap').hidden = v !== 'editor';
    $('#edActs').hidden = v !== 'editor';
    closeFly();
    layout();
  }
  /**
   * One toolbar, as a snipping tool's: in a narrow window New and Whiteboard show only their icons and the markup
   * tools move to a bar along the bottom.
   */
  const NARROW = 860;
  /** While editing, New and Whiteboard show only their icons below this. */
  const COMPACT = 1080;
  function layout() {
    const w = $('#app').clientWidth;
    const narrow = w < NARROW && st.view === 'editor'; // only the editor changes its layout; the small window keeps New's label
    $('#app').classList.toggle('narrow', narrow);
    $('#app').classList.toggle('compact', st.view === 'editor' && w < COMPACT);
    const bottom = narrow && st.view === 'editor';
    const want = bottom ? $('#bottomBar') : $('#midSlot');
    if ($('#toolsWrap').parentElement !== want) want.appendChild($('#toolsWrap'));
    $('#bottomBar').hidden = !bottom;
  }
  new ResizeObserver(layout).observe($('#app'));

  /*
  |--------------------------------------------------------------------------
  | Settings
  |--------------------------------------------------------------------------
  |
  | Kept in the account's settings.
  |
  */
  const COLORS = ['#000000', '#FFFFFF', '#8C929C', '#D63B41', '#2F6FD6'];
  const WIDTHS = [1, 2, 4, 8];
  const opt = () => {
    const x = OS.settings || {};
    return {
      shotCopy: x.shotCopy !== false, shotSave: x.shotSave !== false, shotBorder: !!x.shotBorder,
      shotFolder: x.shotFolder || DIR, shotBorderColor: x.shotBorderColor || '#000000', shotBorderWidth: x.shotBorderWidth || 2,
      shotCopyEdits: x.shotCopyEdits !== false, shotAskSave: !!x.shotAskSave,
      shotRecSave: x.shotRecSave !== false, shotRecFolder: x.shotRecFolder || '/Videos/Recordings', shotRecMic: !!x.shotRecMic, shotRecSound: x.shotRecSound !== false,
    };
  };
  const folder = () => opt().shotFolder;
  /** Which rows show what is under them. */
  const open = { save: true, border: false, recSave: true };
  /** Every row's switch sits in one column, its On or Off after it, and the column for the arrow is kept on every row. */
  const sw = (key, on, label) => '<span class="ss-tog"><button type="button" class="switch" role="switch" aria-checked="' + on + '" data-set="' + key + '" aria-label="' + esc(label) + '"></button><span>' + (on ? 'On' : 'Off') + '</span></span>';
  const noMore = '<span class="ss-more-slot"></span>';
  const more = (key, label) => '<button type="button" class="ss-ib ss-more" data-open="' + key + '" aria-expanded="' + open[key] + '" aria-label="' + esc(label) + '">' + ico('down', 16) + '</button>';
  const row = (title, sub, ctl, cls) => '<div class="ss-row' + (cls ? ' ' + cls : '') + '"><div class="ss-row-text"><div class="ss-row-title">' + esc(title) + '</div>' +
    (sub ? '<div class="ss-row-sub">' + sub + '</div>' : '') + '</div>' + ctl + '</div>';

  function renderSettings() {
    const o = opt();
    $('#setBody').innerHTML = '<div class="ss-group">Snipping</div>' +
      row('Copy screenshots to the clipboard', 'Each screenshot is copied, ready to paste.', sw('shotCopy', o.shotCopy, 'Copy screenshots to the clipboard') + noMore) +
      row('Automatically copy changes', 'Edits to your screenshot are copied to your clipboard as you make them.', sw('shotCopyEdits', o.shotCopyEdits, 'Automatically copy changes') + noMore) +
      row('Automatically save original screenshots', '', sw('shotSave', o.shotSave, 'Automatically save original screenshots') + more('save', 'Where screenshots are saved'), open.save ? 'has-sub' : '') +
      '<div class="ss-sub"' + (open.save ? '' : ' hidden') + '><div class="ss-row-text"><div class="ss-row-title">Screenshots are saved to</div>' +
      '<div class="ss-row-sub">' + esc(o.shotFolder.replace(/^\//, 'My drive/')) + ' <button type="button" class="ss-link" id="setChange">Change</button></div></div>' +
      '<span class="ss-end"><button type="button" class="ss-btn" id="setOpenFolder">Open folder</button></span></div>' +
      row('Ask to save edited screenshots', 'When you close Screenshot with markup that isn’t saved.', sw('shotAskSave', o.shotAskSave, 'Ask to save edited screenshots') + noMore) +
      row('Add a border to each screenshot', '', sw('shotBorder', o.shotBorder, 'Add a border to each screenshot') + more('border', 'Border colour and thickness'), open.border ? 'has-sub' : '') +
      '<div class="ss-sub"' + (open.border ? '' : ' hidden') + '><div class="ss-row-text"><div class="ss-row-title">Colour</div></div><span class="ss-swatches">' +
      COLORS.map((c) => '<button type="button" class="ss-sw' + (c === o.shotBorderColor ? ' on' : '') + '" data-color="' + c + '" style="background:' + c + '" aria-label="' + c + '" aria-pressed="' + (c === o.shotBorderColor) + '"></button>').join('') + '</span>' +
      '<span class="ss-end"><button type="button" class="ss-ib ss-drop" id="setWidth" aria-haspopup="menu" aria-label="Thickness">' + esc(o.shotBorderWidth + ' px') + caret + '</button></span></div>' +
      '<div class="ss-group">Screen recording</div>' +
      row('Automatically save screen recordings', 'When this is off, you\u2019re asked where to save each one.', sw('shotRecSave', o.shotRecSave, 'Automatically save screen recordings') + more('recSave', 'Where screen recordings are saved'), open.recSave ? 'has-sub' : '') +
      '<div class="ss-sub"' + (open.recSave ? '' : ' hidden') + '><div class="ss-row-text"><div class="ss-row-title">Screen recordings are saved to</div>' +
      '<div class="ss-row-sub">' + esc(o.shotRecFolder.replace(/^\//, 'My drive/')) + ' <button type="button" class="ss-link" id="setRecChange">Change</button></div></div>' +
      '<span class="ss-end"><button type="button" class="ss-btn" id="setRecOpenFolder">Open folder</button></span></div>' +
      row('Include microphone input by default when a screen recording starts', '', sw('shotRecMic', o.shotRecMic, 'Include microphone input by default') + noMore) +
      row('Include sound from LiteOS by default when a screen recording starts', 'The sound playing in LiteOS, such as a video.', sw('shotRecSound', o.shotRecSound, 'Include sound from LiteOS by default') + noMore);
  }
  async function change(changes) {
    await OS.saveSettings(changes);
    renderSettings();
    edChanged();
  }
  $('#setBody').addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.set) change({ [t.dataset.set]: t.getAttribute('aria-checked') !== 'true' });
    else if (t.dataset.open) { open[t.dataset.open] = !open[t.dataset.open]; renderSettings(); }
    else if (t.dataset.color) change({ shotBorderColor: t.dataset.color });
    else if (t.id === 'setOpenFolder') openFolder();
    else if (t.id === 'setRecOpenFolder') openFolder(opt().shotRecFolder);
    else if (t.id === 'setRecChange') {
      const dir = await OS.dialog.folder({ title: 'Save screen recordings in', startIn: opt().shotRecFolder });
      if (dir && dir.startsWith('/') && dir !== '/') change({ shotRecFolder: dir });
      else if (dir === '/') OS.notify('Choose a folder in My drive.', { type: 'error', title: 'Can\u2019t save there' });
    }
    else if (t.id === 'setWidth') pop(t, WIDTHS.map((w) => ({ label: w + ' px', checked: w === opt().shotBorderWidth, action: () => change({ shotBorderWidth: w }) })));
    else if (t.id === 'setChange') {
      const dir = await OS.dialog.folder({ title: 'Save screenshots in', startIn: folder() });
      if (dir && dir.startsWith('/') && dir !== '/') change({ shotFolder: dir });
      else if (dir === '/') OS.notify('Choose a folder in My drive.', { type: 'error', title: 'Can’t save there' });
    }
  });
  function showSettings() {
    st.back = st.view === 'settings' ? st.back : st.view;
    showView('settings');
    renderSettings();
    if (st.back === 'home') OS.win.resize(TALL[0], TALL[1]);
    $('#setBack').focus();
  }
  function hideSettings() {
    showView(st.back);
    if (st.back === 'home') OS.win.resize(SMALL[0], SMALL[1]);
    $('#moreBtn').focus();
  }
  $('#setBack').innerHTML = ico('back', 18);
  $('#setBack').addEventListener('click', hideSettings);

  async function ensureDir(dir) {
    let at = '';
    for (const part of (dir || folder()).split('/').filter(Boolean)) {
      at += '/' + part;
      try { await OS.fs.mkdir(at); } catch (e) { /* it's there already */ }
    }
  }
  async function openFile() {
    await ensureDir();
    const path = await OS.dialog.open({ title: 'Open a picture', accept: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'], startIn: folder() });
    if (path) openPicture(path);
  }
  async function openFolder(dir) {
    dir = typeof dir === 'string' ? dir : folder();
    await ensureDir(dir);
    OS.open('files', { path: dir });
  }

  /**
   * take
   *
   * Takes a picture of what is chosen after the delay. The new snip comes up here to mark up, as a snipping tool does.
   */
  async function take() {
    if (st.taking) return;
    OS.closeMenu();
    if (st.kind === 'recording') { OS.capture.record({ mode: st.mode }); return; } // the desktop takes it from here
    st.taking = true;
    render();
    let res = null;
    try { res = await OS.capture.take({ mode: st.mode, delay: st.delay }); } finally { st.taking = false; render(); }
    if (res && res.path) openPicture(res.path, true);
  }
  $('#newBtn').addEventListener('click', take);

  /*
  |--------------------------------------------------------------------------
  | Editor
  |--------------------------------------------------------------------------
  |
  | The editor (markup.js).
  |
  */
  const TOOLS = [
    { id: 'pen', label: 'Pen', icon: 'pen', fly: true },
    { id: 'hl', label: 'Highlighter', icon: 'highlighter', fly: true },
    { id: 'eraser', label: 'Eraser', icon: 'eraser' },
    { id: 'shape', label: 'Shapes', icon: 'arrow', fly: true, list: true },
    { id: 'text', label: 'Text', icon: 'text', fly: true },
    { id: 'blur', label: 'Blur', icon: 'pixelate' },
    { id: 'crop', label: 'Crop', icon: 'crop' },
  ];
  let copyTimer = 0;
  let lastLen = 0;
  const M = window.SSMarkup(OS, {
    changed: () => edChanged(),
    zoomed: () => {},
    cropping: (on) => { $('#toolsMain').hidden = on; $('#cropBar').hidden = !on; renderTools(); },
    cropSize: (s) => { $('#cropSize').textContent = s; },
  });
  $('#undoBtn').innerHTML = ico('undo', 18);
  $('#redoBtn').innerHTML = ico('redo', 18);
  $('#saveBtn').innerHTML = ico('save', 18);
  $('#copyBtn').innerHTML = ico('copy', 18);
  (function boardButton() {
    const img = OS.sysIcon ? OS.sysIcon('app.board') : null;
    $('#boardBtn').innerHTML = (img ? '<img src="' + esc(img) + '" alt="" width="18" height="18" draggable="false">' : ico('pen', 18)) + '<span>Whiteboard</span>';
    if (!(window.LOS_app && window.LOS_app('board'))) $('#boardBtn').hidden = true;
  })();
  $('#cropApply').innerHTML = ico('check', 16) + '<span>Apply</span>';
  $('#cropCancel').innerHTML = ico('x', 16) + '<span>Cancel</span>';

  function renderTools() {
    $('#toolGroup').innerHTML = TOOLS.map((t) => {
      const icon = t.id === 'shape' ? M.shapes.find((s) => s.id === M.shape).icon : t.icon;
      const on = M.tool === t.id;
      return '<button type="button" class="ss-ib' + (on ? ' on' : '') + '" data-tool="' + t.id + '" title="' + esc(t.label) + '" aria-label="' + esc(t.label) + '" aria-pressed="' + on + '">' +
        ico(icon, 18) + (t.list ? caret : '') + '</button>';
    }).join('');
  }
  /**
   * edChanged
   *
   * Updates undo, redo and the title after a change. Edits are copied as they change, a moment after the last one
   * (Settings › Automatically copy changes).
   */
  function edChanged() {
    if (!M.open) return;
    $('#undoBtn').disabled = !M.canUndo;
    $('#redoBtn').disabled = !M.canRedo;
    const name = M.name + (M.dirty ? ' *' : '');
    $('#tbName').textContent = name;
    OS.win.setTitle(M.name);
    OS.win.setDirty(M.dirty && opt().shotAskSave);
    const len = M.canUndo ? 1 : 0;
    if (opt().shotCopyEdits && M.dirty && (len || lastLen)) {
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { M.copy().catch(() => {}); }, 700);
    }
    lastLen = len;
  }
  async function openPicture(path, fresh) {
    if (M.open && M.dirty && !fresh) {
      const ok = await OS.dialog.confirm({ title: 'Open another picture?', message: 'Your markup on “' + M.name + '” isn’t saved. It will be lost.', okLabel: 'Open without saving', danger: true });
      if (!ok) return;
    }
    try { await M.open(path); } catch (e) { OS.notify(e.message || 'It couldn’t be opened.', { type: 'error', title: 'Couldn’t open the picture' }); return; }
    const wasHome = st.view !== 'editor';
    showView('editor');
    renderTools();
    if (wasHome) OS.win.resize(EDITOR[0], EDITOR[1]);
    edChanged();
  }
  async function save() {
    if (!M.open) return;
    if (!M.path) return saveAs();
    try { await M.saveTo(M.path); } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t save' }); }
  }
  async function saveAs() {
    if (!M.open) return;
    const dir = M.path ? M.path.replace(/\/[^/]*$/, '') : folder();
    const path = await OS.dialog.save({ title: 'Save as', defaultName: M.name.replace(/\.[^.]+$/, '') || 'Screenshot', ext: 'png', startIn: dir || folder() });
    if (!path) return;
    try { await M.saveTo(/\.png$/i.test(path) ? path : path + '.png'); } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t save' }); }
  }
  async function copy() {
    if (!M.open) return;
    try {
      await M.copy();
      const b = $('#copyBtn');
      b.innerHTML = ico('check', 18);
      setTimeout(() => { b.innerHTML = ico('copy', 18); }, 1200);
    } catch (e) { OS.notify('The browser didn’t allow copying it.', { type: 'error', title: 'Couldn’t copy' }); }
  }
  /** Opens the picture in Whiteboard, which opens the saved picture, so it is saved first. */
  async function openInBoard() {
    if (!M.open) return;
    if (M.dirty || !M.path) await (M.path ? save() : saveAs());
    if (M.path && !M.dirty) OS.open('board', { path: M.path });
  }

  $('#undoBtn').addEventListener('click', () => M.undo());
  $('#redoBtn').addEventListener('click', () => M.redo());
  $('#saveBtn').addEventListener('click', save);
  $('#copyBtn').addEventListener('click', copy);
  $('#cropApply').addEventListener('click', () => { M.applyCrop(); M.setTool('pen'); renderTools(); });
  $('#cropCancel').addEventListener('click', () => { M.cancelCrop(); renderTools(); });
  $('#boardBtn').addEventListener('click', openInBoard);
  /** Ctrl+wheel zooms the picture. */
  $('#stage').addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !M.open) return;
    e.preventDefault();
    const steps = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
    const cur = M.zoom || M.fitZoom;
    const next = e.deltaY < 0 ? steps.find((z) => z > cur + 0.01) : [...steps].reverse().find((z) => z < cur - 0.01);
    if (next) M.setZoom(next);
  }, { passive: false });
  /** Picks a tool. Shapes shows the list of them, then (picked again) its colour and size. */
  $('#toolGroup').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    const t = TOOLS.find((x) => x.id === b.dataset.tool);
    if (t.list) {
      pop(b, M.shapes.map((s) => ({ label: s.label, icon: s.icon, checked: M.tool === 'shape' && s.id === M.shape, action: () => { M.setShape(s.id); M.setTool('shape'); renderTools(); } }))
        .concat(['sep', { label: 'Colour and size', icon: 'palette', action: () => { M.setTool('shape'); renderTools(); openFly($('[data-tool="shape"]'), 'shape'); } }]));
      return;
    }
    if (M.tool === t.id && t.fly) { openFly(b, t.id); return; }
    M.setTool(t.id);
    renderTools();
  });

  /** The colour and size of a tool: picking it again opens them. */
  let fly = null;
  function closeFly() { if (fly) { fly.el.remove(); fly.btn.classList.remove('open'); fly = null; } }
  function openFly(btn, tool) {
    if (fly && fly.tool === tool) { closeFly(); return; }
    closeFly();
    const s = M.style(tool);
    const isText = tool === 'text';
    const el = document.createElement('div');
    el.className = 'ss-fly';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Colour and size');
    el.innerHTML = '<div class="ss-fly-colors">' + M.colors.map((c) => '<button type="button" class="ss-sw' + (c === s.color ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="' + c + '" aria-pressed="' + (c === s.color) + '"></button>').join('') + '</div>' +
      '<label class="ss-fly-size"><span>Size</span><input type="range" min="' + (isText ? 10 : 1) + '" max="' + (isText ? 96 : 24) + '" step="1" value="' + s.size + '" aria-label="Size"><output>' + s.size + '</output></label>';
    document.body.appendChild(el);
    const r = btn.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, r.left + r.width / 2 - el.offsetWidth / 2)) + 'px';
    el.style.top = (r.bottom + 6) + 'px';
    btn.classList.add('open');
    fly = { el, btn, tool };
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-c]');
      if (!c) return;
      M.setStyle(tool, { color: c.dataset.c });
      el.querySelectorAll('[data-c]').forEach((x) => { x.classList.toggle('on', x === c); x.setAttribute('aria-pressed', String(x === c)); });
    });
    el.querySelector('input').addEventListener('input', (e) => { const v = +e.target.value; M.setStyle(tool, { size: v }); el.querySelector('output').textContent = v; });
  }
  document.addEventListener('pointerdown', (e) => { if (fly && !fly.el.contains(e.target) && !fly.btn.contains(e.target)) closeFly(); }, true);

  /*
  |--------------------------------------------------------------------------
  | Keys
  |--------------------------------------------------------------------------
  */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (fly) { e.preventDefault(); closeFly(); return; }
      if (st.view === 'settings' && !e.defaultPrevented) { e.preventDefault(); hideSettings(); return; }
      if (st.view === 'editor' && M.cropping) { e.preventDefault(); M.cancelCrop(); renderTools(); return; }
    }
    if (st.view === 'editor' && M.cropping && e.key === 'Enter') { e.preventDefault(); M.applyCrop(); M.setTool('pen'); renderTools(); return; }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || (M.typing && M.typing())) return;
    const k = e.key.toLowerCase();
    if (k === 'n' && !e.shiftKey) { e.preventDefault(); take(); }
    else if (k === 'o' && !e.shiftKey) { e.preventDefault(); openFile(); }
    else if (st.view !== 'editor') return;
    else if (k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else save(); }
    else if (k === 'c' && !e.shiftKey && !String(getSelection())) { e.preventDefault(); copy(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); M.redo(); }
    else if (k === 'z') { e.preventDefault(); M.undo(); }
  });

  /** Opened again with a picture (Markup and share in the notification): the page stays, so markup isn't lost unasked. */
  OS.win.onArgs((args) => { if (args && args.path) openPicture(args.path); });

  /* Without a picture it always starts compact, whatever size it last had (Settings is taller). */
  render();
  if (OS.args.path) openPicture(OS.args.path, true);
  else OS.win.resize(SMALL[0], SMALL[1]);
});
