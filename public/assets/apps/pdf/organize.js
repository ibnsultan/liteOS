/*
 * PDF Viewer's Organise view: all the pages as a grid, to select, drag into a new order, rotate, delete, insert
 * (blank pages, pages from another PDF, pictures), extract and split; and the two ways in from the hub that start
 * empty: Combine files and Pictures to PDF. Thumbnails are drawn with pdf.js; the new file is written with pdf-lib
 * (MIT, vendored by `npm run vendor`, loaded the first time it's needed).
 *
 * window.PVOrganize(ctx) is called by app.js with what it shares (see `ctx` there) and returns { open(mode) }.
 */
window.PVOrganize = function (ctx) {
  'use strict';

  const { OS, U, esc, ico, $ } = ctx;
  const PDFLIB = window.LOS_BASE + 'assets/vendor/pdf-lib-1.17.1.min.js';
  const A4 = [595.28, 841.89];
  const view = $('#organize');
  const grid = $('#orgGrid');

  let sources = []; // { kind: 'pdf', name, pjs (pdf.js document), current, bytes? } | { kind: 'image', name, blob, url }
  let pages = []; // { key, src, index (pdf), kind: 'pdf' | 'image' | 'blank', rot, ratio }
  let selected = new Set();
  let anchor = null; // the tile Shift+click selects from
  let changed = false;
  let mode = 'arrange'; // 'arrange' (the open PDF) | 'combine' | 'pictures'
  let nextKey = 1;

  // ------------------------------------------------------------------ opening and closing
  async function open(m) {
    mode = m;
    sources = [];
    pages = [];
    selected = new Set();
    changed = false;
    if (m === 'arrange') {
      const doc = ctx.doc;
      if (!doc) return;
      if (!(await canAssemble())) return;
      sources.push({ kind: 'pdf', name: ctx.current.name, pjs: doc, current: true });
      for (let i = 0; i < doc.numPages; i++) pages.push({ key: nextKey++, src: 0, index: i, kind: 'pdf', rot: 0 });
    }
    show(true);
    render();
    if (m === 'combine') addPdf();
    else if (m === 'pictures') addPictures();
  }
  /** pdf-lib can't rewrite a protected PDF, and some PDFs forbid rearranging their pages. */
  async function canAssemble() {
    try {
      const perms = await ctx.doc.getPermissions();
      if (perms && !perms.includes(ctx.lib.PermissionFlag.ASSEMBLE)) {
        OS.dialog.alert({ title: 'This PDF’s pages can’t be rearranged', message: 'Its author has turned that off.' });
        return false;
      }
    } catch (e) { /* no permissions set */ }
    return true;
  }
  function show(on) {
    view.hidden = !on;
    $('#toolbar').hidden = on || !ctx.doc;
    $('#body').hidden = on || !ctx.doc;
    $('#start').hidden = on || !!ctx.doc;
    document.body.classList.toggle('pv-organizing', on);
    if (on) ctx.setTitle((mode === 'arrange' ? ctx.current.name + ' · ' : '') + (mode === 'combine' ? 'Combine files' : mode === 'pictures' ? 'Pictures to PDF' : 'Organise pages'));
  }
  async function leave() {
    if (changed && pages.length) {
      const ok = await OS.dialog.confirm({ title: 'Leave without saving?', message: 'The changes to the pages will be lost.', okLabel: 'Leave without saving', danger: true });
      if (!ok) return;
    }
    cleanup();
    show(false);
    if (ctx.doc) ctx.setTitle(ctx.current.name); else ctx.backToStart();
  }
  function cleanup() {
    thumbObserver.disconnect();
    sources.forEach((s) => {
      if (s.kind === 'pdf' && !s.current && s.task) s.task.destroy().catch(() => {});
      if (s.kind === 'image' && s.url) URL.revokeObjectURL(s.url);
    });
    sources = [];
    pages = [];
    grid.innerHTML = '';
  }

  // ------------------------------------------------------------------ the grid
  const thumbObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) drawThumb(en.target); });
  }, { root: grid, rootMargin: '400px 0px' });

  function render() {
    thumbObserver.disconnect();
    grid.innerHTML = pages.length ? pages.map((p, i) => {
      const on = selected.has(p.key);
      const s = sources[p.src];
      const label = p.kind === 'blank' ? 'Blank page' : p.kind === 'image' ? s.name : (sources.length > 1 ? s.name + ', page ' + (p.index + 1) : 'Page ' + (p.index + 1));
      return '<div class="pv-otile' + (on ? ' on' : '') + '" data-key="' + p.key + '">' +
        '<button type="button" class="pv-opage" draggable="true" data-key="' + p.key + '" aria-pressed="' + on + '" aria-label="' + esc(label) + ' (position ' + (i + 1) + ')" title="' + esc(label) + '">' +
        '<span class="pv-osheet" data-sheet style="--ratio:' + (p.ratio || 1.414) + ';transform:' + turn(p) + '">' +
        (p.kind === 'image' ? '<img src="' + esc(s.url) + '" alt="" draggable="false">' : p.kind === 'blank' ? '' : '<canvas width="0" height="0"></canvas>') + '</span>' +
        (on ? '<span class="pv-ocheck">' + ico('check', 13) + '</span>' : '') + '</button>' +
        '<span class="pv-ono">' + (i + 1) + (p.kind === 'pdf' && sources.length > 1 ? ' <span class="pv-osrc">' + esc(U.stem(s.name)) + '</span>' : '') + '</span></div>';
    }).join('') : '<div class="pv-oempty">' + (mode === 'pictures' ? 'Add pictures to make a PDF of them, one picture a page.' : 'Add PDFs to combine them into one. Drag pages to put them in order.') + '</div>';
    grid.querySelectorAll('.pv-otile').forEach((t) => thumbObserver.observe(t));
    status();
  }
  function status() {
    const n = pages.length;
    $('#orgStatus').textContent = (selected.size ? selected.size + ' of ' : '') + n + (n === 1 ? ' page' : ' pages') + (selected.size ? ' selected' : '');
    const none = !selected.size;
    ['rotl', 'rotr', 'delete', 'extract'].forEach((a) => { const b = view.querySelector('[data-org="' + a + '"]'); if (b) b.disabled = none; });
    view.querySelector('[data-org="split"]').disabled = n < 2;
    view.querySelector('[data-org="save"]').disabled = !n || (mode === 'arrange' && !changed);
    view.querySelector('[data-org="copy"]').disabled = !n;
    view.querySelector('[data-org="save"]').textContent = mode === 'arrange' && ctx.current.path ? 'Save' : 'Save as…';
  }
  /** A page turned on its side is shrunk so it still fits its tile. */
  function turn(p) {
    const r = p.ratio || 1.414;
    const side = p.rot % 180 !== 0;
    return 'rotate(' + p.rot + 'deg)' + (side ? ' scale(' + (r > 1 ? 1 / r : r).toFixed(3) + ')' : '');
  }
  async function drawThumb(tile) {
    if (tile.dataset.drawn) return;
    tile.dataset.drawn = '1';
    thumbObserver.unobserve(tile);
    const p = pages.find((x) => x.key === +tile.dataset.key);
    if (!p || p.kind !== 'pdf') return;
    try {
      const page = await sources[p.src].pjs.getPage(p.index + 1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (150 * (window.devicePixelRatio || 1)) / base.width });
      const canvas = tile.querySelector('canvas');
      if (!canvas) return;
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      p.ratio = vp.height / vp.width;
      tile.querySelector('[data-sheet]').style.setProperty('--ratio', p.ratio);
      tile.querySelector('[data-sheet]').style.transform = turn(p);
      await page.render({ canvas, viewport: vp, annotationMode: ctx.lib.AnnotationMode.ENABLE_STORAGE }).promise;
    } catch (e) { tile.dataset.drawn = ''; }
  }

  // ------------------------------------------------------------------ selecting
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.pv-opage');
    if (!b) { if (e.target === grid) { selected.clear(); render(); } return; }
    const key = +b.dataset.key;
    if (e.shiftKey && anchor != null) {
      const a = pages.findIndex((p) => p.key === anchor);
      const z = pages.findIndex((p) => p.key === key);
      if (!e.ctrlKey && !e.metaKey) selected.clear();
      for (let i = Math.min(a, z); i <= Math.max(a, z); i++) selected.add(pages[i].key);
    } else if (e.ctrlKey || e.metaKey) {
      if (selected.has(key)) selected.delete(key); else selected.add(key);
      anchor = key;
    } else {
      selected = new Set([key]);
      anchor = key;
    }
    keepFocus(key);
  });
  function keepFocus(key) {
    render();
    const b = grid.querySelector('.pv-opage[data-key="' + key + '"]');
    if (b) b.focus({ preventScroll: false });
  }
  view.addEventListener('keydown', (e) => {
    if (view.hidden || (e.target.closest && e.target.closest('input, dialog'))) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const focusKey = document.activeElement && document.activeElement.dataset && +document.activeElement.dataset.key;
    const at = pages.findIndex((p) => p.key === focusKey);
    if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); selected = new Set(pages.map((p) => p.key)); render(); return; }
    if (e.key === 'Delete') { e.preventDefault(); remove(); return; }
    if (ctrl && (e.key === ']' || e.key === '[')) { e.preventDefault(); rotate(e.key === ']' ? 90 : -90); return; }
    if (e.key === 'Escape') { e.preventDefault(); if (selected.size) { selected.clear(); render(); } else leave(); return; }
    if (at < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const perRow = Math.max(1, Math.round(grid.clientWidth / (grid.querySelector('.pv-otile') || { offsetWidth: 180 }).offsetWidth));
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -perRow, ArrowDown: perRow, Home: -at, End: pages.length - 1 - at }[e.key];
    const to = Math.max(0, Math.min(pages.length - 1, at + step));
    if (ctrl && e.key.startsWith('Arrow')) {
      // Ctrl+arrow moves the selected pages
      if (!selected.has(focusKey)) selected = new Set([focusKey]);
      move([...selected], step > 0 ? Math.min(pages.length, to + 1) : to);
      keepFocus(focusKey);
      return;
    }
    const key = pages[to].key;
    if (e.shiftKey) { selected.add(key); } else { selected = new Set([key]); anchor = key; }
    keepFocus(key);
  });

  // ------------------------------------------------------------------ dragging pages (and dropping files in)
  let dragKeys = null;
  grid.addEventListener('dragstart', (e) => {
    const b = e.target.closest('.pv-opage');
    if (!b) return;
    const key = +b.dataset.key;
    if (!selected.has(key)) { selected = new Set([key]); }
    dragKeys = pages.filter((p) => selected.has(p.key)).map((p) => p.key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'pages');
    grid.querySelectorAll('.pv-otile').forEach((t) => t.classList.toggle('dragging', dragKeys.includes(+t.dataset.key)));
  });
  grid.addEventListener('dragend', () => { dragKeys = null; clearMarker(); grid.querySelectorAll('.dragging').forEach((t) => t.classList.remove('dragging')); });
  function dropIndex(e) {
    const tile = e.target.closest('.pv-otile');
    if (!tile) return pages.length;
    const r = tile.getBoundingClientRect();
    const i = pages.findIndex((p) => p.key === +tile.dataset.key);
    return e.clientX > r.left + r.width / 2 ? i + 1 : i;
  }
  function clearMarker() { grid.querySelectorAll('.mark-before, .mark-after').forEach((t) => t.classList.remove('mark-before', 'mark-after')); }
  grid.addEventListener('dragover', (e) => {
    const files = e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    if (!dragKeys && !files) return;
    e.preventDefault();
    e.stopPropagation();
    clearMarker();
    const i = dropIndex(e);
    const tiles = grid.querySelectorAll('.pv-otile');
    if (i < tiles.length) tiles[i].classList.add('mark-before'); else if (tiles.length) tiles[tiles.length - 1].classList.add('mark-after');
  });
  grid.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearMarker();
    const i = dropIndex(e);
    if (dragKeys) { move(dragKeys, i); dragKeys = null; render(); return; }
    // PDFs and pictures dropped from this device go in where they're dropped
    const files = [...(e.dataTransfer.files || [])];
    let at = i;
    for (const f of files) {
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') at = await insertPdf(new Uint8Array(await f.arrayBuffer()), f.name, at);
      else if (/^image\//.test(f.type)) at = insertImage(f, f.name, at);
    }
  });
  /** Move pages (by key) so they start at position `to` (counted before the move). */
  function move(keys, to) {
    const moving = pages.filter((p) => keys.includes(p.key));
    let index = to;
    pages.forEach((p, i) => { if (i < to && keys.includes(p.key)) index -= 1; });
    pages = pages.filter((p) => !keys.includes(p.key));
    pages.splice(Math.max(0, Math.min(pages.length, index)), 0, ...moving);
    changed = true;
  }

  // ------------------------------------------------------------------ the commands
  function rotate(by) {
    if (!selected.size) return;
    pages.forEach((p) => { if (selected.has(p.key)) p.rot = (p.rot + by + 360) % 360; });
    changed = true;
    render();
  }
  async function remove() {
    if (!selected.size) return;
    if (selected.size === pages.length) { OS.dialog.alert({ title: 'A PDF needs at least one page', message: 'Leave at least one page, or add others first.' }); return; }
    pages = pages.filter((p) => !selected.has(p.key));
    selected.clear();
    changed = true;
    render();
  }
  /** Where inserted pages go: after the last selected page, else at the end. */
  function insertAt() {
    let at = pages.length;
    pages.forEach((p, i) => { if (selected.has(p.key)) at = i + 1; });
    return at;
  }
  function insertMenu(btn) {
    const r = btn.getBoundingClientRect();
    OS.menu([
      { label: 'A blank page', icon: 'pv-blank', action: () => { pages.splice(insertAt(), 0, { key: nextKey++, src: -1, kind: 'blank', rot: 0, ratio: 1.414 }); changed = true; render(); } },
      { label: 'Pages from a PDF…', icon: 'pdf', action: addPdf },
      { label: 'A picture…', icon: 'image', action: addPictures },
    ], { x: r.left, y: r.bottom + 2 });
  }
  async function addPdf() {
    const path = await OS.dialog.open({ title: 'Add pages from a PDF', accept: ['pdf'], startIn: ctx.current && ctx.current.path ? U.dirname(ctx.current.path) : '/Documents' });
    if (!path) return;
    try {
      ctx.showLoading(true, 'Reading ' + U.basename(path));
      const bytes = new Uint8Array(await (await fetch(OS.fs.rawUrl(path))).arrayBuffer());
      await insertPdf(bytes, U.basename(path), insertAt());
    } catch (e) { OS.notify('That PDF couldn’t be added.', 'error'); }
    ctx.showLoading(false);
  }
  async function insertPdf(bytes, name, at) {
    let pjs;
    const task = ctx.lib.getDocument({ data: bytes.slice(), cMapUrl: ctx.PDFJS + 'cmaps/', cMapPacked: true, standardFontDataUrl: ctx.PDFJS + 'standard_fonts/', wasmUrl: ctx.PDFJS + 'wasm/' });
    try { pjs = await task.promise; } catch (e) {
      task.destroy().catch(() => {});
      OS.notify('“' + name + '” couldn’t be read' + (e && e.name === 'PasswordException' ? ': it is protected by a password.' : '.'), 'error');
      return at;
    }
    sources.push({ kind: 'pdf', name, pjs, task, bytes });
    const src = sources.length - 1;
    const add = [];
    for (let i = 0; i < pjs.numPages; i++) add.push({ key: nextKey++, src, index: i, kind: 'pdf', rot: 0 });
    pages.splice(at, 0, ...add);
    changed = true;
    render();
    return at + add.length;
  }
  async function addPictures() {
    const path = await OS.dialog.open({ title: 'Add a picture', accept: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'], startIn: '/Pictures' });
    if (!path) return;
    try {
      const blob = await (await fetch(OS.fs.rawUrl(path))).blob();
      insertImage(blob, U.basename(path), insertAt());
    } catch (e) { OS.notify('That picture couldn’t be added.', 'error'); }
  }
  function insertImage(blob, name, at) {
    sources.push({ kind: 'image', name, blob, url: URL.createObjectURL(blob) });
    const page = { key: nextKey++, src: sources.length - 1, kind: 'image', rot: 0, ratio: 1.414 };
    pages.splice(at, 0, page);
    changed = true;
    render();
    // the tile takes the shape the page will have: A4 turned to suit the picture, as build() makes it
    createImageBitmap(blob).then((bmp) => {
      page.ratio = bmp.width > bmp.height ? A4[0] / A4[1] : A4[1] / A4[0];
      bmp.close();
      render();
    }).catch(() => {});
    return at + 1;
  }

  // ------------------------------------------------------------------ writing PDFs
  async function pdfLib() {
    if (window.PDFLib) return window.PDFLib;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFLIB;
      s.onload = resolve;
      s.onerror = () => reject(new Error('pdf-lib didn’t load'));
      document.head.appendChild(s);
    });
    return window.PDFLib;
  }
  /** A picture as PNG or JPEG bytes pdf-lib can embed (other kinds go through a canvas). */
  async function imageBytes(blob) {
    if (blob.type === 'image/jpeg' || blob.type === 'image/png') return { bytes: new Uint8Array(await blob.arrayBuffer()), png: blob.type === 'image/png' };
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const png = await new Promise((r) => c.toBlob(r, 'image/png'));
    return { bytes: new Uint8Array(await png.arrayBuffer()), png: true };
  }
  /** A new PDF of these pages, in this order, with their rotations. */
  async function build(list) {
    const L = await pdfLib();
    const out = await L.PDFDocument.create();
    const loaded = new Map();
    let lastSize = A4;
    for (const p of list) {
      let page;
      if (p.kind === 'pdf') {
        let src = loaded.get(p.src);
        if (!src) {
          const s = sources[p.src];
          const bytes = s.current ? await ctx.documentBytes() : s.bytes;
          try { src = await L.PDFDocument.load(bytes, { updateMetadata: false }); } catch (e) {
            if (e && /encrypt/i.test(e.message || e.name)) throw new Error('“' + s.name + '” is protected, so its pages can’t be copied into another PDF.');
            throw e;
          }
          loaded.set(p.src, src);
        }
        [page] = await out.copyPages(src, [p.index]);
        out.addPage(page);
        if (p.rot) page.setRotation(L.degrees((page.getRotation().angle + p.rot) % 360));
      } else if (p.kind === 'image') {
        const { bytes, png } = await imageBytes(sources[p.src].blob);
        const img = png ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        // an A4 page turned to suit the picture, the picture fitted inside a margin
        const wide = img.width > img.height;
        const [w, h] = wide ? [A4[1], A4[0]] : A4;
        page = out.addPage([w, h]);
        const m = 28;
        const s = Math.min((w - 2 * m) / img.width, (h - 2 * m) / img.height);
        page.drawImage(img, { x: (w - img.width * s) / 2, y: (h - img.height * s) / 2, width: img.width * s, height: img.height * s });
        if (p.rot) page.setRotation(L.degrees(p.rot));
      } else {
        page = out.addPage(lastSize);
        if (p.rot) page.setRotation(L.degrees(p.rot));
      }
      lastSize = [page.getWidth(), page.getHeight()];
    }
    out.setProducer('LiteOS PDF Viewer');
    return out.save();
  }
  async function write(path, bytes) { await OS.fs.writeBase64(path, ctx.toBase64(bytes)); }
  async function freeName(dir, base) {
    for (let i = 0; i < 500; i++) {
      const name = i ? base + ' (' + (i + 1) + ').pdf' : base + '.pdf';
      try { await OS.fs.stat(U.join(dir, name)); } catch (e) { return U.join(dir, name); }
    }
    return U.join(dir, base + ' ' + Date.now() + '.pdf');
  }
  async function busy(text, fn) {
    ctx.showLoading(true, text);
    try { return await fn(); } catch (e) {
      console.error(e);
      OS.dialog.alert({ title: 'That couldn’t be done', message: (e && e.message) || 'Something went wrong while writing the PDF.' });
      return null;
    } finally { ctx.showLoading(false); }
  }

  async function save() {
    if (!pages.length) return;
    if (mode === 'arrange' && ctx.current.path) {
      const bytes = await busy('Saving', () => build(pages));
      if (!bytes) return;
      if (!(await busy('Saving', () => write(ctx.current.path, bytes).then(() => true)))) return;
      const path = ctx.current.path;
      changed = false;
      cleanup();
      show(false);
      ctx.markSaved();
      await ctx.openPath(path);
      OS.notify('The pages were saved in “' + U.basename(path) + '”.', { title: 'Saved' });
      return;
    }
    await saveCopy();
  }
  async function saveCopy() {
    if (!pages.length) return;
    const base = mode === 'arrange' ? U.stem(ctx.current.name) + ' (arranged)' : mode === 'pictures' ? 'Pictures' : 'Combined';
    const target = await OS.dialog.save({ title: mode === 'arrange' ? 'Save a copy' : 'Save the new PDF', defaultName: base + '.pdf', ext: 'pdf', startIn: ctx.current && ctx.current.path ? U.dirname(ctx.current.path) : '/Documents' });
    if (!target) return;
    const bytes = await busy('Saving', () => build(pages));
    if (!bytes) return;
    if (!(await busy('Saving', () => write(target, bytes).then(() => true)))) return;
    if (mode !== 'arrange') {
      changed = false;
      cleanup();
      show(false);
      await ctx.openPath(target);
    } else {
      changed = false;
      status();
    }
    OS.notify('Saved as “' + U.basename(target) + '”.', { title: 'PDF saved', actions: mode === 'arrange' ? [{ label: 'Open', action: () => { cleanup(); show(false); ctx.openPath(target); } }] : [] });
  }
  async function extract() {
    const list = pages.filter((p) => selected.has(p.key));
    if (!list.length) return;
    const base = (ctx.current ? U.stem(ctx.current.name) : 'Pages') + ' (pages)';
    const target = await OS.dialog.save({ title: 'Extract ' + list.length + (list.length === 1 ? ' page' : ' pages'), defaultName: base + '.pdf', ext: 'pdf', startIn: ctx.current && ctx.current.path ? U.dirname(ctx.current.path) : '/Documents' });
    if (!target) return;
    const bytes = await busy('Extracting', () => build(list));
    if (!bytes) return;
    if (await busy('Extracting', () => write(target, bytes).then(() => true))) OS.notify(list.length + (list.length === 1 ? ' page was' : ' pages were') + ' saved as “' + U.basename(target) + '”.', { title: 'Pages extracted', actions: [{ label: 'Open', action: () => { cleanup(); show(false); ctx.openPath(target); } }] });
  }

  // split: every n pages, or at each top-level bookmark of the open PDF (while its pages are as they were)
  async function split() {
    let marks = [];
    const untouched = mode === 'arrange' && !changed;
    if (untouched) {
      try {
        const outline = await ctx.doc.getOutline();
        for (const it of outline || []) {
          let dest = it.dest;
          if (typeof dest === 'string') dest = await ctx.doc.getDestination(dest);
          if (!Array.isArray(dest)) continue;
          const index = typeof dest[0] === 'number' ? dest[0] : await ctx.doc.getPageIndex(dest[0]);
          marks.push({ title: it.title, index });
        }
        marks = marks.filter((m, i, all) => all.findIndex((x) => x.index === m.index) === i).sort((a, b) => a.index - b.index);
      } catch (e) { marks = []; }
    }
    const box = document.createElement('dialog');
    box.className = 'dlg dlg-wide';
    box.setAttribute('aria-labelledby', 'splitTitle');
    const defDir = ctx.current && ctx.current.path ? U.dirname(ctx.current.path) : '/Documents';
    box.innerHTML = '<form method="dialog"><h2 class="dlg-title" id="splitTitle">Split into several PDFs</h2><div class="dlg-body">' +
      '<label class="pv-radio"><input type="radio" name="how" value="every" checked> Every <input class="input pv-every" name="n" inputmode="numeric" value="' + Math.max(1, Math.ceil(pages.length / 2)) + '" aria-label="Pages in each PDF"> pages</label>' +
      '<label class="pv-radio' + (marks.length > 1 ? '' : ' off') + '"><input type="radio" name="how" value="marks"' + (marks.length > 1 ? '' : ' disabled') + '> At each top-level bookmark' + (marks.length > 1 ? ' (' + marks.length + ' PDFs)' : untouched ? ' (this PDF has none)' : ' (save the pages first)') + '</label>' +
      '<div class="field"><span>Save them in</span><div class="pv-dirrow"><span class="pv-dir" data-dir>' + esc(defDir) + '</span><button type="button" class="btn btn-sm" data-pickdir>Change…</button></div></div>' +
      '<div class="hint" data-preview></div></div>' +
      '<div class="dlg-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn is-default">Split</button></div></form>';
    document.body.appendChild(box);
    let dir = defDir;
    const preview = () => {
      const how = box.querySelector('[name=how]:checked').value;
      const n = Math.max(1, parseInt(box.querySelector('[name=n]').value, 10) || 1);
      const count = how === 'every' ? Math.ceil(pages.length / n) : marks.length;
      box.querySelector('[data-preview]').textContent = count + (count === 1 ? ' PDF' : ' PDFs') + ', named after “' + (ctx.current ? U.stem(ctx.current.name) : 'Combined') + '”' + (how === 'marks' ? ' and each bookmark' : '') + '.';
    };
    preview();
    box.addEventListener('input', preview);
    box.addEventListener('change', preview);
    const result = await new Promise((resolve) => {
      box.addEventListener('click', async (e) => {
        if (e.target.closest('[data-cancel]')) resolve(null);
        if (e.target.closest('[data-pickdir]')) {
          const d = await OS.dialog.folder({ title: 'Save the PDFs in', startIn: dir });
          if (d) { dir = d; box.querySelector('[data-dir]').textContent = d; }
        }
      });
      box.addEventListener('cancel', (e) => { e.preventDefault(); resolve(null); });
      box.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        resolve({ how: box.querySelector('[name=how]:checked').value, n: Math.max(1, parseInt(box.querySelector('[name=n]').value, 10) || 1) });
      });
      box.showModal();
    });
    box.close(); box.remove();
    if (!result) return;
    const stem = ctx.current ? U.stem(ctx.current.name) : 'Combined';
    const parts = [];
    if (result.how === 'every') {
      for (let i = 0; i < pages.length; i += result.n) parts.push({ name: stem + ' (part ' + (parts.length + 1) + ')', list: pages.slice(i, i + result.n) });
    } else {
      marks.forEach((m, i) => {
        const end = i + 1 < marks.length ? marks[i + 1].index : pages.length;
        const start = i === 0 ? 0 : m.index; // pages before the first bookmark go with it
        const title = String(m.title || 'Part ' + (i + 1)).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
        parts.push({ name: stem + ' - ' + (title || 'Part ' + (i + 1)), list: pages.slice(start, end) });
      });
    }
    const done = await busy('Splitting', async () => {
      const written = [];
      for (let i = 0; i < parts.length; i++) {
        ctx.showLoading(true, 'Splitting · ' + (i + 1) + ' of ' + parts.length);
        const bytes = await build(parts[i].list);
        const path = await freeName(dir, parts[i].name);
        await write(path, bytes);
        written.push(path);
      }
      return written;
    });
    if (done) OS.notify(done.length + ' PDFs were saved in ' + dir + '.', { title: 'Split done', actions: [{ label: 'Show in Files', action: () => OS.open('files', { path: dir }) }] });
  }

  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-org]');
    if (!b || b.disabled) return;
    const a = b.dataset.org;
    if (a === 'back') leave();
    else if (a === 'insert') insertMenu(b);
    else if (a === 'rotl') rotate(-90);
    else if (a === 'rotr') rotate(90);
    else if (a === 'delete') remove();
    else if (a === 'extract') extract();
    else if (a === 'split') split();
    else if (a === 'save') save();
    else if (a === 'copy') saveCopy();
  });

  /** Combine files dropped on the home screen: the organiser, empty, with those files in it. */
  async function openWith(files) {
    mode = 'combine';
    sources = [];
    pages = [];
    selected = new Set();
    changed = false;
    show(true);
    render();
    let at = 0;
    for (const f of files) {
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') at = await insertPdf(new Uint8Array(await f.arrayBuffer()), f.name, at);
      else if (/^image\//.test(f.type)) at = insertImage(f, f.name, at);
    }
  }

  return { open, openWith, get active() { return !view.hidden; }, get changed() { return changed && !view.hidden; } };
};
