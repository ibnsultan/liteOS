/*
|--------------------------------------------------------------------------
| Screenshot markup
|--------------------------------------------------------------------------
|
| LiteOS Screenshot, markup (phase 2): a picture opened in the Screenshot window, drawn on with a pen, a highlighter,
| shapes (arrow, rectangle, ellipse, line), text and blur, cropped, and saved, saved as or copied.
|
| Every mark is an operation in the picture's own pixels, kept in a list over the untouched picture: undo and redo
| walk that list, the eraser takes a mark out of it, and crop is one more operation (the latest one decides what is
| shown and saved). The picture shown is drawn again from the list after each change; a mark being drawn goes on the
| layer over it until it is let go.
|
*/
window.SSMarkup = function (OS, host) {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => OS.util.escape(s == null ? '' : s);
  const ico = (n, s) => OS.icon(n, s || 16);

  const COLORS = ['#111111', '#FFFFFF', '#E3342F', '#F59E0B', '#16A34A', '#2F6FD6', '#7C3AED', '#DB2777', '#0891B2', '#8C929C', '#92400E', '#FACC15'];
  const SHAPES = [
    { id: 'arrow', label: 'Arrow', icon: 'arrow' },
    { id: 'rect', label: 'Rectangle', icon: 'square' },
    { id: 'ellipse', label: 'Ellipse', icon: 'circle' },
    { id: 'line', label: 'Line', icon: 'line' },
  ];
  /** Zoom levels; 0: fit the window. */
  const ZOOMS = [0, 0.5, 1, 2];

  const st = {
    path: null, name: '', img: null, W: 0, H: 0,
    /** saved: the length of the undo list when it was last saved. */
    ops: [], undo: [], redo: [], saved: 0,
    tool: 'pen', shape: 'arrow', zoom: 0, z: 1,
    pen: { color: '#E3342F', size: 4 }, hl: { color: '#FACC15', size: 6 }, text: { color: '#E3342F', size: 24 },
    /** crop: the crop being set while the crop tool is out. */
    live: null, crop: null,
  };
  const cv = $('#cv');
  const ov = $('#ov');
  const paper = $('#paper');
  const stage = $('#stage');
  const g = cv.getContext('2d');
  const go = ov.getContext('2d');

  /*
  |--------------------------------------------------------------------------
  | The picture
  |--------------------------------------------------------------------------
  */
  const cropOf = () => { for (let i = st.ops.length - 1; i >= 0; i--) if (st.ops[i].t === 'crop') return st.ops[i]; return { x: 0, y: 0, w: st.W, h: st.H }; };

  /**
   * drawOp
   *
   * Draws one mark on a canvas. Blur is drawn in blocks big enough that text under them can't be read.
   */
  function drawOp(c, op) {
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (op.t === 'pen' || op.t === 'hl') {
      c.strokeStyle = op.color;
      c.lineWidth = op.t === 'hl' ? op.size * 4 : op.size;
      if (op.t === 'hl') { c.globalAlpha = 0.4; c.lineCap = 'square'; }
      c.beginPath();
      op.pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      if (op.pts.length === 1) c.lineTo(op.pts[0][0] + 0.1, op.pts[0][1]);
      c.stroke();
    } else if (op.t === 'line' || op.t === 'arrow') {
      c.strokeStyle = op.color;
      c.lineWidth = op.size;
      c.beginPath();
      c.moveTo(op.a[0], op.a[1]);
      c.lineTo(op.b[0], op.b[1]);
      if (op.t === 'arrow') {
        const ang = Math.atan2(op.b[1] - op.a[1], op.b[0] - op.a[0]);
        const len = Math.max(12, op.size * 4);
        [-0.45, 0.45].forEach((d) => { c.moveTo(op.b[0], op.b[1]); c.lineTo(op.b[0] - len * Math.cos(ang + d), op.b[1] - len * Math.sin(ang + d)); });
      }
      c.stroke();
    } else if (op.t === 'rect') {
      c.strokeStyle = op.color;
      c.lineWidth = op.size;
      c.strokeRect(Math.min(op.a[0], op.b[0]), Math.min(op.a[1], op.b[1]), Math.abs(op.b[0] - op.a[0]), Math.abs(op.b[1] - op.a[1]));
    } else if (op.t === 'ellipse') {
      c.strokeStyle = op.color;
      c.lineWidth = op.size;
      c.beginPath();
      c.ellipse((op.a[0] + op.b[0]) / 2, (op.a[1] + op.b[1]) / 2, Math.abs(op.b[0] - op.a[0]) / 2, Math.abs(op.b[1] - op.a[1]) / 2, 0, 0, Math.PI * 2);
      c.stroke();
    } else if (op.t === 'text') {
      c.fillStyle = op.color;
      c.font = op.size + 'px system-ui, "Segoe UI", sans-serif';
      c.textBaseline = 'top';
      op.text.split('\n').forEach((line, i) => c.fillText(line, op.x, op.y + i * op.size * 1.25));
    } else if (op.t === 'blur') {
      const r = norm(op);
      if (r.w >= 1 && r.h >= 1) {
        const k = Math.max(8, Math.min(24, Math.round(Math.min(r.w, r.h) / 4)));
        const small = document.createElement('canvas');
        small.width = Math.max(1, Math.round(r.w / k));
        small.height = Math.max(1, Math.round(r.h / k));
        small.getContext('2d').drawImage(c.canvas, r.x, r.y, r.w, r.h, 0, 0, small.width, small.height);
        c.imageSmoothingEnabled = false;
        c.drawImage(small, 0, 0, small.width, small.height, r.x, r.y, r.w, r.h);
      }
    }
    c.restore();
  }
  const norm = (r) => ({ x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) });

  /** The whole picture with every mark on it (crop not applied). */
  function composed() {
    const c = document.createElement('canvas');
    c.width = st.W;
    c.height = st.H;
    const x = c.getContext('2d');
    x.drawImage(st.img, 0, 0);
    st.ops.forEach((op) => { if (op.t !== 'crop') drawOp(x, op); });
    return c;
  }
  /** What is saved and copied: the marked-up picture, cropped. */
  function output() {
    const full = composed();
    const r = cropOf();
    if (r.x === 0 && r.y === 0 && r.w === st.W && r.h === st.H) return full;
    const c = document.createElement('canvas');
    c.width = Math.round(r.w);
    c.height = Math.round(r.h);
    c.getContext('2d').drawImage(full, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return c;
  }

  /** Draws the picture shown again from the list of marks. While cropping, the whole picture shows. */
  function render() {
    if (!st.img) return;
    const r = st.crop ? { x: 0, y: 0, w: st.W, h: st.H } : cropOf();
    cv.width = ov.width = Math.round(r.w);
    cv.height = ov.height = Math.round(r.h);
    g.drawImage(composed(), r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    st.view = r;
    fit();
    drawLive();
    host.changed();
  }
  function fit() {
    const r = st.view;
    if (!r) return;
    const pad = 32;
    const fitZ = Math.min(1, (stage.clientWidth - pad) / r.w, (stage.clientHeight - pad) / r.h);
    st.z = st.zoom || Math.max(0.05, fitZ);
    paper.style.width = Math.round(r.w * st.z) + 'px';
    paper.style.height = Math.round(r.h * st.z) + 'px';
    host.zoomed(Math.round(st.z * 100));
  }
  new ResizeObserver(() => { if (st.img) { fit(); drawLive(); } }).observe(stage);

  /** The layer over the picture: the mark being drawn, or the crop being set. */
  function drawLive() {
    go.setTransform(1, 0, 0, 1, 0, 0);
    go.clearRect(0, 0, ov.width, ov.height);
    const v = st.view;
    if (!v) return;
    go.translate(-v.x, -v.y);
    if (st.live) {
      if (st.live.t === 'blur') {
        const r = norm(st.live);
        go.setLineDash([6 / st.z, 4 / st.z]);
        go.lineWidth = 1.5 / st.z;
        go.strokeStyle = '#fff';
        go.strokeRect(r.x, r.y, r.w, r.h);
        go.strokeStyle = '#000';
        go.lineDashOffset = 5 / st.z;
        go.strokeRect(r.x, r.y, r.w, r.h);
      } else drawOp(go, st.live);
    }
    if (st.crop) {
      const r = norm(st.crop);
      go.fillStyle = 'rgba(0,0,0,0.5)';
      go.beginPath();
      go.rect(0, 0, st.W, st.H);
      go.rect(r.x, r.y, r.w, r.h);
      go.fill('evenodd');
      go.strokeStyle = '#fff';
      go.lineWidth = 1 / st.z;
      go.strokeRect(r.x, r.y, r.w, r.h);
      const hs = 9 / st.z;
      go.fillStyle = '#fff';
      handles(r).forEach((h) => go.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs));
      host.cropSize(Math.round(r.w) + ' × ' + Math.round(r.h));
    }
  }
  const handles = (r) => [
    { k: 'nw', x: r.x, y: r.y }, { k: 'n', x: r.x + r.w / 2, y: r.y }, { k: 'ne', x: r.x + r.w, y: r.y },
    { k: 'e', x: r.x + r.w, y: r.y + r.h / 2 }, { k: 'se', x: r.x + r.w, y: r.y + r.h }, { k: 's', x: r.x + r.w / 2, y: r.y + r.h },
    { k: 'sw', x: r.x, y: r.y + r.h }, { k: 'w', x: r.x, y: r.y + r.h / 2 },
  ];

  /*
  |--------------------------------------------------------------------------
  | Changes, undo and redo
  |--------------------------------------------------------------------------
  */
  function add(op) { apply({ do: 'add', op }); }
  function apply(a) {
    if (a.do === 'add') st.ops.push(a.op); else st.ops.splice(a.index, 1);
    st.undo.push(a);
    st.redo = [];
    render();
  }
  function undo() {
    const a = st.undo.pop();
    if (!a) return;
    if (a.do === 'add') st.ops.splice(st.ops.lastIndexOf(a.op), 1); else st.ops.splice(a.index, 0, a.op);
    st.redo.push(a);
    render();
  }
  function redo() {
    const a = st.redo.pop();
    if (!a) return;
    if (a.do === 'add') st.ops.push(a.op); else st.ops.splice(a.index, 1);
    st.undo.push(a);
    render();
  }

  /*
  |--------------------------------------------------------------------------
  | The pointer
  |--------------------------------------------------------------------------
  */
  const at = (e) => {
    const b = paper.getBoundingClientRect();
    return [(e.clientX - b.left) / st.z + st.view.x, (e.clientY - b.top) / st.z + st.view.y];
  };
  const clampPt = (p) => [Math.max(0, Math.min(st.W, p[0])), Math.max(0, Math.min(st.H, p[1]))];
  let drag = null;

  ov.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !st.img) return;
    e.preventDefault();
    commitText();
    const p = at(e);
    if (st.crop) { cropDown(p, e); return; }
    const t = st.tool;
    if (t === 'eraser') { erase(p); drag = { t: 'eraser' }; ov.setPointerCapture(e.pointerId); return; }
    if (t === 'text') { startText(p); return; }
    ov.setPointerCapture(e.pointerId);
    if (t === 'pen' || t === 'hl') st.live = { t, color: st[t].color, size: st[t].size, pts: [p] };
    else if (t === 'shape') st.live = { t: st.shape, color: st.pen.color, size: st.pen.size, a: p, b: p };
    else if (t === 'blur') st.live = { t: 'blur', x: p[0], y: p[1], w: 0, h: 0 };
    drag = { t };
    drawLive();
  });
  ov.addEventListener('pointermove', (e) => {
    if (!st.img) return;
    const p = at(e);
    if (st.crop) { cropMove(p, e); return; }
    ov.style.cursor = st.tool === 'text' ? 'text' : st.tool === 'eraser' ? 'cell' : 'crosshair';
    if (!drag) return;
    if (drag.t === 'eraser') { erase(p); return; }
    const l = st.live;
    if (!l) return;
    if (l.pts) l.pts.push(p);
    else if (l.a) l.b = e.shiftKey && (l.t === 'rect' || l.t === 'ellipse') ? square(l.a, p) : p;
    else { const c = clampPt(p); l.w = c[0] - l.x; l.h = c[1] - l.y; }
    drawLive();
  });
  ov.addEventListener('pointerup', () => {
    if (st.crop) { cropUp(); return; }
    if (!drag) return;
    drag = null;
    const l = st.live;
    st.live = null;
    if (!l) { drawLive(); return; }
    if (l.t === 'blur') { const r = norm(l); if (r.w >= 4 && r.h >= 4) add(Object.assign({ t: 'blur' }, r)); else drawLive(); return; }
    if (l.a && Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]) < 3) { drawLive(); return; }
    add(l);
  });
  const square = (a, p) => { const d = Math.max(Math.abs(p[0] - a[0]), Math.abs(p[1] - a[1])); return [a[0] + Math.sign(p[0] - a[0]) * d, a[1] + Math.sign(p[1] - a[1]) * d]; };

  /** Whether a mark is under the point: the eraser takes away the mark under it (the newest first). */
  function hit(op, p) {
    const near = 6 / st.z;
    const segD = (a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
      return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    };
    if (op.pts) { const w = (op.t === 'hl' ? op.size * 4 : op.size) / 2 + near; for (let i = 0; i < op.pts.length; i++) if (segD(op.pts[i], op.pts[i + 1] || op.pts[i]) <= w) return true; return false; }
    if (op.t === 'line' || op.t === 'arrow') return segD(op.a, op.b) <= op.size / 2 + near;
    if (op.t === 'rect' || op.t === 'ellipse') {
      const x0 = Math.min(op.a[0], op.b[0]) - near, x1 = Math.max(op.a[0], op.b[0]) + near, y0 = Math.min(op.a[1], op.b[1]) - near, y1 = Math.max(op.a[1], op.b[1]) + near;
      return p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
    }
    if (op.t === 'text') {
      g.save();
      g.font = op.size + 'px system-ui, "Segoe UI", sans-serif';
      const lines = op.text.split('\n');
      const w = Math.max(...lines.map((l) => g.measureText(l).width));
      g.restore();
      return p[0] >= op.x - near && p[0] <= op.x + w + near && p[1] >= op.y - near && p[1] <= op.y + lines.length * op.size * 1.25 + near;
    }
    if (op.t === 'blur') return p[0] >= op.x && p[0] <= op.x + op.w && p[1] >= op.y && p[1] <= op.y + op.h;
    return false;
  }
  function erase(p) {
    for (let i = st.ops.length - 1; i >= 0; i--) {
      const op = st.ops[i];
      if (op.t !== 'crop' && hit(op, p)) { apply({ do: 'remove', op, index: i }); return; }
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Text
  |--------------------------------------------------------------------------
  */
  /** The text being typed: { el, x, y }. */
  let typing = null;
  function startText(p) {
    const el = document.createElement('textarea');
    el.className = 'ss-text-in';
    el.rows = 1;
    el.spellcheck = false;
    el.setAttribute('aria-label', 'Text');
    Object.assign(el.style, {
      left: ((p[0] - st.view.x) * st.z) + 'px', top: ((p[1] - st.view.y) * st.z) + 'px',
      color: st.text.color, fontSize: (st.text.size * st.z) + 'px', lineHeight: '1.25',
    });
    paper.appendChild(el);
    typing = { el, x: p[0], y: p[1], color: st.text.color, size: st.text.size };
    const grow = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; el.style.width = 'auto'; el.style.width = Math.max(40, el.scrollWidth + 8) + 'px'; };
    el.addEventListener('input', grow);
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); cancelText(); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
    });
    el.addEventListener('blur', () => setTimeout(commitText, 0));
    grow();
    setTimeout(() => el.focus(), 0);
  }
  function commitText() {
    if (!typing) return;
    const t = typing;
    typing = null;
    const text = t.el.value.replace(/\s+$/, '');
    t.el.remove();
    if (text) add({ t: 'text', color: t.color, size: t.size, x: t.x, y: t.y, text });
  }
  function cancelText() { if (!typing) return; typing.el.remove(); typing = null; }

  /*
  |--------------------------------------------------------------------------
  | Crop
  |--------------------------------------------------------------------------
  */
  function cropStart() {
    commitText();
    st.crop = Object.assign({}, cropOf());
    host.cropping(true);
    render();
  }
  function cropEnd(applyIt) {
    const r = st.crop ? norm(st.crop) : null;
    st.crop = null;
    host.cropping(false);
    const cur = cropOf();
    if (applyIt && r && r.w >= 2 && r.h >= 2 && (Math.round(r.x) !== Math.round(cur.x) || Math.round(r.y) !== Math.round(cur.y) || Math.round(r.w) !== Math.round(cur.w) || Math.round(r.h) !== Math.round(cur.h))) {
      add({ t: 'crop', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
    } else render();
  }
  let cdrag = null;
  function cropDown(p, e) {
    const r = norm(st.crop);
    const near = 10 / st.z;
    const h = handles(r).find((x) => Math.abs(x.x - p[0]) <= near && Math.abs(x.y - p[1]) <= near);
    const inside = p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h;
    cdrag = h ? { k: h.k, r, p } : inside ? { k: 'move', r, p } : { k: 'new', r: { x: p[0], y: p[1], w: 0, h: 0 }, p };
    if (cdrag.k === 'new') st.crop = cdrag.r;
    ov.setPointerCapture(e.pointerId);
  }
  function cropMove(p) {
    if (!cdrag) {
      const r = norm(st.crop);
      const near = 10 / st.z;
      const h = handles(r).find((x) => Math.abs(x.x - p[0]) <= near && Math.abs(x.y - p[1]) <= near);
      ov.style.cursor = h ? ({ n: 'ns', s: 'ns', e: 'ew', w: 'ew', nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw' })[h.k] + '-resize' : (p[0] > r.x && p[0] < r.x + r.w && p[1] > r.y && p[1] < r.y + r.h ? 'move' : 'crosshair');
      return;
    }
    const q = clampPt(p);
    const d = [q[0] - cdrag.p[0], q[1] - cdrag.p[1]];
    const o = cdrag.r;
    let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
    const k = cdrag.k;
    if (k === 'move') {
      const dx = Math.max(-x0, Math.min(st.W - x1, d[0])), dy = Math.max(-y0, Math.min(st.H - y1, d[1]));
      x0 += dx; x1 += dx; y0 += dy; y1 += dy;
    } else if (k === 'new') { x1 = q[0]; y1 = q[1]; } else {
      if (k.includes('w')) x0 = q[0];
      if (k.includes('e')) x1 = q[0];
      if (k.includes('n')) y0 = q[1];
      if (k.includes('s')) y1 = q[1];
    }
    st.crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    drawLive();
  }
  function cropUp() { if (!cdrag) return; cdrag = null; st.crop = norm(st.crop); drawLive(); }

  /*
  |--------------------------------------------------------------------------
  | Opening, saving, copying
  |--------------------------------------------------------------------------
  */
  async function open(path) {
    const blob = await OS.fs.readBlob(path);
    const img = await createImageBitmap(blob);
    Object.assign(st, { path, name: String(path).split('/').pop(), img, W: img.width, H: img.height, ops: [], undo: [], redo: [], saved: 0, live: null, crop: null, zoom: 0 });
    cancelText();
    host.cropping(false);
    render();
  }
  async function toBlob() {
    const c = output();
    return new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('The picture couldn’t be made.'))), 'image/png'));
  }
  async function saveTo(path) {
    commitText();
    const b64 = await OS.util.toBase64(await toBlob());
    await OS.fs.writeBase64(path, b64);
    st.path = path;
    st.name = String(path).split('/').pop();
    st.saved = st.undo.length;
    host.changed();
  }
  async function copy() {
    commitText();
    const blob = await toBlob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  return {
    get open() { return !!st.img; },
    get path() { return st.path; },
    get name() { return st.name; },
    get dirty() { return !!st.img && st.undo.length !== st.saved; },
    get canUndo() { return st.undo.length > 0; },
    get canRedo() { return st.redo.length > 0; },
    get tool() { return st.tool; },
    get shape() { return st.shape; },
    get cropping() { return !!st.crop; },
    get zoom() { return st.zoom; },
    get fitZoom() { return st.z; },
    shapes: SHAPES, colors: COLORS, zooms: ZOOMS,
    style: (tool) => (tool === 'shape' ? st.pen : st[tool]),
    setStyle(tool, s) { Object.assign(tool === 'shape' ? st.pen : st[tool], s); if (typing && tool === 'text') { typing.color = st.text.color; typing.size = st.text.size; typing.el.style.color = st.text.color; typing.el.style.fontSize = (st.text.size * st.z) + 'px'; } },
    setTool(t) { commitText(); if (st.crop) cropEnd(false); st.tool = t; if (t === 'crop') cropStart(); },
    setShape(s) { st.shape = s; },
    setZoom(z) { st.zoom = z; fit(); drawLive(); },
    open, saveTo, copy, undo, redo, toBlob,
    applyCrop: () => cropEnd(true),
    cancelCrop: () => { cropEnd(false); st.tool = 'pen'; },
    typing: () => !!typing,
  };
};
