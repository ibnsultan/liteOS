/* LiteOS Code — text/code editor with explorer, tabs and live preview. */
LiteOS.ready((OS) => {
  'use strict';
  const U = OS.util;
  const H = window.CodeHL;
  const $ = (s) => document.querySelector(s);
  const BIG = 200 * 1024; // above this, no syntax highlighting
  const LINE = 20; // must match --ed-line
  const PAD_TOP = 8;

  const EXTRA_ICONS = {
    panelLeft: 'M3 4h18v16H3z M9 4v16',
    folderPlus: 'M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z M12 11v5 M9.5 13.5h5',
    caret: 'M9 6l6 6-6 6',
  };
  function icon(name, size) {
    if (EXTRA_ICONS[name]) {
      const s = size || 16;
      return '<svg class="ico" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + EXTRA_ICONS[name] + '"></path></svg>';
    }
    return OS.icon(name, size);
  }
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, +(el.dataset.size || 16)));
  });

  const tabsEl = $('#tabs');
  const editorsEl = $('#editors');
  const treeEl = $('#tree');
  const frame = $('#pvFrame');

  const BADGES = { html: ['html', '<>'], htm: ['html', '<>'], css: ['css', '#'], js: ['js', 'JS'], mjs: ['js', 'JS'], ts: ['js', 'TS'], json: ['json', '{}'], php: ['php', 'P'], md: ['md', 'M'], markdown: ['md', 'M'] };
  function badge(entry) {
    if (entry.type === 'dir') return '<span class="badge dir">' + icon('folder', 16) + '</span>';
    const b = BADGES[U.ext(entry.name)];
    if (b) return '<span class="badge ' + b[0] + '">' + U.escape(b[1]) + '</span>';
    return '<span class="badge file">' + icon(window.LOS_fileLook ? window.LOS_fileLook(entry).icon : 'file', 15) + '</span>';
  }
  function isText(name) {
    const ext = U.ext(name);
    const kinds = window.LOS_KINDS || {};
    if (!ext) return true;
    if ((kinds.image || []).concat(kinds.video || [], kinds.audio || []).includes(ext) && ext !== 'svg') return false;
    return !['pdf', 'zip', 'rar', '7z', 'gz', 'ldoc', 'lsheet', 'lslides', 'exe', 'woff', 'woff2', 'ttf', 'otf', 'ico'].includes(ext);
  }

  // ================================================================== editor
  function createEditor(tab) {
    const root = document.createElement('div');
    root.className = 'ed';
    root.hidden = true;
    root.innerHTML =
      '<div class="ed-gutter"><pre class="ed-nums"></pre></div>' +
      '<div class="ed-body"><div class="ed-line"></div><pre class="ed-hl" aria-hidden="true"><code></code></pre>' +
      '<textarea class="ed-ta" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="Code editor"></textarea></div>';
    const ta = root.querySelector('textarea');
    const hl = root.querySelector('.ed-hl');
    const code = hl.querySelector('code');
    const nums = root.querySelector('.ed-nums');
    const gutter = root.querySelector('.ed-gutter');
    const lineEl = root.querySelector('.ed-line');
    let lineCount = 0;
    let curLine = 1;
    let raf = 0;
    let slow = 0;
    const ed = {
      root, ta,
      plain: false,
      get value() { return ta.value; },
      set value(v) { ta.value = v; ed.refresh(); },
      setPlain(p) { ed.plain = p; root.classList.toggle('plain', p); if (!p) render(); },
      refresh() { ed.plain = ta.value.length > BIG; root.classList.toggle('plain', ed.plain); slow = 0; render(); },
      focus() { ta.focus({ preventScroll: true }); },
      caret() {
        const v = ta.value;
        const s = ta.selectionStart;
        let line = 1;
        for (let i = v.indexOf('\n'); i !== -1 && i < s; i = v.indexOf('\n', i + 1)) line++;
        const col = s - (v.lastIndexOf('\n', s - 1) + 1) + 1;
        return { line, col, sel: Math.abs(ta.selectionEnd - ta.selectionStart) };
      },
    };

    function render() {
      raf = 0;
      const v = ta.value;
      // line numbers
      let n = 1;
      for (let i = v.indexOf('\n'); i !== -1; i = v.indexOf('\n', i + 1)) n++;
      if (n !== lineCount) {
        lineCount = n;
        let s = '';
        for (let i = 1; i <= n; i++) s += i + '\n';
        nums.textContent = s;
        gutter.style.minWidth = 'calc(' + Math.max(2, String(n).length) + 'ch + 28px)';
      }
      if (!ed.plain) {
        const t0 = performance.now();
        code.innerHTML = H.highlight(tab.lang, v) + ' \n';
        const dt = performance.now() - t0;
        slow = dt > 45 ? slow + 1 : 0;
        if (slow >= 3) { ed.setPlain(true); OS.notify('This file is large, so it’s shown as plain text to keep editing fast.', { title: 'Syntax highlighting off' }); }
      }
      sync();
      moveLine();
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(render); }
    function sync() {
      const x = ta.scrollLeft;
      const y = ta.scrollTop;
      hl.style.transform = 'translate(' + -x + 'px,' + -y + 'px)';
      nums.style.transform = 'translateY(' + -y + 'px)';
      lineEl.style.top = (PAD_TOP + (curLine - 1) * LINE - y) + 'px';
    }
    function moveLine() {
      const c = ed.caret();
      curLine = c.line;
      lineEl.style.top = (PAD_TOP + (curLine - 1) * LINE - ta.scrollTop) + 'px';
      if (tab === activeTab) updatePos(c);
    }

    // ---- editing helpers (execCommand keeps the native undo stack)
    function insert(text, from, to) {
      if (from != null) ta.setSelectionRange(from, to);
      let ok = false;
      try { ok = text === '' ? document.execCommand('delete', false) : document.execCommand('insertText', false, text); } catch (e) { ok = false; }
      if (!ok) {
        ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    function lineRange() {
      const v = ta.value;
      const s = ta.selectionStart;
      let e = ta.selectionEnd;
      if (e > s && v[e - 1] === '\n') e--;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      let le = v.indexOf('\n', e);
      if (le < 0) le = v.length;
      return { ls, le, s, e: ta.selectionEnd };
    }
    function indent() {
      const v = ta.value;
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      if (s === e || v.slice(s, e).indexOf('\n') < 0) {
        const col = s - (v.lastIndexOf('\n', s - 1) + 1);
        insert(col % 2 ? ' ' : '  ');
        return;
      }
      const r = lineRange();
      const block = v.slice(r.ls, r.le);
      const lines = block.split('\n');
      const out = lines.map((l) => (l.length ? '  ' + l : l)).join('\n');
      insert(out, r.ls, r.le);
      ta.setSelectionRange(s + (lines[0].length ? 2 : 0), r.e + (out.length - block.length));
    }
    function outdent() {
      const v = ta.value;
      const s = ta.selectionStart;
      const r = lineRange();
      const block = v.slice(r.ls, r.le);
      const lines = block.split('\n');
      let firstRemoved = 0;
      const out = lines.map((l, i) => {
        const m = /^( {1,2}|\t)/.exec(l);
        const k = m ? m[0].length : 0;
        if (i === 0) firstRemoved = k;
        return l.slice(k);
      }).join('\n');
      if (out === block) return;
      insert(out, r.ls, r.le);
      const ns = Math.max(r.ls, s - firstRemoved);
      ta.setSelectionRange(ns, Math.max(ns, r.e - (block.length - out.length)));
    }
    const PAIRS = { '{': '}', '[': ']', '(': ')' };
    const VOID_TAGS = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
    function newline() {
      const v = ta.value;
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const ind = /^[ \t]*/.exec(v.slice(ls, s))[0];
      const before = v.slice(ls, s);
      const prev = before.replace(/\s+$/, '').slice(-1);
      const next = v[e];
      const tm = /<([A-Za-z][\w-]*)\b[^<>]*>\s*$/.exec(before);
      const openTag = !!tm && !/\/>\s*$/.test(before) && !VOID_TAGS.test(tm[1]);
      if (PAIRS[prev] || openTag) {
        const closes = PAIRS[prev] ? next === PAIRS[prev] : v.slice(e, e + 2) === '</';
        if (closes) {
          insert('\n' + ind + '  \n' + ind);
          const c = s + 1 + ind.length + 2;
          ta.setSelectionRange(c, c);
        } else insert('\n' + ind + '  ');
        return;
      }
      insert('\n' + ind);
    }

    ta.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) outdent(); else indent();
      } else if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        newline();
      }
    });
    ta.addEventListener('input', () => { schedule(); onEdit(tab); });
    ta.addEventListener('scroll', sync, { passive: true });
    ['keyup', 'mouseup', 'select', 'focus'].forEach((ev) => ta.addEventListener(ev, moveLine));
    ta.addEventListener('keydown', () => setTimeout(moveLine)); // arrow keys
    return ed;
  }

  // ================================================================== tabs
  /** @type {{id:number,path:string|null,name:string,lang:string,saved:string,ed:any,saving:boolean}[]} */
  const tabs = [];
  let activeTab = null;
  let untitledN = 0;
  let tabSeq = 0;

  function isDirty(t) { return t.ed.value !== t.saved; }
  function anyDirty() { return tabs.some(isDirty); }

  function makeTab(path, content, name) {
    const t = { id: ++tabSeq, path, name: name || U.basename(path), lang: 'plain', saved: content, ed: null, saving: false };
    t.lang = H.langFor(t.name);
    t.ed = createEditor(t);
    editorsEl.appendChild(t.ed.root);
    t.ed.value = content;
    tabs.push(t);
    return t;
  }
  function activate(t) {
    activeTab = t;
    tabs.forEach((x) => { x.ed.root.hidden = x !== t; });
    $('#welcome').hidden = !!t;
    if (t) {
      t.ed.focus();
      updatePos(t.ed.caret());
      if (H.LANGS[t.lang]) $('#stLang').textContent = H.LANGS[t.lang].name;
      if (['html', 'md'].includes(t.lang)) { previewTab = t; if (previewAuto && !previewOpen) showPreview(true); }
      schedulePreview(0);
    } else {
      $('#stPos').textContent = '';
      $('#stLang').textContent = 'Plain text';
    }
    renderTabs();
    renderTree();
    updateChrome();
  }
  function renderTabs() {
    tabsEl.innerHTML = tabs.map((t) => {
      const d = isDirty(t);
      return '<div class="tab' + (t === activeTab ? ' active' : '') + '" role="tab" aria-selected="' + (t === activeTab) + '" data-id="' + t.id + '" title="' + U.escape(t.path || t.name) + '">' +
        badge({ type: 'file', name: t.name }) + '<span>' + U.escape(t.name) + '</span>' +
        '<button class="tab-x' + (d ? ' dirty' : '') + '" data-close="' + t.id + '" title="Close" aria-label="Close ' + U.escape(t.name) + '">' + icon('x', 12) + '</button></div>';
    }).join('');
    const a = tabsEl.querySelector('.tab.active');
    if (a) {
      // Manual scroll: scrollIntoView could also scroll the shell around the app frame.
      if (a.offsetLeft < tabsEl.scrollLeft) tabsEl.scrollLeft = a.offsetLeft;
      else if (a.offsetLeft + a.offsetWidth > tabsEl.scrollLeft + tabsEl.clientWidth) tabsEl.scrollLeft = a.offsetLeft + a.offsetWidth - tabsEl.clientWidth;
    }
  }
  function updateChrome() {
    const t = activeTab;
    const dirty = anyDirty();
    OS.win.setDirty(dirty);
    const where = root ? U.basename(root) : '';
    OS.win.setTitle((t ? t.name + (where ? ' — ' + where : '') : where || 'Code') + ' — Code');
    $('#crumbs').innerHTML = t
      ? (t.path ? U.dirname(t.path).split('/').filter(Boolean).map((p) => U.escape(p)).join(' › ') + (U.dirname(t.path) === '/' ? '' : ' › ') : '') + '<b>' + U.escape(t.name) + '</b>'
      : '';
    const st = $('#stSaved');
    if (!t) st.textContent = 'No file';
    else if (t.saving) st.textContent = 'Saving…';
    else if (isDirty(t)) st.textContent = '● Unsaved';
    else st.textContent = t.path ? '✓ Saved' : 'Not saved yet';
  }
  function updatePos(c) {
    $('#stPos').textContent = 'Ln ' + c.line + ', Col ' + c.col + (c.sel ? ' (' + c.sel + ' selected)' : '');
  }

  let chromeRaf = 0;
  function onEdit(t) {
    if (!chromeRaf) chromeRaf = requestAnimationFrame(() => {
      chromeRaf = 0;
      const d = isDirty(t);
      if (d === t.lastDirty) return;
      t.lastDirty = d;
      const btn = tabsEl.querySelector('[data-close="' + t.id + '"]');
      if (btn) btn.classList.toggle('dirty', d);
      updateChrome();
    });
    if (previewOpen && previewTab) schedulePreview(600);
  }

  async function openPath(path) {
    const existing = tabs.find((t) => t.path === path);
    if (existing) { activate(existing); return existing; }
    if (!isText(path) && !(await OS.dialog.confirm({ title: 'Open as text?', message: U.basename(path) + ' doesn’t look like a text file. Open it anyway?', okLabel: 'Open' }))) return null;
    try {
      const r = await OS.fs.read(path);
      const t = makeTab(path, String(r.content == null ? '' : r.content));
      // Replace a single pristine untitled tab.
      const blank = tabs.find((x) => x !== t && !x.path && x.ed.value === '' && x.saved === '');
      if (blank && tabs.length === 2) removeTab(blank);
      activate(t);
      return t;
    } catch (e) {
      OS.notify(U.basename(path) + ': ' + e.message, { type: 'error', title: 'Couldn’t open file' });
      return null;
    }
  }
  function newUntitled() {
    untitledN++;
    const t = makeTab(null, '', 'untitled-' + untitledN + '.txt');
    t.lang = 'plain';
    activate(t);
  }
  function removeTab(t) {
    const i = tabs.indexOf(t);
    if (i < 0) return;
    tabs.splice(i, 1);
    t.ed.root.remove();
    if (previewTab === t) previewTab = null;
    if (activeTab === t) activeTab = null;
  }
  async function closeTab(t) {
    if (isDirty(t)) {
      const ok = await OS.dialog.confirm({ title: 'Close without saving?', message: 'Your changes to ' + t.name + ' will be lost.', okLabel: 'Close without saving', danger: true });
      if (!ok) return false;
    }
    const i = tabs.indexOf(t);
    const wasActive = t === activeTab;
    removeTab(t);
    if (wasActive) activate(tabs[Math.min(i, tabs.length - 1)] || null);
    else { renderTabs(); updateChrome(); }
    if (!previewTab) renderPreview();
    return true;
  }

  async function saveTab(t, as) {
    if (!t || t.saving) return false;
    let path = t.path;
    if (!path || as) {
      const p = await OS.dialog.save({
        title: as ? 'Save as' : 'Save file',
        defaultName: t.name,
        startIn: path ? U.dirname(path) : root || '/Documents',
      });
      if (!p) return false;
      path = p;
    }
    t.saving = true;
    updateChrome();
    const content = t.ed.value;
    try {
      await OS.fs.write(path, content);
      const renamed = path !== t.path;
      t.path = path;
      t.name = U.basename(path);
      t.saved = content;
      if (renamed) {
        const lang = H.langFor(t.name);
        if (lang !== t.lang) { t.lang = lang; t.ed.refresh(); }
        if (t === activeTab) $('#stLang').textContent = H.LANGS[t.lang].name;
        if (root && (path === root || path.startsWith(root === '/' ? '/' : root + '/'))) reloadDir(U.dirname(path));
      }
      t.saving = false;
      t.lastDirty = isDirty(t);
      renderTabs();
      updateChrome();
      if (['html', 'md'].includes(t.lang) && t === activeTab) previewTab = t;
      if (previewOpen) schedulePreview(0);
      return true;
    } catch (e) {
      t.saving = false;
      updateChrome();
      OS.notify(e.message, { type: 'error', title: 'Couldn’t save file' });
      return false;
    }
  }
  async function saveAll() { for (const t of tabs.slice()) if (isDirty(t)) { if (!(await saveTab(t))) return; } }

  // ================================================================== explorer
  let root = null;
  const kids = new Map(); // dir path -> entries
  const open = new Set();
  let explorerVisible = true;

  async function setRoot(p) {
    root = p;
    kids.clear();
    open.clear();
    open.add(p);
    renderTree();
    await reloadDir(p);
    updateChrome();
  }
  async function reloadDir(p) {
    try {
      kids.set(p, await OS.fs.list(p));
    } catch (e) {
      if (p === root) { treeEl.innerHTML = '<div class="tree-msg">Couldn’t open this folder.<br>' + U.escape(e.message) + '</div>'; return; }
      kids.delete(p);
    }
    renderTree();
  }
  function renderTree() {
    if (!root) {
      treeEl.innerHTML = '<div class="tree-msg">No folder open.<br>Open a folder to browse and edit a whole project.<br><button class="btn btn-sm" data-act="openFolder">Open folder</button></div>';
      return;
    }
    const rows = [];
    const rootName = root === '/' ? 'My Drive' : U.basename(root);
    rows.push('<div class="tr root' + (open.has(root) ? ' open' : '') + '" data-path="' + U.escape(root) + '" data-type="dir" style="padding-left:6px" role="treeitem">' +
      '<span class="caret">' + icon('caret', 12) + '</span><span class="name">' + U.escape(rootName) + '</span></div>');
    const activePath = activeTab && activeTab.path;
    function walk(dir, depth) {
      if (!open.has(dir)) return;
      const list = kids.get(dir);
      if (!list) { rows.push('<div class="tree-msg" style="padding-left:' + (20 + depth * 14) + 'px">Loading…</div>'); return; }
      if (!list.length && depth === 1) rows.push('<div class="tree-msg" style="padding-left:' + (20 + depth * 14) + 'px">This folder is empty.</div>');
      list.forEach((e) => {
        const isDir = e.type === 'dir';
        rows.push('<div class="tr' + (isDir && open.has(e.path) ? ' open' : '') + (e.path === activePath ? ' active' : '') + '" data-path="' + U.escape(e.path) + '" data-type="' + (isDir ? 'dir' : 'file') + '" style="padding-left:' + (6 + depth * 14) + 'px" role="treeitem" title="' + U.escape(e.name) + '">' +
          '<span class="caret">' + (isDir ? icon('caret', 12) : '') + '</span>' + badge(e) + '<span class="name">' + U.escape(e.name) + '</span></div>');
        if (isDir) walk(e.path, depth + 1);
      });
    }
    walk(root, 1);
    treeEl.innerHTML = rows.join('');
  }
  async function toggleDir(p) {
    if (open.has(p)) { open.delete(p); renderTree(); return; }
    open.add(p);
    renderTree();
    if (!kids.has(p)) await reloadDir(p);
  }
  function validName(n) {
    const v = String(n || '').trim();
    if (!v || v === '.' || v === '..' || /[\\/<>:"|?*\u0000-\u001f]/.test(v)) return null;
    return v;
  }
  async function newFileIn(dir) {
    const n = await OS.dialog.prompt({ title: 'New file', label: 'File name', value: 'untitled.html', okLabel: 'Create' });
    if (n == null) return;
    const name = validName(n);
    if (!name) { OS.notify('That isn’t a valid file name.', { type: 'error', title: 'Invalid file name' }); return; }
    const p = U.join(dir, name);
    try {
      await OS.fs.write(p, '', { overwrite: false });
      open.add(dir);
      await reloadDir(dir);
      await openPath(p);
    } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t create file' }); }
  }
  async function newFolderIn(dir) {
    const n = await OS.dialog.prompt({ title: 'New folder', label: 'Folder name', value: 'New folder', okLabel: 'Create' });
    if (n == null) return;
    const name = validName(n);
    if (!name) { OS.notify('That isn’t a valid folder name.', { type: 'error', title: 'Invalid folder name' }); return; }
    try {
      await OS.fs.mkdir(U.join(dir, name));
      open.add(dir);
      await reloadDir(dir);
    } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t create folder' }); }
  }
  function under(p, base) { return p === base || p.startsWith(base === '/' ? '/' : base + '/'); }
  async function renameEntry(p) {
    const old = U.basename(p);
    const n = await OS.dialog.prompt({ title: 'Rename', label: 'New name', value: old, okLabel: 'Rename' });
    if (n == null || n.trim() === old) return;
    const name = validName(n);
    if (!name) { OS.notify('That isn’t a valid name.', { type: 'error', title: 'Invalid name' }); return; }
    try {
      const entry = await OS.fs.rename(p, name);
      const np = (entry && entry.path) || U.join(U.dirname(p), name);
      tabs.forEach((t) => {
        if (t.path && under(t.path, p)) {
          t.path = np + t.path.slice(p.length);
          t.name = U.basename(t.path);
          const lang = H.langFor(t.name);
          if (lang !== t.lang) { t.lang = lang; t.ed.refresh(); }
        }
      });
      [...open].forEach((o) => { if (under(o, p)) { open.delete(o); open.add(np + o.slice(p.length)); } });
      [...kids.keys()].forEach((k) => { if (under(k, p)) kids.delete(k); });
      await reloadDir(U.dirname(np));
      renderTabs();
      updateChrome();
    } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t rename' }); }
  }
  async function deleteEntry(p, isDir) {
    const affected = tabs.filter((t) => t.path && under(t.path, p));
    const dirtyOpen = affected.some(isDirty);
    const ok = await OS.dialog.confirm({
      title: 'Move to Trash?',
      message: '“' + U.basename(p) + '”' + (isDir ? ' and everything in it' : '') + ' will be moved to the Trash.' + (dirtyOpen ? ' Unsaved changes in open tabs will be lost.' : ''),
      okLabel: 'Move to Trash', danger: true,
    });
    if (!ok) return;
    try {
      await OS.fs.remove(p);
      affected.forEach((t) => { t.saved = t.ed.value; removeTab(t); });
      if (!activeTab) activate(tabs[tabs.length - 1] || null); else { renderTabs(); updateChrome(); }
      [...kids.keys()].forEach((k) => { if (under(k, p)) kids.delete(k); });
      await reloadDir(U.dirname(p));
      if (!previewTab) renderPreview();
    } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t delete' }); }
  }

  treeEl.addEventListener('click', (e) => {
    const r = e.target.closest('.tr');
    if (!r) return;
    const p = r.dataset.path;
    if (r.dataset.type === 'dir') toggleDir(p); else openPath(p);
  });
  treeEl.addEventListener('contextmenu', (e) => {
    if (!root) return;
    e.preventDefault();
    const r = e.target.closest('.tr');
    const p = r ? r.dataset.path : root;
    const isDir = r ? r.dataset.type === 'dir' : true;
    const items = [];
    if (isDir) {
      items.push({ label: 'New file…', icon: 'plus', action: () => newFileIn(p) });
      items.push({ label: 'New folder…', icon: 'folder', action: () => newFolderIn(p) });
      items.push('sep');
    } else {
      items.push({ label: 'Open', icon: 'code', action: () => openPath(p) });
      items.push({ label: 'Open in new window', icon: 'external', action: () => OS.open('code', { path: p }) });
      items.push('sep');
    }
    if (p !== root) {
      items.push({ label: 'Rename…', icon: 'rename', action: () => renameEntry(p) });
      items.push({ label: 'Move to Trash', icon: 'trash', danger: true, action: () => deleteEntry(p, isDir) });
      items.push('sep');
    }
    items.push({ label: 'Refresh', icon: 'reload', action: () => reloadDir(isDir ? p : U.dirname(p)) });
    if (p === root) items.push({ label: 'Open another folder…', icon: 'open', action: openFolder });
    OS.menu(items, e);
  });

  /** Folder the explorer actions apply to: the selected file's folder, else the root. */
  function targetDir() {
    if (!root) return null;
    if (activeTab && activeTab.path && under(activeTab.path, root)) return U.dirname(activeTab.path);
    return root;
  }

  // ================================================================== preview
  let previewOpen = false;
  let previewAuto = true; // auto-open for html/md until the user closes it
  let previewTab = null;
  let pvTimer = 0;
  let pvSeq = 0;

  function showPreview(on) {
    previewOpen = on;
    $('#preview').hidden = !on;
    $('#resizer').hidden = !on;
    $('#previewBtn').classList.toggle('active', on);
    if (on) renderPreview(); else frame.srcdoc = '';
  }
  function schedulePreview(ms) {
    clearTimeout(pvTimer);
    if (!previewOpen) return;
    pvTimer = setTimeout(renderPreview, ms);
  }
  function resolveRel(dir, href) {
    let h = String(href || '').trim();
    if (!h || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//') || h.startsWith('#')) return null;
    h = h.split('#')[0].split('?')[0];
    try { h = decodeURIComponent(h); } catch (e) { /* keep */ }
    const parts = (h.startsWith('/') ? [] : dir.split('/')).concat(h.split('/'));
    const out = [];
    for (const s of parts) {
      if (!s || s === '.') continue;
      if (s === '..') out.pop(); else out.push(s);
    }
    return '/' + out.join('/');
  }
  async function readText(p) {
    const t = tabs.find((x) => x.path === p);
    if (t) return t.ed.value; // unsaved edits show up live
    try { return String((await OS.fs.read(p, { track: false })).content || ''); } catch (e) { return null; }
  }
  async function replaceAsync(str, re, fn) {
    const jobs = [];
    str.replace(re, (...m) => { jobs.push(fn(...m)); return m[0]; });
    const res = await Promise.all(jobs);
    let i = 0;
    return str.replace(re, () => res[i++]);
  }
  function getAttr(tagSrc, name) {
    const m = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tagSrc);
    return m ? (m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]) : null;
  }
  const CONSOLE_SHIM = '<script>(function(){function f(x){try{if(typeof x==="string")return x;if(x instanceof Error)return String(x);var s=JSON.stringify(x);return s===undefined?String(x):s}catch(e){return String(x)}}' +
    'function send(l,a){try{parent.postMessage({__losConsole:1,level:l,text:[].map.call(a,f).join(" ")},"*")}catch(e){}}' +
    '["log","info","warn","error","debug"].forEach(function(k){var o=console[k];console[k]=function(){send(k,arguments);if(o)o.apply(console,arguments)}});' +
    'addEventListener("error",function(e){send("error",[(e.message||"Error")+(e.lineno?" (line "+e.lineno+")":"")])});' +
    'addEventListener("unhandledrejection",function(e){var r=e.reason;send("error",["Unhandled rejection: "+(r&&r.message||r)])});})();<\/script>';

  async function buildHtml(t) {
    let html = t.ed.value;
    const dir = t.path ? U.dirname(t.path) : null;
    if (dir) {
      html = await replaceAsync(html, /<link\b[^>]*>/gi, async (tagSrc) => {
        if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tagSrc)) return tagSrc;
        const p = resolveRel(dir, getAttr(tagSrc, 'href'));
        if (!p) return tagSrc;
        const cssText = await readText(p);
        if (cssText == null) return tagSrc;
        return '<style data-from="' + U.escape(U.basename(p)) + '">\n' + cssText.replace(/<\/style/gi, '<\\/style') + '\n</style>';
      });
      html = await replaceAsync(html, /<script\b([^>]*)>\s*<\/script\s*>/gi, async (whole, attrsSrc) => {
        const src = getAttr(attrsSrc, 'src');
        if (!src) return whole;
        const p = resolveRel(dir, src);
        if (!p) return whole;
        const jsText = await readText(p);
        if (jsText == null) return whole;
        const rest = attrsSrc.replace(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
        return '<script' + rest + '>\n' + jsText.replace(/<\/script/gi, '<\\/script') + '\n</script>';
      });
      // Relative images → raw file URLs.
      html = html.replace(/(<(?:img|source)\b[^>]*?\bsrc\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (m, pre, a, b) => {
        const p = resolveRel(dir, a != null ? a : b);
        return p ? pre + '"' + U.escape(OS.fs.rawUrl(p)) + '"' : m;
      });
    }
    // Console bridge goes first so it catches everything.
    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, (m) => m + CONSOLE_SHIM);
    else if (/<html\b[^>]*>/i.test(html)) html = html.replace(/<html\b[^>]*>/i, (m) => m + CONSOLE_SHIM);
    else html = CONSOLE_SHIM + html;
    return html;
  }
  function buildMd(t) {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const css = 'body{font-family:' + v('--font') + ';color:' + v('--text') + ';background:' + v('--surface') + ';font-size:14px;line-height:1.65;margin:0;padding:20px 24px;max-width:780px}' +
      'h1,h2,h3{line-height:1.25;margin:1.2em 0 .5em}h1{font-size:1.8em}h2{font-size:1.4em;border-bottom:1px solid ' + v('--line') + ';padding-bottom:.2em}h3{font-size:1.15em}' +
      'a{color:' + v('--accent') + '}code{font-family:' + v('--mono') + ';font-size:.9em;background:' + v('--surface-3') + ';padding:1px 5px;border-radius:4px}' +
      'pre{background:' + v('--surface-2') + ';border:1px solid ' + v('--line') + ';border-radius:8px;padding:10px 12px;overflow:auto}pre code{background:none;padding:0}' +
      'blockquote{margin:0 0 1em;padding:2px 14px;border-left:3px solid ' + v('--line-strong') + ';color:' + v('--muted') + '}hr{border:none;border-top:1px solid ' + v('--line-strong') + '}img{max-width:100%}' +
      'body>:first-child{margin-top:0}';
    return '<!doctype html><html><head><meta charset="utf-8"><style>' + css.replace(/<\//g, '') + '</style></head><body>' + H.markdown(t.ed.value) + '</body></html>';
  }
  async function renderPreview() {
    if (!previewOpen) return;
    const t = previewTab && tabs.includes(previewTab) ? previewTab : null;
    $('#pvEmpty').hidden = !!t;
    if (!t) { frame.srcdoc = ''; $('#pvUrl').textContent = 'preview'; return; }
    const seq = ++pvSeq;
    $('#pvUrl').textContent = 'preview / ' + t.name;
    let doc;
    if (t.lang === 'md') {
      frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox'); // no scripts
      frame.classList.add('md');
      doc = buildMd(t);
    } else {
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.classList.remove('md');
      doc = await buildHtml(t);
    }
    if (seq !== pvSeq) return; // a newer render started
    if (t.lang !== 'md') logLine('sys', '› Preview reloaded — ' + t.name);
    frame.srcdoc = doc;
  }

  // ================================================================== console
  let errors = 0;
  function logLine(level, text) {
    const log = $('#conLog');
    const d = document.createElement('div');
    d.className = 'con-line ' + level;
    d.textContent = (level === 'warn' ? '⚠ ' : level === 'error' ? '✖ ' : '') + text;
    log.appendChild(d);
    while (log.childNodes.length > 500) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    if (level === 'error') {
      errors++;
      const c = $('#errCount');
      c.hidden = false; c.textContent = String(errors);
      const s = $('#stErrors');
      s.hidden = false; s.textContent = '✖ ' + errors;
    }
  }
  function clearConsole() {
    $('#conLog').innerHTML = '';
    errors = 0;
    $('#errCount').hidden = true;
    $('#stErrors').hidden = true;
  }
  function toggleConsole(force) {
    const c = $('#console');
    const on = force != null ? force : c.hidden;
    c.hidden = !on;
    $('#consoleBtn').classList.toggle('active', on);
  }
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.__losConsole !== 1) return;
    const level = ['log', 'info', 'warn', 'error', 'debug'].includes(d.level) ? d.level : 'log';
    logLine(level === 'debug' ? 'info' : level, String(d.text == null ? '' : d.text).slice(0, 5000));
  });

  // ================================================================== resizer
  (function () {
    const rz = $('#resizer');
    const pv = $('#preview');
    rz.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = pv.offsetWidth;
      document.body.classList.add('dragging');
      rz.classList.add('drag');
      function move(ev) {
        const w = Math.max(200, Math.min(window.innerWidth - 320, startW - (ev.clientX - startX)));
        pv.style.width = w + 'px';
      }
      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('dragging');
        rz.classList.remove('drag');
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  })();

  // ================================================================== actions
  async function openFileDialog() {
    const p = await OS.dialog.open({ title: 'Open file', accept: (window.LOS_KINDS && window.LOS_KINDS.text) || [], startIn: targetDir() || '/Documents' });
    if (p) openPath(p);
  }
  async function openFolder() {
    const p = await OS.dialog.folder({ title: 'Open folder', startIn: root || '/Documents' });
    if (p) setRoot(p);
  }
  function toggleExplorer() {
    explorerVisible = !explorerVisible;
    $('#explorer').hidden = !explorerVisible;
    document.querySelector('[data-act="toggleExplorer"]').classList.toggle('active', explorerVisible);
  }
  function moreMenu(btn) {
    const r = btn.getBoundingClientRect();
    OS.menu([
      { label: 'New file', icon: 'plus', key: 'Ctrl+Alt+N', action: newUntitled },
      { label: 'New window', icon: 'external', action: () => OS.open('code') },
      'sep',
      { label: 'Open file…', icon: 'open', key: 'Ctrl+O', action: openFileDialog },
      { label: 'Open folder…', icon: 'folder', action: openFolder },
      'sep',
      { label: 'Save', icon: 'save', key: 'Ctrl+S', disabled: !activeTab, action: () => saveTab(activeTab) },
      { label: 'Save as…', icon: 'save', key: 'Ctrl+Shift+S', disabled: !activeTab, action: () => saveTab(activeTab, true) },
      { label: 'Save all', icon: 'save', disabled: !anyDirty(), action: saveAll },
      'sep',
      { label: 'Close tab', icon: 'x', key: 'Alt+W', disabled: !activeTab, action: () => activeTab && closeTab(activeTab) },
    ], { x: r.left, y: r.bottom + 4 });
  }
  function langMenu(e) {
    if (!activeTab) return;
    const t = activeTab;
    OS.menu(Object.keys(H.LANGS).map((k) => ({
      label: H.LANGS[k].name, icon: k === t.lang ? 'check' : null,
      action: () => {
        t.lang = k; t.ed.refresh();
        $('#stLang').textContent = H.LANGS[k].name;
        if (['html', 'md'].includes(k)) { previewTab = t; schedulePreview(0); }
      },
    })), e);
  }
  function run() {
    if (activeTab && ['html', 'md'].includes(activeTab.lang)) previewTab = activeTab;
    if (!previewOpen) showPreview(true); else renderPreview();
  }

  const ACTIONS = {
    toggleExplorer, newFile: newUntitled, openFile: openFileDialog, openFolder,
    save: () => activeTab && saveTab(activeTab),
    run, clearConsole,
    toggleConsole: () => toggleConsole(),
    togglePreview: () => { previewAuto = false; showPreview(!previewOpen); },
    treeNewFile: () => (root ? newFileIn(targetDir()) : newUntitled()),
    treeNewFolder: () => (root ? newFolderIn(targetDir()) : openFolder()),
    treeRefresh: () => { if (root) { [...kids.keys()].forEach((k) => kids.delete(k)); [...open].forEach((p) => reloadDir(p)); } },
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'more') { moreMenu(b); return; }
    const fn = ACTIONS[b.dataset.act];
    if (fn) fn();
  });
  $('#stLang').addEventListener('click', langMenu);

  tabsEl.addEventListener('mousedown', (e) => {
    if (e.button === 1) { e.preventDefault(); const tEl = e.target.closest('.tab'); const t = tEl && tabs.find((x) => x.id === +tEl.dataset.id); if (t) closeTab(t); }
  });
  tabsEl.addEventListener('click', (e) => {
    const x = e.target.closest('[data-close]');
    if (x) { e.stopPropagation(); const t = tabs.find((y) => y.id === +x.dataset.close); if (t) closeTab(t); return; }
    const tEl = e.target.closest('.tab');
    const t = tEl && tabs.find((y) => y.id === +tEl.dataset.id);
    if (t && t !== activeTab) activate(t);
  });
  tabsEl.addEventListener('contextmenu', (e) => {
    const tEl = e.target.closest('.tab');
    const t = tEl && tabs.find((y) => y.id === +tEl.dataset.id);
    if (!t) return;
    e.preventDefault();
    OS.menu([
      { label: 'Save', icon: 'save', action: () => saveTab(t) },
      { label: 'Close', icon: 'x', action: () => closeTab(t) },
      { label: 'Close others', action: async () => { for (const o of tabs.slice()) if (o !== t && !(await closeTab(o))) return; } },
    ], e);
  });

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); if (e.altKey) saveAll(); else if (activeTab) saveTab(activeTab, e.shiftKey); }
    else if (mod && k === 'o') { e.preventDefault(); openFileDialog(); }
    else if (mod && e.altKey && k === 'n') { e.preventDefault(); newUntitled(); }
    else if (mod && k === 'b') { e.preventDefault(); toggleExplorer(); }
    else if (mod && k === 'j') { e.preventDefault(); toggleConsole(); }
    else if (mod && k === 'enter') { e.preventDefault(); run(); }
    else if (e.altKey && !mod && k === 'w') { e.preventDefault(); if (activeTab) closeTab(activeTab); }
    else if (mod && k === 'tab' && tabs.length > 1) {
      e.preventDefault();
      const i = tabs.indexOf(activeTab);
      activate(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]);
    }
  });

  // Re-theme the Markdown preview when the OS theme changes.
  OS.onSettings(() => { if (previewOpen && previewTab && previewTab.lang === 'md') schedulePreview(50); });

  // ================================================================== start
  renderTree();
  activate(null);
  (async () => {
    const folder = OS.args.folder;
    const path = OS.args.path;
    if (folder) await setRoot(folder);
    else if (path) setRoot(U.dirname(path));
    if (path) await openPath(path);
    if (!tabs.length && !folder) newUntitled();
  })();
});
