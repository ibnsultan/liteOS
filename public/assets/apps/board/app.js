/* LiteOS Whiteboard: vector action list re-rendered onto layered canvases. */
LiteOS.ready((OS) => {
  'use strict';

  const U = OS.util;
  const ic = (n, s) => LOS_icon(n, s);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  $$('[data-icon]').forEach((el) => { el.outerHTML = ic(el.dataset.icon, 16); });

  const COLORS = ['#16171A', '#D63B41', '#DD630A', '#F2C94C', '#1A8A54', '#2F6FD6', '#6B4CCB', '#C9306B'];
  const SIZES = [2, 4, 8, 16];
  const SHAPES = ['line', 'arrow', 'rect', 'ellipse'];

  const stage = $('#stage');
  const bgC = $('#bgCanvas'); const inkC = $('#inkCanvas'); const liveC = $('#liveCanvas');
  const bg = bgC.getContext('2d'); const ink = inkC.getContext('2d'); const live = liveC.getContext('2d');
  const cursorEl = $('#cursor');

  const S = {
    tool: 'pen', color: COLORS[0], size: SIZES[1], fill: false, bg: 'dots',
    actions: [], redo: [], savePath: null, dirty: false,
    W: 0, H: 0, dpr: 1,
  };
  const images = new Map(); // path -> HTMLImageElement (loaded)

  // Preferences (per browser).
  try {
    const p = JSON.parse(localStorage.getItem('liteos.board.prefs') || 'null');
    if (p) {
      if (['plain', 'dots', 'lines'].includes(p.bg)) S.bg = p.bg;
      if (SIZES.includes(p.size)) S.size = p.size;
      if (/^#[0-9a-f]{6}$/i.test(p.color || '')) S.color = p.color;
      S.fill = !!p.fill;
    }
  } catch (e) { /* storage unavailable */ }
  function savePrefs() {
    try { localStorage.setItem('liteos.board.prefs', JSON.stringify({ bg: S.bg, size: S.size, color: S.color, fill: S.fill })); } catch (e) { /* ignore */ }
  }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  // ------------------------------------------------------------ sizing
  function resize() {
    const r = stage.getBoundingClientRect();
    S.W = Math.max(1, Math.round(r.width));
    S.H = Math.max(1, Math.round(r.height));
    S.dpr = Math.min(3, window.devicePixelRatio || 1);
    [bgC, inkC, liveC].forEach((c) => {
      c.width = Math.round(S.W * S.dpr);
      c.height = Math.round(S.H * S.dpr);
      c.style.width = S.W + 'px';
      c.style.height = S.H + 'px';
    });
    [bg, ink, live].forEach((x) => x.setTransform(S.dpr, 0, 0, S.dpr, 0, 0));
    renderAll();
  }
  new ResizeObserver(() => resize()).observe(stage);
  window.addEventListener('resize', () => { if ((window.devicePixelRatio || 1) !== S.dpr) resize(); });

  // ------------------------------------------------------------ rendering
  function visibleActions() {
    let start = 0;
    for (let i = S.actions.length - 1; i >= 0; i--) if (S.actions[i].type === 'clear') { start = i + 1; break; }
    return S.actions.slice(start);
  }
  function currentImage(list) {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].type === 'image') return list[i];
    return null;
  }

  function drawBackground(ctx, w, h, list) {
    ctx.save();
    ctx.fillStyle = cssVar('--wb-paper', '#FFFFFF');
    ctx.fillRect(0, 0, w, h);
    if (S.bg === 'dots') {
      ctx.fillStyle = cssVar('--wb-grid', '#C9D0DA');
      const g = 24;
      for (let y = g; y < h; y += g) for (let x = g; x < w; x += g) { ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill(); }
    } else if (S.bg === 'lines') {
      ctx.strokeStyle = cssVar('--wb-rule', '#DCE3EC');
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 40; y < h; y += 32) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
      ctx.stroke();
      ctx.strokeStyle = cssVar('--wb-margin', '#F2B8BE');
      ctx.beginPath(); ctx.moveTo(64.5, 0); ctx.lineTo(64.5, h); ctx.stroke();
    }
    const im = currentImage(list);
    if (im) {
      const el = images.get(im.path);
      if (el && el.complete && el.naturalWidth) ctx.drawImage(el, im.x, im.y, im.w, im.h);
    }
    ctx.restore();
  }

  function renderAll() {
    const list = visibleActions();
    drawBackground(bg, S.W, S.H, list);
    ink.clearRect(0, 0, S.W, S.H);
    list.forEach((a) => drawAction(ink, a));
    live.clearRect(0, 0, S.W, S.H);
    updateButtons();
  }

  function strokeWidth(a) {
    if (a.type === 'hl') return Math.max(12, a.size * 3);
    if (a.type === 'eraser') return Math.max(12, a.size * 4);
    return a.size;
  }
  function fontSize(size) { return 14 + size * 2; }

  function drawAction(ctx, a) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    if (a.type === 'pen' || a.type === 'hl' || a.type === 'eraser') {
      if (a.type === 'hl') { ctx.globalAlpha = 0.35; ctx.lineCap = 'butt'; ctx.globalCompositeOperation = 'multiply'; }
      if (a.type === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; }
      drawPath(ctx, a);
    } else if (SHAPES.includes(a.type)) {
      drawShape(ctx, a);
    } else if (a.type === 'text') {
      ctx.font = '500 ' + fontSize(a.size) + 'px ' + cssVar('--font', 'sans-serif');
      ctx.textBaseline = 'top';
      String(a.text).split('\n').forEach((line, i) => ctx.fillText(line, a.x, a.y + i * fontSize(a.size) * 1.2));
    }
    ctx.restore();
  }

  function drawPath(ctx, a) {
    const pts = a.points;
    const w = strokeWidth(a);
    if (!pts.length) return;
    if (pts.length === 1) {
      ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], w / 2, 0, Math.PI * 2); ctx.fill(); return;
    }
    if (a.pressure && a.type === 'pen') {
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1]; const p1 = pts[i];
        ctx.lineWidth = Math.max(0.6, w * (0.35 + ((p0[2] + p1[2]) / 2) * 1.3));
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      }
      return;
    }
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2; const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const l = pts[pts.length - 1];
    ctx.lineTo(l[0], l[1]);
    ctx.stroke();
  }

  function drawShape(ctx, a) {
    const { x1, y1, x2, y2 } = a;
    ctx.lineWidth = a.size;
    if (a.type === 'line' || a.type === 'arrow') {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (a.type === 'arrow') {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const len = Math.min(Math.hypot(x2 - x1, y2 - y1) * 0.5, 10 + a.size * 3);
        ctx.beginPath();
        ctx.moveTo(x2 - len * Math.cos(ang - Math.PI / 7), y2 - len * Math.sin(ang - Math.PI / 7));
        ctx.lineTo(x2, y2);
        ctx.lineTo(x2 - len * Math.cos(ang + Math.PI / 7), y2 - len * Math.sin(ang + Math.PI / 7));
        ctx.stroke();
      }
      return;
    }
    const x = Math.min(x1, x2); const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1); const h = Math.abs(y2 - y1);
    ctx.beginPath();
    if (a.type === 'rect') {
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(4, w / 2, h / 2)); else ctx.rect(x, y, w, h);
    } else {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    }
    if (a.fill) { ctx.save(); ctx.globalAlpha = 0.28; ctx.fill(); ctx.restore(); }
    ctx.stroke();
  }

  // ------------------------------------------------------------ actions / history
  function commit(a) {
    S.actions.push(a);
    S.redo = [];
    markDirty();
  }
  function undo() {
    if (!S.actions.length) return;
    S.redo.push(S.actions.pop());
    renderAll(); markDirty();
  }
  function redo() {
    if (!S.redo.length) return;
    S.actions.push(S.redo.pop());
    renderAll(); markDirty();
  }
  function markDirty() {
    S.dirty = true;
    OS.win.setDirty(true);
    updateButtons();
    updateTitle();
  }
  function updateButtons() {
    $('#undo').disabled = !S.actions.length;
    $('#redo').disabled = !S.redo.length;
  }
  function updateTitle() {
    OS.win.setTitle((S.savePath ? U.basename(S.savePath) : 'Untitled') + (S.dirty ? ' •' : '') + ' — Whiteboard');
  }

  // ------------------------------------------------------------ pointer input
  let cur = null; // in-progress action
  let pid = null;

  function pos(e) {
    const r = liveC.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5];
  }

  liveC.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (pid !== null) return;
    commitText();
    const p = pos(e);
    if (S.tool === 'text') { e.preventDefault(); startText(p[0], p[1]); return; }
    pid = e.pointerId;
    liveC.setPointerCapture(pid);
    if (S.tool === 'pen' || S.tool === 'hl' || S.tool === 'eraser') {
      cur = { type: S.tool, color: S.color, size: S.size, points: [p], pressure: e.pointerType === 'pen' };
      if (S.tool === 'eraser') eraseSeg(p, p);
    } else {
      cur = { type: S.tool, color: S.color, size: S.size, fill: S.fill, x1: p[0], y1: p[1], x2: p[0], y2: p[1] };
    }
    drawLive();
    e.preventDefault();
  });

  liveC.addEventListener('pointermove', (e) => {
    moveCursor(e);
    if (!cur || e.pointerId !== pid) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const list = evs.length ? evs : [e];
    if (cur.points) {
      list.forEach((ev) => {
        const p = pos(ev);
        const last = cur.points[cur.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.8) return;
        if (cur.type === 'eraser') eraseSeg(last, p);
        cur.points.push(p);
      });
    } else {
      const p = pos(e);
      let x2 = p[0]; let y2 = p[1];
      if (e.shiftKey) {
        const dx = x2 - cur.x1; const dy = y2 - cur.y1;
        if (cur.type === 'rect' || cur.type === 'ellipse') {
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          x2 = cur.x1 + Math.sign(dx || 1) * m; y2 = cur.y1 + Math.sign(dy || 1) * m;
        } else {
          const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          const d = Math.hypot(dx, dy);
          x2 = cur.x1 + Math.cos(ang) * d; y2 = cur.y1 + Math.sin(ang) * d;
        }
      }
      cur.x2 = x2; cur.y2 = y2;
    }
    drawLive();
  });

  function endStroke(e, cancel) {
    if (!cur || e.pointerId !== pid) return;
    try { liveC.releasePointerCapture(pid); } catch (err) { /* ignore */ }
    const a = cur;
    cur = null; pid = null;
    live.clearRect(0, 0, S.W, S.H);
    const tiny = a.points ? false : Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 3;
    if (cancel || tiny) { if (a.type === 'eraser') renderAll(); return; }
    if (a.type !== 'eraser') drawAction(ink, a);
    commit(a);
  }
  liveC.addEventListener('pointerup', (e) => endStroke(e, false));
  liveC.addEventListener('pointercancel', (e) => endStroke(e, true));
  liveC.addEventListener('pointerleave', () => { cursorEl.hidden = true; });
  liveC.addEventListener('pointerenter', (e) => moveCursor(e));

  function drawLive() {
    live.clearRect(0, 0, S.W, S.H);
    if (!cur || cur.type === 'eraser') return;
    drawAction(live, cur);
  }
  function eraseSeg(a, b) {
    ink.save();
    ink.globalCompositeOperation = 'destination-out';
    ink.lineCap = 'round';
    ink.lineWidth = strokeWidth(cur || { type: 'eraser', size: S.size });
    ink.beginPath(); ink.moveTo(a[0], a[1]); ink.lineTo(b[0] + 0.01, b[1]); ink.stroke();
    ink.restore();
  }
  function moveCursor(e) {
    if (S.tool !== 'eraser' || e.pointerType === 'touch') { cursorEl.hidden = true; return; }
    const r = stage.getBoundingClientRect();
    const d = strokeWidth({ type: 'eraser', size: S.size });
    cursorEl.hidden = false;
    cursorEl.style.width = cursorEl.style.height = d + 'px';
    cursorEl.style.left = (e.clientX - r.left) + 'px';
    cursorEl.style.top = (e.clientY - r.top) + 'px';
  }

  // ------------------------------------------------------------ text tool
  let textBox = null;
  function startText(x, y) {
    const fs = fontSize(S.size);
    const t = document.createElement('input');
    t.type = 'text';
    t.className = 'wb-text';
    t.style.left = x + 'px';
    t.style.top = (y - fs * 0.6) + 'px';
    t.style.fontSize = fs + 'px';
    t.style.color = S.color;
    t.style.width = '60px';
    t.setAttribute('aria-label', 'Text');
    t.dataset.x = x; t.dataset.y = y - fs * 0.6 + 1;
    t.dataset.size = S.size; t.dataset.color = S.color;
    const grow = () => {
      live.font = '500 ' + fs + 'px ' + cssVar('--font', 'sans-serif');
      t.style.width = Math.max(60, live.measureText(t.value).width + fs) + 'px';
    };
    t.addEventListener('input', grow);
    t.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitText(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelText(); }
    });
    t.addEventListener('blur', () => setTimeout(() => { if (textBox === t) commitText(); }, 0));
    stage.appendChild(t);
    textBox = t;
    setTimeout(() => t.focus(), 0);
  }
  function commitText() {
    const t = textBox;
    if (!t) return;
    textBox = null;
    const text = t.value.replace(/\s+$/, '');
    t.remove();
    if (!text) return;
    const a = { type: 'text', text, x: +t.dataset.x + 3, y: +t.dataset.y + 1, size: +t.dataset.size, color: t.dataset.color };
    drawAction(ink, a);
    commit(a);
  }
  function cancelText() { if (textBox) { textBox.remove(); textBox = null; } }

  // ------------------------------------------------------------ controls
  function setTool(t) {
    commitText();
    S.tool = t;
    $$('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    stage.className = 'wb-stage grow tool-' + t;
    if (t !== 'eraser') cursorEl.hidden = true;
  }
  $('#tools').addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });

  const swatches = $('#swatches');
  const customColor = $('#customColor');
  swatches.innerHTML = COLORS.map((c) => '<button class="wb-swatch" role="radio" data-color="' + c + '" style="background:' + c + '" title="' + c + '" aria-label="Colour ' + c + '"></button>').join('');
  function setColor(c) {
    S.color = c;
    let matched = false;
    $$('.wb-swatch', swatches).forEach((b) => { const on = b.dataset.color.toLowerCase() === c.toLowerCase(); matched = matched || on; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
    customColor.parentElement.classList.toggle('active', !matched);
    if (!matched) customColor.value = c;
    if (textBox) textBox.style.color = c;
    savePrefs();
  }
  swatches.addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (b) { setColor(b.dataset.color); if (S.tool === 'eraser') setTool('pen'); } });
  customColor.addEventListener('input', () => setColor(customColor.value));

  const sizes = $('#sizes');
  sizes.innerHTML = SIZES.map((s) => { const d = Math.min(18, 3 + s); return '<button class="wb-size" role="radio" data-size="' + s + '" title="Size ' + s + '" aria-label="Size ' + s + '"><i style="width:' + d + 'px;height:' + d + 'px"></i></button>'; }).join('');
  function setSize(s) {
    S.size = s;
    $$('.wb-size', sizes).forEach((b) => { const on = +b.dataset.size === s; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
    savePrefs();
  }
  sizes.addEventListener('click', (e) => { const b = e.target.closest('[data-size]'); if (b) setSize(+b.dataset.size); });

  const fillBtn = $('#fill');
  function setFill(f) { S.fill = f; fillBtn.setAttribute('aria-pressed', f ? 'true' : 'false'); savePrefs(); }
  fillBtn.addEventListener('click', () => setFill(!S.fill));

  function setBg(b) {
    S.bg = b;
    $$('#bgSeg button').forEach((x) => { const on = x.dataset.bg === b; x.classList.toggle('active', on); x.setAttribute('aria-checked', on); });
    savePrefs();
    drawBackground(bg, S.W, S.H, visibleActions());
  }
  $('#bgSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-bg]'); if (b) setBg(b.dataset.bg); });

  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#clear').addEventListener('click', clearBoard);
  $('#save').addEventListener('click', (e) => save(e.shiftKey));
  $('#openImg').addEventListener('click', openImage);
  $('#more').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    OS.menu([
      { label: 'Save', icon: 'save', key: 'Ctrl+S', action: () => save(false) },
      { label: 'Save as…', icon: 'save', key: 'Ctrl+Shift+S', action: () => save(true) },
      { label: 'Open image…', icon: 'image', key: 'Ctrl+O', action: openImage },
      { label: 'Remove background image', icon: 'x', disabled: !currentImage(visibleActions()) || (currentImage(visibleActions()).path === null), action: removeImage },
      'sep',
      { label: 'Clear board', icon: 'trash', danger: true, action: clearBoard },
    ], { x: r.left, y: r.bottom + 4 });
  });

  async function clearBoard() {
    commitText();
    if (!visibleActions().length) return;
    const ok = await OS.dialog.confirm({ title: 'Clear the board?', message: 'Everything on the board will be removed. You can undo this with Ctrl+Z.', okLabel: 'Clear', danger: true });
    if (!ok) return;
    commit({ type: 'clear' });
    renderAll();
  }

  // ------------------------------------------------------------ images
  function loadImage(path) {
    if (images.has(path)) return Promise.resolve(images.get(path));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { images.set(path, img); resolve(img); };
      img.onerror = () => reject(new Error('Could not load ' + U.basename(path)));
      img.src = OS.fs.rawUrl(path);
    });
  }
  async function openImage() {
    commitText();
    const path = await OS.dialog.open({ title: 'Open image', accept: LOS_KINDS.image, startIn: '/Pictures' });
    if (!path) return;
    await placeImage(path);
  }
  async function placeImage(path) {
    if (!LOS_KINDS.image.includes(U.ext(path))) { OS.notify('Choose an image file (' + LOS_KINDS.image.join(', ') + ').', { type: 'error', title: 'Not an image file' }); return; }
    try {
      const img = await loadImage(path);
      const iw = img.naturalWidth || 800; const ih = img.naturalHeight || 600;
      const k = Math.min((S.W - 40) / iw, (S.H - 40) / ih, 1);
      const w = Math.max(1, iw * k); const h = Math.max(1, ih * k);
      commit({ type: 'image', path, x: (S.W - w) / 2, y: (S.H - h) / 2, w, h });
      renderAll();
    } catch (e) {
      OS.notify(e.message || 'Could not open the image.', { type: 'error', title: 'Couldn’t open image' });
    }
  }
  function removeImage() {
    commit({ type: 'image', path: null, x: 0, y: 0, w: 0, h: 0 });
    renderAll();
  }

  // ------------------------------------------------------------ export / save
  function contentBounds() {
    let mx = S.W; let my = S.H;
    visibleActions().forEach((a) => {
      if (a.points) a.points.forEach((p) => { mx = Math.max(mx, p[0] + 20); my = Math.max(my, p[1] + 20); });
      else if (a.type === 'text') { mx = Math.max(mx, a.x + 20); my = Math.max(my, a.y + fontSize(a.size) * 1.4); }
      else if (a.type === 'image' && a.path) { mx = Math.max(mx, a.x + a.w); my = Math.max(my, a.y + a.h); }
      else if (a.x2 != null) { mx = Math.max(mx, a.x1 + 20, a.x2 + 20); my = Math.max(my, a.y1 + 20, a.y2 + 20); }
    });
    return [Math.ceil(Math.min(mx, 8000)), Math.ceil(Math.min(my, 8000))];
  }
  function exportBlob() {
    const [w, h] = contentBounds();
    const scale = Math.min(2, Math.max(1, S.dpr), 16000 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const x = c.getContext('2d');
    x.setTransform(scale, 0, 0, scale, 0, 0);
    const list = visibleActions();
    drawBackground(x, w, h, list);
    // Ink on its own layer so the eraser doesn't cut through the paper.
    const layer = document.createElement('canvas');
    layer.width = c.width; layer.height = c.height;
    const lx = layer.getContext('2d');
    lx.setTransform(scale, 0, 0, scale, 0, 0);
    list.forEach((a) => drawAction(lx, a));
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.drawImage(layer, 0, 0);
    return new Promise((resolve, reject) => {
      try { c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'); }
      catch (e) { reject(e); }
    });
  }

  let saving = false;
  async function save(saveAs) {
    commitText();
    if (saving) return;
    let path = S.savePath;
    if (!path || saveAs) {
      path = await OS.dialog.save({ title: 'Save whiteboard', defaultName: path ? U.basename(path) : 'Whiteboard.png', ext: 'png', startIn: path ? U.dirname(path) : '/Pictures' });
      if (!path) return;
      if (U.ext(path) !== 'png') path += '.png';
    }
    saving = true;
    const btn = $('#save');
    btn.disabled = true;
    try {
      const blob = await exportBlob();
      const b64 = await U.toBase64(blob);
      await OS.fs.writeBase64(path, b64);
      S.savePath = path;
      S.dirty = false;
      OS.win.setDirty(false);
      updateTitle();
      OS.notify('Your whiteboard is saved as ' + U.basename(path) + '.', { type: 'success', title: 'Whiteboard saved' });
    } catch (e) {
      OS.notify(e.message || 'Could not save the whiteboard.', { type: 'error', title: 'Couldn’t save whiteboard' });
    } finally {
      saving = false;
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------ keyboard
  const KEYS = { p: 'pen', h: 'hl', e: 'eraser', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', t: 'text' };
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) { undo(); e.preventDefault(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { redo(); e.preventDefault(); }
    else if (mod && k === 's') { save(e.shiftKey); e.preventDefault(); }
    else if (mod && k === 'o') { openImage(); e.preventDefault(); }
    else if (!mod && !e.altKey && KEYS[k]) { setTool(KEYS[k]); }
    else if (!mod && (e.key === '[' || e.key === ']')) {
      const i = SIZES.indexOf(S.size) + (e.key === ']' ? 1 : -1);
      if (i >= 0 && i < SIZES.length) setSize(SIZES[i]);
    }
  });

  // Theme changes don't affect the paper, but re-read colours anyway.
  OS.onSettings(() => renderAll());

  // ------------------------------------------------------------ start
  setTool('pen');
  setColor(S.color);
  setSize(S.size);
  setFill(S.fill);
  setBg(S.bg);
  resize();
  updateTitle();
  if (OS.args.path && LOS_KINDS.image.includes(U.ext(OS.args.path))) {
    placeImage(OS.args.path).then(() => { S.dirty = false; OS.win.setDirty(false); updateTitle(); });
  }
});
