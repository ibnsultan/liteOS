/*
 * LiteOS Code — a code editor (CodeMirror 6) laid out like a desktop IDE: a title row with search and layout toggles,
 * an activity bar, a side bar (Explorer, Search, Settings), editor tabs, a bottom panel (Terminal, Console, Problems,
 * Output), a live preview on the right and a status bar. Colours all come from the LiteOS theme.
 */
LiteOS.ready((OS) => {
  'use strict';
  const U = OS.util;
  const { state: S, view: V, commands: C, language: L, search: SR, autocomplete: AC, tags: T } = window.CM;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  // ------------------------------------------------------------------ policy limits
  const PLAIN_ABOVE = 2 * 1024 * 1024; // above this: editing without highlighting
  const MAX_OPEN = 8 * 1024 * 1024; // the drive's own read limit; bigger files are refused
  const MAX_IMAGE = 5 * 1024 * 1024; // images inlined into the preview
  const MAX_SEARCH_FILE = 2 * 1024 * 1024;
  const MAX_WALK = 5000;
  const CON_MAX_LINES = 500;
  const CON_MAX_TEXT = 5000;
  const CON_RATE = 200; // distinct console messages per second before extra ones are dropped
  const BINARY = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'mp4', 'webm', 'ogv', 'mov', 'm4v', 'mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac',
    'pdf', 'zip', 'rar', '7z', 'gz', 'ldoc', 'lsheet', 'lslides', 'exe', 'woff', 'woff2', 'ttf', 'otf'];

  // ------------------------------------------------------------------ icons
  const EXTRA_ICONS = {
    files: 'M8 3h7l4 4v11a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 18V4.5A1.5 1.5 0 0 1 8 3z M15 3v4h4 M3.5 7.5v12A1.5 1.5 0 0 0 5 21h9',
    newFile: 'M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z M14 3v4h4 M12 11v6 M9 14h6',
    folderPlus: 'M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z M12 11v5 M9.5 13.5h5',
    caret: 'M9 6l6 6-6 6',
    chevronDown: 'M6 9l6 6 6-6',
    collapse: 'M8 4l4 4 4-4 M8 20l4-4 4 4 M4 12h16',
    sidebarLeft: 'M3.5 5h17v14h-17z M9.5 5v14',
    sidebarRight: 'M3.5 5h17v14h-17z M14.5 5v14',
    panelBottom: 'M3.5 5h17v14h-17z M3.5 14.5h17',
    maximize: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
    restorePanel: 'M9 4v5H4 M15 4v5h5 M9 20v-5H4 M15 20v-5h5',
  };
  function icon(name, size) {
    if (EXTRA_ICONS[name]) {
      const s = size || 16;
      return '<svg class="ico" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + EXTRA_ICONS[name] + '"></path></svg>';
    }
    return OS.icon(name, size);
  }
  function paintIcons(rootEl) {
    (rootEl || document).querySelectorAll('[data-icon]:not([data-painted])').forEach((el) => {
      el.dataset.painted = '1';
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, +(el.dataset.size || 16)));
    });
  }
  paintIcons();

  // ------------------------------------------------------------------ preferences (this user, this browser)
  const PREF_KEY = 'liteos.code.prefs.' + ((OS.user && OS.user.username) || 'guest');
  const prefs = Object.assign({
    fontSize: 13, wrap: false, indent: 's2', detect: true, autoPreview: true,
    sidebar: true, sidebarW: 280, panelH: 220, previewW: 420, view: 'explorer', openSec: { secOpen: false, secFolder: true, secOutline: false },
  }, (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch (e) { return {}; } })());
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* private window */ } }
  const defaultIndent = () => (prefs.indent === 't4' ? { tabs: true, size: 4 } : { tabs: false, size: prefs.indent === 's4' ? 4 : 2 });
  document.documentElement.style.setProperty('--ed-font-size', prefs.fontSize + 'px');

  // ------------------------------------------------------------------ languages
  const LANGS = {
    html: { name: 'HTML', cm: 'html', exts: ['html', 'htm', 'xhtml'] },
    css: { name: 'CSS', cm: 'css', exts: ['css'] },
    js: { name: 'JavaScript', cm: 'js', exts: ['js', 'mjs', 'cjs'] },
    jsx: { name: 'JavaScript JSX', cm: 'jsx', exts: ['jsx'] },
    ts: { name: 'TypeScript', cm: 'ts', exts: ['ts', 'mts', 'cts'] },
    tsx: { name: 'TypeScript JSX', cm: 'tsx', exts: ['tsx'] },
    json: { name: 'JSON', cm: 'json', exts: ['json'] },
    md: { name: 'Markdown', cm: 'md', exts: ['md', 'markdown'] },
    php: { name: 'PHP', cm: 'php', exts: ['php'] },
    python: { name: 'Python', cm: 'python', exts: ['py'] },
    sql: { name: 'SQL', cm: 'sql', exts: ['sql'] },
    xml: { name: 'XML', cm: 'xml', exts: ['xml', 'svg'] },
    yaml: { name: 'YAML', cm: 'yaml', exts: ['yml', 'yaml'] },
    shell: { name: 'Shell', cm: 'shell', exts: ['sh', 'bash'] },
    cpp: { name: 'C / C++', cm: 'cpp', exts: ['c', 'h', 'cpp', 'hpp', 'cc'] },
    java: { name: 'Java', cm: 'java', exts: ['java'] },
    ini: { name: 'INI', cm: 'ini', exts: ['ini', 'conf', 'properties'] },
    plain: { name: 'Plain text', cm: null, exts: ['txt', 'log'] },
  };
  const EXT_LANG = {};
  Object.keys(LANGS).forEach((k) => LANGS[k].exts.forEach((e) => { EXT_LANG[e] = k; }));
  const langFor = (name) => EXT_LANG[U.ext(name)] || 'plain';
  const isPreviewable = (lang) => lang === 'html' || lang === 'md';
  const CHECKED_LANGS = ['js', 'jsx', 'ts', 'tsx', 'json', 'css', 'python']; // syntax errors listed under Problems
  const langCache = {};
  function langExt(lang) {
    const cm = LANGS[lang] && LANGS[lang].cm;
    if (!cm) return [];
    if (!langCache[cm]) langCache[cm] = window.CM.langs[cm]();
    return langCache[cm];
  }

  const BADGES = { html: ['html', '<>'], htm: ['html', '<>'], css: ['css', '#'], js: ['js', 'JS'], mjs: ['js', 'JS'], ts: ['ts', 'TS'], tsx: ['ts', 'TS'], jsx: ['js', 'JS'], json: ['json', '{}'], php: ['php', 'P'], md: ['md', 'M'], markdown: ['md', 'M'], py: ['py', 'PY'] };
  function badge(entry) {
    if (entry.type === 'dir') return '<span class="badge dir">' + icon('folder', 16) + '</span>';
    const b = BADGES[U.ext(entry.name)];
    if (b) return '<span class="badge ' + b[0] + '">' + U.escape(b[1]) + '</span>';
    return '<span class="badge file">' + icon(window.LOS_fileLook ? window.LOS_fileLook(entry).icon : 'file', 15) + '</span>';
  }
  function looksText(name) {
    const ext = U.ext(name);
    const kinds = window.LOS_KINDS || {};
    if (!ext) return true;
    if ((kinds.image || []).concat(kinds.video || [], kinds.audio || []).includes(ext) && ext !== 'svg') return false;
    return !['pdf', 'zip', 'rar', '7z', 'gz', 'ldoc', 'lsheet', 'lslides', 'exe', 'woff', 'woff2', 'ttf', 'otf', 'ico'].includes(ext);
  }
  const under = (p, base) => !!p && !!base && (p === base || p.startsWith(base === '/' ? '/' : base + '/'));

  // ================================================================== editor
  const hlStyle = L.HighlightStyle.define([
    { tag: [T.keyword, T.modifier, T.operatorKeyword, T.controlKeyword], color: 'var(--syn-kw)' },
    { tag: [T.string, T.special(T.string), T.regexp, T.inserted], color: 'var(--syn-str)' },
    { tag: [T.number, T.bool, T.null, T.atom, T.unit], color: 'var(--syn-num)' },
    { tag: [T.comment, T.meta], color: 'var(--syn-com)', fontStyle: 'italic' },
    { tag: [T.tagName, T.angleBracket], color: 'var(--syn-tag)' },
    { tag: [T.attributeName, T.propertyName], color: 'var(--syn-attr)' },
    { tag: [T.function(T.variableName), T.function(T.propertyName), T.macroName], color: 'var(--syn-fn)' },
    { tag: [T.typeName, T.className, T.namespace, T.self], color: 'var(--syn-type)' },
    { tag: [T.definition(T.variableName), T.special(T.variableName)], color: 'var(--syn-var)' },
    { tag: [T.heading], color: 'var(--syn-kw)', fontWeight: '700' },
    { tag: T.strong, fontWeight: '700' },
    { tag: T.emphasis, fontStyle: 'italic' },
    { tag: T.strikethrough, textDecoration: 'line-through' },
    { tag: [T.link, T.url], color: 'var(--syn-str)', textDecoration: 'underline' },
    { tag: [T.deleted, T.invalid], color: 'var(--syn-var)' },
    { tag: [T.punctuation, T.separator, T.bracket], color: 'var(--syn-punct)' },
  ]);
  const theme = V.EditorView.theme({
    '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--surface)', fontSize: 'var(--ed-font-size)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
    '.cm-content': { caretColor: 'var(--text)', padding: '6px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)', borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--ed-selection)' },
    '.cm-activeLine': { backgroundColor: 'var(--ed-cur-line)' },
    '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--disabled)', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 16px', minWidth: '28px' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', color: 'var(--faint)', cursor: 'pointer' },
    '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-3)', border: '1px solid var(--line)', color: 'var(--muted)', padding: '0 6px', borderRadius: '4px' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent-ring)' },
    '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--danger-soft)' },
    '.cm-selectionMatch': { backgroundColor: 'var(--ed-match)' },
    '.cm-searchMatch': { backgroundColor: 'var(--warning-soft)', outline: '1px solid var(--warning)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)' },
    '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
    '.cm-tooltip': { backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--line-strong)', borderRadius: '6px', boxShadow: 'var(--shadow-2)' },
    '.cm-specialChar': { color: 'var(--danger)' },
  });

  const keepOutOfEditor = new Set(['Mod-Enter', 'Mod-i', 'Alt-ArrowLeft', 'Alt-ArrowRight']);
  const baseKeys = [...AC.closeBracketsKeymap, ...C.defaultKeymap.filter((b) => !keepOutOfEditor.has(b.key)), ...SR.searchKeymap, ...C.historyKeymap, ...L.foldKeymap, C.indentWithTab,
    { key: 'Mod-i', run: C.selectParentSyntax, preventDefault: true },
    { key: 'Mod-Alt-ArrowUp', run: C.addCursorAbove, preventDefault: true },
    { key: 'Mod-Alt-ArrowDown', run: C.addCursorBelow, preventDefault: true }];

  function detectIndent(text) {
    let tabs = 0;
    let spaces = 0;
    const widths = { 2: 0, 4: 0, 8: 0 };
    const sample = text.length > 200000 ? text.slice(0, 200000) : text;
    let prev = 0;
    sample.split('\n').forEach((l) => {
      if (l.startsWith('\t')) { tabs++; return; }
      const m = /^ +/.exec(l);
      if (!m || !/\S/.test(l)) return;
      spaces++;
      const d = Math.abs(m[0].length - prev);
      prev = m[0].length;
      if (d === 2 || d === 4 || d === 8) widths[d]++;
    });
    if (!tabs && !spaces) return null;
    if (tabs > spaces) return { tabs: true, size: 4 };
    return { tabs: false, size: widths[8] > widths[4] && widths[8] > widths[2] ? 8 : widths[4] > widths[2] ? 4 : 2 };
  }
  function features(tab) {
    if (tab.plain) return [];
    return [L.foldGutter(), L.indentOnInput(), L.syntaxHighlighting(hlStyle), L.bracketMatching(), AC.closeBrackets()];
  }
  function indentExt(tab) {
    return [L.indentUnit.of(tab.indent.tabs ? '\t' : ' '.repeat(tab.indent.size)), S.EditorState.tabSize.of(tab.indent.size)];
  }
  function createView(tab, text) {
    tab.langC = new S.Compartment();
    tab.wrapC = new S.Compartment();
    tab.indentC = new S.Compartment();
    tab.featC = new S.Compartment();
    tab.view = new V.EditorView({
      parent: tab.root,
      state: S.EditorState.create({ doc: text, extensions: [
        V.lineNumbers(), V.highlightActiveLineGutter(), V.highlightSpecialChars(), C.history(), V.drawSelection(), V.dropCursor(),
        S.EditorState.allowMultipleSelections.of(true), V.rectangularSelection(), V.crosshairCursor(), V.highlightActiveLine(),
        SR.search({ top: true }), SR.highlightSelectionMatches(),
        V.keymap.of(baseKeys),
        theme,
        tab.featC.of(features(tab)),
        tab.langC.of(tab.plain ? [] : langExt(tab.lang)),
        tab.wrapC.of(prefs.wrap ? V.EditorView.lineWrapping : []),
        tab.indentC.of(indentExt(tab)),
        V.EditorView.updateListener.of((u) => {
          if (u.docChanged) onEdit(tab);
          if ((u.selectionSet || u.docChanged) && tab === activeTab) updatePos();
        }),
        V.EditorView.contentAttributes.of({ 'aria-label': 'Code editor', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
      ] }),
    });
  }
  function reconfigure(tab) {
    tab.view.dispatch({ effects: [
      tab.langC.reconfigure(tab.plain ? [] : langExt(tab.lang)),
      tab.featC.reconfigure(features(tab)),
      tab.indentC.reconfigure(indentExt(tab)),
      tab.wrapC.reconfigure(prefs.wrap ? V.EditorView.lineWrapping : []),
    ] });
  }

  // ================================================================== tabs
  const tabsEl = $('#tabs');
  const editorsEl = $('#editors');
  /** @type {any[]} */
  const tabs = [];
  let activeTab = null;
  let untitledN = 0;
  let tabSeq = 0;

  const textOf = (t) => t.view.state.doc.toString();
  function isDirty(t) { return t.eol !== t.savedEol || !t.view.state.doc.eq(t.savedDoc); }
  function anyDirty() { return tabs.some(isDirty); }

  function makeTab(path, content, name, entry) {
    const raw = String(content);
    const eol = /\r\n/.test(raw) ? 'CRLF' : 'LF';
    const text = raw.replace(/\r\n?/g, '\n');
    const t = {
      id: ++tabSeq, path, name: name || U.basename(path), lang: 'plain', plain: raw.length > PLAIN_ABOVE,
      eol, savedEol: eol, mtime: entry ? entry.mtime : null, saving: false,
      indent: (prefs.detect && detectIndent(text)) || defaultIndent(),
    };
    t.lang = langFor(t.name);
    t.root = document.createElement('div');
    t.root.className = 'ed';
    t.root.hidden = true;
    editorsEl.appendChild(t.root);
    createView(t, text);
    t.savedDoc = t.view.state.doc;
    tabs.push(t);
    if (t.plain) OS.notify(t.name + ' is large, so it’s shown without syntax highlighting to keep editing fast.', { title: 'Highlighting off' });
    return t;
  }
  function activate(t, opts) {
    if (t && t !== activeTab && !(opts && opts.noNav)) pushNav();
    activeTab = t;
    tabs.forEach((x) => { x.root.hidden = x !== t; });
    $('#welcome').hidden = !!t;
    if (t) {
      t.view.focus();
      if (isPreviewable(t.lang)) { previewTab = t; if (prefs.autoPreview && previewAuto && !previewOpen) showPreview(true); }
      schedulePreview(0);
    }
    updateStatus();
    renderTabs();
    renderTree();
    renderOutline();
    scheduleProblems(0);
    updateChrome();
    terms.forEach((x) => x.refresh());
  }
  function renderTabs() {
    tabsEl.innerHTML = tabs.map((t) => {
      const d = isDirty(t);
      return '<div class="tab' + (t === activeTab ? ' active' : '') + '" role="tab" aria-selected="' + (t === activeTab) + '" data-id="' + t.id + '" title="' + U.escape(t.path || t.name) + '">' +
        badge({ type: 'file', name: t.name }) + '<span>' + U.escape(t.name) + '</span>' +
        '<button class="tab-x' + (d ? ' dirty' : '') + '" data-close="' + t.id + '" title="Close (Alt+W)" aria-label="Close ' + U.escape(t.name) + '">' + icon('x', 12) + '</button></div>';
    }).join('');
    const a = tabsEl.querySelector('.tab.active');
    if (a) {
      if (a.offsetLeft < tabsEl.scrollLeft) tabsEl.scrollLeft = a.offsetLeft;
      else if (a.offsetLeft + a.offsetWidth > tabsEl.scrollLeft + tabsEl.clientWidth) tabsEl.scrollLeft = a.offsetLeft + a.offsetWidth - tabsEl.clientWidth;
    }
    renderOpenEditors();
  }
  function renderOpenEditors() {
    const el = $('#openList');
    if (!tabs.length) { el.innerHTML = '<div class="sec-msg">No open files</div>'; return; }
    el.innerHTML = tabs.map((t) => '<div class="oe' + (t === activeTab ? ' active' : '') + '" data-id="' + t.id + '" title="' + U.escape(t.path || t.name) + '">' +
      '<button class="oe-x' + (isDirty(t) ? ' dirty' : '') + '" data-close="' + t.id + '" aria-label="Close ' + U.escape(t.name) + '">' + icon('x', 12) + '</button>' +
      badge({ type: 'file', name: t.name }) + '<span class="name">' + U.escape(t.name) + '</span>' +
      (t.path ? '<span class="dim">' + U.escape(relDir(t.path)) + '</span>' : '') + '</div>').join('');
  }
  function relDir(p) {
    const d = U.dirname(p);
    const r = projectRoot();
    if (r && under(d, r)) return d === r ? '' : d.slice(r === '/' ? 1 : r.length + 1);
    return d;
  }
  function updateChrome() {
    const t = activeTab;
    OS.win.setDirty(anyDirty());
    const where = root ? (root === '/' ? 'My Drive' : U.basename(root)) : '';
    OS.win.setTitle((t ? (isDirty(t) ? '● ' : '') + t.name + (where ? ' — ' + where : '') : where || 'Code') + ' — Code');
    $('#tbSearchText').textContent = where ? 'Search ' + where : 'Search files and commands';
    $('#stFolder').textContent = where || 'No folder';
    $('#stSaving').hidden = !tabs.some((x) => x.saving);
    scheduleMenus();
  }
  function updatePos() {
    const t = activeTab;
    if (!t) return;
    const st = t.view.state;
    const main = st.selection.main;
    const line = st.doc.lineAt(main.head);
    const sel = st.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0);
    const cursors = st.selection.ranges.length;
    $('#stPos').textContent = 'Ln ' + line.number + ', Col ' + (main.head - line.from + 1) + (sel ? ' (' + sel + ' selected)' : '') + (cursors > 1 ? ' · ' + cursors + ' cursors' : '');
  }
  function updateStatus() {
    const t = activeTab;
    ['#stPos', '#stIndent', '#stEol', '#stEnc', '#stLang'].forEach((s) => { $(s).hidden = !t; });
    if (!t) return;
    updatePos();
    $('#stIndent').textContent = t.indent.tabs ? 'Tab size: ' + t.indent.size : 'Spaces: ' + t.indent.size;
    $('#stEol').textContent = t.eol;
    $('#stLang').textContent = LANGS[t.lang].name + (t.plain ? ' (no highlighting)' : '');
  }

  let chromeRaf = 0;
  function onEdit(t) {
    if (!chromeRaf) chromeRaf = requestAnimationFrame(() => {
      chromeRaf = 0;
      let changed = false;
      tabs.forEach((x) => {
        const d = isDirty(x);
        if (d === x.lastDirty) return;
        x.lastDirty = d;
        changed = true;
      });
      if (changed) renderTabs();
      updateChrome();
    });
    if (previewOpen && previewTab) schedulePreview(600);
    if (t === activeTab) scheduleOutline();
    scheduleProblems(700);
  }

  async function openPath(path, opts) {
    const existing = tabs.find((t) => t.path === path);
    if (existing) { activate(existing); return existing; }
    try {
      const info = await OS.fs.stat(path);
      if (info.type === 'dir') { await setRoot(path); return null; }
      if ((info.size || 0) > MAX_OPEN) {
        OS.notify(U.basename(path) + ' is ' + U.formatSize(info.size) + '. Code opens files up to ' + U.formatSize(MAX_OPEN) + '.', { type: 'error', title: 'File too large' });
        return null;
      }
      if (!looksText(path) && !(await OS.dialog.confirm({ title: 'Open as text?', message: U.basename(path) + ' doesn’t look like a text file. Open it anyway?', okLabel: 'Open' }))) return null;
      const r = await OS.fs.read(path);
      const content = String(r.content == null ? '' : r.content);
      if (content.indexOf('\u0000') !== -1 && !(await OS.dialog.confirm({ title: 'Open binary file?', message: U.basename(path) + ' contains binary data. Editing and saving it as text can damage it.', okLabel: 'Open anyway', danger: true }))) return null;
      const t = makeTab(path, content, null, r.entry || info);
      const blank = tabs.find((x) => x !== t && !x.path && !isDirty(x) && x.view.state.doc.length === 0);
      if (blank && tabs.length === 2) removeTab(blank);
      activate(t, opts);
      return t;
    } catch (e) {
      OS.notify(U.basename(path) + ': ' + e.message, { type: 'error', title: 'Couldn’t open file' });
      return null;
    }
  }
  function newUntitled() {
    untitledN++;
    activate(makeTab(null, '', 'untitled-' + untitledN + '.txt'));
  }
  function removeTab(t) {
    const i = tabs.indexOf(t);
    if (i < 0) return;
    tabs.splice(i, 1);
    t.view.destroy();
    t.root.remove();
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
    if (wasActive) activate(tabs[Math.min(i, tabs.length - 1)] || null, { noNav: true });
    else { renderTabs(); updateChrome(); }
    if (!previewTab) renderPreview();
    scheduleProblems(0);
    return true;
  }
  async function closeAll() { for (const t of tabs.slice()) if (!(await closeTab(t))) return; }

  async function saveTab(t, as) {
    if (!t || t.saving) return false;
    let path = t.path;
    if (!path || as) {
      const p = await OS.dialog.save({ title: as ? 'Save as' : 'Save file', defaultName: t.name, startIn: path ? U.dirname(path) : root || '/Documents' });
      if (!p) return false;
      path = p;
    }
    if (path === t.path && t.mtime != null) {
      let now = null;
      try { now = await OS.fs.stat(path); } catch (e) { now = null; }
      if (now && now.mtime !== t.mtime) {
        const ok = await OS.dialog.confirm({ title: 'File changed on the drive', message: t.name + ' was changed somewhere else after you opened it. Saving replaces those changes with yours.', okLabel: 'Replace', danger: true });
        if (!ok) return false;
      }
    }
    t.saving = true;
    updateChrome();
    const doc = t.view.state.doc;
    const eol = t.eol;
    const text = doc.toString();
    try {
      const entry = await OS.fs.write(path, eol === 'CRLF' ? text.replace(/\n/g, '\r\n') : text);
      const renamed = path !== t.path;
      t.path = path;
      t.name = U.basename(path);
      t.savedDoc = doc;
      t.savedEol = eol;
      t.mtime = entry && entry.mtime != null ? entry.mtime : null;
      if (renamed) {
        const lang = langFor(t.name);
        if (lang !== t.lang) { t.lang = lang; reconfigure(t); }
        fsChanged(U.dirname(path));
      }
      t.saving = false;
      t.lastDirty = isDirty(t);
      output('Saved ' + (t.path || t.name));
      renderTabs();
      updateStatus();
      updateChrome();
      if (isPreviewable(t.lang) && t === activeTab) previewTab = t;
      imgCache.clear();
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

  // ------------------------------------------------------------------ back / forward through places
  const nav = { back: [], fwd: [] };
  function here() { return activeTab ? { id: activeTab.id, pos: activeTab.view.state.selection.main.head } : null; }
  function pushNav() {
    const h = here();
    if (!h) return;
    const last = nav.back[nav.back.length - 1];
    if (last && last.id === h.id && last.pos === h.pos) return;
    nav.back.push(h);
    if (nav.back.length > 100) nav.back.shift();
    nav.fwd = [];
    updateNavButtons();
  }
  function goNav(dir) {
    const from = dir < 0 ? nav.back : nav.fwd;
    const to = dir < 0 ? nav.fwd : nav.back;
    while (from.length) {
      const e = from.pop();
      const t = tabs.find((x) => x.id === e.id);
      if (!t) continue;
      const h = here();
      if (h) to.push(h);
      activate(t, { noNav: true });
      const p = Math.min(e.pos, t.view.state.doc.length);
      t.view.dispatch({ selection: { anchor: p }, effects: V.EditorView.scrollIntoView(p, { y: 'center' }) });
      break;
    }
    updateNavButtons();
  }
  function updateNavButtons() {
    $('#navBack').disabled = !nav.back.some((e) => tabs.some((t) => t.id === e.id));
    $('#navForward').disabled = !nav.fwd.some((e) => tabs.some((t) => t.id === e.id));
  }
  /** Move the cursor somewhere (outline, problems, search results), remembering where it was. */
  function jumpTo(t, pos, len) {
    pushNav();
    if (t !== activeTab) activate(t, { noNav: true });
    const p = Math.min(pos, t.view.state.doc.length);
    t.view.dispatch({ selection: { anchor: p, head: Math.min(p + (len || 0), t.view.state.doc.length) }, effects: V.EditorView.scrollIntoView(p, { y: 'center' }) });
    t.view.focus();
  }
  async function openAt(path, line, col, len) {
    const t = tabs.find((x) => x.path === path) || (await openPath(path));
    if (!t) return;
    const ln = t.view.state.doc.line(Math.max(1, Math.min(t.view.state.doc.lines, line)));
    jumpTo(t, ln.from + Math.max(0, (col || 1) - 1), len);
  }

  // ================================================================== explorer
  const treeEl = $('#tree');
  let root = null;
  const kids = new Map(); // dir path -> entries
  const openDirs = new Set();
  let selected = null; // the explorer row the keyboard acts on
  /** Inline editing in the tree: { kind: 'file' | 'folder' | 'rename', dir, path, value, error } */
  let editing = null;
  let fileIndex = null; // cached list of project files for Go to file

  async function setRoot(p) {
    root = p;
    kids.clear();
    openDirs.clear();
    selected = null;
    editing = null;
    fileIndex = null;
    if (p) openDirs.add(p);
    $('#folderTitle').textContent = p ? (p === '/' ? 'My Drive' : U.basename(p)) : 'No folder open';
    $('#folderTools').hidden = !p;
    renderTree();
    if (p) await reloadDir(p);
    updateChrome();
    terms.forEach((x) => x.refresh());
    renderOpenEditors();
  }
  async function reloadDir(p) {
    try {
      kids.set(p, await OS.fs.list(p));
    } catch (e) {
      if (p === root) { kids.delete(p); treeEl.innerHTML = '<div class="sec-msg">Couldn’t open this folder.<br>' + U.escape(e.message) + '</div>'; return; }
      kids.delete(p);
    }
    renderTree();
  }
  /** Something on the drive changed under dir: reload the nearest folder the explorer has loaded. */
  function fsChanged(dir) {
    fileIndex = null;
    if (!root || !under(dir, root)) return;
    let d = dir;
    while (d !== root && !kids.has(d)) d = U.dirname(d);
    [...kids.keys()].forEach((k) => { if (k !== d && under(k, d) && !openDirs.has(k)) kids.delete(k); });
    if (d === root || openDirs.has(d)) reloadDir(d);
  }
  function editRow(depth, kind) {
    const e = editing;
    return '<div class="tr editing" style="padding-left:' + (6 + depth * 14) + 'px"><span class="caret"></span>' + badge({ type: kind === 'folder' ? 'dir' : 'file', name: e.value || '' }) +
      '<span class="tr-edit"><input class="tr-input" id="trInput" type="text" spellcheck="false" autocomplete="off" aria-label="' + (kind === 'folder' ? 'Folder name' : 'File name') + '"' + (e.error ? ' aria-invalid="true"' : '') + '>' +
      (e.error ? '<span class="tr-err">' + U.escape(e.error) + '</span>' : '') + '</span></div>';
  }
  function renderTree() {
    if (!root) {
      treeEl.innerHTML = '<div class="sec-msg">You haven’t opened a folder yet.<div class="sec-actions"><button class="btn btn-sm" data-act="openFolder">Open folder</button></div>' +
        '<div class="sec-note">Open a folder to browse a whole project, use the terminal in it, and preview pages that link their own styles and scripts.</div></div>';
      return;
    }
    const keepFocus = editing && document.activeElement && document.activeElement.id === 'trInput';
    const sel = keepFocus ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const rows = [];
    const activePath = activeTab && activeTab.path;
    function walk(dir, depth) {
      if (!openDirs.has(dir)) return;
      const list = kids.get(dir);
      if (editing && editing.kind !== 'rename' && editing.dir === dir) rows.push(editRow(depth, editing.kind));
      if (!list) { rows.push('<div class="sec-msg" style="padding-left:' + (20 + depth * 14) + 'px">Loading…</div>'); return; }
      if (!list.length && depth === 0 && !editing) rows.push('<div class="sec-msg">This folder is empty.</div>');
      list.forEach((e) => {
        const isDir = e.type === 'dir';
        if (editing && editing.kind === 'rename' && editing.path === e.path) { rows.push(editRow(depth, isDir ? 'folder' : 'file')); if (isDir) walk(e.path, depth + 1); return; }
        rows.push('<div class="tr' + (isDir && openDirs.has(e.path) ? ' open' : '') + (e.path === activePath ? ' active' : '') + (e.path === selected ? ' selected' : '') +
          '" data-path="' + U.escape(e.path) + '" data-type="' + (isDir ? 'dir' : 'file') + '" style="padding-left:' + (6 + depth * 14) + 'px" role="treeitem" title="' + U.escape(e.name) + '">' +
          '<span class="caret">' + (isDir ? icon('caret', 12) : '') + '</span>' + badge(e) + '<span class="name">' + U.escape(e.name) + '</span></div>');
        if (isDir) walk(e.path, depth + 1);
      });
    }
    walk(root, 0);
    treeEl.innerHTML = rows.join('');
    const input = $('#trInput');
    if (input) {
      input.value = editing.value;
      if (!editing.focused || keepFocus) {
        input.focus();
        if (sel) input.setSelectionRange(sel[0], sel[1]);
        else if (editing.kind === 'rename') { const dot = editing.value.lastIndexOf('.'); input.setSelectionRange(0, dot > 0 && editing.originalType === 'file' ? dot : editing.value.length); }
        editing.focused = true;
      }
      const row = input.closest('.tr');
      if (row && row.scrollIntoViewIfNeeded) row.scrollIntoViewIfNeeded(false);
    }
  }
  async function toggleDir(p) {
    if (openDirs.has(p)) { openDirs.delete(p); renderTree(); return; }
    openDirs.add(p);
    renderTree();
    if (!kids.has(p)) await reloadDir(p);
  }
  function refreshTree() {
    if (!root) return;
    fileIndex = null;
    kids.clear();
    [...openDirs].forEach((p) => reloadDir(p));
  }
  function collapseTree() {
    if (!root) return;
    openDirs.clear();
    openDirs.add(root);
    renderTree();
  }
  function nameProblem(name, dir, except) {
    const v = String(name || '').trim();
    if (!v) return 'Enter a name.';
    if (v === '.' || v === '..' || /[\\/<>:"|?*\u0000-\u001f]/.test(v)) return 'A name can’t contain \\ / < > : " | ? * or be . or ..';
    const list = kids.get(dir) || [];
    if (list.some((e) => e.name.toLowerCase() === v.toLowerCase() && e.path !== except)) return 'There’s already a file or folder named ' + v + ' here.';
    return null;
  }
  /** Start creating a file or folder inline, inside dir (the selected folder, or the selected file's folder). */
  async function startCreate(kind, dir) {
    if (!root) { if (kind === 'file') newUntitled(); else openFolder(); return; }
    const target = dir || targetDir();
    showView('explorer');
    if (!prefs.sidebar) toggleSidebar(true);
    $('#secFolder').classList.remove('collapsed');
    let d = target;
    while (d && under(d, root)) { openDirs.add(d); if (d === root) break; d = U.dirname(d); }
    editing = { kind, dir: target, value: '', error: null };
    renderTree();
    if (!kids.has(target)) await reloadDir(target);
  }
  function startRename(p) {
    if (!root || p === root) return;
    const entry = [...kids.values()].flat().find((e) => e.path === p);
    editing = { kind: 'rename', dir: U.dirname(p), path: p, value: U.basename(p), originalType: entry ? entry.type : 'file', error: null };
    renderTree();
  }
  function cancelEdit() {
    editing = null;
    renderTree();
    treeEl.focus();
  }
  let committing = false;
  async function commitEdit() {
    if (!editing || committing) return;
    const e = editing;
    const name = String(e.value || '').trim();
    if (e.kind === 'rename' && name === U.basename(e.path)) { cancelEdit(); return; }
    if (!name && e.kind !== 'rename') { cancelEdit(); return; }
    const problem = nameProblem(name, e.dir, e.path);
    if (problem) { e.error = problem; renderTree(); return; }
    committing = true;
    try {
      if (e.kind === 'rename') {
        const entry = await OS.fs.rename(e.path, name);
        const np = (entry && entry.path) || U.join(e.dir, name);
        editing = null;
        followMove(e.path, np);
        selected = np;
        output('Renamed ' + e.path + ' to ' + np);
      } else {
        const p = U.join(e.dir, name);
        if (e.kind === 'folder') await OS.fs.mkdir(p); else await OS.fs.write(p, '', { overwrite: false });
        editing = null;
        selected = p;
        if (e.kind === 'folder') openDirs.add(p);
        output('Created ' + p);
        if (e.kind === 'file') { await reloadDir(e.dir); await openPath(p); }
      }
      await reloadDir(e.dir);
      fileIndex = null;
    } catch (err) {
      e.error = err.message;
      if (editing === null) editing = e;
      renderTree();
    } finally {
      committing = false;
    }
  }
  treeEl.addEventListener('input', (e) => {
    if (e.target.id !== 'trInput' || !editing) return;
    editing.value = e.target.value;
    const had = editing.error;
    editing.error = editing.value.trim() ? nameProblem(editing.value, editing.dir, editing.path) : null;
    if (had !== editing.error) {
      // Show or clear the message without rebuilding the row (keeps the caret where it is).
      const wrap = e.target.parentElement;
      let msg = wrap.querySelector('.tr-err');
      if (editing.error) { if (!msg) { msg = document.createElement('span'); msg.className = 'tr-err'; wrap.appendChild(msg); } msg.textContent = editing.error; e.target.setAttribute('aria-invalid', 'true'); } else { if (msg) msg.remove(); e.target.removeAttribute('aria-invalid'); }
    }
  });
  treeEl.addEventListener('keydown', (e) => {
    if (e.target.id === 'trInput') {
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
      return;
    }
    const rows = [...treeEl.querySelectorAll('.tr[data-path]')];
    if (!rows.length) return;
    let i = rows.findIndex((r) => r.dataset.path === selected);
    const row = i >= 0 ? rows[i] : null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      i = i < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      selected = rows[i].dataset.path;
      renderTree();
    } else if (e.key === 'ArrowRight' && row && row.dataset.type === 'dir' && !openDirs.has(row.dataset.path)) { e.preventDefault(); toggleDir(row.dataset.path); }
    else if (e.key === 'ArrowLeft' && row) {
      e.preventDefault();
      if (row.dataset.type === 'dir' && openDirs.has(row.dataset.path)) toggleDir(row.dataset.path);
      else { const up = U.dirname(row.dataset.path); if (up !== root && under(up, root)) { selected = up; renderTree(); } }
    } else if (e.key === 'Enter' && row) { e.preventDefault(); if (row.dataset.type === 'dir') toggleDir(row.dataset.path); else openPath(row.dataset.path); }
    else if (e.key === 'F2' && row) { e.preventDefault(); startRename(row.dataset.path); }
    else if (e.key === 'Delete' && row) { e.preventDefault(); deleteEntry(row.dataset.path, row.dataset.type === 'dir'); }
  });
  treeEl.addEventListener('focusout', (e) => {
    if (e.target.id !== 'trInput' || !editing) return;
    // Clicking elsewhere keeps a valid new name (like pressing Enter) and drops an empty or invalid one.
    setTimeout(() => {
      if (!editing || document.activeElement === $('#trInput')) return;
      const v = String(editing.value || '').trim();
      if (!v || nameProblem(v, editing.dir, editing.path)) cancelEdit(); else commitEdit();
    }, 0);
  });

  /** Tabs, open folders and terminals follow a rename or move from p to np. */
  function followMove(p, np) {
    tabs.forEach((t) => {
      if (t.path && under(t.path, p)) {
        t.path = np + t.path.slice(p.length);
        t.name = U.basename(t.path);
        t.mtime = null;
        const lang = langFor(t.name);
        if (lang !== t.lang) { t.lang = lang; reconfigure(t); }
      }
    });
    [...openDirs].forEach((o) => { if (under(o, p)) { openDirs.delete(o); openDirs.add(np + o.slice(p.length)); } });
    [...kids.keys()].forEach((k) => { if (under(k, p)) kids.delete(k); });
    terms.forEach((x) => x.fix(p, np));
    fileIndex = null;
    [...openDirs].forEach((o) => { if (under(o, np) && !kids.has(o)) reloadDir(o); });
    renderTabs();
    updateStatus();
    updateChrome();
  }
  function forgetRemoved(paths) {
    paths.forEach((p) => {
      tabs.filter((t) => t.path && under(t.path, p)).forEach((t) => { t.savedDoc = t.view.state.doc; t.savedEol = t.eol; removeTab(t); });
      [...kids.keys()].forEach((k) => { if (under(k, p)) kids.delete(k); });
      terms.forEach((x) => x.fix(p, null));
      if (selected && under(selected, p)) selected = null;
    });
    fileIndex = null;
    if (!activeTab) activate(tabs[tabs.length - 1] || null, { noNav: true }); else { renderTabs(); updateChrome(); }
    if (!previewTab) renderPreview();
  }
  async function deleteEntry(p, isDir) {
    const dirtyOpen = tabs.some((t) => t.path && under(t.path, p) && isDirty(t));
    const ok = await OS.dialog.confirm({
      title: 'Move to Trash?',
      message: '“' + U.basename(p) + '”' + (isDir ? ' and everything in it' : '') + ' will be moved to the Trash.' + (dirtyOpen ? ' Unsaved changes in open tabs will be lost.' : ''),
      okLabel: 'Move to Trash', danger: true,
    });
    if (!ok) return;
    try {
      await OS.fs.remove(p);
      forgetRemoved([p]);
      output('Moved ' + p + ' to the Trash');
      await reloadDir(U.dirname(p));
    } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t delete' }); }
  }

  treeEl.addEventListener('click', (e) => {
    if (e.target.closest('.tr.editing')) return;
    const r = e.target.closest('.tr[data-path]');
    if (!r) return;
    const p = r.dataset.path;
    selected = p;
    if (r.dataset.type === 'dir') toggleDir(p); else { renderTree(); openPath(p); }
  });
  treeEl.addEventListener('contextmenu', (e) => {
    if (!root) return;
    e.preventDefault();
    const r = e.target.closest('.tr[data-path]');
    const p = r ? r.dataset.path : root;
    const isDir = r ? r.dataset.type === 'dir' : true;
    if (r) { selected = p; renderTree(); }
    const dir = isDir ? p : U.dirname(p);
    const items = [
      { label: 'New file…', icon: 'plus', action: () => startCreate('file', dir) },
      { label: 'New folder…', icon: 'folder', action: () => startCreate('folder', dir) },
      'sep',
    ];
    if (!isDir) {
      items.push({ label: 'Open', icon: 'code', action: () => openPath(p) });
      items.push({ label: 'Open in new window', icon: 'external', action: () => OS.open('code', { path: p }) });
      items.push('sep');
    }
    if (p !== root) {
      items.push({ label: 'Rename', icon: 'rename', key: 'F2', action: () => startRename(p) });
      items.push({ label: 'Move to Trash', icon: 'trash', key: 'Delete', danger: true, action: () => deleteEntry(p, isDir) });
      items.push('sep');
    }
    items.push({ label: 'Open terminal here', icon: 'terminal', action: () => { showPanel('terminal', true); activeTerm && activeTerm.cd(dir); } });
    items.push({ label: 'Refresh', icon: 'reload', action: () => reloadDir(dir) });
    OS.menu(items, e);
  });

  /** Folder that new files go into: the selected folder, or the selected (or open) file's folder, else the root. */
  function targetDir() {
    if (!root) return null;
    if (selected && under(selected, root)) {
      const entry = [...kids.values()].flat().find((e) => e.path === selected);
      if (entry) return entry.type === 'dir' ? entry.path : U.dirname(entry.path);
    }
    if (activeTab && activeTab.path && under(activeTab.path, root)) return U.dirname(activeTab.path);
    return root;
  }
  /** The folder the preview may include files from, and terminals and search work in. */
  function projectRoot() {
    if (root) return root;
    if (activeTab && activeTab.path) return U.dirname(activeTab.path);
    return null;
  }

  // Side bar sections fold open and shut.
  function applySections() {
    Object.keys(prefs.openSec).forEach((id) => { const s = document.getElementById(id); if (s) s.classList.toggle('collapsed', !prefs.openSec[id]); });
  }
  document.addEventListener('click', (e) => {
    const h = e.target.closest('[data-sec]');
    if (!h || e.target.closest('.sec-tools')) return;
    const id = h.dataset.sec;
    prefs.openSec[id] = !prefs.openSec[id];
    savePrefs();
    applySections();
    if (id === 'secOutline') renderOutline();
  });
  $('#openList').addEventListener('click', (e) => {
    const x = e.target.closest('[data-close]');
    if (x) { e.stopPropagation(); const t = tabs.find((y) => y.id === +x.dataset.close); if (t) closeTab(t); return; }
    const r = e.target.closest('.oe');
    const t = r && tabs.find((y) => y.id === +r.dataset.id);
    if (t) activate(t);
  });

  // ------------------------------------------------------------------ outline
  const OUTLINE = /^(FunctionDeclaration|ClassDeclaration|MethodDeclaration|FunctionDefinition|ClassDefinition|ATXHeading[1-6]|SetextHeading[12]|RuleSet|InterfaceDeclaration|TypeAliasDeclaration|EnumDeclaration)$/;
  let outlineTimer = 0;
  function scheduleOutline() { clearTimeout(outlineTimer); outlineTimer = setTimeout(renderOutline, 400); }
  function renderOutline() {
    const el = $('#outline');
    if (!prefs.openSec.secOutline) return;
    const t = activeTab;
    if (!t || t.plain) { el.innerHTML = '<div class="sec-msg">' + (t ? 'Not available for this file.' : 'Open a file to see its outline.') + '</div>'; return; }
    const st = t.view.state;
    const tree = L.ensureSyntaxTree(st, st.doc.length, 200) || L.syntaxTree(st);
    const items = [];
    const stack = [];
    tree.iterate({
      enter(n) {
        if (items.length >= 400) return false;
        if (!OUTLINE.test(n.name)) return undefined;
        let label;
        let depth;
        const h = /Heading(\d)/.exec(n.name);
        if (h) {
          label = st.sliceDoc(n.from, n.to).split('\n')[0].replace(/^#+\s*/, '').replace(/\s*#*\s*$/, '');
          depth = +h[1] - 1;
        } else {
          while (stack.length && stack[stack.length - 1] <= n.from) stack.pop();
          depth = stack.length;
          stack.push(n.to);
          const name = n.node.getChild('VariableDefinition') || n.node.getChild('Definition') || n.node.getChild('PropertyDefinition') || n.node.getChild('TypeDefinition') || n.node.getChild('VariableName');
          label = name ? st.sliceDoc(name.from, name.to) : st.sliceDoc(n.from, Math.min(n.to, n.from + 80)).split(/[{\n]/)[0].trim();
        }
        if (label) items.push({ label, depth, pos: n.from, kind: h ? 'heading' : n.name === 'RuleSet' ? 'rule' : /Class|Interface|Type|Enum/.test(n.name) ? 'class' : 'fn' });
        return undefined;
      },
    });
    el.innerHTML = items.length
      ? items.map((it, i) => '<div class="ol-item ' + it.kind + '" data-i="' + i + '" style="padding-left:' + (22 + Math.min(it.depth, 6) * 12) + 'px" title="' + U.escape(it.label) + '">' + U.escape(it.label) + '</div>').join('')
      : '<div class="sec-msg">No symbols found in this file.</div>';
    el._items = items;
  }
  $('#outline').addEventListener('click', (e) => {
    const r = e.target.closest('.ol-item');
    const it = r && $('#outline')._items[+r.dataset.i];
    if (it && activeTab) jumpTo(activeTab, it.pos);
  });

  // ------------------------------------------------------------------ search view
  let searchSeq = 0;
  let searchTimer = 0;
  const sQuery = $('#sQuery');
  const searchOpts = { case: false, regex: false };
  async function walkProject(fn) {
    const base = projectRoot();
    if (!base) return false;
    let seen = 0;
    async function go(d) {
      let list;
      try { list = await OS.fs.list(d); } catch (e) { return; }
      for (const e of list) {
        if (++seen > MAX_WALK) return;
        if ((await fn(e)) === false) { seen = MAX_WALK + 1; return; }
        if (e.type === 'dir') await go(e.path);
      }
    }
    await go(base);
    return seen > MAX_WALK ? 'cut' : true;
  }
  async function runSearch() {
    const q = sQuery.value;
    const seq = ++searchSeq;
    const out = $('#sResults');
    const info = $('#sInfo');
    if (!q) { out.innerHTML = ''; info.textContent = ''; return; }
    if (!projectRoot()) { info.textContent = 'Open a folder to search its files.'; out.innerHTML = ''; return; }
    let re;
    try { re = new RegExp(searchOpts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g' + (searchOpts.case ? '' : 'i')); } catch (e) { info.textContent = 'Not a valid regular expression.'; return; }
    info.textContent = 'Searching…';
    out.innerHTML = '';
    let files = 0;
    let hits = 0;
    const results = [];
    const done = await walkProject(async (e) => {
      if (seq !== searchSeq) return false;
      if (e.type !== 'file' || BINARY.includes(U.ext(e.name)) || (e.size || 0) > MAX_SEARCH_FILE) return undefined;
      const open = tabs.find((t) => t.path === e.path);
      let text;
      if (open) text = textOf(open);
      else { try { text = String((await OS.fs.read(e.path, { track: false })).content || ''); } catch (err) { return undefined; } }
      const lines = text.split(/\r?\n/);
      const found = [];
      lines.forEach((l, i) => {
        re.lastIndex = 0;
        const m = re.exec(l);
        if (m && found.length < 200) found.push({ line: i + 1, col: m.index + 1, len: m[0].length, text: l });
      });
      if (found.length) { files++; hits += found.length; results.push({ path: e.path, found }); }
      return hits >= 2000 ? false : undefined;
    });
    if (seq !== searchSeq) return;
    info.textContent = hits ? hits + ' result' + (hits === 1 ? '' : 's') + ' in ' + files + ' file' + (files === 1 ? '' : 's') + (done === 'cut' || hits >= 2000 ? ' (search stopped early)' : '') : 'No results.';
    out.innerHTML = results.map((r, fi) => '<div class="sr-file" data-f="' + fi + '"><div class="sr-head">' + badge({ type: 'file', name: U.basename(r.path) }) + '<span class="name">' + U.escape(U.basename(r.path)) + '</span><span class="dim">' + U.escape(relDir(r.path)) + '</span><span class="sr-n">' + r.found.length + '</span></div>' +
      r.found.map((m, mi) => {
        const start = Math.max(0, m.col - 1 - 30);
        const pre = m.text.slice(start, m.col - 1);
        return '<div class="sr-line" data-f="' + fi + '" data-m="' + mi + '">' + (start ? '…' : '') + U.escape(pre) + '<mark>' + U.escape(m.text.substr(m.col - 1, m.len)) + '</mark>' + U.escape(m.text.slice(m.col - 1 + m.len, m.col - 1 + m.len + 120)) + '</div>';
      }).join('') + '</div>').join('');
    out._results = results;
  }
  sQuery.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 350); });
  sQuery.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); runSearch(); } });
  ['sCase', 'sRegex'].forEach((id) => $('#' + id).addEventListener('click', (e) => {
    const k = id === 'sCase' ? 'case' : 'regex';
    searchOpts[k] = !searchOpts[k];
    e.currentTarget.setAttribute('aria-pressed', String(searchOpts[k]));
    e.currentTarget.classList.toggle('active', searchOpts[k]);
    runSearch();
  }));
  $('#sResults').addEventListener('click', (e) => {
    const l = e.target.closest('.sr-line');
    const rs = $('#sResults')._results;
    if (l && rs) { const r = rs[+l.dataset.f]; const m = r.found[+l.dataset.m]; openAt(r.path, m.line, m.col, m.len); return; }
    const h = e.target.closest('.sr-head');
    if (h) h.parentElement.classList.toggle('folded');
  });

  // ------------------------------------------------------------------ settings view
  (function settingsView() {
    const font = $('#setFont');
    font.innerHTML = [11, 12, 13, 14, 15, 16, 18, 20].map((n) => '<option value="' + n + '">' + n + ' px</option>').join('');
    font.value = String(prefs.fontSize);
    $('#setWrap').checked = prefs.wrap;
    $('#setIndent').value = prefs.indent;
    $('#setDetect').checked = prefs.detect;
    $('#setAutoPreview').checked = prefs.autoPreview;
    font.addEventListener('change', () => { prefs.fontSize = +font.value; document.documentElement.style.setProperty('--ed-font-size', prefs.fontSize + 'px'); tabs.forEach((t) => t.view.requestMeasure()); savePrefs(); });
    $('#setWrap').addEventListener('change', (e) => { if (e.target.checked !== prefs.wrap) toggleWrap(); });
    $('#setIndent').addEventListener('change', (e) => { prefs.indent = e.target.value; savePrefs(); });
    $('#setDetect').addEventListener('change', (e) => { prefs.detect = e.target.checked; savePrefs(); });
    $('#setAutoPreview').addEventListener('change', (e) => { prefs.autoPreview = e.target.checked; savePrefs(); });
  })();

  // ------------------------------------------------------------------ views and layout
  function showView(v) {
    prefs.view = v;
    savePrefs();
    $$('.ab-btn').forEach((b) => { const on = b.dataset.view === v && prefs.sidebar; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $('#viewExplorer').hidden = v !== 'explorer';
    $('#viewSearch').hidden = v !== 'search';
    $('#viewSettings').hidden = v !== 'settings';
    if (v === 'explorer') renderOutline();
  }
  function toggleSidebar(force) {
    prefs.sidebar = typeof force === 'boolean' ? force : !prefs.sidebar;
    savePrefs();
    $('#sidebar').hidden = !prefs.sidebar;
    $('#sbSash').hidden = !prefs.sidebar;
    $('#tgSidebar').classList.toggle('active', prefs.sidebar);
    showView(prefs.view);
    scheduleMenus();
  }
  function activityClick(v) {
    if (prefs.sidebar && prefs.view === v) { toggleSidebar(false); return; }
    if (!prefs.sidebar) toggleSidebar(true);
    showView(v);
    if (v === 'search') { sQuery.focus(); sQuery.select(); }
  }
  $$('.ab-btn').forEach((b) => b.addEventListener('click', () => activityClick(b.dataset.view)));
  function applySizes() {
    $('#sidebar').style.width = prefs.sidebarW + 'px';
    $('#panel').style.height = prefs.panelH + 'px';
    $('#preview').style.width = prefs.previewW + 'px';
  }

  // ================================================================== preview
  const frame = $('#pvFrame');
  let previewOpen = false;
  let previewAuto = true; // auto-open for html/md until the user closes it
  let previewTab = null;
  let pvTimer = 0;
  let pvSeq = 0;
  let token = '';
  const imgCache = new Map();

  // The preview may load from the web over https (and data:/blob:), never plain http, and has no route to LiteOS:
  // the sandbox gives it an opaque origin, and project files are inlined instead of linked.
  const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: data: blob:; style-src 'unsafe-inline' https: data: blob:; " +
    'img-src https: data: blob:; font-src https: data:; media-src https: data: blob:; connect-src https:; frame-src https:; worker-src blob:; ' +
    "form-action 'none'; base-uri 'none'";
  const MD_CSP = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'";
  const cspMeta = (csp) => '<meta http-equiv="Content-Security-Policy" content="' + csp + '">';

  function newToken() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  /** Console bridge and evaluator, first in the page. Messages carry this render's token. */
  function shim(tok) {
    return '<script>(function(){var T=' + JSON.stringify(tok) + ';' +
      'function f(x,d){d=d||0;try{if(typeof x==="string")return d?JSON.stringify(x):x;if(x instanceof Error)return x.name+": "+x.message;' +
      'if(typeof x==="function")return "ƒ "+(x.name||"anonymous")+"()";if(typeof x==="undefined")return "undefined";if(typeof x==="symbol"||typeof x==="bigint")return String(x);' +
      'if(x&&typeof x==="object"&&x.nodeType===1)return "<"+x.tagName.toLowerCase()+(x.id?"#"+x.id:"")+">";' +
      'var s=JSON.stringify(x,function(k,v){return typeof v==="function"?"ƒ":typeof v==="bigint"?String(v):v},d?0:2);return s===undefined?String(x):s}catch(e){return String(x)}}' +
      'function send(l,a){try{parent.postMessage({__losConsole:1,token:T,level:l,text:[].map.call(a,function(x){return f(x)}).join(" ")},"*")}catch(e){}}' +
      '["log","info","warn","error","debug"].forEach(function(k){var o=console[k];console[k]=function(){send(k,arguments);if(o)o.apply(console,arguments)}});' +
      'addEventListener("error",function(e){send("error",[(e.message||"Error")+(e.lineno?" (line "+e.lineno+")":"")])});' +
      'addEventListener("unhandledrejection",function(e){var r=e.reason;send("error",["Unhandled rejection: "+(r&&r.message||r)])});' +
      'addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.__losEval!==1||d.token!==T)return;var out,lvl="result";' +
      'try{out=(0,eval)(d.code)}catch(err){lvl="error";out=err}' +
      'Promise.resolve(out).then(function(v){reply(lvl,out&&typeof out.then==="function"?v:out)},function(err){reply("error",err)});' +
      'function reply(l,v){parent.postMessage({__losConsole:1,token:T,level:l,id:d.id,text:l==="error"?f(v):f(v,1)},"*")}});' +
      '})();<\/script>';
  }

  function showPreview(on) {
    previewOpen = on;
    $('#preview').hidden = !on;
    $('#pvSash').hidden = !on;
    $('#tgPreview').classList.toggle('active', on);
    if (on) renderPreview(); else { frame.srcdoc = ''; frame.dataset.token = ''; frame.dataset.lang = ''; pvSeq++; }
    updateEvalTarget();
    scheduleMenus();
  }
  function togglePreview() { previewAuto = false; showPreview(!previewOpen); }
  function schedulePreview(ms) {
    clearTimeout(pvTimer);
    if (!previewOpen) return;
    pvTimer = setTimeout(renderPreview, ms);
  }
  /** A link in the page → a path inside the project, or null (web links, absolute paths and escapes stay as they are). */
  function resolveRel(dir, href, base) {
    let h = String(href || '').trim();
    if (!h || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//') || h.startsWith('#') || h.startsWith('/')) return null;
    h = h.split('#')[0].split('?')[0];
    try { h = decodeURIComponent(h); } catch (e) { /* keep */ }
    const out = [];
    for (const s of dir.split('/').concat(h.split('/'))) {
      if (!s || s === '.') continue;
      if (s === '..') out.pop(); else out.push(s);
    }
    const p = '/' + out.join('/');
    return base && under(p, base) ? p : null;
  }
  async function readText(p) {
    const t = tabs.find((x) => x.path === p);
    if (t) return textOf(t);
    try { return String((await OS.fs.read(p, { track: false })).content || ''); } catch (e) { return null; }
  }
  async function readDataUrl(p) {
    if (imgCache.has(p)) return imgCache.get(p);
    let url = null;
    try {
      const res = await fetch(OS.fs.rawUrl(p), { credentials: 'same-origin' });
      const blob = res.ok ? await res.blob() : null;
      if (blob && blob.size <= MAX_IMAGE) {
        url = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ok(null); r.readAsDataURL(blob); });
      }
    } catch (e) { url = null; }
    imgCache.set(p, url);
    return url;
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
  function injectHead(html, extra) {
    if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (m) => m + extra);
    if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, (m) => m + '<head>' + extra + '</head>');
    return '<head>' + extra + '</head>' + html;
  }
  async function buildHtml(t) {
    let html = textOf(t);
    const dir = t.path ? U.dirname(t.path) : null;
    const base = projectRoot();
    if (dir && base) {
      html = await replaceAsync(html, /<link\b[^>]*>/gi, async (tagSrc) => {
        if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tagSrc)) return tagSrc;
        const p = resolveRel(dir, getAttr(tagSrc, 'href'), base);
        if (!p) return tagSrc;
        const cssText = await readText(p);
        if (cssText == null) return tagSrc;
        return '<style data-from="' + U.escape(U.basename(p)) + '">\n' + cssText.replace(/<\/style/gi, '<\\/style') + '\n</style>';
      });
      html = await replaceAsync(html, /<script\b([^>]*)>\s*<\/script\s*>/gi, async (whole, attrsSrc) => {
        const src = getAttr(attrsSrc, 'src');
        if (!src) return whole;
        const p = resolveRel(dir, src, base);
        if (!p) return whole;
        const jsText = await readText(p);
        if (jsText == null) return whole;
        const rest = attrsSrc.replace(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
        return '<script' + rest + '>\n' + jsText.replace(/<\/script/gi, '<\\/script') + '\n</script>';
      });
      html = await replaceAsync(html, /(<(?:img|source|video|audio)\b[^>]*?\b(?:src|poster)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, async (m, pre, a, b) => {
        const p = resolveRel(dir, a != null ? a : b, base);
        if (!p) return m;
        const url = await readDataUrl(p);
        return url ? pre + '"' + url + '"' : m;
      });
    }
    return injectHead(html, cspMeta(PREVIEW_CSP) + shim(token));
  }
  function buildMd(t) {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const css = 'body{font-family:' + v('--font') + ';color:' + v('--text') + ';background:' + v('--surface') + ';font-size:14px;line-height:1.65;margin:0;padding:20px 24px;max-width:780px}' +
      'h1,h2,h3{line-height:1.25;margin:1.2em 0 .5em}h1{font-size:1.8em}h2{font-size:1.4em;border-bottom:1px solid ' + v('--line') + ';padding-bottom:.2em}h3{font-size:1.15em}' +
      'a{color:' + v('--accent') + '}code{font-family:' + v('--mono') + ';font-size:.9em;background:' + v('--surface-3') + ';padding:1px 5px;border-radius:4px}' +
      'pre{background:' + v('--surface-2') + ';border:1px solid ' + v('--line') + ';border-radius:8px;padding:10px 12px;overflow:auto}pre code{background:none;padding:0}' +
      'blockquote{margin:0 0 1em;padding:2px 14px;color:' + v('--muted') + ';background:' + v('--surface-2') + ';border-radius:6px}hr{border:none;border-top:1px solid ' + v('--line-strong') + '}img{max-width:100%}' +
      'body>:first-child{margin-top:0}';
    return '<!doctype html><html><head><meta charset="utf-8">' + cspMeta(MD_CSP) + '<style>' + css.replace(/<\//g, '') + '</style></head><body>' + window.CodeMarkdown.markdown(textOf(t)) + '</body></html>';
  }
  async function renderPreview() {
    if (!previewOpen) return;
    const t = previewTab && tabs.includes(previewTab) ? previewTab : null;
    $('#pvEmpty').hidden = !!t;
    $('#pvTitle').textContent = t ? 'Preview — ' + t.name : 'Preview';
    if (!t) { frame.srcdoc = ''; frame.dataset.token = ''; frame.dataset.lang = ''; updateEvalTarget(); return; }
    const seq = ++pvSeq;
    let doc;
    let tok = '';
    if (t.lang === 'md') {
      frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox'); // no scripts; links open in a new tab
      frame.classList.add('md');
      doc = buildMd(t);
    } else {
      tok = newToken();
      const prevToken = token;
      token = tok;
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.classList.remove('md');
      doc = await buildHtml(t);
      if (seq !== pvSeq) { token = prevToken; return; }
    }
    if (seq !== pvSeq) return;
    frame.dataset.token = tok;
    frame.dataset.lang = t.lang;
    if (t.lang !== 'md') { output('Preview reloaded: ' + t.name); previewErrors.length = 0; scheduleProblems(0); }
    frame.srcdoc = doc;
    updateEvalTarget();
  }

  // ================================================================== bottom panel
  let panelTab = 'terminal';
  let panelMaxed = false;
  function showPanel(which, force) {
    const p = $('#panel');
    const open = force != null ? force : (p.hidden || panelTab !== which);
    if (which) panelTab = which;
    p.hidden = !open;
    $('#panelSash').hidden = !open || panelMaxed;
    $('#tgPanel').classList.toggle('active', open);
    $$('[data-panel]').forEach((b) => { const on = b.dataset.panel === panelTab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    $$('.panel-view').forEach((v) => { v.hidden = v.dataset.view !== panelTab; });
    $$('.panel-acts').forEach((a) => { a.hidden = a.dataset.for !== panelTab; });
    if (!open && panelMaxed) setPanelMax(false);
    if (open) {
      if (panelTab === 'console') { ensureScratch(); updateEvalTarget(); conInput.focus(); }
      else if (panelTab === 'terminal') { if (!terms.length) newTerminal(); else showTerm(activeTerm); }
      else if (panelTab === 'problems') renderProblems();
    } else if (activeTab) activeTab.view.focus();
    scheduleMenus();
  }
  function setPanelMax(on) {
    panelMaxed = on;
    $('#editorCol').classList.toggle('panel-max', on);
    $('#panelSash').hidden = on || $('#panel').hidden;
    const b = $('#panelMax');
    b.title = on ? 'Restore panel size' : 'Maximise panel';
    b.innerHTML = icon(on ? 'restorePanel' : 'maximize', 16);
  }

  // ------------------------------------------------------------------ terminals
  const termHost = $('#termHost');
  const terms = [];
  let activeTerm = null;
  let termSeq = 0;
  function newTerminal() {
    const n = ++termSeq;
    const el = document.createElement('div');
    el.className = 'term-view';
    el.innerHTML = '<div class="term-log" role="log"></div><div class="prompt-row"><span class="prompt">$</span><input type="text" spellcheck="false" autocomplete="off" aria-label="Terminal command" placeholder="Type help for the commands"></div>';
    termHost.appendChild(el);
    const input = el.querySelector('input');
    const t = window.CodeTerminal.create({
      OS, el, name: 'Terminal ' + n,
      out: el.querySelector('.term-log'),
      input,
      prompt: el.querySelector('.prompt'),
      root: projectRoot,
      open: openPath,
      run: () => run(),
      confirm: (o) => OS.dialog.confirm(o),
      changed: fsChanged,
      removed: forgetRemoved,
      moved: (srcs, intoDir, toPath) => srcs.forEach((s) => followMove(s, toPath || U.join(intoDir, U.basename(s)))),
    });
    t.cd = (dir) => { input.value = ''; t.focus(); t.run('cd "' + dir.replace(/(["\\])/g, '\\$1') + '"', true); };
    terms.push(t);
    showTerm(t);
    return t;
  }
  function showTerm(t) {
    activeTerm = t;
    terms.forEach((x) => { x.el.hidden = x !== t; });
    $('#termName').textContent = t ? t.name : 'Terminal';
    if (t && !$('#panel').hidden && panelTab === 'terminal') t.focus();
  }
  function killTerm() {
    const t = activeTerm;
    if (!t) return;
    const i = terms.indexOf(t);
    terms.splice(i, 1);
    t.el.remove();
    if (terms.length) showTerm(terms[Math.min(i, terms.length - 1)]);
    else { activeTerm = null; showPanel(null, false); }
  }
  function termMenu(btn) {
    const r = btn.getBoundingClientRect();
    OS.menu([
      ...terms.map((t) => ({ label: t.name, checked: t === activeTerm, action: () => showTerm(t) })),
      'sep',
      { label: 'New terminal', key: 'Ctrl+Shift+`', action: newTerminal },
    ], { x: r.left, y: r.bottom + 2 });
  }

  // ------------------------------------------------------------------ console
  const conLog = $('#conLog');
  const conInput = $('#conInput');
  let lastLine = null;
  let rateStart = 0;
  let rateCount = 0;
  let dropped = 0;
  let dropTimer = 0;
  function addLine(log, level, text) {
    const d = document.createElement('div');
    d.className = 'con-line ' + level;
    d.textContent = text;
    log.appendChild(d);
    while (log.childNodes.length > CON_MAX_LINES) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    return d;
  }
  function flushDropped() {
    dropTimer = 0;
    if (!dropped) return;
    addLine(conLog, 'sys', dropped.toLocaleString() + ' message' + (dropped === 1 ? '' : 's') + ' dropped (too many at once)');
    dropped = 0;
    lastLine = null;
  }
  function logLine(level, text) {
    text = String(text == null ? '' : text);
    if (text.length > CON_MAX_TEXT) text = text.slice(0, CON_MAX_TEXT) + '…';
    if (lastLine && lastLine.level === level && lastLine.text === text && lastLine.el.isConnected) {
      lastLine.n++;
      let c = lastLine.el.querySelector('.rep');
      if (!c) { c = document.createElement('span'); c.className = 'rep'; lastLine.el.prepend(c); }
      c.textContent = '×' + lastLine.n;
    } else {
      const now = performance.now();
      if (now - rateStart > 1000) { rateStart = now; rateCount = 0; }
      if (++rateCount > CON_RATE) {
        dropped++;
        if (!dropTimer) dropTimer = setTimeout(flushDropped, 1000);
        return;
      }
      lastLine = { level, text, n: 1, el: addLine(conLog, level, text) };
    }
    if (level === 'error' && frame.dataset.lang === 'html') {
      if (previewErrors.length < 100) previewErrors.push(text);
      scheduleProblems(200);
    }
  }
  function clearConsole() { conLog.innerHTML = ''; lastLine = null; }

  // JavaScript typed into the console runs in the preview page, or in a blank sandboxed page when there is none.
  let scratch = null;
  let scratchToken = '';
  let evalSeq = 0;
  function ensureScratch() {
    if (scratch) return;
    scratchToken = newToken();
    scratch = document.createElement('iframe');
    scratch.className = 'scratch';
    scratch.setAttribute('sandbox', 'allow-scripts');
    scratch.setAttribute('title', 'JavaScript scratch page');
    scratch.setAttribute('aria-hidden', 'true');
    scratch.tabIndex = -1;
    scratch.srcdoc = '<!doctype html><html><head><meta charset="utf-8">' + cspMeta(PREVIEW_CSP) + shim(scratchToken) + '</head><body></body></html>';
    scratch.addEventListener('load', () => { scratch.dataset.ready = '1'; }, { once: true });
    document.body.appendChild(scratch);
  }
  function evalTarget() {
    if (previewOpen && frame.dataset.lang === 'html' && frame.dataset.token) return { win: frame.contentWindow, token: frame.dataset.token };
    ensureScratch();
    return { win: scratch.contentWindow, token: scratchToken };
  }
  function updateEvalTarget() {
    const html = previewOpen && frame.dataset.lang === 'html' && frame.dataset.token;
    $('#conCtx').textContent = html ? 'Runs in the preview' : 'Runs in a blank page';
  }
  const conHistory = [];
  let conHistAt = 0;
  conInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const code = conInput.value;
      if (!code.trim()) return;
      conInput.value = '';
      autoGrow();
      conHistory.push(code);
      if (conHistory.length > 200) conHistory.shift();
      conHistAt = conHistory.length;
      lastLine = null;
      addLine(conLog, 'input', code);
      const tgt = evalTarget();
      const id = ++evalSeq;
      const send = () => { try { tgt.win.postMessage({ __losEval: 1, token: tgt.token, id, code }, '*'); } catch (err) { logLine('error', String(err)); } };
      if (scratch && tgt.win === scratch.contentWindow && !scratch.dataset.ready) scratch.addEventListener('load', send, { once: true });
      else send();
    } else if (e.key === 'ArrowUp' && !conInput.value.includes('\n') && conHistory.length) {
      e.preventDefault();
      conHistAt = Math.max(0, conHistAt - 1);
      conInput.value = conHistory[conHistAt] || '';
      autoGrow();
    } else if (e.key === 'ArrowDown' && !conInput.value.includes('\n') && conHistory.length) {
      e.preventDefault();
      conHistAt = Math.min(conHistory.length, conHistAt + 1);
      conInput.value = conHistory[conHistAt] || '';
      autoGrow();
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      clearConsole();
    }
  });
  function autoGrow() { conInput.style.height = 'auto'; conInput.style.height = Math.min(120, conInput.scrollHeight) + 'px'; }
  conInput.addEventListener('input', autoGrow);
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.__losConsole !== 1 || typeof d.token !== 'string') return;
    const fromPreview = e.source === frame.contentWindow && d.token === frame.dataset.token && d.token !== '';
    const fromScratch = scratch && e.source === scratch.contentWindow && d.token === scratchToken;
    if (!fromPreview && !fromScratch) return;
    const level = ['log', 'info', 'warn', 'error', 'debug', 'result'].includes(d.level) ? d.level : 'log';
    if (level === 'result') lastLine = null;
    logLine(level === 'debug' ? 'info' : level, d.text);
    if (d.id && panelTab === 'console' && !$('#panel').hidden && (document.activeElement === document.body || !document.activeElement)) conInput.focus();
  });

  // ------------------------------------------------------------------ output
  const outLog = $('#outLog');
  function output(text) {
    const d = new Date();
    addLine(outLog, 'sys', '[' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') + '] ' + text);
  }

  // ------------------------------------------------------------------ problems
  const previewErrors = [];
  let problems = [];
  let probTimer = 0;
  function scheduleProblems(ms) { clearTimeout(probTimer); probTimer = setTimeout(computeProblems, ms); }
  function computeProblems() {
    const list = [];
    tabs.forEach((t) => {
      if (t.plain || !CHECKED_LANGS.includes(t.lang)) return;
      const st = t.view.state;
      const tree = L.ensureSyntaxTree(st, st.doc.length, 100);
      if (!tree) return;
      let n = 0;
      tree.iterate({
        enter(node) {
          if (n >= 50) return false;
          if (!node.type.isError) return undefined;
          n++;
          const line = st.doc.lineAt(node.from);
          const near = st.sliceDoc(node.from, Math.min(node.to, node.from + 20)).trim();
          list.push({ tab: t, pos: node.from, line: line.number, col: node.from - line.from + 1, msg: 'Syntax error' + (near ? ' near “' + near + '”' : '') });
          return undefined;
        },
      });
    });
    problems = list;
    const total = list.length + previewErrors.length;
    const c = $('#probCount');
    c.hidden = !total;
    c.textContent = String(total);
    $('#stProblems').textContent = total ? total + (total === 1 ? ' problem' : ' problems') : 'No problems';
    $('#stProblems').classList.toggle('has', !!total);
    if (panelTab === 'problems' && !$('#panel').hidden) renderProblems();
  }
  function renderProblems() {
    const el = $('#probList');
    const groups = [];
    tabs.forEach((t) => { const items = problems.filter((p) => p.tab === t); if (items.length) groups.push({ title: t.name, dim: t.path ? relDir(t.path) : '', items }); });
    let html = groups.map((g, gi) => '<div class="pr-group"><div class="pr-head">' + badge({ type: 'file', name: g.title }) + '<span class="name">' + U.escape(g.title) + '</span><span class="dim">' + U.escape(g.dim) + '</span><span class="sr-n">' + g.items.length + '</span></div>' +
      g.items.map((p, i) => '<div class="pr-item" data-g="' + gi + '" data-i="' + i + '"><span class="pr-msg">' + U.escape(p.msg) + '</span><span class="dim">Ln ' + p.line + ', Col ' + p.col + '</span></div>').join('') + '</div>').join('');
    if (previewErrors.length) {
      html += '<div class="pr-group"><div class="pr-head"><span class="name">Live preview</span><span class="sr-n">' + previewErrors.length + '</span></div>' +
        previewErrors.map((m) => '<div class="pr-item preview"><span class="pr-msg">' + U.escape(m) + '</span></div>').join('') + '</div>';
    }
    el.innerHTML = html || '<div class="sec-msg">No problems found in the open files.</div>';
    el._groups = groups;
  }
  $('#probList').addEventListener('click', (e) => {
    const r = e.target.closest('.pr-item');
    if (!r) return;
    if (r.classList.contains('preview')) { showPanel('console', true); return; }
    const p = $('#probList')._groups[+r.dataset.g].items[+r.dataset.i];
    if (p && tabs.includes(p.tab)) jumpTo(p.tab, p.pos);
  });

  // ================================================================== sashes (drag to resize)
  function sash(handle, axis, get, set, invert) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const start = axis === 'x' ? e.clientX : e.clientY;
      const size = get();
      document.body.classList.add('dragging', axis === 'x' ? 'drag-x' : 'drag-y');
      handle.classList.add('drag');
      function move(ev) { const d = (axis === 'x' ? ev.clientX : ev.clientY) - start; set(size + (invert ? -d : d)); }
      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('dragging', 'drag-x', 'drag-y');
        handle.classList.remove('drag');
        savePrefs();
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }
  sash($('#sbSash'), 'x', () => $('#sidebar').offsetWidth, (v) => { prefs.sidebarW = Math.max(180, Math.min(window.innerWidth - 400, v)); applySizes(); });
  sash($('#pvSash'), 'x', () => $('#preview').offsetWidth, (v) => { prefs.previewW = Math.max(220, Math.min(window.innerWidth - 360, v)); applySizes(); }, true);
  sash($('#panelSash'), 'y', () => $('#panel').offsetHeight, (v) => { prefs.panelH = Math.max(100, Math.min(window.innerHeight - 180, v)); applySizes(); }, true);

  // ================================================================== commands
  async function openFileDialog() {
    const p = await OS.dialog.open({ title: 'Open file', accept: Object.keys(EXT_LANG), startIn: targetDir() || '/Documents' });
    if (p) openPath(p);
  }
  async function openFolder() {
    const p = await OS.dialog.folder({ title: 'Open folder', startIn: root || '/Documents' });
    if (p) { await setRoot(p); output('Opened folder ' + p); }
  }
  function toggleWrap() {
    prefs.wrap = !prefs.wrap;
    savePrefs();
    $('#setWrap').checked = prefs.wrap;
    tabs.forEach((t) => t.view.dispatch({ effects: t.wrapC.reconfigure(prefs.wrap ? V.EditorView.lineWrapping : []) }));
    scheduleMenus();
  }
  function setLang(t, k) {
    t.lang = k;
    reconfigure(t);
    updateStatus();
    renderOutline();
    scheduleProblems(0);
    if (isPreviewable(k)) { previewTab = t; schedulePreview(0); }
  }
  function langMenu(e) {
    const t = activeTab;
    if (!t) return;
    OS.menu(Object.keys(LANGS).map((k) => ({ label: LANGS[k].name, checked: k === t.lang, action: () => setLang(t, k) })), e);
  }
  function setIndent(t, tabsOn, size) {
    t.indent = { tabs: tabsOn, size };
    t.view.dispatch({ effects: t.indentC.reconfigure(indentExt(t)) });
    updateStatus();
  }
  function indentMenu(e) {
    const t = activeTab;
    if (!t) return;
    const i = t.indent;
    OS.menu([
      { label: 'Indent with spaces', checked: !i.tabs, action: () => setIndent(t, false, i.size) },
      { label: 'Indent with tabs', checked: i.tabs, action: () => setIndent(t, true, i.size) },
      'sep',
      ...[2, 4, 8].map((n) => ({ label: (i.tabs ? 'Tab size ' : 'Width ') + n, checked: i.size === n, action: () => setIndent(t, i.tabs, n) })),
      'sep',
      { label: 'Detect from content', action: () => { const d = detectIndent(textOf(t)) || defaultIndent(); setIndent(t, d.tabs, d.size); } },
    ], e);
  }
  function eolMenu(e) {
    const t = activeTab;
    if (!t) return;
    const set = (v) => { t.eol = v; updateStatus(); onEdit(t); };
    OS.menu([
      { label: 'LF (Linux, macOS)', checked: t.eol === 'LF', action: () => set('LF') },
      { label: 'CRLF (Windows)', checked: t.eol === 'CRLF', action: () => set('CRLF') },
    ], e);
  }
  async function goToLine() {
    const t = activeTab;
    if (!t) return;
    const st = t.view.state;
    const cur = st.doc.lineAt(st.selection.main.head).number;
    const v = await OS.dialog.prompt({ title: 'Go to line', label: 'Line (1–' + st.doc.lines + '), optionally :column', value: String(cur), okLabel: 'Go' });
    if (v == null) return;
    const m = /^\s*(\d+)\s*(?::\s*(\d+))?\s*$/.exec(v);
    if (!m) { OS.notify('Enter a line number, like 42 or 42:7.', { type: 'error', title: 'Not a line number' }); return; }
    const line = t.view.state.doc.line(Math.max(1, Math.min(t.view.state.doc.lines, +m[1])));
    jumpTo(t, Math.min(line.to, line.from + Math.max(0, (+m[2] || 1) - 1)));
  }
  const ed = (cmd) => () => { const t = activeTab; if (!t) return; t.view.focus(); cmd(t.view); };
  async function clip(kind) {
    const t = activeTab;
    if (!t) return;
    t.view.focus();
    if (kind === 'paste') {
      try {
        const text = await navigator.clipboard.readText();
        t.view.dispatch(t.view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input.paste' });
      } catch (e) { OS.notify('Use Ctrl+V to paste: the browser didn’t allow reading the clipboard.', { title: 'Couldn’t paste' }); }
      return;
    }
    const st = t.view.state;
    const text = st.selection.ranges.map((r) => st.sliceDoc(r.from, r.to)).join('\n');
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch (e) { document.execCommand(kind); return; }
    if (kind === 'cut') t.view.dispatch(st.replaceSelection(''), { userEvent: 'delete.cut' });
  }
  function run() {
    if (activeTab && isPreviewable(activeTab.lang)) previewTab = activeTab;
    if (!previewOpen) showPreview(true); else { imgCache.clear(); renderPreview(); }
  }
  function nextTab(dir) {
    if (tabs.length < 2) return;
    const i = tabs.indexOf(activeTab);
    activate(tabs[(i + dir + tabs.length) % tabs.length]);
  }

  /** Menus: the shell's menu bar (and the title row's when the shell's bar is hidden), the palette and the keys. */
  function menus() {
    const t = activeTab;
    const has = !!t;
    const panelOpen = !$('#panel').hidden;
    return [
      { label: 'File', items: [
        { label: 'New file', key: 'Ctrl+Alt+N', action: newUntitled },
        { label: 'New file in folder…', disabled: !root, action: () => startCreate('file') },
        { label: 'New folder…', disabled: !root, action: () => startCreate('folder') },
        'sep',
        { label: 'Open file…', key: 'Ctrl+O', action: openFileDialog },
        { label: 'Open folder…', key: 'Ctrl+K Ctrl+O', action: openFolder },
        { label: 'Close folder', disabled: !root, action: () => setRoot(null) },
        'sep',
        { label: 'Save', key: 'Ctrl+S', disabled: !has, action: () => saveTab(activeTab) },
        { label: 'Save as…', key: 'Ctrl+Shift+S', disabled: !has, action: () => saveTab(activeTab, true) },
        { label: 'Save all', key: 'Ctrl+Alt+S', disabled: !anyDirty(), action: saveAll },
        'sep',
        { label: 'Close tab', key: 'Alt+W', disabled: !has, action: () => activeTab && closeTab(activeTab) },
        { label: 'Close all tabs', disabled: !has, action: closeAll },
      ] },
      { label: 'Edit', items: [
        { label: 'Undo', key: 'Ctrl+Z', disabled: !has, action: ed(C.undo) },
        { label: 'Redo', key: 'Ctrl+Y', disabled: !has, action: ed(C.redo) },
        'sep',
        { label: 'Cut', key: 'Ctrl+X', disabled: !has, action: () => clip('cut') },
        { label: 'Copy', key: 'Ctrl+C', disabled: !has, action: () => clip('copy') },
        { label: 'Paste', key: 'Ctrl+V', disabled: !has, action: () => clip('paste') },
        'sep',
        { label: 'Find', key: 'Ctrl+F', disabled: !has, action: ed(SR.openSearchPanel) },
        { label: 'Replace', key: 'Ctrl+H', disabled: !has, action: ed(SR.openSearchPanel) },
        { label: 'Find in folder', key: 'Ctrl+Shift+F', action: () => activityClick('search') },
        'sep',
        { label: 'Toggle line comment', key: 'Ctrl+/', disabled: !has, action: ed(C.toggleComment) },
        { label: 'Toggle block comment', key: 'Shift+Alt+A', disabled: !has, action: ed(C.toggleBlockComment) },
        { label: 'Move line up', key: 'Alt+Up', disabled: !has, action: ed(C.moveLineUp) },
        { label: 'Move line down', key: 'Alt+Down', disabled: !has, action: ed(C.moveLineDown) },
        { label: 'Duplicate line', key: 'Shift+Alt+Down', disabled: !has, action: ed(C.copyLineDown) },
        { label: 'Delete line', key: 'Ctrl+Shift+K', disabled: !has, action: ed(C.deleteLine) },
      ] },
      { label: 'Selection', items: [
        { label: 'Select all', key: 'Ctrl+A', disabled: !has, action: ed(C.selectAll) },
        { label: 'Select line', key: 'Ctrl+L', disabled: !has, action: ed(C.selectLine) },
        { label: 'Expand selection', key: 'Ctrl+I', disabled: !has, action: ed(C.selectParentSyntax) },
        'sep',
        { label: 'Add next occurrence', key: 'Ctrl+D', disabled: !has, action: ed(SR.selectNextOccurrence) },
        { label: 'Select all occurrences', key: 'Ctrl+Shift+L', disabled: !has, action: ed(SR.selectSelectionMatches) },
        { label: 'Add cursor above', key: 'Ctrl+Alt+Up', disabled: !has, action: ed(C.addCursorAbove) },
        { label: 'Add cursor below', key: 'Ctrl+Alt+Down', disabled: !has, action: ed(C.addCursorBelow) },
      ] },
      { label: 'View', items: [
        { label: 'Command palette…', key: 'Ctrl+Shift+P', action: () => openPalette('>') },
        'sep',
        { label: 'Explorer', key: 'Ctrl+Shift+E', checked: prefs.sidebar && prefs.view === 'explorer', action: () => activityClick('explorer') },
        { label: 'Search', key: 'Ctrl+Shift+F', checked: prefs.sidebar && prefs.view === 'search', action: () => activityClick('search') },
        { label: 'Settings', key: 'Ctrl+,', checked: prefs.sidebar && prefs.view === 'settings', action: () => activityClick('settings') },
        'sep',
        { label: 'Side bar', key: 'Ctrl+B', checked: prefs.sidebar, action: () => toggleSidebar() },
        { label: 'Panel', key: 'Ctrl+J', checked: panelOpen, action: () => showPanel(panelTab) },
        { label: 'Live preview', checked: previewOpen, action: togglePreview },
        'sep',
        { label: 'Terminal', key: 'Ctrl+`', action: () => showPanel('terminal', true) },
        { label: 'Console', action: () => showPanel('console', true) },
        { label: 'Problems', action: () => showPanel('problems', true) },
        { label: 'Output', action: () => showPanel('output', true) },
        'sep',
        { label: 'Word wrap', key: 'Alt+Z', checked: prefs.wrap, action: toggleWrap },
        { label: 'Fold all', key: 'Ctrl+Alt+[', disabled: !has, action: ed(L.foldAll) },
        { label: 'Unfold all', key: 'Ctrl+Alt+]', disabled: !has, action: ed(L.unfoldAll) },
      ] },
      { label: 'Go', items: [
        { label: 'Back', key: 'Alt+Left', disabled: $('#navBack').disabled, action: () => goNav(-1) },
        { label: 'Forward', key: 'Alt+Right', disabled: $('#navForward').disabled, action: () => goNav(1) },
        'sep',
        { label: 'Go to file…', key: 'Ctrl+P', action: () => openPalette('') },
        { label: 'Go to line…', key: 'Ctrl+G', disabled: !has, action: goToLine },
        { label: 'Go to matching bracket', key: 'Ctrl+Shift+\\', disabled: !has, action: ed(C.cursorMatchingBracket) },
        'sep',
        { label: 'Next tab', key: 'Ctrl+Tab', disabled: tabs.length < 2, action: () => nextTab(1) },
        { label: 'Previous tab', key: 'Ctrl+Shift+Tab', disabled: tabs.length < 2, action: () => nextTab(-1) },
      ] },
      { label: 'Run', items: [
        { label: 'Run preview', key: 'Ctrl+Enter', action: run },
        'sep',
        { label: 'New terminal', key: 'Ctrl+Shift+`', action: () => { showPanel('terminal', true); newTerminal(); } },
        { label: 'Clear console', action: clearConsole },
      ] },
    ];
  }

  let menuRaf = 0;
  function scheduleMenus() {
    if (menuRaf) return;
    menuRaf = requestAnimationFrame(() => { menuRaf = 0; OS.win.setMenus(menus()); renderMenubar(); });
  }
  /** The title row's menus, shown only when the desktop's own top bar (which carries app menus) isn't there. */
  function shellShowsMenus() {
    const s = OS.settings || {};
    return OS.inShell && s.taskbar !== 'classic' && s.topbar !== false;
  }
  function renderMenubar() {
    const bar = $('#menubar');
    const show = !shellShowsMenus();
    bar.hidden = !show;
    if (!show) return;
    const labels = menus().map((m) => m.label);
    if (bar.dataset.labels === labels.join('|')) return;
    bar.dataset.labels = labels.join('|');
    bar.innerHTML = labels.map((l, i) => '<button class="mbtn" data-menu="' + i + '">' + U.escape(l) + '</button>').join('');
  }
  $('#menubar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    const m = menus()[+b.dataset.menu];
    const r = b.getBoundingClientRect();
    b.classList.add('open');
    Promise.resolve(OS.menu(m.items, { x: r.left, y: r.bottom + 2 })).finally(() => b.classList.remove('open'));
  });

  // ------------------------------------------------------------------ palette: go to file, or > commands
  const pal = $('#palette');
  const palInput = $('#palInput');
  const palList = $('#palList');
  let palItems = [];
  let palAt = 0;
  let indexing = null;
  async function buildFileIndex() {
    if (fileIndex) return fileIndex;
    if (indexing) return indexing;
    indexing = (async () => {
      const files = [];
      await walkProject((e) => { if (e.type === 'file') files.push(e.path); return files.length >= 3000 ? false : undefined; });
      fileIndex = files;
      indexing = null;
      return files;
    })();
    return indexing;
  }
  function paletteCommands() {
    const out = [];
    menus().forEach((m) => m.items.forEach((it) => {
      if (it && typeof it === 'object' && !it.disabled && it.action && it.label !== 'Command palette…') out.push({ label: m.label + ': ' + it.label.replace(/…$/, ''), key: it.key, action: it.action });
    }));
    if (activeTab) Object.keys(LANGS).forEach((k) => out.push({ label: 'Language: ' + LANGS[k].name, key: '', action: () => setLang(activeTab, k) }));
    return out;
  }
  function score(label, words) {
    const l = label.toLowerCase();
    let s = 0;
    for (const w of words) { const i = l.indexOf(w); if (i < 0) return -1; s += i; }
    return s;
  }
  async function renderPalette() {
    const raw = palInput.value;
    const cmd = raw.startsWith('>');
    const words = raw.replace(/^>/, '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    let items;
    if (cmd) items = paletteCommands().filter((c) => score(c.label, words) >= 0);
    else {
      const open = tabs.map((t) => ({ label: t.name, detail: t.path ? relDir(t.path) : 'unsaved', key: '', action: () => activate(t), path: t.path }));
      items = open.filter((c) => score(c.label + ' ' + c.detail, words) >= 0);
      if (projectRoot()) {
        if (!fileIndex) { palList.innerHTML = '<div class="pal-empty">Listing files…</div>'; await buildFileIndex(); if (palInput.value !== raw) return; }
        const base = projectRoot();
        const files = (fileIndex || []).filter((p) => !tabs.some((t) => t.path === p)).map((p) => ({ label: U.basename(p), detail: U.dirname(p) === base ? '' : U.dirname(p).slice(base === '/' ? 1 : base.length + 1), key: '', action: () => openPath(p) }));
        const matched = words.length ? files.map((c) => ({ c, s: score(c.label + ' ' + c.detail, words) })).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s || a.c.label.length - b.c.label.length).map((x) => x.c) : files;
        items = items.concat(matched);
      }
      if (!words.length) items.push({ label: 'Show all commands', detail: '', key: 'Ctrl+Shift+P', action: () => openPalette('>') });
    }
    palItems = items.slice(0, 80);
    palAt = Math.min(palAt, Math.max(0, palItems.length - 1));
    palList.innerHTML = palItems.length
      ? palItems.map((c, i) => '<div class="pal-item' + (i === palAt ? ' active' : '') + '" role="option" aria-selected="' + (i === palAt) + '" data-i="' + i + '"><span class="pal-label">' + U.escape(c.label) + (c.detail ? '<span class="dim">' + U.escape(c.detail) + '</span>' : '') + '</span>' + (c.key ? '<span class="key">' + U.escape(c.key) + '</span>' : '') + '</div>').join('')
      : '<div class="pal-empty">' + (cmd ? 'No matching commands' : projectRoot() ? 'No matching files' : 'Open a folder to find files in it, or type > for commands') + '</div>';
    const a = palList.querySelector('.active');
    if (a) {
      if (a.offsetTop < palList.scrollTop) palList.scrollTop = a.offsetTop;
      else if (a.offsetTop + a.offsetHeight > palList.scrollTop + palList.clientHeight) palList.scrollTop = a.offsetTop + a.offsetHeight - palList.clientHeight;
    }
  }
  function openPalette(prefix) {
    // Open over the title row's search box, at its width (wider when that box is narrow), so it reads as that box opening.
    const r = $('#tbSearch').getBoundingClientRect();
    const box = $('#palBox');
    const w = Math.min(window.innerWidth - 16, Math.max(r.width + 24, 440));
    box.style.width = w + 'px';
    box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    box.style.transform = 'none';
    pal.hidden = false;
    palInput.value = prefix || '';
    palAt = 0;
    renderPalette();
    palInput.focus();
  }
  function closePalette(refocus) {
    pal.hidden = true;
    if (refocus !== false && activeTab) activeTab.view.focus();
  }
  function runPalette(i) {
    const c = palItems[i];
    closePalette(false);
    if (c) c.action();
  }
  palInput.addEventListener('input', () => { palAt = 0; renderPalette(); });
  palInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); palAt = Math.min(palItems.length - 1, palAt + 1); renderPalette(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palAt = Math.max(0, palAt - 1); renderPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); runPalette(palAt); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
  });
  palList.addEventListener('mousedown', (e) => { const it = e.target.closest('.pal-item'); if (it) { e.preventDefault(); runPalette(+it.dataset.i); } });
  pal.addEventListener('mousedown', (e) => { if (e.target === pal) closePalette(); });

  // ------------------------------------------------------------------ title row
  (function titleRow() {
    const tb = $('#titlebar');
    const img = OS.sysIcon ? OS.sysIcon('app.code') : null;
    $('#tbIcon').innerHTML = img ? '<img src="' + U.escape(img) + '" alt="" draggable="false">' : icon('code', 16);
    $('#tbControls').style.width = (OS.win.controlsWidth || 0) + 'px';
    OS.win.dragRegion(tb, (t) => t === tb || t.classList.contains('tb-center') || t.classList.contains('tb-controls') || t.classList.contains('tb-icon'));
  })();

  // ------------------------------------------------------------------ buttons, tabs, keys
  const ACTIONS = {
    newFile: newUntitled, openFile: openFileDialog, openFolder, run, clearConsole,
    clearOutput: () => { outLog.innerHTML = ''; },
    togglePanel: () => showPanel(panelTab), closePanel: () => showPanel(null, false), togglePreview,
    toggleSidebar: () => toggleSidebar(),
    panelMax: () => setPanelMax(!panelMaxed),
    quickOpen: () => openPalette(''),
    navBack: () => goNav(-1), navForward: () => goNav(1),
    termNew: newTerminal, termKill: killTerm,
    treeNewFile: () => startCreate('file'),
    treeNewFolder: () => startCreate('folder'),
    treeRefresh: refreshTree,
    treeCollapse: collapseTree,
  };
  document.addEventListener('click', (e) => {
    const p = e.target.closest('[data-panel]');
    if (p) { showPanel(p.dataset.panel, true); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'termMenu') { termMenu(b); return; }
    const fn = ACTIONS[b.dataset.act];
    if (fn) { e.stopPropagation(); fn(); }
  });
  $('#stLang').addEventListener('click', langMenu);
  $('#stIndent').addEventListener('click', indentMenu);
  $('#stEol').addEventListener('click', eolMenu);
  $('#stPos').addEventListener('click', goToLine);
  $('#stProblems').addEventListener('click', () => showPanel('problems', true));
  $('#stFolder').addEventListener('click', () => (root ? activityClick('explorer') : openFolder()));

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
      'sep',
      { label: 'Reveal in explorer', disabled: !t.path || !root || !under(t.path, root), action: () => revealInTree(t.path) },
    ], e);
  });
  function revealInTree(p) {
    let d = U.dirname(p);
    while (under(d, root)) { openDirs.add(d); if (d === root) break; d = U.dirname(d); }
    selected = p;
    if (!prefs.sidebar) toggleSidebar(true);
    showView('explorer');
    [...openDirs].forEach((x) => { if (!kids.has(x)) reloadDir(x); });
    renderTree();
  }

  // App-wide keys. Capture phase, so they win over the editor's own bindings for the same keys.
  let chord = 0; // Ctrl+K was pressed: the next key completes a two-key shortcut
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const inField = e.target.closest && e.target.closest('input, textarea, select') && !e.target.closest('.cm-editor');
    let fn = null;
    if (chord) {
      clearTimeout(chord);
      chord = 0;
      if (mod && k === 'o') fn = openFolder;
      if (fn) { e.preventDefault(); e.stopPropagation(); fn(); }
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && k === 'k' && !inField) { e.preventDefault(); e.stopPropagation(); chord = setTimeout(() => { chord = 0; }, 1500); return; }
    if (mod && e.shiftKey && k === 'p') fn = () => openPalette('>');
    else if (mod && !e.shiftKey && !e.altKey && k === 'p') fn = () => openPalette('');
    else if (mod && k === 's') fn = e.altKey ? saveAll : () => activeTab && saveTab(activeTab, e.shiftKey);
    else if (mod && !e.shiftKey && k === 'o') fn = openFileDialog;
    else if (mod && e.altKey && k === 'n') fn = newUntitled;
    else if (mod && !e.shiftKey && !e.altKey && k === 'b') fn = () => toggleSidebar();
    else if (mod && !e.shiftKey && k === 'j') fn = () => showPanel(panelTab);
    else if (mod && e.shiftKey && (e.key === '`' || e.key === '~' || e.code === 'Backquote')) fn = () => { showPanel('terminal', true); newTerminal(); };
    else if (mod && (e.key === '`' || e.code === 'Backquote')) fn = () => showPanel('terminal');
    else if (mod && e.shiftKey && k === 'e') fn = () => activityClick('explorer');
    else if (mod && e.shiftKey && k === 'f') fn = () => { if (!prefs.sidebar) toggleSidebar(true); showView('search'); const t = activeTab; const s = t && t.view.state.sliceDoc(t.view.state.selection.main.from, t.view.state.selection.main.to); if (s && !s.includes('\n')) sQuery.value = s; sQuery.focus(); sQuery.select(); if (s) runSearch(); };
    else if (mod && e.key === ',') fn = () => activityClick('settings');
    else if (mod && k === 'enter') fn = run;
    else if (mod && !e.shiftKey && !e.altKey && k === 'g') fn = goToLine;
    else if (mod && !e.altKey && !e.shiftKey && k === 'h' && activeTab) fn = ed(SR.openSearchPanel);
    else if (mod && e.altKey && (e.key === '[' || e.code === 'BracketLeft')) fn = ed(L.foldAll);
    else if (mod && e.altKey && (e.key === ']' || e.code === 'BracketRight')) fn = ed(L.unfoldAll);
    else if (mod && e.shiftKey && (e.key === '\\' || e.key === '|')) fn = ed(C.cursorMatchingBracket);
    else if (mod && e.shiftKey && k === 'k' && activeTab) fn = ed(C.deleteLine);
    else if (e.shiftKey && e.altKey && !mod && k === 'a' && activeTab) fn = ed(C.toggleBlockComment);
    else if (e.altKey && !mod && !e.shiftKey && k === 'z') fn = toggleWrap;
    else if (e.altKey && !mod && !e.shiftKey && e.key === 'ArrowLeft' && !inField) fn = () => goNav(-1);
    else if (e.altKey && !mod && !e.shiftKey && e.key === 'ArrowRight' && !inField) fn = () => goNav(1);
    else if (e.altKey && !mod && k === 'w') fn = () => activeTab && closeTab(activeTab);
    else if (mod && k === 'tab') fn = () => nextTab(e.shiftKey ? -1 : 1);
    else if (mod && !e.shiftKey && k === 'f' && activeTab && !activeTab.view.hasFocus && !inField) fn = ed(SR.openSearchPanel);
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  }, true);

  // The theme changed: the title row's menus may come or go, and the Markdown preview takes the new colours.
  OS.onSettings(() => {
    renderMenubar();
    if (previewOpen && previewTab && previewTab.lang === 'md') schedulePreview(50);
  });

  // ================================================================== start
  applySizes();
  applySections();
  toggleSidebar(prefs.sidebar);
  renderTree();
  activate(null, { noNav: true });
  showPanel('terminal', false);
  ensureScratch(); // created up front: making it on first use takes the keyboard focus away from the console
  updateEvalTarget();
  (async () => {
    const folder = OS.args.folder;
    const path = OS.args.path;
    if (folder) await setRoot(folder);
    else if (path) await setRoot(U.dirname(path));
    if (path) await openPath(path, { noNav: true });
  })();
});
