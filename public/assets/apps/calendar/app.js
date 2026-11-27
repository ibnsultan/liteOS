/*
|--------------------------------------------------------------------------
| Calendar
|--------------------------------------------------------------------------
|
| A personal calendar. Each calendar is an .ics file in /Calendar on the drive (LOS_ics reads and writes it), with its
| own colour, shown or hidden at the side; new events go to Personal.ics unless another is picked. The views are the
| month, the week and the day: a click on a day or a drag over the hours makes an event, an event is moved by dragging
| it and resized by its lower edge, and a click opens it in the editor. Events can repeat (daily, weekly on chosen
| days, monthly, yearly, or a rule of one's own); changing, moving or deleting one of a series asks whether it is that
| one or the whole series. Changes can be undone from the notification. The week starts as Settings say (or as the
| language has it); times follow Settings' 24-hour clock.
|
*/
LiteOS.ready((OS) => {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => OS.util.escape(s == null ? '' : s);
  const ico = (n, s) => OS.icon(n, s || 16);
  const ICS = window.LOS_ics;
  if (OS.inShell) document.documentElement.classList.add('in-shell');

  const DIR = '/Calendar';
  const PERSONAL = DIR + '/Personal.ics';
  /** Pixels per hour in the week and day views, and the step events snap to (minutes). */
  const HOUR = 48;
  const SNAP = 15;
  const lang = navigator.language || undefined;
  const firstDay = () => ICS.firstDay(OS.settings);
  const h24 = () => OS.settings.clock24 !== false;

  const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const weekStart = (d) => addDays(day0(d), -((d.getDay() - firstDay() + 7) % 7));
  const key = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const fromKey = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d); };
  const time = (d) => d.toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit', hour12: !h24() });
  const mins = (d) => d.getHours() * 60 + d.getMinutes();
  const atMin = (d, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, m);

  const st = {
    view: 'week',
    cursor: day0(new Date()),
    /** The month the side shows. */
    mini: null,
    /** The calendars: [{ path, cal }]. */
    cals: [],
    loaded: false,
  };
  try { const v = localStorage.getItem('los.calendar.view'); if (['day', 'week', 'month'].includes(v)) st.view = v; } catch (e) { /* nothing kept */ }
  /** The calendars hidden at the side (their paths), kept in this browser. */
  const hidden = new Set((() => { try { return JSON.parse(localStorage.getItem('los.calendar.hidden') || '[]'); } catch (e) { return []; } })());
  const keepHidden = () => { try { localStorage.setItem('los.calendar.hidden', JSON.stringify([...hidden])); } catch (e) { /* not kept */ } };

  /*
  |--------------------------------------------------------------------------
  | The title bar (chrome: custom) and the toolbar
  |--------------------------------------------------------------------------
  */
  (function titleBar() {
    const img = OS.sysIcon ? OS.sysIcon('app.calendar') : null;
    if (img) $('#tbIcon').innerHTML = '<img src="' + esc(img) + '" alt="" width="16" height="16" draggable="false">';
    $('#tbControls').style.width = (OS.win.controlsWidth || 0) + 'px';
    OS.win.dragRegion($('#titlebar'), (t) => !t.closest('button, input, label'));
  })();
  $('#newBtn').innerHTML = ico('plus', 16) + '<span>New event</span>';
  $('#prevBtn').innerHTML = ico('chevUp', 16);
  $('#nextBtn').innerHTML = ico('down', 16);

  /*
  |--------------------------------------------------------------------------
  | Calendars: read from /Calendar, written back whole
  |--------------------------------------------------------------------------
  */
  async function load() {
    const out = [];
    try {
      const list = await OS.fs.list(DIR);
      for (const f of (list || []).filter((x) => x.type === 'file' && /\.ics$/i.test(x.name))) {
        try {
          const r = await OS.fs.read(f.path, { track: false });
          const cal = ICS.parse(r.content);
          if (!cal.name) cal.name = f.name.replace(/\.ics$/i, '');
          if (!cal.color) cal.color = '#2F6FD6';
          out.push({ path: f.path, cal });
        } catch (e) { /* a file that can't be read is left out */ }
      }
    } catch (e) { /* no /Calendar yet */ }
    if (!out.some((c) => c.path === PERSONAL)) out.unshift({ path: PERSONAL, cal: { name: 'Personal', color: '#2F6FD6', events: [], head: [], tail: [] }, unsaved: true });
    st.cals = out;
    st.loaded = true;
    render();
  }
  /** The stored events of the calendars shown (each knows its calendar). */
  const events = () => st.cals.filter((c) => !hidden.has(c.path)).flatMap((c) => c.cal.events.map((e) => Object.assign(e, { _cal: c })));
  /** The occurrences drawn, by key (an event's id and the start of that occurrence): what a click or a drag acts on. */
  const shown = new Map();
  const reg = (o) => { const k = o.uid + '|' + o.occ.getTime(); shown.set(k, o); return esc(k); };
  const rep = (o) => (o.master && isSeriesEv(o.master) ? '<span class="ev-rep" title="Repeats">' + ico('repeat', 11) + '</span>' : '');

  async function save(c) {
    try { await OS.fs.mkdir(DIR); } catch (e) { /* it's there already */ }
    await OS.fs.write(c.path, ICS.stringify(c.cal));
    c.unsaved = false;
    try { new BroadcastChannel('liteos.calendar').postMessage({ type: 'changed' }); } catch (e) { /* it reads again in a few minutes */ }
  }
  async function commit(c) {
    try { await save(c); } catch (e) { OS.notify(e.message || 'The calendar couldn’t be saved.', { type: 'error', title: 'Couldn’t save' }); }
  }

  /*
  |--------------------------------------------------------------------------
  | Drawing
  |--------------------------------------------------------------------------
  */
  function render() {
    shown.clear();
    $$('.cal-views [data-view]').forEach((b) => { const on = b.dataset.view === st.view; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    $('#prevBtn').setAttribute('aria-label', 'Previous ' + st.view);
    $('#nextBtn').setAttribute('aria-label', 'Next ' + st.view);
    $('#period').textContent = periodTitle();
    renderMini();
    renderCals();
    if (st.view === 'month') renderMonth(); else renderDays(st.view === 'day' ? 1 : 7);
  }
  function periodTitle() {
    const c = st.cursor;
    if (st.view === 'month') return c.toLocaleDateString(lang, { month: 'long', year: 'numeric' });
    if (st.view === 'day') return c.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const a = weekStart(c);
    const b = addDays(a, 6);
    const sameMonth = a.getMonth() === b.getMonth();
    return a.toLocaleDateString(lang, { day: 'numeric', month: sameMonth ? undefined : 'short' }) + ' – ' + b.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** The month at the side: moving through months doesn't move the view until a day is picked. */
  function renderMini() {
    const m = st.mini || new Date(st.cursor.getFullYear(), st.cursor.getMonth(), 1);
    st.mini = m;
    const start = weekStart(m);
    const today = new Date();
    let h = '<div class="mini-head"><b>' + esc(m.toLocaleDateString(lang, { month: 'long', year: 'numeric' })) + '</b><span class="spacer"></span>' +
      '<button type="button" class="icon-btn" data-mini="-1" aria-label="Previous month">' + ico('chevUp', 14) + '</button><button type="button" class="icon-btn" data-mini="1" aria-label="Next month">' + ico('down', 14) + '</button></div><div class="mini-grid">';
    for (let i = 0; i < 7; i++) h += '<span class="mini-wd">' + esc(addDays(start, i).toLocaleDateString(lang, { weekday: 'narrow' })) + '</span>';
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      h += '<button type="button" class="mini-d' + (d.getMonth() !== m.getMonth() ? ' out' : '') + (sameDay(d, today) ? ' today' : '') + (inView(d) ? ' inview' : '') + '" data-day="' + key(d) + '">' + d.getDate() + '</button>';
    }
    $('#mini').innerHTML = h + '</div>';
  }
  function inView(d) {
    if (st.view === 'day') return sameDay(d, st.cursor);
    if (st.view === 'week') { const a = weekStart(st.cursor); return d >= a && d < addDays(a, 7); }
    return false;
  }
  /** The calendars: the tick shows or hides one, its menu (on hover) renames, recolours, exports or deletes it. */
  function renderCals() {
    $('#calList').innerHTML = st.cals.map((c) => {
      const on = !hidden.has(c.path);
      return '<div class="cal-row"><button type="button" class="cal-show" data-cal-show="' + esc(c.path) + '" role="checkbox" aria-checked="' + on + '" style="--c:' + esc(c.cal.color) + '">' +
        '<span class="cal-tick">' + (on ? ico('check', 12) : '') + '</span><span class="cal-name">' + esc(c.cal.name) + '</span></button>' +
        '<button type="button" class="icon-btn cal-more" data-cal-more="' + esc(c.path) + '" aria-label="' + esc(c.cal.name) + ' options" title="More">' + ico('more', 16) + '</button></div>';
    }).join('') + '<button type="button" class="cal-add" data-cal-add>' + ico('plus', 14) + '<span>Add calendar</span></button>';
  }

  /** The month: six weeks of days, up to three events a day and "+N more" (which opens that day). */
  function renderMonth() {
    const m = new Date(st.cursor.getFullYear(), st.cursor.getMonth(), 1);
    const start = weekStart(m);
    const all = events();
    const today = new Date();
    let h = '<div class="mon"><div class="mon-wd">';
    for (let i = 0; i < 7; i++) h += '<span>' + esc(addDays(start, i).toLocaleDateString(lang, { weekday: 'short' })) + '</span>';
    h += '</div><div class="mon-grid">';
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const evs = ICS.onDay(all, d);
      h += '<div class="mon-d' + (d.getMonth() !== m.getMonth() ? ' out' : '') + (sameDay(d, today) ? ' today' : '') + '" data-day="' + key(d) + '">' +
        '<span class="mon-n">' + d.getDate() + '</span>' +
        evs.slice(0, 3).map((e) => '<button type="button" class="ev-chip' + (e.allDay ? ' allday' : '') + '" data-ev="' + reg(e) + '" style="--c:' + esc(e._cal.cal.color) + '">' +
          (e.allDay ? '' : '<small>' + esc(time(e.start)) + '</small>') + esc(e.title || 'Untitled') + rep(e) + '</button>').join('') +
        (evs.length > 3 ? '<button type="button" class="mon-more" data-more="' + key(d) + '">+' + (evs.length - 3) + ' more</button>' : '') + '</div>';
    }
    $('#main').innerHTML = h + '</div></div>';
  }

  /** The week (7 days) or the day: all-day events across the top, the hours under them, a line at the time now. */
  function renderDays(n) {
    const start = n === 1 ? day0(st.cursor) : weekStart(st.cursor);
    const days = Array.from({ length: n }, (_, i) => addDays(start, i));
    const all = events();
    const today = new Date();
    let head = '<div class="wk-head"><span class="wk-gutter"></span>';
    let alld = '<div class="wk-allday"><span class="wk-gutter">All day</span>';
    let cols = '';
    days.forEach((d) => {
      const evs = ICS.onDay(all, d);
      head += '<div class="wk-dh' + (sameDay(d, today) ? ' today' : '') + '"><small>' + esc(d.toLocaleDateString(lang, { weekday: 'short' })) + '</small><b>' + d.getDate() + '</b></div>';
      alld += '<div class="wk-ad" data-day="' + key(d) + '">' + evs.filter((e) => e.allDay).map((e) => '<button type="button" class="ev-chip allday" data-ev="' + reg(e) + '" style="--c:' + esc(e._cal.cal.color) + '">' + esc(e.title || 'Untitled') + rep(e) + '</button>').join('') + '</div>';
      cols += '<div class="wk-col' + (sameDay(d, today) ? ' today' : '') + '" data-day="' + key(d) + '">' + layoutDay(d, evs.filter((e) => !e.allDay)) +
        (sameDay(d, today) ? '<span class="wk-now" style="top:' + (mins(today) * HOUR / 60) + 'px"></span>' : '') + '</div>';
    });
    let hours = '<div class="wk-hours">';
    for (let hr = 0; hr < 24; hr++) hours += '<span style="top:' + (hr * HOUR) + 'px">' + (hr ? esc(time(new Date(2024, 0, 1, hr))) : '') + '</span>';
    hours += '</div>';
    const prev = $('.wk-scroll');
    const keep = prev ? prev.scrollTop : null;
    $('#main').innerHTML = '<div class="wk" style="--days:' + n + '">' + head + '</div>' + alld + '</div>' +
      '<div class="wk-scroll"><div class="wk-grid" style="height:' + (24 * HOUR) + 'px">' + hours + '<div class="wk-cols">' + cols + '</div></div></div></div>';
    const sc = $('.wk-scroll');
    sc.scrollTop = keep != null ? keep : Math.max(0, (sameDay(start, today) || n === 7 ? Math.min(mins(today) / 60 - 2, 16) : 8) * HOUR);
  }

  /** Timed events of one day placed in columns where they overlap (each cluster shares the width). */
  function layoutDay(d, evs) {
    const a = day0(d);
    const items = evs.map((e) => {
      const s = e.start < a ? 0 : mins(e.start);
      const en = e.end > addDays(a, 1) ? 1440 : Math.max(s + SNAP, mins(e.end) || 1440);
      return { e, s, en, col: 0, cols: 1 };
    }).sort((x, y) => x.s - y.s || y.en - x.en);
    let cluster = [];
    let end = -1;
    const flush = () => { const n = Math.max(1, ...cluster.map((x) => x.col + 1)); cluster.forEach((x) => { x.cols = n; }); cluster = []; };
    items.forEach((it) => {
      if (it.s >= end && cluster.length) flush();
      const used = cluster.filter((x) => x.en > it.s).map((x) => x.col);
      let c = 0;
      while (used.includes(c)) c++;
      it.col = c;
      cluster.push(it);
      end = Math.max(end, it.en);
    });
    flush();
    return items.map((it) => {
      const top = it.s * HOUR / 60;
      const h = Math.max(18, (it.en - it.s) * HOUR / 60 - 2);
      const short = h < 36;
      return '<div class="ev-block' + (short ? ' short' : '') + '" data-ev="' + reg(it.e) + '" tabindex="0" role="button" style="--c:' + esc(it.e._cal.cal.color) + ';top:' + top + 'px;height:' + h + 'px;left:calc(' + (it.col / it.cols * 100) + '% + 2px);width:calc(' + (100 / it.cols) + '% - 6px)">' +
        '<b>' + esc(it.e.title || 'Untitled') + rep(it.e) + '</b>' + (short ? '' : '<small>' + esc(time(it.e.start)) + ' – ' + esc(time(it.e.end)) + (it.e.location ? ', ' + esc(it.e.location) : '') + '</small>') +
        '<span class="ev-grip" aria-hidden="true"></span></div>';
    }).join('');
  }

  /*
  |--------------------------------------------------------------------------
  | Moving through time
  |--------------------------------------------------------------------------
  */
  function go(delta) {
    const c = st.cursor;
    st.cursor = st.view === 'month' ? new Date(c.getFullYear(), c.getMonth() + delta, 1) : addDays(c, delta * (st.view === 'week' ? 7 : 1));
    st.mini = null;
    render();
  }
  function setView(v) {
    st.view = v;
    try { localStorage.setItem('los.calendar.view', v); } catch (e) { /* not kept */ }
    render();
  }
  $('#prevBtn').addEventListener('click', () => go(-1));
  $('#nextBtn').addEventListener('click', () => go(1));
  $('#todayBtn').addEventListener('click', () => { st.cursor = day0(new Date()); st.mini = null; render(); });
  $$('.cal-views [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#mini').addEventListener('click', (e) => {
    const n = e.target.closest('[data-mini]');
    if (n) { st.mini = new Date(st.mini.getFullYear(), st.mini.getMonth() + +n.dataset.mini, 1); renderMini(); return; }
    const d = e.target.closest('[data-day]');
    if (d) { st.cursor = fromKey(d.dataset.day); st.mini = null; render(); }
  });

  /*
  |--------------------------------------------------------------------------
  | Making, opening, moving and resizing events
  |--------------------------------------------------------------------------
  */
  const byKey = (k) => shown.get(k);
  $('#newBtn').addEventListener('click', () => newEvent(st.cursor));

  /** A new event on a day: the next whole hour today, nine o'clock on another day; an hour long. */
  function newEvent(d, startMin, endMin) {
    const now = new Date();
    const s = startMin != null ? startMin : (sameDay(d, now) ? Math.min(23 * 60, (now.getHours() + 1) * 60) : 9 * 60);
    edit({ uid: '', title: '', start: atMin(d, s), end: atMin(d, endMin != null ? endMin : s + 60), allDay: false, location: '', notes: '' }, true);
  }

  $('#main').addEventListener('click', (e) => {
    if (drag && drag.moved) return;
    const more = e.target.closest('[data-more]');
    if (more) { st.cursor = fromKey(more.dataset.more); setView('day'); return; }
    const ev = e.target.closest('[data-ev]');
    if (ev) { const x = byKey(ev.dataset.ev); if (x) edit(x, false); return; }
    const md = e.target.closest('.mon-d');
    if (md) { newEvent(fromKey(md.dataset.day)); return; }
    const ad = e.target.closest('.wk-ad');
    if (ad) { const d = fromKey(ad.dataset.day); edit({ uid: '', title: '', start: d, end: addDays(d, 1), allDay: true, location: '', notes: '' }, true); }
  });
  $('#main').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-ev]')) { e.preventDefault(); const x = byKey(e.target.dataset.ev); if (x) edit(x, false); }
  });

  /**
   * Drags in the week and day views: over empty hours makes an event (the editor opens with its times); on an event
   * moves it, to another day too; on its lower edge resizes it. A press without moving is a click (it opens).
   */
  let drag = null;
  const colAt = (x) => $$('.wk-col').find((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; });
  const minAt = (col, y) => { const r = col.getBoundingClientRect(); return Math.max(0, Math.min(1440, Math.round(((y - r.top) / HOUR * 60) / SNAP) * SNAP)); };
  $('#main').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const col = e.target.closest('.wk-col');
    if (!col) return;
    const block = e.target.closest('.ev-block');
    const m0 = minAt(col, e.clientY);
    if (block) {
      const ev = byKey(block.dataset.ev);
      if (!ev) return;
      drag = { kind: e.target.closest('.ev-grip') ? 'resize' : 'move', ev, block, col, m0, x0: e.clientX, y0: e.clientY, start: ev.start, end: ev.end, moved: false };
    } else {
      drag = { kind: 'create', col, m0, m1: m0 + 60, x0: e.clientX, y0: e.clientY, moved: false, ghost: null };
    }
    e.preventDefault();
    $('#main').setPointerCapture(e.pointerId);
  });
  $('#main').addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 4) return;
    drag.moved = true;
    if (drag.kind === 'create') {
      const m = minAt(drag.col, e.clientY);
      const a = Math.min(drag.m0, m), b = Math.max(drag.m0, m, Math.min(drag.m0, m) + SNAP);
      drag.ms = a; drag.me = b;
      if (!drag.ghost) { drag.ghost = document.createElement('div'); drag.ghost.className = 'ev-ghost'; drag.col.appendChild(drag.ghost); }
      Object.assign(drag.ghost.style, { top: (a * HOUR / 60) + 'px', height: ((b - a) * HOUR / 60) + 'px' });
      drag.ghost.textContent = time(atMin(new Date(), a)) + ' – ' + time(atMin(new Date(), b));
      return;
    }
    const col = colAt(e.clientX) || drag.col;
    const dm = minAt(drag.col, e.clientY) - drag.m0;
    const len = drag.end - drag.start;
    if (drag.kind === 'move') {
      const dayShift = Math.round((fromKey(col.dataset.day) - fromKey(drag.col.dataset.day)) / 86400000);
      const st0 = drag.start;
      const s = new Date(st0.getFullYear(), st0.getMonth(), st0.getDate() + dayShift, st0.getHours(), st0.getMinutes() + dm);
      drag.newStart = s; drag.newEnd = new Date(s.getTime() + len);
      if (drag.block.parentElement !== col) col.appendChild(drag.block);
      drag.block.style.top = (mins(s) * HOUR / 60) + 'px';
      drag.block.style.left = '2px'; drag.block.style.width = 'calc(100% - 6px)';
      drag.block.classList.add('dragging');
    } else {
      const en = new Date(Math.max(drag.start.getTime() + SNAP * 60000, drag.end.getTime() + dm * 60000));
      drag.newStart = drag.start; drag.newEnd = en;
      drag.block.style.height = Math.max(18, (en - drag.start) / 60000 * HOUR / 60 - 2) + 'px';
      drag.block.classList.add('dragging');
    }
  });
  $('#main').addEventListener('pointerup', () => {
    const d = drag;
    if (!d) return;
    /** The click that follows still sees it was a drag (and doesn't open anything). */
    setTimeout(() => { if (drag === d) drag = null; }, 0);
    if (!d.moved) {
      /** A press without moving is a click: the pointer was captured, so the click itself lands on the view. */
      if (d.kind === 'create') newEvent(fromKey(d.col.dataset.day), d.m0, d.m0 + 60);
      else edit(d.ev, false);
      return;
    }
    if (d.kind === 'create') {
      if (d.ghost) d.ghost.remove();
      newEvent(fromKey(d.col.dataset.day), d.ms, d.me);
      return;
    }
    if (d.newStart && d.newEnd && (d.newStart - d.ev.start || d.newEnd - d.ev.end)) changeTimes(d.ev, d.newStart, d.newEnd, d.kind === 'resize' ? 'changed' : 'moved');
    else render();
  });

  /*
  |--------------------------------------------------------------------------
  | The editor
  |--------------------------------------------------------------------------
  |
  | A panel over the window: title, start and end (a date, and a time unless all day), how it repeats, which calendar
  | it goes in, location and notes; Delete for an event that exists, Cancel and Save. The date opens a month to pick
  | from, the time a list of half hours (or a time typed: 9:30, 14:00, 2pm). Saving one of a series asks whether it is
  | that one or the whole series (a new repeat or another calendar is always the whole series).
  |
  */
  function edit(ev, isNew) {
    closeEditor();
    const m = ev.master || null;
    const draft = {
      title: ev.title, start: new Date(ev.start), end: new Date(ev.end), allDay: !!ev.allDay, location: ev.location || '', notes: ev.notes || '',
      rule: cloneRule(m ? (m.recurrenceId ? (findSeries(m) || {}).rrule : m.rrule) : null),
      cal: (m && m._cal) || defaultCal(),
    };
    const src = m ? (m.recurrenceId ? m : (findSeries(m) || m)) : null;
    draft.alarms = src ? (src.alarms || []).filter((a) => a.minutes != null).map((a) => a.minutes)
      : (draft.cal.cal.defaultAlarm != null ? [draft.cal.cal.defaultAlarm] : []);
    const keptAlarms = src ? (src.alarms || []).filter((a) => a.minutes == null) : [];
    const ruleBefore = JSON.stringify(ruleKey(draft.rule));
    /** An all-day event is shown with its last day, and saved with the day after it. */
    if (draft.allDay) draft.end = addDays(draft.end, -1);
    const wrap = document.createElement('div');
    wrap.className = 'ed-wrap';
    wrap.innerHTML = '<div class="ed" role="dialog" aria-modal="true" aria-label="' + (isNew ? 'New event' : 'Event') + '">' +
      '<input class="ed-title" type="text" placeholder="Add a title" aria-label="Title" maxlength="300">' +
      '<div class="ed-row"><span class="ed-ico">' + ico('clock', 16) + '</span><div class="ed-when">' +
        '<div class="ed-line"><span class="ed-lbl">Starts</span><button type="button" class="btn ed-date" data-f="start"></button><input class="input ed-time" data-f="start" aria-label="Start time"></div>' +
        '<div class="ed-line"><span class="ed-lbl">Ends</span><button type="button" class="btn ed-date" data-f="end"></button><input class="input ed-time" data-f="end" aria-label="End time"></div>' +
        '<label class="ed-allday"><span>All day</span><button type="button" class="switch" role="switch" aria-checked="false" aria-label="All day"></button></label>' +
      '</div></div>' +
      '<div class="ed-row"><span class="ed-ico">' + ico('repeat', 16) + '</span><button type="button" class="btn ed-pick ed-repeat" aria-haspopup="menu" aria-label="Repeat"></button></div>' +
      '<div class="ed-row"><span class="ed-ico">' + ico('bell', 16) + '</span><div class="ed-alarms" role="group" aria-label="Reminders"></div></div>' +
      '<div class="ed-row"><span class="ed-ico">' + ico('calendar', 16) + '</span><button type="button" class="btn ed-pick ed-cal" aria-haspopup="menu" aria-label="Calendar"></button></div>' +
      '<div class="ed-row"><span class="ed-ico">' + ico('pin', 16) + '</span><input class="input ed-loc" type="text" placeholder="Location" aria-label="Location" maxlength="300"></div>' +
      '<div class="ed-row"><span class="ed-ico">' + ico('note', 16) + '</span><textarea class="input ed-notes" rows="3" placeholder="Notes" aria-label="Notes"></textarea></div>' +
      '<p class="ed-err" role="alert" hidden></p>' +
      '<div class="ed-actions">' + (isNew ? '' : '<button type="button" class="icon-btn ed-del" title="Delete" aria-label="Delete">' + ico('trash', 16) + '</button>') +
        '<span class="spacer"></span><button type="button" class="btn ed-cancel">Cancel</button><button type="button" class="btn btn-primary ed-save">Save</button></div></div>';
    document.body.appendChild(wrap);
    const box = $('.ed', wrap);
    $('.ed-title', box).value = draft.title || '';
    $('.ed-loc', box).value = draft.location;
    $('.ed-notes', box).value = draft.notes;
    const sw = $('.ed-allday .switch', box);
    const caret = '<span class="ed-caret">' + ico('down', 12) + '</span>';

    function paint() {
      sw.setAttribute('aria-checked', String(draft.allDay));
      box.classList.toggle('allday', draft.allDay);
      ['start', 'end'].forEach((f) => {
        $('.ed-date[data-f="' + f + '"]', box).textContent = draft[f].toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        const t = $('.ed-time[data-f="' + f + '"]', box);
        if (document.activeElement !== t) t.value = time(draft[f]);
      });
      $('.ed-repeat', box).innerHTML = '<span>' + esc(describeRule(draft.rule, draft.start)) + '</span>' + caret;
      $('.ed-cal', box).innerHTML = '<span class="cal-dot" style="background:' + esc(draft.cal.cal.color) + '"></span><span>' + esc(draft.cal.cal.name) + '</span>' + caret;
      $('.ed-alarms', box).innerHTML = draft.alarms.map((mm, i) => '<div class="ed-alarm"><button type="button" class="btn ed-pick" data-a="' + i + '" aria-haspopup="menu" aria-label="Reminder"><span>' + esc(alarmLabel(mm, draft.allDay)) + '</span>' + caret + '</button>' +
        '<button type="button" class="icon-btn ed-ax" data-ax="' + i + '" aria-label="Remove reminder" title="Remove">' + ico('x', 14) + '</button></div>').join('') +
        '<button type="button" class="ed-add" data-aadd>' + ico('plus', 14) + '<span>Add a reminder</span></button>';
    }
    paint();
    const err = (msg) => { const p = $('.ed-err', box); p.textContent = msg || ''; p.hidden = !msg; };
    sw.addEventListener('click', () => { draft.allDay = !draft.allDay; paint(); });
    $('.ed-allday span', box).addEventListener('click', () => sw.click());

    /** The dates: a month to pick from; moving the start keeps the length. */
    $$('.ed-date', box).forEach((b) => b.addEventListener('click', () => pickDate(b, draft[b.dataset.f], (d) => {
      const f = b.dataset.f;
      const keepLen = draft.end - draft.start;
      draft[f] = new Date(d.getFullYear(), d.getMonth(), d.getDate(), draft[f].getHours(), draft[f].getMinutes());
      if (f === 'start') draft.end = new Date(draft.start.getTime() + keepLen);
      if (draft.end < draft.start) draft.end = new Date(draft.start.getTime() + (draft.allDay ? 0 : 3600000));
      paint();
    })));
    /** The times: typed, or picked from the half hours; an end before the start is the next day. */
    $$('.ed-time', box).forEach((inp) => {
      const f = inp.dataset.f;
      const apply = () => {
        const mm = parseTime(inp.value);
        if (mm == null) { inp.value = time(draft[f]); return; }
        const keepLen = draft.end - draft.start;
        draft[f] = atMin(draft[f], mm);
        if (f === 'start') draft.end = new Date(draft.start.getTime() + keepLen);
        else if (draft.end <= draft.start) draft.end = new Date(draft.end.getTime() + 86400000);
        paint();
      };
      inp.addEventListener('focus', () => pickTime(inp, draft[f], (mm) => { inp.value = time(atMin(draft[f], mm)); apply(); }));
      inp.addEventListener('change', apply);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); closePicker(); inp.blur(); } });
    });
    /** How it repeats: the usual choices for its date, or a rule of its own (Custom). */
    $('.ed-repeat', box).addEventListener('click', (e) => {
      const b = e.currentTarget;
      const r = b.getBoundingClientRect();
      const now = ruleKey(draft.rule);
      OS.menu(repeatChoices(draft.start).map((c) => ({ label: c.label, checked: JSON.stringify(ruleKey(c.rule)) === JSON.stringify(now), action: () => { draft.rule = c.rule; paint(); } }))
        .concat(['sep', { label: 'Custom…', action: async () => { const got = await customRepeat(draft.rule, draft.start); if (got !== undefined) { draft.rule = got; paint(); } } }]), { x: r.left, y: r.bottom + 2 });
    });
    $('.ed-cal', box).addEventListener('click', (e) => pickCal(e.currentTarget, draft.cal, (c) => { draft.cal = c; paint(); }));
    /** Reminders: each its own choice (None takes it away), Add a reminder, and a time of one's own (Custom). */
    $('.ed-alarms', box).addEventListener('click', async (e) => {
      const x = e.target.closest('[data-ax]');
      if (x) { draft.alarms.splice(+x.dataset.ax, 1); paint(); return; }
      if (e.target.closest('[data-aadd]')) {
        const next = alarmChoices(draft.allDay).map((c) => c[0]).find((v) => v != null && !draft.alarms.includes(v));
        if (next != null) draft.alarms.push(next);
        paint();
        return;
      }
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const i = +b.dataset.a;
      const r = b.getBoundingClientRect();
      OS.menu(alarmChoices(draft.allDay).map(([v, label]) => ({ label, checked: v === draft.alarms[i], action: () => { if (v == null) draft.alarms.splice(i, 1); else draft.alarms[i] = v; paint(); } }))
        .concat(['sep', { label: 'Custom\u2026', action: async () => { const v = await customAlarm(draft.alarms[i]); if (v != null) { draft.alarms[i] = v; paint(); } } }]), { x: r.left, y: r.bottom + 2 });
    });

    async function doSave() {
      draft.title = $('.ed-title', box).value.trim();
      draft.location = $('.ed-loc', box).value.trim();
      draft.notes = $('.ed-notes', box).value;
      const start = draft.allDay ? day0(draft.start) : draft.start;
      const end = draft.allDay ? addDays(day0(draft.end), 1) : draft.end;
      if (end <= start) { err('The event has to end after it starts.'); return; }
      const alarms = [...new Set(draft.alarms)].sort((a, b) => a - b).map((mm) => ({ minutes: mm, edited: true })).concat(keptAlarms);
      const fields = { title: draft.title, start, end, allDay: draft.allDay, location: draft.location, notes: draft.notes, alarms };
      const touched = new Set([draft.cal]);
      if (isNew) {
        draft.cal.cal.events.push(Object.assign({ uid: ICS.uid(), rrule: draft.rule, exdates: [], recurrenceId: null, extra: [] }, fields));
      } else {
        const ruleChanged = JSON.stringify(ruleKey(draft.rule)) !== ruleBefore;
        const calChanged = draft.cal !== m._cal;
        touched.add(m._cal);
        if (!isSeriesEv(m)) {
          Object.assign(m, fields, { rrule: draft.rule, exdates: draft.rule ? m.exdates || [] : [] });
          if (calChanged) moveTo(m, draft.cal);
        } else {
          const scope = ruleChanged || calChanged ? 'all' : await askScope(ev, 'Save changes to');
          if (!scope) return;
          if (scope === 'one') {
            if (m.recurrenceId) Object.assign(m, fields);
            else m._cal.cal.events.push(Object.assign({ uid: m.uid, rrule: null, exdates: [], recurrenceId: ev.occ, extra: [] }, fields));
          } else {
            const s = m.recurrenceId ? findSeries(m) : m;
            if (s) {
              Object.assign(s, { title: fields.title, location: fields.location, notes: fields.notes, allDay: fields.allDay, alarms: fields.alarms });
              if (!m.recurrenceId) {
                const ns = new Date(s.start.getTime() + (start - ev.start));
                s.start = ns;
                s.end = new Date(ns.getTime() + (end - start));
              }
              s.rrule = draft.rule;
              if (!draft.rule) dropChanges(s);
              if (m.recurrenceId) Object.assign(m, { title: fields.title, location: fields.location, notes: fields.notes });
              if (calChanged) seriesOf(s).forEach((x) => moveTo(x, draft.cal));
            }
          }
        }
      }
      try { for (const c of touched) await save(c); } catch (e) { err(e.message || 'It couldn’t be saved.'); return; }
      closeEditor();
      if (hidden.has(draft.cal.path)) { hidden.delete(draft.cal.path); keepHidden(); }
      if (!inViewRange(start)) { st.cursor = day0(start); st.mini = null; }
      render();
    }
    $('.ed-save', box).addEventListener('click', doSave);
    $('.ed-cancel', box).addEventListener('click', closeEditor);
    const del = $('.ed-del', box);
    if (del) del.addEventListener('click', () => { closeEditor(); remove(ev); });
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) closeEditor(); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (picker) closePicker(); else closeEditor(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); }
      if (e.key === 'Enter' && e.target.classList.contains('ed-title')) { e.preventDefault(); doSave(); }
    });
    setTimeout(() => $('.ed-title', box).focus(), 0);
  }
  function closeEditor() { closePicker(); $$('.ed-wrap').forEach((w) => w.remove()); }
  function inViewRange(d) {
    if (st.view === 'month') return d.getMonth() === st.cursor.getMonth() && d.getFullYear() === st.cursor.getFullYear();
    if (st.view === 'week') { const a = weekStart(st.cursor); return d >= a && d < addDays(a, 7); }
    return sameDay(d, st.cursor);
  }

  /*
  |--------------------------------------------------------------------------
  | Series: the event a changed occurrence belongs to, moving between calendars
  |--------------------------------------------------------------------------
  */
  const isSeriesEv = (e) => !!(e.rrule || e.recurrenceId);
  const findSeries = (e) => e._cal.cal.events.find((x) => x.uid === e.uid && !x.recurrenceId);
  const seriesOf = (s) => s._cal.cal.events.filter((x) => x.uid === s.uid);
  /** No repeat any more: the occurrences changed on their own and the dates left out go with it. */
  function dropChanges(s) {
    s.exdates = [];
    s._cal.cal.events = s._cal.cal.events.filter((x) => !(x.uid === s.uid && x.recurrenceId));
  }
  function moveTo(e, c) {
    const from = e._cal;
    if (from === c) return;
    from.cal.events = from.cal.events.filter((x) => x !== e);
    c.cal.events.push(e);
    e._cal = c;
  }
  const defaultCal = () => st.cals.find((c) => c.path === PERSONAL) || st.cals[0];

  /** The calendar's text before a change, and putting it back (Undo). */
  const snap = (c) => ICS.stringify(c.cal);
  async function restore(c, text) {
    const p = ICS.parse(text);
    c.cal.events = p.events;
    c.cal.head = p.head;
    c.cal.tail = p.tail;
    await commit(c);
    render();
  }

  /** A drag of one of a series asks which it means; Undo puts the calendar back as it was. */
  async function changeTimes(o, ns, ne, how) {
    const m = o.master;
    const c = m._cal;
    let scope = 'one';
    if (isSeriesEv(m)) scope = await askScope(o, how === 'moved' ? 'Move' : 'Change');
    if (!scope) { render(); return; }
    const before = snap(c);
    if (!isSeriesEv(m) || (scope === 'one' && m.recurrenceId)) { m.start = ns; m.end = ne; }
    else if (scope === 'one') c.cal.events.push({ uid: m.uid, title: m.title, start: ns, end: ne, allDay: m.allDay, location: m.location, notes: m.notes, rrule: null, exdates: [], recurrenceId: o.occ, alarms: (m.alarms || []).map((x) => Object.assign({}, x)), extra: [] });
    else {
      const s = m.recurrenceId ? findSeries(m) : m;
      if (s) { s.start = new Date(s.start.getTime() + (ns - o.start)); s.end = new Date(s.start.getTime() + (ne - ns)); }
    }
    await commit(c);
    render();
    OS.notify(ns.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + time(ns) + ' – ' + time(ne), {
      title: '“' + (o.title || 'Untitled') + '” ' + how,
      actions: [{ label: 'Undo', action: () => restore(c, before) }],
    });
  }

  /** Delete (one of a series asks which), with Undo in the notification. */
  async function remove(o) {
    const m = o.master;
    const c = m._cal;
    let scope = 'one';
    if (isSeriesEv(m)) scope = await askScope(o, 'Delete');
    if (!scope) return;
    const before = snap(c);
    if (!isSeriesEv(m)) c.cal.events = c.cal.events.filter((x) => x !== m);
    else if (scope === 'all') c.cal.events = c.cal.events.filter((x) => x.uid !== m.uid);
    else if (m.recurrenceId) {
      c.cal.events = c.cal.events.filter((x) => x !== m);
      const s = findSeries(m);
      if (s) s.exdates = (s.exdates || []).concat([m.recurrenceId]);
    } else m.exdates = (m.exdates || []).concat([o.occ]);
    await commit(c);
    render();
    OS.notify('“' + (o.title || 'Untitled') + '” was deleted' + (isSeriesEv(m) && scope === 'one' ? ' on ' + o.occ.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }) : '') + '.', {
      title: scope === 'all' && isSeriesEv(m) ? 'Repeating event deleted' : 'Event deleted',
      actions: [{ label: 'Undo', action: () => restore(c, before) }],
    });
  }

  /** "Just this one" or "The whole series" -> 'one' | 'all' | null (cancelled). */
  function askScope(o, verb) {
    return new Promise((resolve) => {
      const m = o.master;
      const s = m.recurrenceId ? findSeries(m) : m;
      const wrap = document.createElement('div');
      wrap.className = 'ed-wrap';
      wrap.innerHTML = '<div class="ed ed-small" role="dialog" aria-modal="true" aria-labelledby="scopeT"><h2 class="ed-h" id="scopeT">' + esc(verb) + ' a repeating event</h2>' +
        '<p class="ed-sub">“' + esc(o.title || 'Untitled') + '” repeats ' + esc(((t) => t.charAt(0).toLowerCase() + t.slice(1))(describeRule(s && s.rrule, (s || m).start))) + '.</p>' +
        '<label class="ed-radio"><input type="radio" name="scope" value="one" checked><span>Just this one (' + esc(o.occ.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' })) + ')</span></label>' +
        '<label class="ed-radio"><input type="radio" name="scope" value="all"><span>The whole series</span></label>' +
        '<div class="ed-actions"><span class="spacer"></span><button type="button" class="btn ed-cancel">Cancel</button><button type="button" class="btn btn-primary ed-ok">OK</button></div></div>';
      document.body.appendChild(wrap);
      const done = (v) => { wrap.remove(); resolve(v); };
      $('.ed-cancel', wrap).addEventListener('click', () => done(null));
      $('.ed-ok', wrap).addEventListener('click', () => done($('input[name=scope]:checked', wrap).value));
      wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } if (e.key === 'Enter') { e.preventDefault(); done($('input[name=scope]:checked', wrap).value); } });
      wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) done(null); });
      setTimeout(() => $('.ed-ok', wrap).focus(), 0);
    });
  }

  /*
  |--------------------------------------------------------------------------
  | Repeats: the choices, their words, and a rule of one's own
  |--------------------------------------------------------------------------
  */
  const cloneRule = (r) => (r ? Object.assign({}, r, { byday: (r.byday || []).slice() }) : null);
  /** What makes two rules the same (the written text of one read from a file doesn't count). */
  const ruleKey = (r) => (r ? [r.freq, r.interval || 1, (r.byday || []).slice().sort().join(','), r.count || 0, r.until ? r.until.getTime() : 0] : null);
  const rule = (freq, extra) => Object.assign({ freq, interval: 1, byday: [], count: 0, until: null, edited: true }, extra || {});
  const weekdayName = (i, style) => new Date(2024, 0, 7 + i).toLocaleDateString(lang, { weekday: style || 'long' });
  function repeatChoices(d) {
    return [
      { label: 'Doesn’t repeat', rule: null },
      { label: 'Every day', rule: rule('DAILY') },
      { label: 'Weekly on ' + weekdayName(d.getDay()), rule: rule('WEEKLY', { byday: [d.getDay()] }) },
      { label: 'Every weekday (' + weekdayName(1, 'short') + ' to ' + weekdayName(5, 'short') + ')', rule: rule('WEEKLY', { byday: [1, 2, 3, 4, 5] }) },
      { label: 'Monthly on day ' + d.getDate(), rule: rule('MONTHLY') },
      { label: 'Yearly on ' + d.toLocaleDateString(lang, { month: 'long', day: 'numeric' }), rule: rule('YEARLY') },
    ];
  }
  /** A rule in words: "Weekly on Monday", "Every 2 weeks on Mon, Wed, until 18 Dec 2026". */
  function describeRule(r, d) {
    if (!r) return 'Doesn’t repeat';
    const n = r.interval || 1;
    const unit = { DAILY: ['day', 'days'], WEEKLY: ['week', 'weeks'], MONTHLY: ['month', 'months'], YEARLY: ['year', 'years'] }[r.freq];
    let s;
    const days = (r.byday && r.byday.length ? r.byday : [d.getDay()]).slice().sort((a, b) => ((a - firstDay() + 7) % 7) - ((b - firstDay() + 7) % 7));
    if (r.freq === 'WEEKLY' && n === 1 && days.join() === '1,2,3,4,5') s = 'Every weekday';
    else if (r.freq === 'WEEKLY') s = (n === 1 ? 'Weekly' : 'Every ' + n + ' weeks') + ' on ' + (days.length === 1 ? weekdayName(days[0]) : days.map((x) => weekdayName(x, 'short')).join(', '));
    else if (r.freq === 'MONTHLY') s = (n === 1 ? 'Monthly' : 'Every ' + n + ' months') + ' on day ' + d.getDate();
    else if (r.freq === 'YEARLY') s = (n === 1 ? 'Yearly' : 'Every ' + n + ' years') + ' on ' + d.toLocaleDateString(lang, { month: 'long', day: 'numeric' });
    else s = n === 1 ? 'Every day' : 'Every ' + n + ' ' + unit[1];
    if (r.count) s += ', ' + r.count + ' times';
    else if (r.until) s += ', until ' + r.until.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
    return s;
  }

  /** Custom: every N days, weeks, months or years; for weeks, which days; ending never, on a date, or after N times. -> rule | null | undefined (cancelled) */
  function customRepeat(cur, d) {
    return new Promise((resolve) => {
      const r = cloneRule(cur) || rule('WEEKLY', { byday: [d.getDay()] });
      if (!r.byday.length) r.byday = [d.getDay()];
      let ends = r.count ? 'count' : r.until ? 'until' : 'never';
      let until = r.until || addDays(d, 30);
      const units = [['DAILY', 'days'], ['WEEKLY', 'weeks'], ['MONTHLY', 'months'], ['YEARLY', 'years']];
      const wrap = document.createElement('div');
      wrap.className = 'ed-wrap ed-over';
      wrap.innerHTML = '<div class="ed ed-small" role="dialog" aria-modal="true" aria-labelledby="repT"><h2 class="ed-h" id="repT">Repeat</h2>' +
        '<div class="rp-line"><span class="rp-lbl">Every</span><input class="input rp-n" type="number" min="1" max="99" aria-label="How often"><button type="button" class="btn ed-pick rp-unit" aria-haspopup="menu" aria-label="Unit"></button></div>' +
        '<div class="rp-line rp-days"><span class="rp-lbl">On</span><span class="rp-wd" role="group" aria-label="Days of the week"></span></div>' +
        '<div class="rp-ends"><div class="rp-lbl">Ends</div>' +
          '<label class="ed-radio"><input type="radio" name="ends" value="never"><span>Never</span></label>' +
          '<label class="ed-radio"><input type="radio" name="ends" value="until"><span>On</span><button type="button" class="btn rp-until"></button></label>' +
          '<label class="ed-radio"><input type="radio" name="ends" value="count"><span>After</span><input class="input rp-count" type="number" min="1" max="999" aria-label="Times"><span>times</span></label></div>' +
        '<div class="ed-actions"><span class="spacer"></span><button type="button" class="btn ed-cancel">Cancel</button><button type="button" class="btn btn-primary ed-ok">Done</button></div></div>';
      document.body.appendChild(wrap);
      const $w = (s) => $(s, wrap);
      $w('.rp-n').value = r.interval || 1;
      $w('.rp-count').value = r.count || 10;
      const paint = () => {
        $w('.rp-unit').innerHTML = '<span>' + units.find((u) => u[0] === r.freq)[1] + '</span><span class="ed-caret">' + ico('down', 12) + '</span>';
        $w('.rp-days').hidden = r.freq !== 'WEEKLY';
        $w('.rp-wd').innerHTML = Array.from({ length: 7 }, (_, i) => (firstDay() + i) % 7).map((x) => '<button type="button" class="rp-day' + (r.byday.includes(x) ? ' on' : '') + '" data-d="' + x + '" aria-pressed="' + r.byday.includes(x) + '" title="' + esc(weekdayName(x)) + '">' + esc(weekdayName(x, 'narrow')) + '</button>').join('');
        $w('.rp-until').textContent = until.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        $$('input[name=ends]', wrap).forEach((x) => { x.checked = x.value === ends; });
      };
      paint();
      $w('.rp-unit').addEventListener('click', (e) => { const b = e.currentTarget.getBoundingClientRect(); OS.menu(units.map((u) => ({ label: u[1], checked: u[0] === r.freq, action: () => { r.freq = u[0]; paint(); } })), { x: b.left, y: b.bottom + 2 }); });
      $w('.rp-wd').addEventListener('click', (e) => {
        const b = e.target.closest('[data-d]');
        if (!b) return;
        const x = +b.dataset.d;
        r.byday = r.byday.includes(x) ? (r.byday.length > 1 ? r.byday.filter((y) => y !== x) : r.byday) : r.byday.concat([x]);
        paint();
      });
      $$('input[name=ends]', wrap).forEach((x) => x.addEventListener('change', () => { ends = x.value; }));
      $w('.rp-until').addEventListener('click', (e) => { e.preventDefault(); ends = 'until'; pickDate(e.currentTarget, until, (dd) => { until = dd; paint(); }); paint(); });
      $w('.rp-count').addEventListener('focus', () => { ends = 'count'; paint(); });
      const done = (v) => { closePicker(); wrap.remove(); resolve(v); };
      $w('.ed-cancel').addEventListener('click', () => done(undefined));
      $w('.ed-ok').addEventListener('click', () => {
        r.interval = Math.max(1, Math.min(99, parseInt($w('.rp-n').value, 10) || 1));
        r.count = ends === 'count' ? Math.max(1, Math.min(999, parseInt($w('.rp-count').value, 10) || 1)) : 0;
        r.until = ends === 'until' ? new Date(until.getFullYear(), until.getMonth(), until.getDate(), 23, 59, 59) : null;
        if (r.freq !== 'WEEKLY') r.byday = [];
        r.edited = true;
        delete r.raw;
        done(r);
      });
      wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (picker) closePicker(); else done(undefined); } });
      setTimeout(() => $w('.rp-n').focus(), 0);
    });
  }

  /*
  |--------------------------------------------------------------------------
  | Reminders: their words, the usual choices, a time of one's own
  |--------------------------------------------------------------------------
  */
  /** Minutes before -> words: "15 minutes before", "1 day before"; for an all-day event, a time on a day. */
  function alarmLabel(mm, allDay) {
    if (allDay) {
      if (mm === -540) return 'On the day at ' + time(new Date(2024, 0, 1, 9));
      if (mm === 900) return 'The day before at ' + time(new Date(2024, 0, 1, 9));
      if (mm === 9540) return '1 week before at ' + time(new Date(2024, 0, 1, 9));
    }
    if (mm === 0) return 'At the time';
    const after = mm < 0;
    let n = Math.abs(mm);
    const unit = n % 10080 === 0 ? [n / 10080, 'week'] : n % 1440 === 0 ? [n / 1440, 'day'] : n % 60 === 0 ? [n / 60, 'hour'] : [n, 'minute'];
    n = unit[0];
    return n + ' ' + unit[1] + (n === 1 ? '' : 's') + (after ? ' after' : ' before');
  }
  function alarmChoices(allDay) {
    const list = allDay ? [-540, 900, 9540] : [0, 5, 10, 15, 30, 60, 1440];
    return [[null, 'None']].concat(list.map((v) => [v, alarmLabel(v, allDay)]));
  }
  /** Custom: "45 minutes", "2 hours", "3 days", "1 week" (before). -> minutes or null */
  async function customAlarm(cur) {
    const v = await OS.dialog.prompt({ title: 'Custom reminder', label: 'How long before', value: cur != null && cur > 0 ? alarmLabel(cur, false).replace(/ before$/, '') : '45 minutes', okLabel: 'Done' });
    if (!v) return null;
    const m = String(v).trim().toLowerCase().match(/^(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?)?/);
    if (!m) { OS.notify('Try "45 minutes", "2 hours" or "3 days".', { type: 'error', title: 'That isn\u2019t a time' }); return null; }
    const n = +m[1];
    const u = (m[2] || 'm')[0];
    return Math.min(40320, n * ({ m: 1, h: 60, d: 1440, w: 10080 })[u]);
  }

  /*
  |--------------------------------------------------------------------------
  | Calendars: shown or hidden, added, renamed, recoloured, exported, deleted
  |--------------------------------------------------------------------------
  */
  const COLORS = [['#2F6FD6', 'Blue'], ['#0F9D77', 'Green'], ['#D97706', 'Orange'], ['#E3342F', 'Red'], ['#8B5CF6', 'Purple'], ['#DB2777', 'Pink'], ['#0891B2', 'Teal'], ['#8C929C', 'Grey']];
  $('#calList').addEventListener('click', (e) => {
    const t = e.target.closest('[data-cal-show], [data-cal-more], [data-cal-add]');
    if (!t) return;
    if (t.hasAttribute('data-cal-add')) { addCalendar(); return; }
    const c = st.cals.find((x) => x.path === t.dataset.calShow || x.path === t.dataset.calMore);
    if (!c) return;
    if (t.hasAttribute('data-cal-show')) {
      if (hidden.has(c.path)) hidden.delete(c.path); else hidden.add(c.path);
      keepHidden();
      render();
      return;
    }
    const r = t.getBoundingClientRect();
    OS.menu([
      { label: 'Rename…', icon: 'rename', action: () => renameCalendar(c) },
      { label: 'Colour', icon: 'palette', items: COLORS.map(([hex, name]) => ({ label: name, checked: c.cal.color.toUpperCase() === hex, action: async () => { c.cal.color = hex; await commit(c); render(); } })) },
      { label: 'Default reminder', icon: 'bell', items: alarmChoices(false).map(([v, label]) => ({ label, checked: (c.cal.defaultAlarm == null ? null : c.cal.defaultAlarm) === v, action: async () => { c.cal.defaultAlarm = v; await commit(c); } })) },
      { label: 'Export…', icon: 'download', action: () => exportCalendar(c) },
      'sep',
      { label: 'Delete calendar', icon: 'trash', disabled: st.cals.length < 2, action: () => deleteCalendar(c) },
    ], { x: r.left, y: r.bottom + 2 });
  });
  async function renameCalendar(c) {
    const name = await OS.dialog.prompt({ title: 'Rename calendar', label: 'Name', value: c.cal.name, okLabel: 'Rename' });
    if (!name || !name.trim()) return;
    c.cal.name = name.trim().slice(0, 100);
    await commit(c);
    render();
  }
  async function exportCalendar(c) {
    const path = await OS.dialog.save({ title: 'Export calendar', defaultName: c.cal.name, ext: 'ics', startIn: '/Documents' });
    if (!path) return;
    try { await OS.fs.write(/\.ics$/i.test(path) ? path : path + '.ics', ICS.stringify(c.cal)); OS.notify('Saved as ' + String(path).split('/').pop() + '.', { type: 'success', title: 'Calendar exported' }); } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t export' }); }
  }
  async function deleteCalendar(c) {
    const ok = await OS.dialog.confirm({ title: 'Delete “' + c.cal.name + '”?', message: 'Its ' + c.cal.events.length + (c.cal.events.length === 1 ? ' event goes' : ' events go') + ' to the Trash with it. You can restore it from there.', okLabel: 'Delete calendar', danger: true });
    if (!ok) return;
    try { if (!c.unsaved) await OS.fs.remove([c.path]); } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t delete' }); return; }
    st.cals = st.cals.filter((x) => x !== c);
    hidden.delete(c.path); keepHidden();
    render();
  }
  /** A new calendar: a name and a colour; it becomes /Calendar/<name>.ics (with a number when that is taken). */
  function addCalendar() {
    const wrap = document.createElement('div');
    wrap.className = 'ed-wrap';
    let color = COLORS[(st.cals.length) % COLORS.length][0];
    wrap.innerHTML = '<div class="ed ed-small" role="dialog" aria-modal="true" aria-labelledby="ncT"><h2 class="ed-h" id="ncT">New calendar</h2>' +
      '<input class="input nc-name" type="text" placeholder="Name" aria-label="Name" maxlength="100">' +
      '<div class="nc-colors" role="group" aria-label="Colour"></div><p class="ed-err" role="alert" hidden></p>' +
      '<div class="ed-actions"><span class="spacer"></span><button type="button" class="btn ed-cancel">Cancel</button><button type="button" class="btn btn-primary ed-ok">Add</button></div></div>';
    document.body.appendChild(wrap);
    const paint = () => { $('.nc-colors', wrap).innerHTML = COLORS.map(([hex, name]) => '<button type="button" class="nc-c' + (hex === color ? ' on' : '') + '" data-c="' + hex + '" style="background:' + hex + '" aria-label="' + name + '" aria-pressed="' + (hex === color) + '"></button>').join(''); };
    paint();
    $('.nc-colors', wrap).addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { color = b.dataset.c; paint(); } });
    const close = () => wrap.remove();
    const add = async () => {
      const name = $('.nc-name', wrap).value.trim().slice(0, 100);
      const p = $('.ed-err', wrap);
      if (!name) { p.textContent = 'Give it a name.'; p.hidden = false; return; }
      const base = name.replace(/[\\/<>:"|?*]+/g, ' ').trim() || 'Calendar';
      let path = DIR + '/' + base + '.ics';
      for (let i = 2; st.cals.some((x) => x.path.toLowerCase() === path.toLowerCase()); i++) path = DIR + '/' + base + ' ' + i + '.ics';
      const c = { path, cal: { name, color, events: [], head: [], tail: [] } };
      try { await save(c); } catch (e) { p.textContent = e.message || 'It couldn’t be made.'; p.hidden = false; return; }
      st.cals.push(c);
      close();
      render();
    };
    $('.ed-cancel', wrap).addEventListener('click', close);
    $('.ed-ok', wrap).addEventListener('click', add);
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } if (e.key === 'Enter') { e.preventDefault(); add(); } });
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
    setTimeout(() => $('.nc-name', wrap).focus(), 0);
  }

  /** "9:30", "14:00", "2pm", "2:15 pm", "930" -> minutes after midnight, or null. */
  function parseTime(s) {
    const m = String(s).trim().toLowerCase().replace(/\./g, '').match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/);
    if (!m) return null;
    let h = +m[1];
    const mi = m[2] ? +m[2] : 0;
    if (m[3]) { if (h === 12) h = 0; if (m[3][0] === 'p') h += 12; }
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  /*
  |--------------------------------------------------------------------------
  | The pickers: a month for a date, half hours for a time
  |--------------------------------------------------------------------------
  */
  let picker = null;
  function closePicker() { if (picker) { picker.el.remove(); picker = null; } }
  function placePicker(el, anchor) {
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, r.left)) + 'px';
    el.style.top = (r.bottom + 4 + h > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  }
  function pickDate(anchor, value, done) {
    if (picker && picker.anchor === anchor) { closePicker(); return; }
    closePicker();
    let m = new Date(value.getFullYear(), value.getMonth(), 1);
    const el = document.createElement('div');
    el.className = 'pick pick-date';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Pick a date');
    const draw = () => {
      const start = weekStart(m);
      let h = '<div class="mini-head"><b>' + esc(m.toLocaleDateString(lang, { month: 'long', year: 'numeric' })) + '</b><span class="spacer"></span>' +
        '<button type="button" class="icon-btn" data-m="-1" aria-label="Previous month">' + ico('chevUp', 14) + '</button><button type="button" class="icon-btn" data-m="1" aria-label="Next month">' + ico('down', 14) + '</button></div><div class="mini-grid">';
      for (let i = 0; i < 7; i++) h += '<span class="mini-wd">' + esc(addDays(start, i).toLocaleDateString(lang, { weekday: 'narrow' })) + '</span>';
      for (let i = 0; i < 42; i++) {
        const d = addDays(start, i);
        h += '<button type="button" class="mini-d' + (d.getMonth() !== m.getMonth() ? ' out' : '') + (sameDay(d, new Date()) ? ' today' : '') + (sameDay(d, value) ? ' inview' : '') + '" data-day="' + key(d) + '">' + d.getDate() + '</button>';
      }
      el.innerHTML = h + '</div>';
    };
    draw();
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (b) { m = new Date(m.getFullYear(), m.getMonth() + +b.dataset.m, 1); draw(); return; }
      const d = e.target.closest('[data-day]');
      if (d) { done(fromKey(d.dataset.day)); closePicker(); }
    });
    placePicker(el, anchor);
    picker = { el, anchor };
  }
  /** Which calendar: each with its colour square, the current one shown by its background. */
  function pickCal(anchor, cur, done) {
    if (picker && picker.anchor === anchor) { closePicker(); return; }
    closePicker();
    const el = document.createElement('div');
    el.className = 'pick pick-cal';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Calendar');
    el.innerHTML = st.cals.map((c, i) => '<button type="button" role="option" class="pick-c' + (c === cur ? ' on' : '') + '" aria-selected="' + (c === cur) + '" data-i="' + i + '"><span class="cal-dot" style="background:' + esc(c.cal.color) + '"></span><span>' + esc(c.cal.name) + '</span></button>').join('');
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { done(st.cals[+b.dataset.i]); closePicker(); } });
    placePicker(el, anchor);
    el.style.minWidth = anchor.getBoundingClientRect().width + 'px';
    picker = { el, anchor };
  }
  function pickTime(input, value, done) {
    if (picker && picker.anchor === input) return;
    closePicker();
    const el = document.createElement('div');
    el.className = 'pick pick-time';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Times');
    const cur = mins(value);
    let h = '';
    for (let m = 0; m < 1440; m += 30) h += '<button type="button" role="option" class="pick-t' + (Math.abs(m - cur) < 15 ? ' on' : '') + '" data-min="' + m + '">' + esc(time(atMin(value, m))) + '</button>';
    el.innerHTML = h;
    /** The input keeps focus while a time is picked. */
    el.addEventListener('pointerdown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-min]'); if (b) { done(+b.dataset.min); closePicker(); } });
    placePicker(el, input);
    const on = $('.pick-t.on', el) || el.children[Math.floor(cur / 30)];
    if (on) el.scrollTop = on.offsetTop - el.clientHeight / 2 + on.offsetHeight / 2;
    picker = { el, anchor: input };
    input.addEventListener('blur', () => setTimeout(() => { if (picker && picker.anchor === input) closePicker(); }, 120), { once: true });
  }
  document.addEventListener('pointerdown', (e) => { if (picker && !picker.el.contains(e.target) && e.target !== picker.anchor && !picker.anchor.contains(e.target)) closePicker(); }, true);

  /*
  |--------------------------------------------------------------------------
  | Keys, the date it was opened with, and starting
  |--------------------------------------------------------------------------
  */
  document.addEventListener('keydown', (e) => {
    if ($('.ed-wrap') || e.target.closest('input, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newEvent(st.cursor); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === 't') { st.cursor = day0(new Date()); st.mini = null; render(); }
    else if (e.key === 'PageUp') { e.preventDefault(); go(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); go(1); }
    else if (e.key === 'd') setView('day');
    else if (e.key === 'w') setView('week');
    else if (e.key === 'm') setView('month');
  });

  /** Opened with a date (the calendar flyout, an event in it): that day. */
  function openDate(args) {
    if (!args || !args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) return false;
    st.cursor = fromKey(args.date);
    st.mini = null;
    st.view = 'day';
    return true;
  }
  OS.win.onArgs((args) => { if (openDate(args)) { load(); } });
  openDate(OS.args);
  /** The line at the time now moves on with the clock; settings (the 24-hour clock) redraw the view. */
  setInterval(() => { if (st.view !== 'month' && !drag && !$('.ed-wrap')) { const n = $('.wk-now'); if (n) n.style.top = (mins(new Date()) * HOUR / 60) + 'px'; } }, 60000);
  OS.onSettings(() => render());
  render();
  load();
});
