/* LiteOS Slides — presentation editor with present mode. */
LiteOS.ready((OS) => {
  'use strict';
  const U = OS.util;
  const esc = U.escape;
  const $ = (id) => document.getElementById(id);

  const W0 = 1280; const H0 = 720;
  const MAX_UNDO = 80;
  const FONTS = {
    Inter: 'Inter, "Segoe UI", system-ui, -apple-system, Roboto, sans-serif',
    Georgia: 'Georgia, "Times New Roman", serif',
    Verdana: 'Verdana, Geneva, sans-serif',
    Trebuchet: '"Trebuchet MS", "Segoe UI", sans-serif',
    Mono: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
  };
  const ACCENTS = ['#2F6FD6', '#1B3A6B', '#0F7A6E', '#1A8A54', '#DD630A', '#C9306B', '#6B4CCB', '#D63B41'];
  const BGS = ['#FFFFFF', '#F6F7F9', '#16171A', '#1B3A6B', '#FFF6E5', '#E8F6EF', '#E7EFFB', '#FBE7EF'];
  const LAYOUTS = [
    { id: 'title', name: 'Title' },
    { id: 'content', name: 'Title + content' },
    { id: 'two', name: 'Two columns' },
    { id: 'blank', name: 'Blank' },
  ];
  const HEX = /^#[0-9a-fA-F]{3,8}$/;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ------------------------------------------------------------------ state
  let doc = newDeck();
  let path = null;
  let dirty = false;
  let cur = 0; // current slide index
  let selIds = [];
  let editingId = null;
  let undoStack = []; let redoStack = [];
  let clipItems = null;
  let scale = 0.5;

  const el = {
    rail: $('rail'), stage: $('stage'), wrap: $('wrap'), canvas: $('canvas'), selLayer: $('selLayer'),
    notes: $('notes'), panel: $('panelBody'), counter: $('counter'), saveState: $('saveState'),
    fontSize: $('fontSize'), textColor: $('textColor'), colorBar: $('colorBar'),
  };
  document.querySelectorAll('[data-icon]').forEach((b) => b.insertAdjacentHTML('afterbegin', OS.icon(b.dataset.icon, b.closest('.present-btn') ? 13 : 16)));

  function newDeck() {
    const d = { v: 1, size: [W0, H0], theme: { font: 'Inter', accent: '#2F6FD6' }, slides: [] };
    d.slides.push(makeSlide('title', d.theme));
    return d;
  }
  const slide = () => doc.slides[cur];
  const findItem = (id) => slide().items.find((i) => i.id === id) || null;
  const selItems = () => selIds.map(findItem).filter(Boolean);

  function textItem(o) {
    return Object.assign({ id: uid(), type: 'text', x: 80, y: 60, w: 600, h: 60, html: '', size: 28, color: '#16171A', bold: false, italic: false, underline: false, align: 'left' }, o);
  }
  function makeSlide(layout, theme) {
    const s = { bg: '#FFFFFF', items: [], notes: '', transition: 'none' };
    const acc = (theme && theme.accent) || '#2F6FD6';
    if (layout === 'title') {
      s.items.push(textItem({ x: 120, y: 236, w: 1040, h: 120, size: 64, bold: true, align: 'center', ph: 'Click to add title' }));
      s.items.push(textItem({ x: 220, y: 376, w: 840, h: 60, size: 28, color: '#5A606B', align: 'center', ph: 'Click to add subtitle' }));
      s.items.push({ id: uid(), type: 'shape', shape: 'rect', x: 590, y: 212, w: 100, h: 6, fill: acc, stroke: 'none', sw: 0 });
    } else if (layout === 'content') {
      s.items.push(textItem({ x: 80, y: 56, w: 1120, h: 90, size: 44, bold: true, ph: 'Click to add title' }));
      s.items.push(textItem({ x: 80, y: 170, w: 1120, h: 480, size: 28, color: '#3F434B', ph: 'Click to add text' }));
    } else if (layout === 'two') {
      s.items.push(textItem({ x: 80, y: 56, w: 1120, h: 90, size: 44, bold: true, ph: 'Click to add title' }));
      s.items.push(textItem({ x: 80, y: 170, w: 540, h: 480, size: 26, color: '#3F434B', ph: 'Click to add text' }));
      s.items.push(textItem({ x: 660, y: 170, w: 540, h: 480, size: 26, color: '#3F434B', ph: 'Click to add text' }));
    }
    return s;
  }

  // ------------------------------------------------------------------ sanitising
  const ALLOWED = new Set(['B', 'I', 'U', 'BR', 'SPAN', 'DIV', 'P']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH', 'NOSCRIPT', 'TEXTAREA', 'SELECT', 'HEAD', 'TITLE', 'META', 'LINK']);
  const STYLE_OK = {
    color: /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|[a-z]{3,20})$/i,
    'font-size': /^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/,
    'font-weight': /^(normal|bold|bolder|lighter|[1-9]00)$/,
    'text-align': /^(left|right|center|justify|start|end)$/,
  };
  const parserDoc = document.implementation.createHTMLDocument('');
  function sanitize(html) {
    const box = parserDoc.createElement('div');
    box.innerHTML = String(html || '');
    const out = document.createElement('div');
    const walk = (src, dst) => {
      src.childNodes.forEach((n) => {
        if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); return; }
        if (n.nodeType !== 1) return;
        let tag = n.tagName.toUpperCase();
        if (DROP.has(tag)) return;
        if (tag === 'STRONG') tag = 'B';
        if (tag === 'EM') tag = 'I';
        if (!ALLOWED.has(tag)) { walk(n, dst); return; } // unwrap unknown tags
        const e = document.createElement(tag);
        const st = n.getAttribute('style');
        if (st) {
          const keep = [];
          st.split(';').forEach((decl) => {
            const i = decl.indexOf(':'); if (i < 0) return;
            const p = decl.slice(0, i).trim().toLowerCase(); const v = decl.slice(i + 1).trim();
            if (STYLE_OK[p] && STYLE_OK[p].test(v)) keep.push(p + ': ' + v);
          });
          if (keep.length) e.setAttribute('style', keep.join('; '));
        }
        if (tag !== 'BR') walk(n, e);
        dst.appendChild(e);
      });
    };
    walk(box, out);
    return out.innerHTML;
  }
  const plainText = (html) => { const d = parserDoc.createElement('div'); d.innerHTML = html; return d.textContent || ''; };

  // ------------------------------------------------------------------ load / normalise
  const num = (v, d, lo, hi) => (isFinite(Number(v)) && v !== null && v !== '' ? clamp(Number(v), lo, hi) : d);
  const color = (v, d) => (typeof v === 'string' && (HEX.test(v) || v === 'none') ? v : d);
  function normItem(it) {
    if (!it || typeof it !== 'object') return null;
    const base = { id: typeof it.id === 'string' && /^[\w-]{1,40}$/.test(it.id) ? it.id : uid(), x: num(it.x, 100, -5000, 10000), y: num(it.y, 100, -5000, 10000) };
    const wh = (dw, dh, allowNeg) => ({ w: num(it.w, dw, allowNeg ? -10000 : 4, 10000), h: num(it.h, dh, allowNeg ? -10000 : 4, 10000) });
    if (it.type === 'text') {
      return Object.assign(base, wh(400, 60), {
        type: 'text', html: sanitize(typeof it.html === 'string' ? it.html : ''), size: num(it.size, 28, 4, 400),
        color: color(it.color, '#16171A'), bold: !!it.bold, italic: !!it.italic, underline: !!it.underline,
        align: ['left', 'center', 'right', 'justify'].includes(it.align) ? it.align : 'left',
        fill: color(it.fill, 'none'), ph: typeof it.ph === 'string' ? it.ph.slice(0, 60) : '',
      });
    }
    if (it.type === 'image') {
      if (typeof it.path !== 'string' || it.path[0] !== '/') return null;
      return Object.assign(base, wh(400, 300), { type: 'image', path: it.path, fit: it.fit === 'contain' ? 'contain' : 'cover' });
    }
    if (it.type === 'shape') {
      const shape = ['rect', 'ellipse', 'line', 'arrow'].includes(it.shape) ? it.shape : 'rect';
      const line = shape === 'line' || shape === 'arrow';
      return Object.assign(base, wh(200, line ? 0 : 120, line), {
        type: 'shape', shape, fill: color(it.fill, line ? 'none' : '#2F6FD6'), stroke: color(it.stroke, line ? '#16171A' : 'none'),
        sw: num(it.sw, line ? 4 : 0, 0, 60), radius: num(it.radius, 0, 0, 400),
      });
    }
    return null;
  }
  function normalise(j) {
    if (!j || typeof j !== 'object' || !Array.isArray(j.slides)) throw new Error('Not a LiteOS presentation');
    const theme = j.theme && typeof j.theme === 'object' ? j.theme : {};
    const d = {
      v: 1, size: [W0, H0],
      theme: { font: FONTS[theme.font] ? theme.font : 'Inter', accent: color(theme.accent, '#2F6FD6') === 'none' ? '#2F6FD6' : color(theme.accent, '#2F6FD6') },
      slides: j.slides.slice(0, 500).map((s) => ({
        bg: s && typeof s.bg === 'string' && HEX.test(s.bg) ? s.bg : '#FFFFFF',
        items: s && Array.isArray(s.items) ? s.items.map(normItem).filter(Boolean) : [],
        notes: s && typeof s.notes === 'string' ? s.notes : '',
        transition: s && ['fade', 'slide'].includes(s.transition) ? s.transition : 'none',
      })),
    };
    if (!d.slides.length) d.slides.push(makeSlide('title', d.theme));
    return d;
  }
  const serialise = () => JSON.stringify(doc);

  async function load(p) {
    try {
      const res = await OS.fs.read(p);
      const d = res.content === '' || res.content == null ? newDeck() : normalise(JSON.parse(res.content));
      path = p;
      doc = d; cur = 0; selIds = []; undoStack = []; redoStack = [];
      renderAll();
      setDirty(false);
      updateTitle();
    } catch (e) {
      OS.notify(U.basename(p) + ': ' + e.message, { type: 'error', title: 'Couldn’t open file' });
    }
  }
  function updateTitle() { OS.win.setTitle((path ? U.basename(path) : 'Untitled') + ' — Slides'); }
  function setDirty(d) { dirty = d; OS.win.setDirty(d); el.saveState.textContent = d ? 'Edited' : path ? 'Saved' : ''; }
  async function save(as) {
    endEdit();
    let target = path;
    if (!target || as) {
      target = await OS.dialog.save({ title: as ? 'Save as' : 'Save presentation', defaultName: (path ? U.stem(path) : 'Untitled') + '.lslides', ext: 'lslides', startIn: path ? U.dirname(path) : '/Documents' });
      if (!target) return false;
      if (U.ext(target) !== 'lslides') target += '.lslides';
    }
    try {
      el.saveState.textContent = 'Saving…';
      await OS.fs.write(target, serialise());
      path = target;
      setDirty(false);
      updateTitle();
      return true;
    } catch (e) {
      el.saveState.textContent = dirty ? 'Edited' : '';
      OS.notify(e.message, { type: 'error', title: 'Couldn’t save presentation' });
      return false;
    }
  }
  async function openFile() {
    const p = await OS.dialog.open({ title: 'Open presentation', accept: ['lslides'], startIn: path ? U.dirname(path) : '/Documents' });
    if (!p) return;
    if (!path && !dirty) load(p); else OS.open('slides', { path: p });
  }

  // ------------------------------------------------------------------ undo
  const snapshot = () => ({ data: serialise(), cur, sel: selIds.slice() });
  let lastCoalesce = { tag: null, t: 0 };
  function pushUndo(snap, tag) {
    const now = Date.now();
    if (tag && lastCoalesce.tag === tag && now - lastCoalesce.t < 900) { lastCoalesce.t = now; return; }
    lastCoalesce = { tag: tag || null, t: now };
    undoStack.push(snap || snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }
  function restore(s) {
    doc = normalise(JSON.parse(s.data));
    cur = clamp(s.cur, 0, doc.slides.length - 1);
    selIds = s.sel.filter((id) => doc.slides[cur].items.some((i) => i.id === id));
    renderAll();
    setDirty(true);
  }
  function undo() { endEdit(); if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); lastCoalesce.tag = null; }
  function redo() { endEdit(); if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); lastCoalesce.tag = null; }
  /** Content of the current slide changed. */
  function touched(opts) {
    setDirty(true);
    renderCanvas();
    renderSelection();
    if (!(opts && opts.keepPanel)) renderPanel(); else syncPanel();
    refreshThumb(cur);
  }

  // ------------------------------------------------------------------ rendering slides
  function fontStack() { return FONTS[doc.theme.font] || FONTS.Inter; }
  function lineGeom(it) {
    const pad = 10 + (it.sw || 0);
    const x1 = it.x; const y1 = it.y; const x2 = it.x + it.w; const y2 = it.y + it.h;
    const left = Math.min(x1, x2) - pad; const top = Math.min(y1, y2) - pad;
    return { left, top, width: Math.abs(it.w) + pad * 2, height: Math.abs(it.h) + pad * 2, ax: x1 - left, ay: y1 - top, bx: x2 - left, by: y2 - top };
  }
  function itemEl(it, mode) {
    const d = document.createElement('div');
    d.className = 'item';
    d.dataset.id = it.id;
    const box = (x, y, w, h) => { d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.width = w + 'px'; d.style.height = h + 'px'; };
    if (it.type === 'text') {
      d.classList.add('text');
      box(it.x, it.y, it.w, it.h);
      const t = document.createElement('div');
      t.className = 'txt';
      t.innerHTML = it.html; // sanitised on load and on every edit
      Object.assign(t.style, {
        fontSize: it.size + 'px', color: it.color, fontWeight: it.bold ? '700' : '400', fontStyle: it.italic ? 'italic' : 'normal',
        textDecoration: it.underline ? 'underline' : 'none', textAlign: it.align,
      });
      if (it.fill && it.fill !== 'none') t.style.background = it.fill;
      if (mode === 'edit' && it.ph) t.dataset.ph = it.ph;
      d.appendChild(t);
    } else if (it.type === 'image') {
      d.classList.add('img');
      box(it.x, it.y, it.w, it.h);
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.src = OS.fs.rawUrl(it.path);
      img.style.objectFit = it.fit || 'cover';
      img.addEventListener('error', () => {
        const m = document.createElement('div'); m.className = 'img-missing'; m.textContent = 'Image not found';
        img.replaceWith(m);
      });
      d.appendChild(img);
    } else if (it.type === 'shape') {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      const sw = it.sw || 0;
      const stroke = it.stroke && it.stroke !== 'none' && sw > 0 ? it.stroke : 'none';
      const fill = it.fill && it.fill !== 'none' ? it.fill : 'none';
      if (it.shape === 'line' || it.shape === 'arrow') {
        d.classList.add('line');
        const g = lineGeom(it);
        box(g.left, g.top, g.width, g.height);
        svg.setAttribute('width', g.width); svg.setAttribute('height', g.height);
        const col = it.stroke && it.stroke !== 'none' ? it.stroke : '#16171A';
        const w = Math.max(1, sw);
        let ex = g.bx; let ey = g.by;
        const ang = Math.atan2(g.by - g.ay, g.bx - g.ax);
        if (it.shape === 'arrow') {
          const size = 8 + w * 2.2;
          ex = g.bx - Math.cos(ang) * size * 0.7; ey = g.by - Math.sin(ang) * size * 0.7;
          const head = document.createElementNS(NS, 'polygon');
          const p = (a, r) => (g.bx - Math.cos(a) * r) + ',' + (g.by - Math.sin(a) * r);
          head.setAttribute('points', g.bx + ',' + g.by + ' ' + p(ang - 0.45, size) + ' ' + p(ang + 0.45, size));
          head.setAttribute('fill', col);
          svg.appendChild(head);
        }
        const ln = document.createElementNS(NS, 'line');
        ln.setAttribute('x1', g.ax); ln.setAttribute('y1', g.ay); ln.setAttribute('x2', ex); ln.setAttribute('y2', ey);
        ln.setAttribute('stroke', col); ln.setAttribute('stroke-width', w); ln.setAttribute('stroke-linecap', 'round');
        svg.insertBefore(ln, svg.firstChild);
        if (mode === 'edit') {
          const hitLine = document.createElementNS(NS, 'line');
          hitLine.setAttribute('x1', g.ax); hitLine.setAttribute('y1', g.ay); hitLine.setAttribute('x2', g.bx); hitLine.setAttribute('y2', g.by);
          hitLine.setAttribute('stroke', 'transparent'); hitLine.setAttribute('stroke-width', Math.max(16, w + 10));
          hitLine.setAttribute('class', 'hit');
          svg.appendChild(hitLine);
        }
      } else {
        box(it.x, it.y, it.w, it.h);
        svg.setAttribute('width', it.w); svg.setAttribute('height', it.h);
        svg.setAttribute('viewBox', '0 0 ' + it.w + ' ' + it.h);
        const sh = document.createElementNS(NS, it.shape === 'ellipse' ? 'ellipse' : 'rect');
        const inset = stroke === 'none' ? 0 : sw / 2;
        if (it.shape === 'ellipse') {
          sh.setAttribute('cx', it.w / 2); sh.setAttribute('cy', it.h / 2);
          sh.setAttribute('rx', Math.max(0, it.w / 2 - inset)); sh.setAttribute('ry', Math.max(0, it.h / 2 - inset));
        } else {
          sh.setAttribute('x', inset); sh.setAttribute('y', inset);
          sh.setAttribute('width', Math.max(0, it.w - inset * 2)); sh.setAttribute('height', Math.max(0, it.h - inset * 2));
          if (it.radius) sh.setAttribute('rx', it.radius);
        }
        sh.setAttribute('fill', fill); sh.setAttribute('stroke', stroke); sh.setAttribute('stroke-width', sw);
        if (fill === 'none') sh.setAttribute('pointer-events', 'all');
        svg.appendChild(sh);
      }
      d.appendChild(svg);
    }
    return d;
  }
  /** Build a slide element (1280×720 in slide coordinates). */
  function slideEl(s, mode, target) {
    const e = target || document.createElement('div');
    e.className = 'slide' + (mode === 'edit' ? ' editing-canvas' : '');
    e.innerHTML = '';
    Object.assign(e.style, { width: W0 + 'px', height: H0 + 'px', background: s.bg, fontFamily: fontStack() });
    s.items.forEach((it) => e.appendChild(itemEl(it, mode)));
    return e;
  }

  // ------------------------------------------------------------------ editor canvas
  function fit() {
    const r = el.stage.getBoundingClientRect();
    const s = Math.max(0.1, Math.min((r.width - 48) / W0, (r.height - 40) / H0));
    scale = s;
    el.wrap.style.width = (W0 * s) + 'px';
    el.wrap.style.height = (H0 * s) + 'px';
    el.canvas.style.transform = 'scale(' + s + ')';
    renderSelection();
  }
  new ResizeObserver(fit).observe(el.stage);

  function renderCanvas() {
    if (editingId) return; // never rebuild under the caret
    slideEl(slide(), 'edit', el.canvas);
  }
  function renderAll() {
    cur = clamp(cur, 0, doc.slides.length - 1);
    editingId = null;
    renderCanvas();
    renderRail();
    renderSelection();
    renderPanel();
    el.notes.value = slide().notes || '';
    updateCounter();
  }
  function updateCounter() { el.counter.textContent = 'Slide ' + (cur + 1) + ' of ' + doc.slides.length; }

  function renderSelection() {
    const L = el.selLayer;
    L.innerHTML = '';
    const items = selItems();
    const s = scale;
    items.forEach((it) => {
      if (it.type === 'shape' && (it.shape === 'line' || it.shape === 'arrow')) {
        if (items.length === 1) {
          [['p1', it.x, it.y], ['p2', it.x + it.w, it.y + it.h]].forEach(([h, x, y]) => {
            const d = document.createElement('div'); d.className = 'hdl round'; d.dataset.h = h;
            d.style.left = (x * s) + 'px'; d.style.top = (y * s) + 'px'; L.appendChild(d);
          });
        } else {
          const g = lineGeom(it);
          const b = document.createElement('div'); b.className = 'sel-box multi';
          Object.assign(b.style, { left: (g.left * s) + 'px', top: (g.top * s) + 'px', width: (g.width * s) + 'px', height: (g.height * s) + 'px' });
          L.appendChild(b);
        }
        return;
      }
      const b = document.createElement('div');
      b.className = 'sel-box' + (items.length > 1 ? ' multi' : '') + (editingId === it.id ? ' editing' : '');
      const h = it.type === 'text' && editingId === it.id ? Math.max(it.h, liveTextHeight(it)) : it.h;
      Object.assign(b.style, { left: (it.x * s) + 'px', top: (it.y * s) + 'px', width: (it.w * s) + 'px', height: (h * s) + 'px' });
      L.appendChild(b);
      if (items.length === 1 && editingId !== it.id) {
        const pts = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
        Object.keys(pts).forEach((k) => {
          const d = document.createElement('div'); d.className = 'hdl'; d.dataset.h = k;
          d.style.left = ((it.x + it.w * pts[k][0]) * s) + 'px'; d.style.top = ((it.y + it.h * pts[k][1]) * s) + 'px';
          L.appendChild(d);
        });
      }
    });
    updateToolbar();
  }
  function liveTextHeight(it) {
    const n = el.canvas.querySelector('.item[data-id="' + it.id + '"] .txt');
    return n ? n.scrollHeight : it.h;
  }

  function select(ids) {
    if (editingId && !ids.includes(editingId)) endEdit();
    selIds = ids;
    renderSelection();
    renderPanel();
  }

  // ------------------------------------------------------------------ mouse on canvas
  let drag = null;
  const toSlide = (e) => { const r = el.wrap.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; };
  el.stage.addEventListener('mousedown', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    const hdl = e.target.closest('.hdl');
    if (hdl && e.button === 0) { startResize(e, hdl.dataset.h); return; }
    const itemNode = e.target.closest('.item');
    if (itemNode && editingId === itemNode.dataset.id) return; // caret placement inside the text being edited
    if (editingId) endEdit();
    const ae = document.activeElement;
    if (ae && ae !== document.body && !el.stage.contains(ae)) ae.blur(); // keyboard shortcuts now target the canvas
    if (!itemNode) {
      if (!e.shiftKey) select([]);
      if (e.button === 0 && el.wrap.contains(e.target)) startMarquee(e);
      return;
    }
    const id = itemNode.dataset.id;
    if (e.shiftKey) {
      select(selIds.includes(id) ? selIds.filter((x) => x !== id) : selIds.concat(id));
      return;
    }
    if (!selIds.includes(id)) select([id]);
    if (e.button !== 0) return;
    e.preventDefault();
    const p = toSlide(e);
    drag = { mode: 'move', start: p, orig: selItems().map((it) => ({ it, x: it.x, y: it.y })), snap: snapshot(), moved: false };
  });
  el.stage.addEventListener('dblclick', (e) => {
    const itemNode = e.target.closest('.item'); if (!itemNode) return;
    const it = findItem(itemNode.dataset.id);
    if (it && it.type === 'text') startEdit(it.id, e);
  });
  el.stage.addEventListener('contextmenu', (e) => {
    if (editingId && e.target.closest('.item.editing')) return;
    e.preventDefault();
    const itemNode = e.target.closest('.item');
    if (itemNode && !selIds.includes(itemNode.dataset.id)) select([itemNode.dataset.id]);
    if (!itemNode) select([]);
    const has = selIds.length > 0;
    OS.menu(has ? [
      { label: 'Cut', icon: 'cut', key: 'Ctrl+X', action: () => { copyItems(); deleteSelected(); } },
      { label: 'Copy', icon: 'copy', key: 'Ctrl+C', action: copyItems },
      { label: 'Paste', icon: 'paste', key: 'Ctrl+V', disabled: !clipItems, action: pasteItems },
      { label: 'Duplicate', key: 'Ctrl+D', action: duplicateItems },
      'sep',
      { label: 'Bring to front', icon: 'up', action: () => reorder('front') },
      { label: 'Bring forward', action: () => reorder('forward') },
      { label: 'Send backward', action: () => reorder('backward') },
      { label: 'Send to back', icon: 'down', action: () => reorder('back') },
      'sep',
      { label: 'Delete', icon: 'trash', danger: true, key: 'Del', action: deleteSelected },
    ] : [
      { label: 'Paste', icon: 'paste', key: 'Ctrl+V', disabled: !clipItems, action: pasteItems },
      { label: 'Text box', icon: 'text', action: () => insertText() },
      { label: 'New slide', icon: 'plus', key: 'Ctrl+M', action: () => addSlide('content') },
    ], e);
  });

  function startResize(e, h) {
    e.preventDefault(); e.stopPropagation();
    const it = selItems()[0]; if (!it) return;
    drag = { mode: 'resize', h, it, start: toSlide(e), o: { x: it.x, y: it.y, w: it.w, h: it.h }, snap: snapshot(), moved: false };
  }
  function startMarquee(e) {
    const p = toSlide(e);
    const box = document.createElement('div');
    box.className = 'sel-box multi';
    el.selLayer.appendChild(box);
    drag = { mode: 'marquee', start: p, box };
  }
  const SNAP = 6;
  function snapMove(dx, dy) {
    // snap the selection's bounding box edges/centre to the slide edges/centre
    const items = drag.orig;
    let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
    items.forEach((o) => {
      const it = o.it; const w = it.w; const h = it.h;
      const ax = Math.min(o.x, o.x + w); const ay = Math.min(o.y, o.y + h);
      x1 = Math.min(x1, ax); y1 = Math.min(y1, ay); x2 = Math.max(x2, ax + Math.abs(w)); y2 = Math.max(y2, ay + Math.abs(h));
    });
    const guides = [];
    const snapAxis = (a1, a2, d, size, axis) => {
      const cands = [[a1 + d, 0], [(a1 + a2) / 2 + d, size / 2], [a2 + d, size]];
      for (const [v, target] of cands) {
        if (Math.abs(v - target) < SNAP / scale * 0.5 + 2) { guides.push([axis, target]); return d + (target - v); }
      }
      return d;
    };
    dx = snapAxis(x1, x2, dx, W0, 'x');
    dy = snapAxis(y1, y2, dy, H0, 'y');
    return { dx, dy, guides };
  }
  function drawGuides(guides) {
    el.selLayer.querySelectorAll('.guide').forEach((g) => g.remove());
    guides.forEach(([axis, v]) => {
      const g = document.createElement('div'); g.className = 'guide';
      if (axis === 'x') Object.assign(g.style, { left: (v * scale) + 'px', top: 0, width: '1px', height: '100%' });
      else Object.assign(g.style, { top: (v * scale) + 'px', left: 0, height: '1px', width: '100%' });
      el.selLayer.appendChild(g);
    });
  }
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const p = toSlide(e);
    let dx = p.x - drag.start.x; let dy = p.y - drag.start.y;
    if (drag.mode === 'marquee') {
      const x = Math.min(p.x, drag.start.x); const y = Math.min(p.y, drag.start.y);
      Object.assign(drag.box.style, { left: (x * scale) + 'px', top: (y * scale) + 'px', width: (Math.abs(dx) * scale) + 'px', height: (Math.abs(dy) * scale) + 'px' });
      drag.rect = { x, y, w: Math.abs(dx), h: Math.abs(dy) };
      return;
    }
    if (!drag.moved && Math.abs(dx) * scale + Math.abs(dy) * scale < 3) return;
    drag.moved = true;
    if (drag.mode === 'move') {
      let guides = [];
      if (!e.altKey) ({ dx, dy, guides } = snapMove(dx, dy));
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      drag.orig.forEach((o) => { o.it.x = Math.round(o.x + dx); o.it.y = Math.round(o.y + dy); });
      drag.orig.forEach((o) => positionItem(o.it));
      renderSelection();
      drawGuides(guides);
    } else if (drag.mode === 'resize') {
      const it = drag.it; const o = drag.o; const h = drag.h;
      if (h === 'p1') { it.x = Math.round(o.x + dx); it.y = Math.round(o.y + dy); it.w = Math.round(o.w - dx); it.h = Math.round(o.h - dy); }
      else if (h === 'p2') { it.w = Math.round(o.w + dx); it.h = Math.round(o.h + dy); }
      else {
        let x = o.x; let y = o.y; let w = o.w; let hh = o.h;
        if (h.includes('e')) w = o.w + dx;
        if (h.includes('s')) hh = o.h + dy;
        if (h.includes('w')) { w = o.w - dx; x = o.x + dx; }
        if (h.includes('n')) { hh = o.h - dy; y = o.y + dy; }
        const keep = (e.shiftKey || it.type === 'image') && h.length === 2;
        if (keep) {
          const ratio = o.w / o.h;
          if (Math.abs(w / o.w) > Math.abs(hh / o.h)) hh = w / ratio; else w = hh * ratio;
          if (h.includes('w')) x = o.x + o.w - w;
          if (h.includes('n')) y = o.y + o.h - hh;
        }
        const min = 10;
        if (w < min) { if (h.includes('w')) x -= min - w; w = min; }
        if (hh < min) { if (h.includes('n')) y -= min - hh; hh = min; }
        Object.assign(it, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) });
      }
      replaceItemEl(it);
      renderSelection();
    }
    syncPanel();
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    drawGuides([]);
    if (d.mode === 'marquee') {
      d.box.remove();
      if (d.rect && d.rect.w > 2 && d.rect.h > 2) {
        const r = d.rect;
        const hits = slide().items.filter((it) => {
          const g = it.type === 'shape' && (it.shape === 'line' || it.shape === 'arrow') ? { x: Math.min(it.x, it.x + it.w), y: Math.min(it.y, it.y + it.h), w: Math.abs(it.w), h: Math.abs(it.h) } : it;
          return g.x < r.x + r.w && g.x + g.w > r.x && g.y < r.y + r.h && g.y + g.h > r.y;
        }).map((it) => it.id);
        select(hits);
      } else renderSelection();
      return;
    }
    if (d.moved) { pushUndo(d.snap); touched({ keepPanel: true }); }
  });
  function positionItem(it) {
    const n = el.canvas.querySelector('.item[data-id="' + it.id + '"]');
    if (!n) return;
    if (it.type === 'shape' && (it.shape === 'line' || it.shape === 'arrow')) { const g = lineGeom(it); n.style.left = g.left + 'px'; n.style.top = g.top + 'px'; }
    else { n.style.left = it.x + 'px'; n.style.top = it.y + 'px'; }
  }
  function replaceItemEl(it) {
    const n = el.canvas.querySelector('.item[data-id="' + it.id + '"]');
    if (n) n.replaceWith(itemEl(it, 'edit'));
  }

  // ------------------------------------------------------------------ text editing
  let editSnap = null; let savedRange = null;
  function editNode() { return editingId ? el.canvas.querySelector('.item[data-id="' + editingId + '"] .txt') : null; }
  function startEdit(id, ev) {
    const it = findItem(id); if (!it || it.type !== 'text') return;
    if (editingId === id) return;
    endEdit();
    selIds = [id];
    editingId = id;
    editSnap = snapshot();
    const wrap = el.canvas.querySelector('.item[data-id="' + id + '"]');
    wrap.classList.add('editing');
    const t = wrap.querySelector('.txt');
    t.contentEditable = 'true';
    t.spellcheck = true;
    t.focus();
    try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* ignore */ }
    const sel = window.getSelection();
    let range = null;
    if (ev && document.caretRangeFromPoint) range = document.caretRangeFromPoint(ev.clientX, ev.clientY);
    if (!range || !t.contains(range.startContainer)) { range = document.createRange(); range.selectNodeContents(t); if (!ev) range.collapse(false); }
    sel.removeAllRanges(); sel.addRange(range);
    t.addEventListener('input', onEditInput);
    t.addEventListener('blur', onEditBlur);
    renderSelection();
    renderPanel();
  }
  function onEditInput() {
    const it = findItem(editingId); if (!it) return;
    renderSelection();
    setDirty(true);
  }
  function onEditBlur(e) {
    const to = e.relatedTarget;
    if (to && (to.closest('#toolbar') || to.closest('#panel'))) { commitText(); return; }
    setTimeout(() => {
      const a = document.activeElement;
      if (a && (a.closest('#toolbar') || a.closest('#panel'))) { commitText(); return; }
      if (editingId && a !== editNode()) endEdit();
    }, 0);
  }
  /** Save the edited html into the item (keeps editing). */
  function commitText() {
    const t = editNode(); const it = findItem(editingId);
    if (!t || !it) return false;
    const html = sanitize(t.innerHTML).replace(/^(<br>)+$/, '');
    const changed = html !== it.html;
    it.html = html;
    const sh = t.scrollHeight;
    if (sh > it.h + 1) it.h = Math.ceil(sh);
    return changed;
  }
  function endEdit() {
    if (!editingId) return;
    const t = editNode();
    const before = editSnap;
    const changed = commitText();
    if (t) { t.removeEventListener('input', onEditInput); t.removeEventListener('blur', onEditBlur); t.contentEditable = 'false'; }
    editingId = null; editSnap = null; savedRange = null;
    window.getSelection().removeAllRanges();
    if (changed || (before && before.data !== serialise())) { pushUndo(before); touched(); }
    else { renderCanvas(); renderSelection(); renderPanel(); }
  }
  document.addEventListener('selectionchange', () => {
    const t = editNode(); if (!t) return;
    const s = window.getSelection();
    if (s.rangeCount && t.contains(s.getRangeAt(0).commonAncestorContainer)) savedRange = s.getRangeAt(0).cloneRange();
  });
  function restoreRange() {
    const t = editNode(); if (!t) return false;
    t.focus();
    if (savedRange) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
    return true;
  }
  function execOnText(command, value) {
    if (!restoreRange()) return false;
    try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* ignore */ }
    document.execCommand(command, false, value);
    commitText();
    setDirty(true);
    return true;
  }

  // ------------------------------------------------------------------ item commands
  function addItem(it) {
    pushUndo();
    slide().items.push(it);
    selIds = [it.id];
    touched();
  }
  function insertText() {
    endEdit();
    const it = textItem({ x: 340, y: 300, w: 600, h: 60, size: 28, html: '', ph: 'Type here' });
    addItem(it);
    startEdit(it.id);
  }
  function insertShape(shape) {
    endEdit();
    const acc = doc.theme.accent;
    let it;
    if (shape === 'line' || shape === 'arrow') it = { id: uid(), type: 'shape', shape, x: 440, y: 360, w: 400, h: 0, fill: 'none', stroke: '#16171A', sw: 4, radius: 0 };
    else it = { id: uid(), type: 'shape', shape, x: 540, y: 260, w: 200, h: shape === 'ellipse' ? 200 : 160, fill: acc, stroke: 'none', sw: 0, radius: shape === 'rect' ? 12 : 0 };
    addItem(it);
  }
  async function insertImage(replace) {
    endEdit();
    const p = await OS.dialog.open({ title: replace ? 'Replace image' : 'Insert image', accept: (window.LOS_KINDS && LOS_KINDS.image) || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'], startIn: '/Pictures' });
    if (!p) return;
    const size = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve([img.naturalWidth || 400, img.naturalHeight || 300]);
      img.onerror = () => resolve(null);
      img.src = OS.fs.rawUrl(p);
    });
    if (!size) { OS.notify('The file may be damaged or in a format that isn’t supported.', { type: 'error', title: 'Couldn’t load image' }); return; }
    if (replace) {
      const it = selItems()[0]; if (!it || it.type !== 'image') return;
      pushUndo();
      it.path = p;
      it.h = Math.round(it.w * size[1] / size[0]);
      touched();
      return;
    }
    const k = Math.min(1, 720 / size[0], 440 / size[1]);
    const w = Math.max(20, Math.round(size[0] * k)); const h = Math.max(20, Math.round(size[1] * k));
    addItem({ id: uid(), type: 'image', path: p, x: Math.round((W0 - w) / 2), y: Math.round((H0 - h) / 2), w, h, fit: 'cover' });
  }
  function deleteSelected() {
    if (!selIds.length) return;
    endEdit();
    pushUndo();
    slide().items = slide().items.filter((i) => !selIds.includes(i.id));
    selIds = [];
    touched();
  }
  function cloneItems(items, offset) {
    return items.map((it) => Object.assign(JSON.parse(JSON.stringify(it)), { id: uid(), x: it.x + offset, y: it.y + offset }));
  }
  function duplicateItems() {
    const items = selItems(); if (!items.length) return;
    endEdit();
    pushUndo();
    const copies = cloneItems(items, 20);
    slide().items.push(...copies);
    selIds = copies.map((c) => c.id);
    touched();
  }
  function copyItems() { const items = selItems(); if (items.length) clipItems = JSON.parse(JSON.stringify(items)); }
  function pasteItems() {
    if (!clipItems) return;
    endEdit();
    pushUndo();
    const same = clipItems.every((c) => slide().items.some((i) => i.x === c.x && i.y === c.y));
    const copies = cloneItems(clipItems, same ? 20 : 0);
    slide().items.push(...copies);
    selIds = copies.map((c) => c.id);
    clipItems = JSON.parse(JSON.stringify(copies));
    touched();
  }
  function reorder(how) {
    const items = slide().items;
    if (!selIds.length) return;
    endEdit();
    pushUndo();
    const picked = items.filter((i) => selIds.includes(i.id));
    let rest = items.filter((i) => !selIds.includes(i.id));
    if (how === 'front') rest = rest.concat(picked);
    else if (how === 'back') rest = picked.concat(rest);
    else {
      // swap each selected item with its unselected neighbour
      const out = items.slice();
      if (how === 'forward') {
        for (let i = out.length - 2; i >= 0; i--) if (selIds.includes(out[i].id) && !selIds.includes(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]];
      } else {
        for (let i = 1; i < out.length; i++) if (selIds.includes(out[i].id) && !selIds.includes(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]];
      }
      rest = out;
    }
    slide().items = rest;
    touched();
  }
  function nudge(dx, dy) {
    const items = selItems(); if (!items.length) return;
    pushUndo(null, 'nudge');
    items.forEach((it) => { it.x += dx; it.y += dy; });
    items.forEach(positionItem);
    renderSelection();
    syncPanel();
    setDirty(true);
    refreshThumbSoon();
  }
  /** Apply a property to every selected item that has it (or to items matching a predicate). */
  function applyProp(fn, tag) {
    const items = selItems(); if (!items.length) return;
    pushUndo(null, tag);
    items.forEach(fn);
    touched({ keepPanel: true });
  }

  // ------------------------------------------------------------------ toolbar
  function updateToolbar() {
    const items = selItems();
    const t = items.find((i) => i.type === 'text');
    const set = (cmd, on) => { const b = document.querySelector('[data-cmd="' + cmd + '"]'); if (b) b.classList.toggle('active', !!on); };
    let bold = t && t.bold; let italic = t && t.italic; let underline = t && t.underline;
    if (editingId) {
      try { bold = document.queryCommandState('bold'); italic = document.queryCommandState('italic'); underline = document.queryCommandState('underline'); } catch (e) { /* ignore */ }
    }
    set('bold', bold); set('italic', italic); set('underline', underline);
    set('alignLeft', t && t.align === 'left'); set('alignCenter', t && t.align === 'center'); set('alignRight', t && t.align === 'right');
    if (document.activeElement !== el.fontSize) el.fontSize.value = t ? t.size : '';
    el.fontSize.disabled = !t;
    const c = t ? t.color : '#16171A';
    el.colorBar.style.background = c;
    if (HEX.test(c) && c.length === 7) el.textColor.value = c;
    ['forward', 'backward', 'delete'].forEach((k) => { const b = document.querySelector('[data-cmd="' + k + '"]'); if (b) b.disabled = !items.length; });
  }
  document.addEventListener('selectionchange', () => { if (editingId) updateToolbar(); });
  $('toolbar').addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault(); // keep the caret in the text being edited
  });
  $('toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]'); if (!b || b.disabled) return;
    const c = b.dataset.cmd;
    const texts = () => selItems().filter((i) => i.type === 'text');
    switch (c) {
      case 'text': insertText(); break;
      case 'shape': {
        const r = b.getBoundingClientRect();
        OS.menu([
          { label: 'Rectangle', icon: 'square', action: () => insertShape('rect') },
          { label: 'Ellipse', icon: 'circle', action: () => insertShape('ellipse') },
          { label: 'Line', icon: 'line', action: () => insertShape('line') },
          { label: 'Arrow', icon: 'arrow', action: () => insertShape('arrow') },
        ], { x: r.left, y: r.bottom + 4 });
        break;
      }
      case 'image': insertImage(false); break;
      case 'bold': case 'italic': case 'underline':
        if (editingId) { execOnText(c); updateToolbar(); break; }
        if (texts().length) { const on = !texts()[0][c]; applyProp((it) => { if (it.type === 'text') it[c] = on; }); }
        break;
      case 'alignLeft': case 'alignCenter': case 'alignRight': {
        const a = c === 'alignLeft' ? 'left' : c === 'alignCenter' ? 'center' : 'right';
        if (editingId) { const it = findItem(editingId); pushUndo(null); it.align = a; editNode().style.textAlign = a; setDirty(true); updateToolbar(); refreshThumbSoon(); break; }
        applyProp((it) => { if (it.type === 'text') it.align = a; });
        break;
      }
      case 'forward': reorder('forward'); break;
      case 'backward': reorder('backward'); break;
      case 'delete': deleteSelected(); break;
      default: break;
    }
  });
  el.fontSize.addEventListener('change', () => {
    const v = clamp(Math.round(Number(el.fontSize.value) || 0), 6, 400);
    if (!v) return;
    if (editingId) {
      const it = findItem(editingId); pushUndo(null); it.size = v; editNode().style.fontSize = v + 'px'; commitText(); setDirty(true); renderSelection(); restoreRange(); return;
    }
    applyProp((it) => { if (it.type === 'text') it.size = v; });
  });
  el.fontSize.addEventListener('keydown', (e) => { if (e.key === 'Enter') { el.fontSize.dispatchEvent(new Event('change')); if (editingId) restoreRange(); } e.stopPropagation(); });
  el.textColor.addEventListener('change', () => {
    const v = el.textColor.value;
    if (editingId) {
      const s = savedRange;
      if (s && !s.collapsed) { execOnText('foreColor', v); return; }
      const it = findItem(editingId); pushUndo(null); it.color = v; editNode().style.color = v; setDirty(true); updateToolbar(); restoreRange(); return;
    }
    applyProp((it) => { if (it.type === 'text') it.color = v; else if (it.type === 'shape' && (it.shape === 'line' || it.shape === 'arrow')) it.stroke = v; });
  });

  // new slide / layouts
  function addSlide(layout, at) {
    endEdit();
    pushUndo();
    const i = at == null ? cur + 1 : at;
    const s = makeSlide(layout, doc.theme);
    s.bg = slide() ? slide().bg : '#FFFFFF';
    doc.slides.splice(i, 0, s);
    cur = i; selIds = [];
    renderAll();
    setDirty(true);
    scrollThumbIntoView();
  }
  $('newSlideBtn').addEventListener('click', () => addSlide(doc.slides.length === 0 ? 'title' : 'content'));
  $('layoutBtn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    OS.menu(LAYOUTS.map((l) => ({ label: l.name, action: () => addSlide(l.id) })), { x: r.left - 80, y: r.bottom + 4 });
  });
  $('presentBtn').addEventListener('click', () => present(cur));
  $('fileBtn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    OS.menu([
      { label: 'New presentation', icon: 'plus', action: () => OS.open('slides') },
      { label: 'Open…', icon: 'open', key: 'Ctrl+O', action: openFile },
      'sep',
      { label: 'Save', icon: 'save', key: 'Ctrl+S', action: () => save(false) },
      { label: 'Save as…', key: 'Ctrl+Shift+S', action: () => save(true) },
      'sep',
      { label: 'Present from beginning', icon: 'present', key: 'F5', action: () => present(0) },
      { label: 'Present from current slide', key: 'Shift+F5', action: () => present(cur) },
    ], { x: r.left, y: r.bottom + 4 });
  });

  // ------------------------------------------------------------------ thumbnail rail
  const TW = 140;
  function thumbHtml(i) {
    return '<div class="thumb' + (i === cur ? ' active' : '') + '" draggable="true" data-i="' + i + '">' +
      '<span class="num">' + (i + 1) + '</span><div class="mini"></div>' +
      '<div class="thumb-tools"><button data-act="up" title="Move up" aria-label="Move slide up">' + OS.icon('up', 12) + '</button>' +
      '<button data-act="down" title="Move down" aria-label="Move slide down">' + OS.icon('down', 12) + '</button></div></div>';
  }
  function fillThumb(node, i) {
    const mini = node.querySelector('.mini');
    const s = slideEl(doc.slides[i], 'thumb');
    s.style.transform = 'scale(' + (TW / W0) + ')';
    mini.innerHTML = '';
    mini.appendChild(s);
  }
  function renderRail() {
    el.rail.innerHTML = doc.slides.map((_, i) => thumbHtml(i)).join('');
    el.rail.querySelectorAll('.thumb').forEach((n, i) => fillThumb(n, i));
  }
  function refreshThumb(i) {
    const n = el.rail.querySelector('.thumb[data-i="' + i + '"]');
    if (n) fillThumb(n, i);
  }
  const refreshThumbSoon = U.debounce(() => refreshThumb(cur), 200);
  function scrollThumbIntoView() {
    const n = el.rail.querySelector('.thumb.active');
    if (n) n.scrollIntoView({ block: 'nearest' });
  }
  function goto(i) {
    if (i < 0 || i >= doc.slides.length) return;
    endEdit();
    if (i === cur) return;
    cur = i; selIds = [];
    el.rail.querySelectorAll('.thumb').forEach((n) => n.classList.toggle('active', +n.dataset.i === cur));
    renderCanvas(); renderSelection(); renderPanel();
    el.notes.value = slide().notes || '';
    updateCounter();
    scrollThumbIntoView();
  }
  function moveSlide(from, to) {
    if (to < 0 || to >= doc.slides.length || from === to) return;
    endEdit();
    pushUndo();
    const [s] = doc.slides.splice(from, 1);
    doc.slides.splice(to, 0, s);
    cur = to;
    renderAll();
    setDirty(true);
    scrollThumbIntoView();
  }
  function duplicateSlide(i) {
    endEdit(); pushUndo();
    const copy = JSON.parse(JSON.stringify(doc.slides[i]));
    copy.items.forEach((it) => { it.id = uid(); });
    doc.slides.splice(i + 1, 0, copy);
    cur = i + 1; selIds = [];
    renderAll(); setDirty(true); scrollThumbIntoView();
  }
  async function deleteSlide(i) {
    if (doc.slides.length < 2) {
      if (doc.slides[0].items.length && !(await OS.dialog.confirm({ title: 'Clear slide?', message: 'This is the only slide. Clear everything on it?', okLabel: 'Clear', danger: true }))) return;
      endEdit(); pushUndo(); doc.slides[0].items = []; selIds = []; renderAll(); setDirty(true); return;
    }
    endEdit(); pushUndo();
    doc.slides.splice(i, 1);
    if (cur >= doc.slides.length) cur = doc.slides.length - 1; else if (i < cur) cur--;
    selIds = [];
    renderAll(); setDirty(true);
  }
  el.rail.addEventListener('click', (e) => {
    const t = e.target.closest('.thumb'); if (!t) return;
    const i = +t.dataset.i;
    const act = e.target.closest('[data-act]');
    if (act) { e.stopPropagation(); moveSlide(i, act.dataset.act === 'up' ? i - 1 : i + 1); return; }
    goto(i);
    el.rail.focus({ preventScroll: true });
  });
  el.rail.addEventListener('contextmenu', (e) => {
    const t = e.target.closest('.thumb');
    e.preventDefault();
    if (!t) { OS.menu([{ label: 'New slide', icon: 'plus', action: () => addSlide('content', doc.slides.length) }], e); return; }
    const i = +t.dataset.i;
    goto(i);
    OS.menu([
      { label: 'New slide', icon: 'plus', action: () => addSlide('content', i + 1) },
      { label: 'Duplicate slide', icon: 'copy', key: 'Ctrl+D', action: () => duplicateSlide(i) },
      { label: 'Move up', icon: 'up', disabled: i === 0, action: () => moveSlide(i, i - 1) },
      { label: 'Move down', icon: 'down', disabled: i === doc.slides.length - 1, action: () => moveSlide(i, i + 1) },
      'sep',
      { label: 'Delete slide', icon: 'trash', danger: true, key: 'Del', action: () => deleteSlide(i) },
    ], e);
  });
  let dragFrom = -1;
  el.rail.addEventListener('dragstart', (e) => {
    const t = e.target.closest('.thumb'); if (!t) return;
    dragFrom = +t.dataset.i;
    t.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', 'slide'); } catch (err) { /* ignore */ }
  });
  const clearDrop = () => el.rail.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  el.rail.addEventListener('dragover', (e) => {
    if (dragFrom < 0) return;
    const t = e.target.closest('.thumb'); if (!t) return;
    e.preventDefault();
    clearDrop();
    const r = t.getBoundingClientRect();
    t.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  el.rail.addEventListener('drop', (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
    const t = e.target.closest('.thumb');
    if (t) {
      const i = +t.dataset.i;
      const r = t.getBoundingClientRect();
      let to = e.clientY < r.top + r.height / 2 ? i : i + 1;
      if (to > dragFrom) to--;
      moveSlide(dragFrom, to);
    }
    clearDrop();
    dragFrom = -1;
  });
  el.rail.addEventListener('dragend', () => { clearDrop(); dragFrom = -1; el.rail.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging')); });

  // notes
  let notesSnap = null;
  el.notes.addEventListener('focus', () => { endEdit(); notesSnap = snapshot(); });
  el.notes.addEventListener('input', () => { slide().notes = el.notes.value; setDirty(true); });
  el.notes.addEventListener('blur', () => { if (notesSnap && notesSnap.data !== serialise()) pushUndo(notesSnap); notesSnap = null; });
  el.notes.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(e.shiftKey); }
    e.stopPropagation();
  });

  // ------------------------------------------------------------------ format panel
  let panelSnap = null;
  function cpick(id, value) {
    const none = !value || value === 'none';
    return '<span class="cpick' + (none ? ' none' : '') + '"><input type="color" id="' + id + '" value="' + (none ? '#ffffff' : esc(value.length === 4 ? '#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3] : value.slice(0, 7))) + '"></span>';
  }
  function layoutTile(l) {
    const parts = {
      title: '<i style="left:20%;top:36%;width:60%;height:12%"></i><i class="b" style="left:30%;top:56%;width:40%;height:8%"></i>',
      content: '<i style="left:8%;top:12%;width:50%;height:12%"></i><i class="b" style="left:8%;top:34%;width:84%;height:50%"></i>',
      two: '<i style="left:8%;top:12%;width:50%;height:12%"></i><i class="b" style="left:8%;top:34%;width:40%;height:50%"></i><i class="b" style="left:52%;top:34%;width:40%;height:50%"></i>',
      blank: '',
    }[l.id];
    return '<div class="layouts-wrap"><button class="layout-tile" data-layout="' + l.id + '" title="' + esc(l.name) + '">' + parts + '</button><div class="lbl">' + esc(l.name) + '</div></div>';
  }
  function renderPanel() {
    const items = selItems();
    const s = slide();
    let h = '';
    if (items.length === 1) {
      const it = items[0];
      const isLine = it.type === 'shape' && (it.shape === 'line' || it.shape === 'arrow');
      const label = it.type === 'text' ? 'Text box' : it.type === 'image' ? 'Image' : isLine ? (it.shape === 'arrow' ? 'Arrow' : 'Line') : it.shape === 'ellipse' ? 'Ellipse' : 'Rectangle';
      h += '<section class="psec"><h3>' + label + '</h3><div class="fields">' +
        ['x', 'y', 'w', 'h'].map((k) => '<label class="nfield"><span>' + k.toUpperCase() + '</span><input type="number" data-geom="' + k + '" step="1"><em>px</em></label>').join('') + '</div>';
      if (it.type === 'text') {
        h += '<div class="crow"><label for="pColor">Text colour</label>' + cpick('pColor', it.color) + '</div>';
        h += '<div class="crow"><label for="pFill">Background</label>' + cpick('pFill', it.fill) + '<button class="btn btn-sm mini-btn" data-clear="fill">None</button></div>';
        h += '<div class="crow"><label for="pSize">Font size</label><input class="input" style="width:72px" id="pSize" type="number" min="6" max="400" value="' + it.size + '"></div>';
      } else if (it.type === 'shape' && !isLine) {
        h += '<div class="crow"><label for="pFill">Fill</label>' + cpick('pFill', it.fill) + '<button class="btn btn-sm mini-btn" data-clear="fill">None</button></div>';
        h += '<div class="crow"><label for="pStroke">Border</label>' + cpick('pStroke', it.sw > 0 ? it.stroke : 'none') + '<input class="input" style="width:56px" id="pSw" type="number" min="0" max="60" value="' + it.sw + '" title="Border width"></div>';
        if (it.shape === 'rect') h += '<div class="crow"><label for="pRadius">Corner radius</label><input class="input" style="width:72px" id="pRadius" type="number" min="0" max="400" value="' + it.radius + '"></div>';
      } else if (isLine) {
        h += '<div class="crow"><label for="pStroke">Colour</label>' + cpick('pStroke', it.stroke) + '<input class="input" style="width:56px" id="pSw" type="number" min="1" max="60" value="' + it.sw + '" title="Line width"></div>';
        h += '<div class="crow"><label>Type</label><select class="select" id="pLineType" style="width:110px"><option value="line"' + (it.shape === 'line' ? ' selected' : '') + '>Line</option><option value="arrow"' + (it.shape === 'arrow' ? ' selected' : '') + '>Arrow</option></select></div>';
      } else if (it.type === 'image') {
        h += '<div class="crow"><label for="pFit">Fit</label><select class="select" id="pFit" style="width:110px"><option value="cover"' + (it.fit !== 'contain' ? ' selected' : '') + '>Fill box</option><option value="contain"' + (it.fit === 'contain' ? ' selected' : '') + '>Fit inside</option></select></div>';
        h += '<button class="btn btn-sm" id="pReplace">' + OS.icon('image', 14) + 'Replace image…</button>';
      }
      h += '</section>';
    } else if (items.length > 1) {
      h += '<section class="psec"><h3>' + items.length + ' items selected</h3><p class="phint">Drag to move them together, use arrow keys to nudge, or press Delete to remove them.</p></section>';
    }
    h += '<section class="psec"><h3>Layout</h3><div class="layouts">' + LAYOUTS.map(layoutTile).join('') + '</div><p class="phint">Applies to this slide.</p></section>';
    h += '<section class="psec"><h3>Theme colour</h3><div class="swatches">' +
      ACCENTS.map((c) => '<button class="swatch' + (c.toLowerCase() === doc.theme.accent.toLowerCase() ? ' active' : '') + '" data-accent="' + c + '" title="' + c + '" style="background:' + c + '"></button>').join('') + '</div>' +
      '<select class="select" id="pFont" aria-label="Theme font">' + Object.keys(FONTS).map((f) => '<option' + (f === doc.theme.font ? ' selected' : '') + '>' + f + '</option>').join('') + '</select></section>';
    h += '<section class="psec"><h3>Background</h3><div class="swatches">' +
      BGS.map((c) => '<button class="swatch' + (c.toLowerCase() === s.bg.toLowerCase() ? ' active' : '') + '" data-bg="' + c + '" title="' + c + '" style="background:' + c + '"></button>').join('') + '</div>' +
      '<div class="crow"><label for="pBg">Custom colour</label>' + cpick('pBg', s.bg) + '</div>' +
      '<button class="btn btn-sm" id="pBgAll">Apply to all slides</button></section>';
    h += '<section class="psec"><h3>Transition</h3><select class="select" id="pTrans">' +
      [['none', 'None'], ['fade', 'Fade'], ['slide', 'Slide in']].map(([v, n]) => '<option value="' + v + '"' + (s.transition === v ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></section>';
    el.panel.innerHTML = h;
    syncPanel();
  }
  function syncPanel() {
    const it = selIds.length === 1 ? findItem(selIds[0]) : null;
    if (!it) return;
    el.panel.querySelectorAll('[data-geom]').forEach((inp) => { if (document.activeElement !== inp) inp.value = Math.round(it[inp.dataset.geom]); });
  }
  const P = el.panel;
  P.addEventListener('focusin', () => { panelSnap = snapshot(); });
  P.addEventListener('mousedown', () => { if (!panelSnap) panelSnap = snapshot(); });
  function commitPanel() {
    if (panelSnap && panelSnap.data !== serialise()) pushUndo(panelSnap);
    panelSnap = snapshot();
  }
  function livePanel(e) {
    const t = e.target; const it = selIds.length === 1 ? findItem(selIds[0]) : null;
    const v = t.value;
    if (t.dataset.geom && it) {
      const n = Number(v); if (!isFinite(n) || v === '') return;
      const k = t.dataset.geom;
      const isLine = it.type === 'shape' && (it.shape === 'line' || it.shape === 'arrow');
      it[k] = Math.round((k === 'w' || k === 'h') && !isLine ? Math.max(4, n) : n);
    } else if (t.id === 'pColor' && it) it.color = v;
    else if (t.id === 'pFill' && it) { it.fill = v; t.parentNode.classList.remove('none'); }
    else if (t.id === 'pStroke' && it) { it.stroke = v; if (!it.sw) { it.sw = 3; const sw = $('pSw'); if (sw) sw.value = 3; } t.parentNode.classList.remove('none'); }
    else if (t.id === 'pSw' && it) it.sw = clamp(Math.round(Number(v) || 0), 0, 60);
    else if (t.id === 'pRadius' && it) it.radius = clamp(Math.round(Number(v) || 0), 0, 400);
    else if (t.id === 'pSize' && it) { const n = Math.round(Number(v)); if (n >= 6) it.size = Math.min(400, n); }
    else if (t.id === 'pBg') slide().bg = v;
    else return false;
    setDirty(true);
    if (editingId) { const ed = editNode(); if (ed && it) { ed.style.color = it.color; ed.style.fontSize = it.size + 'px'; ed.style.background = it.fill && it.fill !== 'none' ? it.fill : ''; } renderSelection(); return true; }
    if (t.id === 'pBg') { el.canvas.style.background = v; } else if (it) replaceItemEl(it);
    renderSelection();
    refreshThumbSoon();
    return true;
  }
  P.addEventListener('input', livePanel);
  P.addEventListener('change', (e) => {
    const t = e.target; const it = selIds.length === 1 ? findItem(selIds[0]) : null;
    if (t.id === 'pFont') { doc.theme.font = FONTS[t.value] ? t.value : 'Inter'; commitPanel(); renderCanvas(); renderRail(); renderSelection(); setDirty(true); return; }
    if (t.id === 'pTrans') { slide().transition = t.value; commitPanel(); setDirty(true); return; }
    if (t.id === 'pLineType' && it) { it.shape = t.value; commitPanel(); touched(); return; }
    if (t.id === 'pFit' && it) { it.fit = t.value; commitPanel(); touched({ keepPanel: true }); return; }
    livePanel(e);
    commitPanel();
    if (!editingId) { renderCanvas(); renderSelection(); }
    refreshThumb(cur);
    if (t.id === 'pBg') renderPanel();
  });
  P.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); e.stopPropagation(); });
  P.addEventListener('click', async (e) => {
    const t = e.target;
    const acc = t.closest('[data-accent]');
    if (acc) {
      endEdit();
      pushUndo();
      const old = doc.theme.accent.toLowerCase(); const nw = acc.dataset.accent;
      doc.theme.accent = nw;
      doc.slides.forEach((s) => s.items.forEach((it) => {
        ['color', 'fill', 'stroke'].forEach((k) => { if (typeof it[k] === 'string' && it[k].toLowerCase() === old) it[k] = nw; });
      }));
      renderAll(); setDirty(true); return;
    }
    const bg = t.closest('[data-bg]');
    if (bg) { endEdit(); pushUndo(); slide().bg = bg.dataset.bg; touched(); return; }
    if (t.closest('#pBgAll')) { endEdit(); pushUndo(); const b = slide().bg; doc.slides.forEach((s) => { s.bg = b; }); renderRail(); setDirty(true); OS.notify('Every slide now uses this background.', { type: 'success', title: 'Background applied' }); return; }
    if (t.closest('#pReplace')) { insertImage(true); return; }
    const clr = t.closest('[data-clear]');
    if (clr) { const it = findItem(selIds[0]); if (it) { pushUndo(); it[clr.dataset.clear] = 'none'; if (editingId) { editNode().style.background = ''; renderPanel(); } else touched(); } return; }
    const lay = t.closest('[data-layout]');
    if (lay) {
      endEdit();
      const s = slide();
      const hasContent = s.items.some((it) => it.type !== 'text' || plainText(it.html).trim());
      if (hasContent && !(await OS.dialog.confirm({ title: 'Apply layout?', message: 'This replaces everything on the current slide. You can undo it.', okLabel: 'Apply layout', danger: true }))) return;
      pushUndo();
      const fresh = makeSlide(lay.dataset.layout, doc.theme);
      s.items = fresh.items;
      selIds = [];
      touched();
    }
  });

  // ------------------------------------------------------------------ keyboard
  const typingIn = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  document.addEventListener('keydown', (e) => {
    if (presenting) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key; const lk = k.toLowerCase();
    if (mod && lk === 's') { e.preventDefault(); save(e.shiftKey); return; }
    if (mod && lk === 'o') { e.preventDefault(); openFile(); return; }
    if (k === 'F5') { e.preventDefault(); endEdit(); present(e.shiftKey ? cur : 0); return; }
    if (editingId) {
      if (k === 'Escape') { e.preventDefault(); const id = editingId; endEdit(); select([id]); }
      return; // the browser handles typing, Ctrl+B/I/U, undo inside the box
    }
    if (typingIn(e.target)) return;
    const inRail = el.rail.contains(document.activeElement);
    if (mod) {
      if (lk === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (lk === 'y' || (lk === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (lk === 'd') { e.preventDefault(); if (selIds.length && !inRail) duplicateItems(); else duplicateSlide(cur); }
      else if (lk === 'c') { if (selIds.length) { e.preventDefault(); copyItems(); } }
      else if (lk === 'x') { if (selIds.length) { e.preventDefault(); copyItems(); deleteSelected(); } }
      else if (lk === 'v') { if (clipItems) { e.preventDefault(); pasteItems(); } }
      else if (lk === 'a') { e.preventDefault(); select(slide().items.map((i) => i.id)); }
      else if (lk === 'm') { e.preventDefault(); addSlide('content'); }
      else if (lk === 'b' || lk === 'i' || lk === 'u') {
        const map = { b: 'bold', i: 'italic', u: 'underline' };
        const texts = selItems().filter((i) => i.type === 'text');
        if (texts.length) { e.preventDefault(); const p = map[lk]; const on = !texts[0][p]; applyProp((it) => { if (it.type === 'text') it[p] = on; }); }
      } else if (k === 'ArrowUp' && inRail) { e.preventDefault(); moveSlide(cur, cur - 1); }
      else if (k === 'ArrowDown' && inRail) { e.preventDefault(); moveSlide(cur, cur + 1); }
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    switch (k) {
      case 'Delete': case 'Backspace':
        e.preventDefault();
        if (selIds.length && !inRail) deleteSelected(); else if (inRail) deleteSlide(cur);
        break;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown':
        e.preventDefault();
        if (selIds.length && !inRail) nudge(k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0, k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0);
        else goto(cur + (k === 'ArrowUp' || k === 'ArrowLeft' ? -1 : 1));
        break;
      case 'PageUp': e.preventDefault(); goto(cur - 1); break;
      case 'PageDown': e.preventDefault(); goto(cur + 1); break;
      case 'Home': if (inRail) { e.preventDefault(); goto(0); } break;
      case 'End': if (inRail) { e.preventDefault(); goto(doc.slides.length - 1); } break;
      case 'Escape': if (selIds.length) select([]); break;
      case 'Enter': case 'F2': {
        const it = selItems()[0];
        if (it && it.type === 'text' && selIds.length === 1) { e.preventDefault(); startEdit(it.id); }
        break;
      }
      default: break;
    }
  });

  // ------------------------------------------------------------------ present mode
  let presenting = null;
  function present(start) {
    endEdit();
    if (presenting) return;
    const ov = document.createElement('div');
    ov.className = 'present';
    ov.tabIndex = 0;
    ov.innerHTML = '<div class="pcount"></div>';
    document.body.appendChild(ov);
    presenting = { ov, i: clamp(start, 0, doc.slides.length - 1), end: false, idleT: null };
    ov.focus();
    const root = document.documentElement;
    if (root.requestFullscreen) root.requestFullscreen().catch(() => { /* not allowed: overlay fills the window instead */ });
    showPresented(null);
    ov.addEventListener('click', () => nextSlide(1));
    ov.addEventListener('contextmenu', (e) => { e.preventDefault(); nextSlide(-1); });
    ov.addEventListener('mousemove', () => {
      ov.classList.add('cursor'); ov.classList.remove('idle');
      clearTimeout(presenting.idleT);
      presenting.idleT = setTimeout(() => { if (presenting) { ov.classList.remove('cursor'); ov.classList.add('idle'); } }, 2000);
    });
    presenting.idleT = setTimeout(() => { if (presenting) ov.classList.add('idle'); }, 2500);
    window.addEventListener('resize', layoutPresented);
  }
  function presentScale() {
    const w = presenting.ov.clientWidth; const h = presenting.ov.clientHeight;
    return Math.min(w / W0, h / H0);
  }
  function layoutPresented() {
    if (!presenting) return;
    const s = presentScale();
    presenting.ov.querySelectorAll('.pslot').forEach((slot) => {
      Object.assign(slot.style, { width: (W0 * s) + 'px', height: (H0 * s) + 'px' });
      const inner = slot.querySelector('.slide'); if (inner) inner.style.transform = 'scale(' + s + ')';
    });
  }
  function showPresented(dir) {
    const p = presenting; const ov = p.ov;
    const old = ov.querySelectorAll('.pslot');
    const slot = document.createElement('div');
    slot.className = 'pslot';
    if (p.end) {
      slot.innerHTML = '<div class="pend">End of presentation — click or press Esc to exit</div>';
      Object.assign(slot.style, { position: 'static' });
    } else {
      const s = doc.slides[p.i];
      slot.appendChild(slideEl(s, 'present'));
      const tr = dir ? s.transition : 'none';
      if (tr === 'fade') slot.classList.add('t-fade-in');
      else if (tr === 'slide') slot.classList.add(dir > 0 ? 't-slide-in' : 't-slide-back');
    }
    ov.insertBefore(slot, ov.querySelector('.pcount'));
    layoutPresented();
    const remove = () => old.forEach((o) => o.remove());
    if (slot.classList.contains('t-fade-in') || slot.classList.contains('t-slide-in') || slot.classList.contains('t-slide-back')) {
      slot.addEventListener('animationend', remove, { once: true });
      setTimeout(remove, 700);
    } else remove();
    ov.querySelector('.pcount').textContent = p.end ? '' : (p.i + 1) + ' / ' + doc.slides.length;
  }
  function nextSlide(d) {
    const p = presenting; if (!p) return;
    if (p.end) { if (d > 0) { exitPresent(); return; } p.end = false; showPresented(null); return; }
    const n = p.i + d;
    if (n >= doc.slides.length) { p.end = true; showPresented(null); return; }
    if (n < 0) return;
    p.i = n;
    showPresented(d);
  }
  function exitPresent() {
    if (!presenting) return;
    const p = presenting; presenting = null;
    clearTimeout(p.idleT);
    p.ov.remove();
    window.removeEventListener('resize', layoutPresented);
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (!p.end && p.i !== cur) goto(p.i);
  }
  document.addEventListener('fullscreenchange', () => {
    if (presenting) { if (!document.fullscreenElement && presenting.wasFull) exitPresent(); else if (document.fullscreenElement) presenting.wasFull = true; layoutPresented(); }
  });
  document.addEventListener('keydown', (e) => {
    if (!presenting) return;
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) { e.preventDefault(); nextSlide(1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) { e.preventDefault(); nextSlide(-1); }
    else if (k === 'Home') { e.preventDefault(); presenting.end = false; presenting.i = 0; showPresented(null); }
    else if (k === 'End') { e.preventDefault(); presenting.end = false; presenting.i = doc.slides.length - 1; showPresented(null); }
    else if (k === 'Escape') { e.preventDefault(); exitPresent(); }
  }, true);

  // ------------------------------------------------------------------ start
  updateTitle();
  renderAll();
  fit();
  if (OS.args.path) load(OS.args.path);
});
