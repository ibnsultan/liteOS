/*
 * LiteOS System Monitor. Processes: the open apps with their windows under them (OS.tasks): what each is doing, and
 * switching to, closing and ending them; then what LiteOS itself keeps running in the background. More sections
 * (Usage, Performance, Storage, Server, the LiteLink device) join the side as they are built
 * (liteapps/docs/utilities-roadmap.md).
 */
LiteOS.ready((OS) => {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => OS.util.escape(s == null ? '' : s);
  const ico = (n, s) => OS.icon(n, s || 16);
  // ending a task: a circle struck through (no glyph in the set says it)
  const END_ICO = '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M8.5 15.5l7-7"></path></svg>';
  if (OS.inShell) document.documentElement.classList.add('in-shell');

  const SECTIONS = [
    { id: 'processes', label: 'Processes', icon: 'list' },
    { id: 'performance', label: 'Performance', icon: 'chart' },
    { id: 'usage', label: 'Usage', icon: 'clock' },
    { id: 'storage', label: 'Storage', icon: 'storage' },
    { id: 'server', label: 'Server', icon: 'server', admin: true },
  ].filter((x) => !x.admin || (OS.user && OS.user.role === 'admin'));
  const st = {
    section: 'processes',
    list: [],
    query: '',
    sel: null, // { kind: 'app' | 'win' | 'svc', id }
  };
  // Performance (performance.js) and Usage (usage.js) draw themselves; each asks for a redraw when it has news
  const VIEWS = {};
  const redrawOf = (id) => () => { if (st.section === id) drawView(); };
  VIEWS.performance = window.SMPerf(OS, { redraw: redrawOf('performance') });
  VIEWS.usage = window.SMUsage(OS, { redraw: redrawOf('usage') });
  VIEWS.storage = window.SMStorage(OS, { redraw: redrawOf('storage') });
  VIEWS.server = window.SMServer(OS, { redraw: redrawOf('server') });
  const view = () => VIEWS[st.section] || null;
  const kept = OS.win.restored;
  if (kept && SECTIONS.some((x) => x.id === kept.section)) st.section = kept.section;
  if (kept) Object.keys(VIEWS).forEach((id) => VIEWS[id].restore(kept[id]));
  OS.win.keepState(() => Object.assign({ section: st.section }, ...Object.keys(VIEWS).map((id) => ({ [id]: VIEWS[id].keep() }))));

  // ------------------------------------------------------------------ title bar (chrome: custom)
  (function titleBar() {
    const img = OS.sysIcon ? OS.sysIcon('app.monitor') : null;
    if (img) $('#tbIcon').innerHTML = '<img src="' + esc(img) + '" alt="" width="16" height="16" draggable="false">';
    $('#tbControls').style.width = (OS.win.controlsWidth || 0) + 'px';
    $('#searchIco').outerHTML = ico('search', 14);
    OS.win.dragRegion($('#titlebar'), (t) => !t.closest('button, input, label'));
  })();
  $('#search').addEventListener('input', (e) => {
    st.query = e.target.value.trim().toLowerCase();
    if (view()) { if (view().search) view().search(st.query); } else render();
  });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.target.value = ''; st.query = ''; if (view()) { if (view().search) view().search(''); } else render(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); const l = $('.sm-list'); if (l) { l.focus(); step(1); } }
  });

  // ------------------------------------------------------------------ the sections
  function renderNav() {
    $('#nav').innerHTML = SECTIONS.map((x) => '<button type="button" class="sm-nav-row' + (x.id === st.section ? ' on' : '') + '" data-sec="' + x.id + '"' +
      (x.id === st.section ? ' aria-current="page"' : '') + ' title="' + esc(x.label) + '">' + ico(x.icon, 18) + '<span>' + esc(x.label) + '</span></button>').join('');
  }
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sec]');
    if (!b || b.dataset.sec === st.section) return;
    st.section = b.dataset.sec;
    showSection();
  });
  /** A section comes up: its search starts empty (Performance has none), its view starts watching, the others stop. */
  function showSection() {
    st.query = '';
    $('#search').value = '';
    const v = view();
    const ph = v ? v.placeholder : 'Search apps and windows';
    $('#searchBox').hidden = !!v && (!v.search || !v.placeholder);
    $('#search').placeholder = ph;
    $('#search').setAttribute('aria-label', ph);
    renderNav();
    Object.keys(VIEWS).forEach((id) => { if (id !== st.section) VIEWS[id].hide(); });
    if (v) { if (v.search) v.search(''); v.show(); } else render();
  }
  function drawView() {
    const main = $('#main');
    const box = $('.sm-scroll', main);
    const top = box ? box.scrollTop : 0;
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.metric : null;
    main.innerHTML = '<div class="sm-scroll">' + view().render() + '</div>';
    $('.sm-scroll', main).scrollTop = top;
    if (focused) { const b = $('[data-metric="' + focused + '"]', main); if (b) b.focus(); }
  }

  // ------------------------------------------------------------------ Processes
  const time = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + t;
  };
  /** A window's title without its app's name after it ("Report — Documents", "Report - Documents"). */
  const shortTitle = (w) => {
    const t = String(w.title || '').replace(/ — .*$/, '');
    const m = t.match(/^(.*\S)\s+[-–]\s+(.+)$/);
    return m && m[2] === w.app.name ? m[1] : t;
  };
  function winStatus(w) {
    if (!w.responding) return { text: 'Not responding', cls: 'sm-bad' };
    if (w.asleep) return { text: 'Not started', cls: 'sm-muted', tip: 'Starts when you switch to it' };
    if (w.starting) return { text: 'Starting', cls: 'sm-muted' };
    if (w.dirty) return { text: 'Unsaved changes', cls: 'sm-muted' };
    if (w.min) return { text: 'Minimised', cls: 'sm-muted' };
    return { text: 'Running', cls: '' };
  }
  function appStatus(a) {
    if (a.wins.some((w) => !w.responding)) return { text: 'Not responding', cls: 'sm-bad' };
    if (a.wins.every((w) => w.asleep)) return { text: 'Not started', cls: 'sm-muted', tip: 'Starts when you switch to it' };
    if (a.wins.some((w) => w.starting)) return { text: 'Starting', cls: 'sm-muted' };
    return { text: 'Running', cls: '' };
  }
  /** The windows grouped by app, in the order the apps were opened. */
  function apps() {
    const by = new Map();
    st.list.forEach((w) => {
      if (!by.has(w.app.id)) by.set(w.app.id, { id: w.app.id, name: w.app.name, img: w.app.img, wins: [] });
      by.get(w.app.id).wins.push(w);
    });
    const out = [...by.values()];
    out.forEach((a) => { a.wins.sort((x, y) => x.opened - y.opened); a.opened = a.wins[0].opened; });
    return out.sort((x, y) => x.opened - y.opened);
  }
  const matches = (s) => !st.query || String(s || '').toLowerCase().includes(st.query);

  function render() {
    if (st.section !== 'processes') return;
    const all = apps();
    const svcs = OS.tasks.services();
    // with a search: the apps whose name or a window's title has it, with only those windows when it is in a title
    const shown = all.map((a) => {
      if (matches(a.name)) return a;
      const wins = a.wins.filter((w) => matches(w.title));
      return wins.length ? Object.assign({}, a, { wins, part: true }) : null;
    }).filter(Boolean);
    const svcShown = svcs.filter((x) => matches(x.name) || matches(x.detail));
    // the selection goes when what it points at does
    if (st.sel && !rowExists(st.sel, all, svcs)) st.sel = null;
    const actions = (a) => {
      const bad = a.wins.some((w) => !w.responding);
      return '<span class="sm-acts">' +
        '<button type="button" class="icon-btn" data-act="switch" title="Switch to ' + esc(a.name) + '" aria-label="Switch to ' + esc(a.name) + '">' + ico('external', 16) + '</button>' +
        (bad ? '<button type="button" class="icon-btn red" data-act="end" title="End task for ' + esc(a.name) + '" aria-label="End task for ' + esc(a.name) + '">' + END_ICO + '</button>'
          : '<button type="button" class="icon-btn" data-act="close" title="Close ' + esc(a.name) + '" aria-label="Close ' + esc(a.name) + '">' + ico('x', 16) + '</button>') + '</span>';
    };
    const isSel = (kind, id) => st.sel && st.sel.kind === kind && st.sel.id === id;
    const rows = [];
    if (shown.length) rows.push('<div class="sm-grp" role="presentation">Apps (' + shown.length + ')</div>');
    shown.forEach((a) => {
      const s = appStatus(a);
      const one = a.wins.length === 1 ? a.wins[0] : null;
      const sub = one && shortTitle(one) !== a.name ? shortTitle(one) : '';
      rows.push('<div class="sm-row' + (isSel('app', a.id) ? ' sel' : '') + '" role="row" data-kind="app" data-id="' + esc(a.id) + '" aria-selected="' + isSel('app', a.id) + '">' +
        '<span class="sm-name"><img src="' + esc(a.img) + '" alt="" draggable="false"><b>' + esc(a.name) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') +
        (one && one.dirty ? '<span class="sm-dot" title="Unsaved changes"></span>' : '') + '</span>' +
        '<span class="' + s.cls + '"' + (s.tip ? ' title="' + esc(s.tip) + '"' : '') + '>' + esc(s.text) + '</span>' +
        '<span>' + a.wins.length + '</span><span>' + esc(time(a.opened)) + '</span>' + actions(a) + '</div>');
      if (a.wins.length > 1 || (a.part && a.wins.length && !one)) {
        a.wins.forEach((w) => {
          const ws = winStatus(w);
          rows.push('<div class="sm-row sub' + (isSel('win', w.id) ? ' sel' : '') + '" role="row" data-kind="win" data-id="' + esc(w.id) + '" aria-selected="' + isSel('win', w.id) + '">' +
            '<span class="sm-name"><b>' + esc(shortTitle(w)) + '</b>' + (w.dirty ? '<span class="sm-dot" title="Unsaved changes"></span>' : '') + '</span>' +
            '<span class="' + ws.cls + '"' + (ws.tip ? ' title="' + esc(ws.tip) + '"' : '') + '>' + esc(ws.text) + '</span><span></span><span>' + esc(time(w.opened)) + '</span><span></span></div>');
        });
      }
    });
    if (svcShown.length) rows.push('<div class="sm-grp" role="presentation">LiteOS (' + svcShown.length + ')</div>');
    svcShown.forEach((x) => {
      rows.push('<div class="sm-row' + (isSel('svc', x.id) ? ' sel' : '') + '" role="row" data-kind="svc" data-id="' + esc(x.id) + '" aria-selected="' + isSel('svc', x.id) + '" title="' + esc(x.detail) + '">' +
        '<span class="sm-name">' + ico(svcIcon(x.id), 16) + '<b>' + esc(x.name) + '</b></span><span class="sm-muted">Background</span><span>0</span><span>' + esc(time(x.since)) + '</span><span></span></div>');
    });
    if (!rows.length) rows.push('<div class="sm-empty">' + (st.query ? 'Nothing matches “' + esc(st.query) + '”.' : 'No apps are open.') + '</div>');

    const winCount = st.list.length;
    const bad = st.list.filter((w) => !w.responding).length;
    const main = $('#main');
    const list = $('.sm-list', main);
    const scroll = list ? list.scrollTop : 0;
    const hadFocus = list && document.activeElement === list;
    main.innerHTML = '<div class="sm-hd"><h1>Processes</h1>' +
      '<button type="button" class="btn" data-act="switch"' + (canSwitch() ? '' : ' disabled') + '>Switch to</button>' +
      '<button type="button" class="btn sm-danger" data-act="end"' + (canEnd() ? '' : ' disabled') + '>End task</button></div>' +
      '<div class="sm-cols" role="row"><span>Name</span><span>Status</span><span>Windows</span><span>Opened</span><span class="r">Actions</span></div>' +
      '<div class="sm-list" role="grid" aria-label="Processes" tabindex="0">' + rows.join('') + '</div>' +
      '<div class="sm-status"><span>' + all.length + (all.length === 1 ? ' app, ' : ' apps, ') + winCount + (winCount === 1 ? ' window' : ' windows') + '</span>' +
      (bad ? '<span class="sm-bad">' + bad + ' not responding</span>' : '') +
      '<span class="end">Ctrl+Shift+Esc opens System Monitor</span></div>';
    const nl = $('.sm-list', main);
    nl.scrollTop = scroll;
    if (hadFocus) nl.focus();
  }
  const svcIcon = (id) => ({ reminders: 'bell', litelink: 'desktop', 'guest-drive': 'storage' }[id] || 'settings');
  function rowExists(sel, all, svcs) {
    if (sel.kind === 'app') return all.some((a) => a.id === sel.id);
    if (sel.kind === 'win') return st.list.some((w) => w.id === sel.id);
    return svcs.some((x) => x.id === sel.id);
  }

  // ------------------------------------------------------------------ what the selection means
  /** The windows a row stands for: an app's, or one window. */
  function winsOf(sel) {
    if (!sel) return [];
    if (sel.kind === 'app') return st.list.filter((w) => w.app.id === sel.id);
    if (sel.kind === 'win') return st.list.filter((w) => w.id === sel.id);
    return [];
  }
  const canSwitch = () => winsOf(st.sel).length > 0;
  const canEnd = () => winsOf(st.sel).length > 0 && !winsOf(st.sel).some((w) => w.id === OS.win.id);

  function switchTo(sel) {
    const ws = winsOf(sel);
    if (!ws.length) return;
    // an app: its window most recently in front (the focused one, else the last opened that isn't minimised)
    const w = ws.find((x) => x.focused) || ws.slice().reverse().find((x) => !x.min) || ws[ws.length - 1];
    OS.tasks.focus(w.id);
  }
  async function closeAll(sel) {
    for (const w of winsOf(sel)) {
      if (!(await OS.tasks.close(w.id))) break; // they chose to keep one with unsaved changes: leave the rest
    }
  }
  async function endTask(sel) {
    const ws = winsOf(sel).filter((w) => w.id !== OS.win.id);
    if (!ws.length) return;
    const name = sel.kind === 'win' ? shortTitle(ws[0]) : ws[0].app.name;
    const stuck = ws.some((w) => !w.responding);
    const what = ws.length === 1 ? 'its window' : 'its ' + ws.length + ' windows';
    const message = (stuck ? name + ' isn’t responding. ' : '') + 'Ending it closes ' + what + ' without asking, and changes that weren’t saved will be lost.';
    const ok = await OS.dialog.confirm({ title: 'End task for ' + name + '?', message, okLabel: 'End task', danger: true });
    if (!ok) return;
    for (const w of ws) await OS.tasks.end(w.id);
  }

  // ------------------------------------------------------------------ pointer and keys
  $('#main').addEventListener('click', (e) => {
    if (view()) { view().click(e); return; }
    const row = e.target.closest('.sm-row');
    const act = e.target.closest('[data-act]');
    if (row) select({ kind: row.dataset.kind, id: row.dataset.id });
    if (!act) return;
    const sel = row ? { kind: row.dataset.kind, id: row.dataset.id } : st.sel;
    if (act.dataset.act === 'switch') switchTo(sel);
    else if (act.dataset.act === 'close') closeAll(sel);
    else if (act.dataset.act === 'end') endTask(sel);
  });
  $('#main').addEventListener('pointerdown', (e) => { if (view() && view().press) view().press(e); });
  $('#main').addEventListener('dblclick', (e) => {
    if (st.section !== 'processes') return;
    const row = e.target.closest('.sm-row');
    if (row && !e.target.closest('[data-act]')) switchTo({ kind: row.dataset.kind, id: row.dataset.id });
  });
  $('#main').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.sm-row');
    if (!row || st.section !== 'processes') return;
    e.preventDefault();
    const sel = { kind: row.dataset.kind, id: row.dataset.id };
    select(sel);
    const ws = winsOf(sel);
    if (!ws.length) return;
    const self = ws.some((w) => w.id === OS.win.id);
    OS.menu([
      { label: 'Switch to', icon: 'external', action: () => switchTo(sel) },
      { label: ws.length > 1 ? 'Close all windows' : 'Close', icon: 'x', disabled: self, action: () => closeAll(sel) },
      'sep',
      { label: 'End task', danger: true, disabled: self, action: () => endTask(sel) },
    ], { x: e.clientX, y: e.clientY });
  });
  function select(sel) {
    if (st.sel && sel && st.sel.kind === sel.kind && st.sel.id === sel.id) return;
    st.sel = sel;
    $('#main').querySelectorAll('.sm-row').forEach((r) => {
      const on = !!sel && r.dataset.kind === sel.kind && r.dataset.id === sel.id;
      r.classList.toggle('sel', on);
      r.setAttribute('aria-selected', on);
    });
    const sw = $('.sm-hd [data-act=switch]');
    const en = $('.sm-hd [data-act=end]');
    if (sw) sw.disabled = !canSwitch();
    if (en) en.disabled = !canEnd();
  }
  function step(d) {
    const rows = [...document.querySelectorAll('.sm-row')];
    if (!rows.length) return;
    let i = st.sel ? rows.findIndex((r) => r.dataset.kind === st.sel.kind && r.dataset.id === st.sel.id) : -1;
    i = i < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + d));
    select({ kind: rows[i].dataset.kind, id: rows[i].dataset.id });
    rows[i].scrollIntoView({ block: 'nearest' });
  }
  $('#main').addEventListener('keydown', (e) => {
    if (view()) { if (view().key && view().key(e)) e.preventDefault(); return; }
    if (!e.target.classList.contains('sm-list')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); step(-1e6); }
    else if (e.key === 'End') { e.preventDefault(); step(1e6); }
    else if (e.key === 'Enter' && st.sel) { e.preventDefault(); switchTo(st.sel); }
    else if (e.key === 'Delete' && st.sel && canEnd()) { e.preventDefault(); endTask(st.sel); }
  });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F') && !$('#searchBox').hidden) { e.preventDefault(); $('#search').focus(); $('#search').select(); }
  });

  // ------------------------------------------------------------------ start
  st.list = OS.tasks.list();
  showSection();
  // redrawn only when something shown has changed (not for a window that was merely moved or brought forward)
  const shownOf = (list) => JSON.stringify(list.map((w) => [w.id, w.title, w.dirty, w.min, w.asleep, w.starting, w.responding]));
  let shownNow = shownOf(st.list);
  OS.tasks.watch((list) => {
    st.list = list;
    const s = shownOf(list);
    if (s !== shownNow) { shownNow = s; render(); }
  });
  // the Opened times read "today" against the clock: look again when the day turns
  setInterval(() => { if (new Date().getHours() === 0) render(); }, 60000);
});
