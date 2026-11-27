/*
 * LiteOS Clock: timers, alarms, a stopwatch and world clocks.
 *
 * What it keeps is on the drive under /.apps/clock/ (alarms.json, timers.json, stopwatch.json, clocks.json). Alarms
 * and timers ring from the shell's reminders service (assets/js/reminders.js), which reads alarms.json and
 * timers.json, so they ring with this window closed, while LiteOS is open. Clock tells it about each change over the
 * BroadcastChannel "liteos.clock". Times are kept as moments (ms), so a running timer or stopwatch carries on while
 * Clock is closed.
 */
LiteOS.ready((OS) => {
  'use strict';

  const U = OS.util;
  const esc = U.escape;
  const $ = (s, el) => (el || document).querySelector(s);
  const DIR = '/.apps/clock';
  const FILES = { alarms: DIR + '/alarms.json', timers: DIR + '/timers.json', stopwatch: DIR + '/stopwatch.json', clocks: DIR + '/clocks.json' };
  const lang = navigator.language || undefined;
  // Mica: inside the desktop with Transparency effects on, the window is frosted glass and the page lets it through
  if (OS.inShell) document.documentElement.classList.add('in-shell');

  // ------------------------------------------------------------------ glyphs (in-app icons, LiteOS's line style)
  const P = window.LOS_ICON_PATHS || {};
  Object.assign(P, {
    'ck-timers': 'M7 3h10 M7 21h10 M8 3v3.5a4 4 0 0 0 1.6 3.2L12 12l-2.4 2.3A4 4 0 0 0 8 17.5V21 M16 3v3.5a4 4 0 0 1-1.6 3.2L12 12l2.4 2.3a4 4 0 0 1 1.6 3.2V21',
    'ck-alarms': 'M12 7v5l2.5 2 M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z M4 5.5L6.5 3 M20 5.5L17.5 3 M7 19.5L5.5 21 M17 19.5l1.5 1.5',
    'ck-stopwatch': 'M12 6.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z M12 14l3-3 M10 2.5h4 M12 2.5v4 M18.5 6l1.5-1.5',
    'ck-world': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9 M12 3C9.5 5.7 8.2 8.7 8.2 12s1.3 6.3 3.8 9',
    'ck-play': 'M8 5.5v13l10.5-6.5z',
    'ck-pause': 'M8.5 5.5v13 M15.5 5.5v13',
    'ck-restart': P.reload || 'M20 12a8 8 0 1 1-2.3-5.7 M20 4v4h-4',
    'ck-edit': P.rename || 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
    'ck-sound': 'M4 9.5h4L13 5v14l-5-4.5H4z M16.5 9a4 4 0 0 1 0 6',
    'ck-sun': P.sun || 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
    'ck-moon': P.moon || 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
    'ck-plus': P.plus || 'M12 5v14 M5 12h14',
    'ck-flag': 'M6 21V4 M6 4.5h11l-2.5 4 2.5 4H6',
    'ck-reset': 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3 M4.5 4v4h4',
    'ck-expand': 'M14 4h6v6 M20 4l-6.5 6.5 M10 20H4v-6 M4 20l6.5-6.5',
    'ck-collapse': 'M20 4l-6 6 M14 5v5h5 M4 20l6-6 M10 19v-5H5',
    'ck-copy': P.copy || 'M9 9h11v11H9z M5 15H4V4h11v1',
  });
  document.querySelectorAll('[data-ico]').forEach((el) => { el.outerHTML = OS.icon('ck-' + el.dataset.ico, 18); });

  // its own title bar (chrome: custom), as Windows' Clock: the name over the navigation pane, the page running up to
  // the top of the window under the window buttons; both top strips move the window
  (function titleBar() {
    const img = OS.sysIcon ? OS.sysIcon('app.clock') : null;
    $('#tbIcon').innerHTML = img ? '<img src="' + U.escape(img) + '" alt="" draggable="false" width="16" height="16">' : OS.icon('ck-alarms', 16);
    $('#tbRight').style.right = (OS.win.controlsWidth || 0) + 'px';
    OS.win.dragRegion($('#tbLeft'));
    OS.win.dragRegion($('#tbRight'));
  })();

  // ------------------------------------------------------------------ the drive
  let channel = null;
  try { channel = new BroadcastChannel('liteos.clock'); } catch (e) { /* the shell's five-minute reload catches up */ }
  const tellShell = (msg) => { if (channel) channel.postMessage(msg); };

  async function readJson(path, fallback) {
    try {
      const r = await OS.fs.read(path, { track: false });
      return JSON.parse(String(r.content || ''));
    } catch (e) { return fallback; }
  }
  let writing = Promise.resolve();
  function writeJson(path, value) {
    const text = JSON.stringify(value, null, 1);
    writing = writing.then(async () => {
      try { await OS.fs.write(path, text); } catch (e) {
        try { await OS.fs.mkdir('/.apps'); } catch (e2) { /* there */ }
        try { await OS.fs.mkdir(DIR); } catch (e2) { /* there */ }
        try { await OS.fs.write(path, text); } catch (e3) { OS.notify('Clock couldn’t save its ' + U.basename(path).replace('.json', '') + '.', 'error'); }
      }
      if (path === FILES.alarms || path === FILES.timers) tellShell({ type: 'changed' });
    });
    return writing;
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ------------------------------------------------------------------ formatting
  const hour12 = (() => { try { const c = new Intl.DateTimeFormat(lang, { hour: 'numeric' }).resolvedOptions(); return c.hour12 != null ? c.hour12 : /h1[12]/.test(c.hourCycle); } catch (e) { return false; } })();
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  /** A clock time (hours and minutes) in the language's style; "07:30" style strings or a Date. */
  function clockText(h, m, zone) {
    const d = h instanceof Date ? h : new Date(2000, 0, 1, h, m);
    return d.toLocaleTimeString(lang, Object.assign({ hour: 'numeric', minute: '2-digit' }, zone ? { timeZone: zone } : {}));
  }
  /** h:mm:ss for timers (hours shown only when there are some). */
  function duration(ms, showHours) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return (h || showHours ? pad(h) + ':' : '') + pad(m) + ':' + pad(s % 60);
  }
  /** hh:mm:ss.cc for the stopwatch. */
  function swText(ms) {
    const cs = Math.floor(ms / 10);
    const s = Math.floor(cs / 100);
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60) + '.' + pad(cs % 100);
  }
  /** A timer's length in words, for its name when it's given none: "1 hour 30 minutes", "45 seconds". */
  function lengthName(ms) {
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return [h && h + (h === 1 ? ' hour' : ' hours'), m && m + (m === 1 ? ' minute' : ' minutes'), sec && sec + (sec === 1 ? ' second' : ' seconds')].filter(Boolean).join(' ');
  }
  function inWords(ms) {
    const mins = Math.max(1, Math.round(ms / 60000));
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    const parts = [];
    if (d) parts.push(d + (d === 1 ? ' day' : ' days'));
    if (h) parts.push(h + (h === 1 ? ' hour' : ' hours'));
    if (m && !d) parts.push(m + (m === 1 ? ' minute' : ' minutes'));
    return parts.join(' ');
  }
  // the week as the language starts it
  const firstDay = (() => { const w = OS.settings.weekStart; if (w === 'sunday') return 0; if (w === 'monday') return 1; if (w === 'saturday') return 6; try { const l = new Intl.Locale(lang || 'en'); const i = (l.getWeekInfo && l.getWeekInfo()) || l.weekInfo; return i ? i.firstDay % 7 : 1; } catch (e) { return 1; } })();
  const weekOrder = Array.from({ length: 7 }, (_, i) => (firstDay + i) % 7);
  const dayName = (d, style) => new Date(2024, 0, 7 + d).toLocaleDateString(lang, { weekday: style || 'short' });

  // ------------------------------------------------------------------ state
  const data = { alarms: [], timers: [], stopwatch: { running: false, startedAt: 0, elapsed: 0, laps: [] }, clocks: [] };
  let view = 'timers';

  async function load() {
    const [alarms, timers, stopwatch, clocks] = await Promise.all([
      readJson(FILES.alarms, null), readJson(FILES.timers, null), readJson(FILES.stopwatch, null), readJson(FILES.clocks, null),
    ]);
    data.alarms = Array.isArray(alarms) ? alarms : [{ id: uid(), time: '07:00', name: 'Good morning', days: [1, 2, 3, 4, 5], sound: 'chimes', snooze: 10, on: false }];
    data.timers = Array.isArray(timers) ? timers : [1, 3, 5].map((m) => ({ id: uid(), name: m + (m === 1 ? ' minute' : ' minutes'), ms: m * 60000, state: 'idle' }));
    if (stopwatch && typeof stopwatch === 'object') data.stopwatch = Object.assign(data.stopwatch, stopwatch);
    data.clocks = Array.isArray(clocks) ? clocks : [];
  }
  const save = (what) => writeJson(FILES[what], data[what]);

  // ------------------------------------------------------------------ views
  const main = $('#main');
  const nav = $('#nav');
  const TITLES = { timers: 'Timer', alarms: 'Alarm', stopwatch: 'Stopwatch', world: 'World clock' };

  function show(v) {
    if (view !== v) { editing = false; setSwFull(false); }
    view = v;
    nav.querySelectorAll('[data-view]').forEach((b) => { const on = b.dataset.view === v; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    render();
  }
  nav.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) show(b.dataset.view); });
  nav.querySelectorAll('[data-view]').forEach((b) => { b.title = b.textContent.trim(); });

  /** No page titles (as Windows' Clock): only a note where a page needs one. */
  function head(title, sub) {
    return sub ? '<div class="ck-sub">' + esc(sub) + '</div>' : '';
  }
  // the management buttons, as Windows' Clock has them: a small bar at the bottom right. The pencil shows each
  // row's edit and delete buttons; + adds.
  const tools = $('#tools');
  let editing = false;
  const ADD = { timers: ['add-timer', 'Add timer'], alarms: ['add-alarm', 'Add alarm'], world: ['add-city', 'Add city'] };
  function renderTools() {
    const add = ADD[view];
    tools.hidden = !add;
    main.classList.toggle('editing', !!add && editing);
    if (!add) { tools.innerHTML = ''; return; }
    tools.innerHTML = '<button type="button" class="icon-btn' + (editing ? ' active' : '') + '" data-act="edit-mode" aria-pressed="' + editing + '" title="' + (editing ? 'Done' : 'Edit') + '" aria-label="' + (editing ? 'Done editing' : 'Edit') + '">' + OS.icon(editing ? 'check' : 'ck-edit', 17) + '</button>' +
      '<button type="button" class="icon-btn" data-act="' + add[0] + '" title="' + add[1] + '" aria-label="' + add[1] + '">' + OS.icon('ck-plus', 18) + '</button>';
  }
  tools.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'edit-mode') { editing = !editing; renderTools(); return; }
    // the same actions as in the page
    main.dispatchEvent(new CustomEvent('ck-act', { detail: b.dataset.act }));
  });

  function render() {
    renderTools();
    if (view === 'timers') renderTimers();
    else if (view === 'alarms') renderAlarms();
    else if (view === 'stopwatch') renderStopwatch();
    else renderWorld();
    update();
  }

  // ------------------------------------------------------------------ timers
  const timerLeft = (t) => (t.state === 'running' ? t.endsAt - Date.now() : t.state === 'paused' ? t.left : t.ms);
  const timerDone = (t) => t.state === 'running' && t.endsAt <= Date.now();

  function renderTimers() {
    main.innerHTML = head('Timer') +
      '<div class="ck-list" role="list">' + (data.timers.length ? data.timers.map((t) =>
        '<div class="ck-row timer" role="listitem" data-id="' + t.id + '">' +
        '<div class="ck-row-main"><div class="ck-name">' + esc(t.name || 'Timer') + '</div>' +
        '<div class="ck-big" data-left></div><div class="ck-bar"><i data-bar></i></div><div class="ck-note" data-note></div></div>' +
        '<div class="ck-acts">' +
        '<button type="button" class="icon-btn ck-play" data-act="timer-go"></button>' +
        '<button type="button" class="icon-btn" data-act="timer-reset" title="Reset" aria-label="Reset">' + OS.icon('ck-restart', 17) + '</button>' +
        '<button type="button" class="icon-btn edit-only" data-act="timer-edit" title="Edit" aria-label="Edit">' + OS.icon('ck-edit', 17) + '</button>' +
        '<button type="button" class="icon-btn danger edit-only" data-act="timer-del" title="Delete" aria-label="Delete">' + OS.icon('trash', 17) + '</button>' +
        '</div></div>').join('') : '<div class="ck-empty">No timers. Add one to start counting down.</div>') + '</div>';
  }
  function updateTimers() {
    data.timers.forEach((t) => {
      const row = main.querySelector('.ck-row.timer[data-id="' + t.id + '"]');
      if (!row) return;
      const done = timerDone(t);
      const left = done ? 0 : timerLeft(t);
      row.querySelector('[data-left]').textContent = duration(left, t.ms >= 3600000);
      row.querySelector('[data-bar]').style.width = (t.ms ? (100 * Math.max(0, left)) / t.ms : 0) + '%';
      row.querySelector('[data-note]').textContent = done ? 'Finished' : t.state === 'running' ? 'Ends at ' + clockText(new Date(t.endsAt)) : t.state === 'paused' ? 'Paused' : '';
      row.classList.toggle('on', t.state === 'running' && !done);
      const go = row.querySelector('[data-act="timer-go"]');
      const playing = t.state === 'running' && !done;
      const label = playing ? 'Pause' : done ? 'Start again' : 'Start';
      if (go.dataset.state !== label) { go.dataset.state = label; go.innerHTML = OS.icon(playing ? 'ck-pause' : 'ck-play', 17); go.title = label; go.setAttribute('aria-label', label); }
    });
  }
  function timerGo(t) {
    const now = Date.now();
    if (timerDone(t)) { tellShell({ type: 'stop', id: 'timer:' + t.id }); t.state = 'running'; t.endsAt = now + t.ms; }
    else if (t.state === 'running') { t.state = 'paused'; t.left = Math.max(0, t.endsAt - now); delete t.endsAt; }
    else { t.endsAt = now + (t.state === 'paused' ? t.left : t.ms); t.state = 'running'; delete t.left; }
    save('timers');
    update();
  }
  function timerReset(t) {
    if (timerDone(t)) tellShell({ type: 'stop', id: 'timer:' + t.id });
    t.state = 'idle'; delete t.endsAt; delete t.left;
    save('timers');
    update();
  }

  // ------------------------------------------------------------------ alarms
  /** When an alarm rings next (ms), or null when it's off. */
  function nextRing(a, from) {
    if (!a.on) return null;
    const now = from || Date.now();
    if (!a.days || !a.days.length) return a.at && a.at > now ? a.at : null;
    const [h, m] = a.time.split(':').map(Number);
    const d = new Date(now);
    for (let i = 0; i < 8; i++) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, h, m).getTime();
      if (t > now && a.days.includes(new Date(t).getDay())) return t;
    }
    return null;
  }
  /** A once alarm's moment: the next time its clock time comes round. */
  function onceAt(time) {
    const [h, m] = time.split(':').map(Number);
    const n = new Date();
    let t = new Date(n.getFullYear(), n.getMonth(), n.getDate(), h, m).getTime();
    if (t <= Date.now()) t += 86400000;
    return t;
  }
  function repeatText(days) {
    if (!days || !days.length) return 'Once';
    const set = new Set(days);
    if (set.size === 7) return 'Every day';
    if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Weekdays';
    if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
    return weekOrder.filter((d) => set.has(d)).map((d) => dayName(d)).join(', ');
  }
  function renderAlarms() {
    // a once alarm that has rung is off
    data.alarms.forEach((a) => { if (a.on && (!a.days || !a.days.length) && (!a.at || a.at <= Date.now())) a.on = false; });
    const sorted = data.alarms.slice().sort((x, y) => x.time.localeCompare(y.time));
    main.innerHTML = head('Alarm', 'Alarms ring while LiteOS is open in a browser, even with Clock closed.') +
      '<div class="ck-list" role="list">' + (sorted.length ? sorted.map((a) => {
        const [h, m] = a.time.split(':').map(Number);
        return '<div class="ck-row alarm' + (a.on ? ' on' : '') + '" role="listitem" data-id="' + a.id + '">' +
          '<button type="button" class="ck-row-main ck-open" data-act="alarm-edit" aria-label="Edit ' + esc(a.name || 'alarm') + '">' +
          '<div class="ck-big">' + esc(clockText(h, m)) + '</div>' +
          '<div class="ck-name">' + esc(a.name || 'Alarm') + '</div>' +
          '<div class="ck-note"><span>' + esc(repeatText(a.days)) + '</span><span data-next></span></div></button>' +
          '<div class="ck-acts">' +
          '<button type="button" class="switch" role="switch" aria-checked="' + !!a.on + '" data-act="alarm-toggle" aria-label="' + (a.on ? 'Turn off ' : 'Turn on ') + esc(a.name || 'alarm') + '"></button>' +
          '<button type="button" class="icon-btn danger edit-only" data-act="alarm-del" title="Delete" aria-label="Delete">' + OS.icon('trash', 17) + '</button>' +
          '</div></div>';
      }).join('') : '<div class="ck-empty">No alarms. Add one to be woken up or reminded.</div>') + '</div>';
  }
  function updateAlarms() {
    data.alarms.forEach((a) => {
      const el = main.querySelector('.ck-row.alarm[data-id="' + a.id + '"] [data-next]');
      if (!el) return;
      const t = nextRing(a);
      el.textContent = t ? 'Rings in ' + inWords(t - Date.now()) : '';
    });
  }
  function alarmToggle(a) {
    a.on = !a.on;
    if (a.on && (!a.days || !a.days.length)) a.at = onceAt(a.time);
    save('alarms');
    renderAlarms();
    updateAlarms();
  }

  // ------------------------------------------------------------------ stopwatch
  const sw = () => data.stopwatch;
  const swNow = () => sw().elapsed + (sw().running ? Date.now() - sw().startedAt : 0);
  // filled glyphs for the round start and pause button
  const PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8.5 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.7 4.5a.8.8 0 0 0-1.2.7z" fill="currentColor"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';
  const FLAG = '<svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><path d="M6.5 21V4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M6.5 4h12l-3 4.5 3 4.5h-12z" fill="currentColor"/></svg>';
  let swFull = false;
  function setSwFull(on) {
    swFull = !!on && view === 'stopwatch';
    document.body.classList.toggle('sw-full', swFull);
  }
  function renderStopwatch() {
    const s = sw();
    const t = swNow();
    const roundBtn = (act, label, html, cls, disabled) => '<button type="button" class="sw-btn ' + (cls || '') + '" data-act="' + act + '" title="' + label + '" aria-label="' + label + '"' + (disabled ? ' disabled' : '') + '>' + html + '</button>';
    main.innerHTML = '<div class="sw' + (s.laps.length ? ' has-laps' : '') + '">' +
      '<div class="sw-face">' +
      '<div class="sw-corner"><button type="button" class="icon-btn" data-act="sw-full" title="' + (swFull ? 'Back to normal size' : 'Expand') + '" aria-label="' + (swFull ? 'Back to normal size' : 'Expand') + '">' + OS.icon(swFull ? 'ck-collapse' : 'ck-expand', 17) + '</button></div>' +
      '<div class="sw-time" data-sw role="timer" aria-label="Stopwatch">' +
      '<span class="sw-g"><b data-g="h">00</b><i>hr</i></span><span class="sw-c">:</span>' +
      '<span class="sw-g"><b data-g="m">00</b><i>min</i></span><span class="sw-c">:</span>' +
      '<span class="sw-g"><b data-g="s">00</b><i>sec</i></span>' +
      '<span class="sw-g cs"><b><span class="sw-dot">.</span><span data-g="c">00</span></b><i>&nbsp;</i></span></div></div>' +
      '<div class="sw-btns">' +
      roundBtn('sw-go', s.running ? 'Pause' : 'Start', s.running ? PAUSE : PLAY, 'main') +
      roundBtn('sw-lap', 'Lap', FLAG, '', !s.running) +
      roundBtn('sw-reset', 'Reset', OS.icon('ck-reset', 20), '', !t) +
      '</div>' + lapsHtml() + '</div>';
  }
  function lapsHtml() {
    const laps = sw().laps;
    if (!laps.length) return '';
    const splits = laps.map((t, i) => t - (i ? laps[i - 1] : 0));
    const fast = splits.length > 1 ? splits.indexOf(Math.min(...splits)) : -1;
    const slow = splits.length > 1 ? splits.indexOf(Math.max(...splits)) : -1;
    return '<div class="laps" role="table" aria-label="Laps"><div class="lap head" role="row"><span role="columnheader">Laps</span><span role="columnheader">Time</span><span role="columnheader">Total ' +
      '<button type="button" class="icon-btn sw-copy" data-act="sw-copy" title="Copy laps" aria-label="Copy laps">' + OS.icon('ck-copy', 15) + '</button></span></div>' +
      laps.map((t, i) => i).reverse().map((i) => '<div class="lap" role="row"><span role="cell">' + (i + 1) +
        (i === fast ? '<em class="tag">Fastest</em>' : i === slow ? '<em class="tag">Slowest</em>' : '') + '</span><span role="cell">' + swText(splits[i]) + '</span><span role="cell">' + swText(laps[i]) + '</span></div>').join('') + '</div>';
  }
  function swGo() {
    const s = sw();
    if (s.running) { s.elapsed = swNow(); s.running = false; } else { s.startedAt = Date.now(); s.running = true; }
    save('stopwatch');
    renderStopwatch();
    update();
  }

  // ------------------------------------------------------------------ world clocks
  const zones = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch (e) { return ['UTC', 'Europe/London', 'Europe/Paris', 'Africa/Nairobi', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'America/New_York', 'America/Chicago', 'America/Los_Angeles']; } })();
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const cityOf = (z) => z.split('/').pop().replace(/_/g, ' ');
  const regionOf = (z) => z.includes('/') ? z.split('/')[0].replace(/_/g, ' ') : '';
  /** Minutes a zone is ahead of UTC at a moment. */
  function offsetOf(zone, t) {
    const d = new Date(t);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(d).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
    return Math.round((asUtc - (t - (t % 60000))) / 60000);
  }
  function relText(zone) {
    const now = Date.now();
    const diff = offsetOf(zone, now) - offsetOf(here, now);
    const day = new Date(now).toLocaleDateString('en-CA', { timeZone: zone });
    const today = new Date(now).toLocaleDateString('en-CA', { timeZone: here });
    const when = day === today ? 'Today' : day > today ? 'Tomorrow' : 'Yesterday';
    if (!diff) return when + ', same time';
    const h = Math.floor(Math.abs(diff) / 60);
    const m = Math.abs(diff) % 60;
    const amount = (h ? h + (h === 1 ? ' hour' : ' hours') : '') + (m ? (h ? ' ' : '') + m + ' min' : '');
    return when + ', ' + amount + (diff > 0 ? ' ahead' : ' behind');
  }
  // the map: land from world-data.js, the night side worked out from where the sun is, a pin for here and each city
  const W = window.CLOCK_WORLD || null;
  const mapW = 360 * (W ? W.k : 10);
  const mapH = W ? (W.top - W.bottom) * W.k : 1420;
  const project = (lat, lon) => [((lon + 180) / 360) * mapW, W ? ((W.top - lat) / (W.top - W.bottom)) * mapH : 0];
  const coordsOf = (zone) => (W && W.zones[zone]) || null;
  /** Where the sun is overhead at a moment: [latitude (its declination), longitude], to a fraction of a degree. */
  function subsolar(t) {
    const d = t / 86400000 - 10957.5; // days from J2000
    const rad = Math.PI / 180;
    const g = (357.529 + 0.98560028 * d) * rad;
    const q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
    const e = (23.439 - 0.00000036 * d) * rad;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad;
    const gmst = (18.697374558 + 24.06570982441908 * d) * 15;
    const lon = (((ra - gmst + 180) % 360) + 360) % 360 - 180;
    return [dec / rad, lon];
  }
  /** The night side as an SVG path: from the line where the sun sets to the pole in darkness. */
  function nightPath(t) {
    const [dec, sunLon] = subsolar(t);
    const rad = Math.PI / 180;
    const tanDec = Math.tan((Math.abs(dec) < 0.1 ? 0.1 : dec) * rad);
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 2) {
      const lat = Math.atan(-Math.cos((lon - sunLon) * rad) / tanDec) / rad;
      pts.push(project(lat, lon));
    }
    const edge = dec > 0 ? mapH + 200 : -200; // northern summer: the night is towards the south pole
    return 'M' + pts.map((p) => p[0].toFixed(0) + ' ' + p[1].toFixed(0)).join('L') + 'L' + (mapW + 100) + ' ' + edge + 'L-100 ' + edge + 'Z';
  }
  /** The sun's height above the horizon at a place (degrees): below zero is night. */
  function sunHeight(lat, lon, t) {
    const [dec, sunLon] = subsolar(t);
    const rad = Math.PI / 180;
    return Math.asin(Math.sin(lat * rad) * Math.sin(dec * rad) + Math.cos(lat * rad) * Math.cos(dec * rad) * Math.cos((lon - sunLon) * rad)) / rad;
  }
  const PIN = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 22s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12z" fill="currentColor"/><circle cx="12" cy="10" r="2.6" class="wm-hole"/></svg>';
  function pinHtml(zone, cls, label) {
    const c = coordsOf(zone);
    if (!c) return '';
    const [x, y] = project(c[0], c[1]);
    return '<div class="wm-pin ' + cls + '" style="left:' + (100 * x / mapW).toFixed(2) + '%;top:' + (100 * y / mapH).toFixed(2) + '%" data-pin="' + esc(zone) + '" title="' + esc(cityOf(zone)) + '">' +
      PIN + (label ? '<span class="wm-label"><b>' + esc(cityOf(zone)) + '</b><span data-pin-time></span></span>' : '') + '</div>';
  }
  function mapHtml() {
    if (!W) return '';
    return '<div class="wm" role="img" aria-label="World map, the night side shaded">' +
      '<svg class="wm-svg" viewBox="0 0 ' + mapW + ' ' + mapH + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<defs><filter id="wm-dusk" x="-5%" y="-10%" width="110%" height="120%"><feGaussianBlur stdDeviation="28"/></filter></defs>' +
      '<path class="wm-land" d="' + W.land + '"/>' +
      '<path class="wm-night" data-night filter="url(#wm-dusk)" d="' + nightPath(Date.now()) + '"/></svg>' +
      pinHtml(here, 'here', false) + data.clocks.map((c) => pinHtml(c.zone, 'city', true)).join('') + '</div>';
  }
  function cityRow(zone, isHere) {
    return '<div class="ck-row city' + (isHere ? ' here' : '') + '" role="listitem" data-zone="' + esc(zone) + '">' +
      '<span class="city-dn" data-dn></span>' +
      '<div class="ck-big city-time" data-time></div>' +
      '<div class="ck-row-main"><div class="ck-name">' + (isHere ? 'Local time' : esc(cityOf(zone)) + (regionOf(zone) ? ' <span class="ck-region">' + esc(regionOf(zone)) + '</span>' : '')) + '</div>' +
      '<div class="ck-note" data-rel></div></div>' +
      '<div class="city-date" data-date></div>' +
      (isHere ? '' : '<div class="ck-acts edit-only"><button type="button" class="icon-btn danger" data-act="city-del" title="Remove" aria-label="Remove ' + esc(cityOf(zone)) + '">' + OS.icon('trash', 17) + '</button></div>') +
      '</div>';
  }
  function renderWorld() {
    main.innerHTML = head('World clock') + mapHtml() +
      '<div class="ck-list" role="list">' + cityRow(here, true) + data.clocks.map((c) => cityRow(c.zone, false)).join('') + '</div>';
    lastNight = Date.now();
  }
  let lastNight = 0;
  function updateWorld() {
    const now = new Date();
    const t = now.getTime();
    main.querySelectorAll('.ck-row.city').forEach((row) => {
      const z = row.dataset.zone;
      const isHere = row.classList.contains('here');
      const time = row.querySelector('[data-time]');
      const txt = clockText(now, null, z);
      if (time.textContent !== txt) time.textContent = txt;
      row.querySelector('[data-rel]').textContent = isHere ? cityOf(z) : relText(z);
      row.querySelector('[data-date]').textContent = now.toLocaleDateString(lang, { timeZone: z, weekday: 'short', day: 'numeric', month: 'short' });
      // a sun by day, a moon by night: from where the sun is, or by the clock where the zone's place isn't known
      const c = coordsOf(z);
      const day = c ? sunHeight(c[0], c[1], t) > -0.8 : (() => { const h = +new Intl.DateTimeFormat('en-US', { timeZone: z, hour: 'numeric', hourCycle: 'h23' }).format(now); return h >= 6 && h < 18; })();
      const dn = row.querySelector('[data-dn]');
      if (dn.dataset.day !== String(day)) { dn.dataset.day = String(day); dn.innerHTML = OS.icon(day ? 'ck-sun' : 'ck-moon', 18); dn.title = day ? 'Daytime' : 'Night-time'; }
    });
    main.querySelectorAll('.wm-pin.city').forEach((pin) => {
      const el = pin.querySelector('[data-pin-time]');
      if (el) el.textContent = clockText(now, null, pin.dataset.pin);
    });
    // the night side moves a quarter of a degree a minute
    if (t - lastNight > 60000) {
      lastNight = t;
      const n = main.querySelector('[data-night]');
      if (n) n.setAttribute('d', nightPath(t));
    }
  }

  // ------------------------------------------------------------------ the ticking
  function update() {
    if (view === 'timers') updateTimers();
    else if (view === 'alarms') updateAlarms();
    else if (view === 'world') updateWorld();
    else if (view === 'stopwatch') {
      const el = main.querySelector('[data-sw]');
      if (!el) return;
      const [h, m, rest] = swText(swNow()).split(':');
      const [sec, cs] = rest.split('.');
      const g = { h, m, s: sec, c: cs };
      el.querySelectorAll('[data-g]').forEach((b) => { if (b.textContent !== g[b.dataset.g]) b.textContent = g[b.dataset.g]; });
    }
  }
  let raf = 0;
  let lastSecond = 0;
  function loop() {
    raf = 0;
    if (document.hidden) return;
    if (view === 'stopwatch' && sw().running) update();
    else if (Date.now() - lastSecond >= 250) { lastSecond = Date.now(); update(); }
    raf = requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !raf) raf = requestAnimationFrame(loop); });

  // ------------------------------------------------------------------ actions
  main.addEventListener('ck-act', (e) => act(e.detail, null));
  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) act(b.dataset.act, b);
  });
  async function act(act, b) {
    const row = b && b.closest('[data-id]');
    const t = row && data.timers.find((x) => x.id === row.dataset.id);
    const a = row && data.alarms.find((x) => x.id === row.dataset.id);
    if (act === 'add-timer') timerDialog(null);
    else if (act === 'timer-go' && t) timerGo(t);
    else if (act === 'timer-reset' && t) timerReset(t);
    else if (act === 'timer-edit' && t) timerDialog(t);
    else if (act === 'timer-del' && t) {
      if (!(await OS.dialog.confirm({ title: 'Delete “' + (t.name || 'Timer') + '”?', message: 'The timer is removed from Clock.', okLabel: 'Delete', danger: true }))) return;
      tellShell({ type: 'stop', id: 'timer:' + t.id });
      data.timers = data.timers.filter((x) => x !== t); save('timers'); renderTimers(); update();
    } else if (act === 'add-alarm') alarmDialog(null);
    else if (act === 'alarm-edit' && a) alarmDialog(a);
    else if (act === 'alarm-toggle' && a) alarmToggle(a);
    else if (act === 'alarm-del' && a) {
      if (!(await OS.dialog.confirm({ title: 'Delete “' + (a.name || 'Alarm') + '”?', message: 'It won’t ring again.', okLabel: 'Delete', danger: true }))) return;
      data.alarms = data.alarms.filter((x) => x !== a); save('alarms'); renderAlarms(); update();
    } else if (act === 'sw-go') swGo();
    else if (act === 'sw-lap') { sw().laps.push(swNow()); save('stopwatch'); renderStopwatch(); update(); }
    else if (act === 'sw-reset') { const run = sw().running; Object.assign(sw(), { running: run, startedAt: Date.now(), elapsed: 0, laps: [] }); save('stopwatch'); renderStopwatch(); update(); }
    else if (act === 'sw-full') { setSwFull(!swFull); renderStopwatch(); update(); }
    else if (act === 'sw-copy') {
      const laps = sw().laps;
      const text = laps.map((x, i) => 'Lap ' + (i + 1) + '\t' + swText(x - (i ? laps[i - 1] : 0)) + '\t' + swText(x)).join('\n');
      try { await navigator.clipboard.writeText(text); OS.notify('The laps are on the clipboard.', { title: 'Copied' }); } catch (err) { OS.notify('Couldn’t copy to the clipboard.', 'error'); }
    } else if (act === 'add-city') cityDialog();
    else if (act === 'city-del') { const z = b.closest('[data-zone]').dataset.zone; data.clocks = data.clocks.filter((c) => c.zone !== z); save('clocks'); renderWorld(); update(); }
  }

  // keyboard: Space starts and pauses the stopwatch, L laps, R resets, Escape leaves the expanded view
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && swFull && !(e.target.closest && e.target.closest('dialog'))) { setSwFull(false); renderStopwatch(); update(); return; }
    if (view !== 'stopwatch' || e.ctrlKey || e.altKey || e.metaKey || (e.target.closest && e.target.closest('input, dialog, .st-flyout'))) return;
    if (e.key === ' ' && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); swGo(); }
    else if (e.key === 'l' || e.key === 'L') { if (sw().running) { sw().laps.push(swNow()); save('stopwatch'); renderStopwatch(); update(); } }
    else if (e.key === 'r' || e.key === 'R') { if (!sw().running && swNow()) { Object.assign(sw(), { elapsed: 0, laps: [] }); save('stopwatch'); renderStopwatch(); update(); } }
  });

  // ------------------------------------------------------------------ dialogs
  /** An app dialog (docs/ui-dialogs.md): build(box) fills it; resolves with what done() is given, null on Cancel/Escape. */
  function dialog(cls, html, wire) {
    return new Promise((resolve) => {
      const box = document.createElement('dialog');
      box.className = 'dlg ' + (cls || '');
      box.innerHTML = html;
      document.body.appendChild(box);
      let closed = false;
      const done = (v) => { if (closed) return; closed = true; closeCombo(); box.close(); box.remove(); resolve(v); };
      box.addEventListener('cancel', (e) => { e.preventDefault(); if (!flyout) done(null); });
      box.querySelectorAll('[data-cancel]').forEach((c) => c.addEventListener('click', () => done(null)));
      wire(box, done);
      box.showModal();
      const first = box.querySelector('[autofocus]');
      if (first) first.focus();
    });
  }
  const num = (v, max) => Math.max(0, Math.min(max, parseInt(String(v).replace(/\D/g, '') || '0', 10)));
  function numField(name, label, value, max) {
    return '<label class="field ck-num"><span>' + label + '</span><input class="input" inputmode="numeric" maxlength="' + String(max).length + '" name="' + name + '" value="' + pad(value) + '" aria-label="' + label + '"></label>';
  }
  function wireNums(box) {
    box.querySelectorAll('.ck-num input').forEach((inp) => {
      inp.addEventListener('focus', () => inp.select());
      inp.addEventListener('input', () => { const v = inp.value.replace(/\D/g, ''); if (v !== inp.value) inp.value = v; });
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const max = Math.pow(10, +inp.maxLength) - 1;
        const lim = +inp.dataset.max || max;
        let v = num(inp.value, lim) + (e.key === 'ArrowUp' ? 1 : -1);
        if (v > lim) v = +inp.dataset.min || 0;
        if (v < (+inp.dataset.min || 0)) v = lim;
        inp.value = pad(v);
      });
    });
  }

  async function timerDialog(t) {
    const ms = t ? t.ms : 5 * 60000;
    const s = Math.round(ms / 1000);
    const r = await dialog('dlg-wide', '<form method="dialog"><h2 class="dlg-title">' + (t ? 'Edit timer' : 'Add timer') + '</h2><div class="dlg-body">' +
      '<div class="ck-nums">' + numField('h', 'Hours', Math.floor(s / 3600), 99) + '<span class="ck-colon">:</span>' + numField('m', 'Minutes', Math.floor((s % 3600) / 60), 59) +
      '<span class="ck-colon">:</span>' + numField('s', 'Seconds', s % 60, 59) + '</div>' +
      '<label class="field"><span>Name</span><input class="input" name="name" maxlength="60" value="' + esc(t ? t.name : '') + '" placeholder="Timer" autofocus></label>' +
      '<div class="ck-err" hidden></div></div>' +
      '<div class="dlg-actions"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn is-default">Save</button></div></form>', (box, done) => {
      box.querySelector('[name=m]').dataset.max = 59;
      box.querySelector('[name=s]').dataset.max = 59;
      wireNums(box);
      box.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const total = (num(f.get('h'), 99) * 3600 + num(f.get('m'), 59) * 60 + num(f.get('s'), 59)) * 1000;
        if (!total) { const er = box.querySelector('.ck-err'); er.textContent = 'Set a time longer than zero.'; er.hidden = false; return; }
        done({ ms: total, name: String(f.get('name') || '').trim() });
      });
    });
    if (!r) return;
    const name = r.name || lengthName(r.ms);
    if (t) {
      const changed = t.ms !== r.ms;
      t.name = name;
      if (changed) { t.ms = r.ms; t.state = 'idle'; delete t.endsAt; delete t.left; }
    } else data.timers.push({ id: uid(), name, ms: r.ms, state: 'idle' });
    save('timers');
    renderTimers();
    update();
  }

  const SNOOZES = [[5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [20, '20 minutes'], [30, '30 minutes']];
  async function alarmDialog(a) {
    const time = a ? a.time : (() => { const n = new Date(); return pad((n.getHours() + 1) % 24) + ':00'; })();
    let [h, m] = time.split(':').map(Number);
    const pm = h >= 12;
    const h12 = h % 12 || 12;
    const days = new Set(a ? a.days || [] : []);
    let sound = a ? a.sound || 'chimes' : 'chimes';
    let snooze = a ? a.snooze || 10 : 10;
    let ampm = pm ? 'pm' : 'am';
    let stopPreview = null;
    const sounds = (window.LOS_sounds && window.LOS_sounds.list) || [['chimes', 'Chimes']];
    const r = await dialog('dlg-wide', '<form method="dialog"><h2 class="dlg-title">' + (a ? 'Edit alarm' : 'Add alarm') + '</h2><div class="dlg-body">' +
      '<div class="ck-nums">' + numField('h', 'Hours', hour12 ? h12 : h, hour12 ? 12 : 23) + '<span class="ck-colon">:</span>' + numField('m', 'Minutes', m, 59) +
      (hour12 ? '<div class="field ck-ampm"><span>&nbsp;</span>' + comboHtml('ampm', [['am', 'AM'], ['pm', 'PM']], ampm, 'AM or PM') + '</div>' : '') + '</div>' +
      '<label class="field"><span>Name</span><input class="input" name="name" maxlength="60" value="' + esc(a ? a.name : '') + '" placeholder="Alarm" autofocus></label>' +
      '<div class="field"><span>Repeat</span><div class="ck-days" role="group" aria-label="Repeat on">' + weekOrder.map((d) =>
        '<button type="button" class="ck-day' + (days.has(d) ? ' on' : '') + '" data-day="' + d + '" aria-pressed="' + days.has(d) + '" title="' + esc(dayName(d, 'long')) + '">' + esc(dayName(d, 'narrow')) + '</button>').join('') +
      '</div><div class="hint" data-repeat></div></div>' +
      '<div class="ck-two"><div class="field"><span>Sound</span><div class="ck-sound">' + comboHtml('sound', sounds, sound, 'Sound') +
      '<button type="button" class="icon-btn" data-preview title="Play the sound" aria-label="Play the sound">' + OS.icon('ck-sound', 17) + '</button></div></div>' +
      '<div class="field"><span>Snooze for</span>' + comboHtml('snooze', SNOOZES, snooze, 'Snooze for') + '</div></div>' +
      '</div><div class="dlg-actions">' + (a ? '<button type="button" class="btn btn-danger-text" data-delete>Delete</button><span class="spacer"></span>' : '') +
      '<button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn is-default">Save</button></div></form>', (box, done) => {
      const hIn = box.querySelector('[name=h]');
      hIn.dataset.max = hour12 ? 12 : 23;
      if (hour12) hIn.dataset.min = 1;
      box.querySelector('[name=m]').dataset.max = 59;
      wireNums(box);
      const repeat = () => { box.querySelector('[data-repeat]').textContent = repeatText([...days]); };
      repeat();
      box.addEventListener('click', (e) => {
        const d = e.target.closest('[data-day]');
        if (d) { const n = +d.dataset.day; if (days.has(n)) days.delete(n); else days.add(n); d.classList.toggle('on', days.has(n)); d.setAttribute('aria-pressed', days.has(n)); repeat(); return; }
        const c = e.target.closest('.combo');
        if (c) { if (flyout && flyout.btn === c) closeCombo(); else openCombo(c, c.id === 'sound' ? sounds : c.id === 'snooze' ? SNOOZES : [['am', 'AM'], ['pm', 'PM']], (v) => { if (c.id === 'sound') sound = v; else if (c.id === 'snooze') snooze = +v; else ampm = v; }); return; }
        if (e.target.closest('[data-preview]')) {
          if (stopPreview) stopPreview();
          const s = OS.settings || {};
          stopPreview = window.LOS_sounds ? window.LOS_sounds.play(sound, { volume: s.muted ? 0 : (s.volume == null ? 80 : s.volume) / 100 }) : null;
          return;
        }
        if (e.target.closest('[data-delete]')) done({ delete: true });
      });
      box.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        let hh = num(f.get('h'), hour12 ? 12 : 23);
        const mm = num(f.get('m'), 59);
        if (hour12) { hh = hh % 12 + (ampm === 'pm' ? 12 : 0); }
        done({ time: pad(hh) + ':' + pad(mm), name: String(f.get('name') || '').trim() });
      });
    });
    if (stopPreview) stopPreview();
    if (!r) return;
    if (r.delete) {
      data.alarms = data.alarms.filter((x) => x !== a);
    } else {
      const item = a || { id: uid() };
      Object.assign(item, { time: r.time, name: r.name, days: [...days].sort(), sound, snooze, on: true });
      if (!item.days.length) item.at = onceAt(item.time); else delete item.at;
      if (!a) data.alarms.push(item);
      const t = nextRing(item);
      if (t) OS.notify('It rings in ' + inWords(t - Date.now()) + '.', { title: (item.name || 'Alarm') + ' is on' });
    }
    save('alarms');
    renderAlarms();
    update();
  }

  async function cityDialog() {
    const have = new Set(data.clocks.map((c) => c.zone));
    const z = await dialog('dlg-wide ck-city', '<h2 class="dlg-title">Add city</h2><div class="dlg-body">' +
      '<label class="search"><span data-s></span><input class="input" type="search" placeholder="Search for a city or region" aria-label="Search for a city or region" autofocus autocomplete="off"></label>' +
      '<div class="ck-zones" role="listbox" aria-label="Cities"></div></div>' +
      '<div class="dlg-actions"><button type="button" class="btn" data-cancel>Cancel</button></div>', (box, done) => {
      box.querySelector('[data-s]').outerHTML = OS.icon('search', 15);
      const list = box.querySelector('.ck-zones');
      const input = box.querySelector('input');
      const fill = () => {
        const q = input.value.trim().toLowerCase().replace(/\s+/g, '_');
        const found = zones.filter((x) => !have.has(x) && (!q || x.toLowerCase().includes(q))).slice(0, 60);
        list.innerHTML = found.length ? found.map((x, i) => '<button type="button" class="ck-zone' + (i === 0 ? ' on' : '') + '" role="option" data-zone="' + esc(x) + '">' +
          '<span>' + esc(cityOf(x)) + (regionOf(x) ? ' <span class="ck-region">' + esc(regionOf(x)) + '</span>' : '') + '</span><span class="ck-zone-time">' + esc(clockText(new Date(), null, x)) + '</span></button>').join('')
          : '<div class="ck-empty">' + (q && [...have].some((x) => x.toLowerCase().includes(q)) ? 'That place is already in your list' : 'No place matches “' + esc(input.value.trim()) + '”') + '</div>';
      };
      fill();
      input.addEventListener('input', fill);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const f = list.querySelector('.ck-zone'); if (f) done(f.dataset.zone); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); const f = list.querySelector('.ck-zone'); if (f) f.focus(); }
      });
      list.addEventListener('keydown', (e) => {
        const items = [...list.querySelectorAll('.ck-zone')];
        const at = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); if (items[at + 1]) items[at + 1].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (at > 0) items[at - 1].focus(); else input.focus(); }
      });
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-zone]'); if (b) done(b.dataset.zone); });
    });
    if (!z) return;
    data.clocks.push({ zone: z });
    save('clocks');
    renderWorld();
    update();
  }

  // ------------------------------------------------------------------ combo box (as Settings and Calculator)
  function comboHtml(id, opts, value, aria) {
    const cur = opts.find((o) => String(o[0]) === String(value)) || opts[0];
    return '<button type="button" class="combo" id="' + id + '" data-value="' + esc(cur[0]) + '" aria-haspopup="listbox" aria-expanded="false" aria-label="' + esc(aria) + '">' +
      '<span>' + esc(cur[1]) + '</span>' + OS.icon('down', 14) + '</button>';
  }
  let flyout = null;
  function openCombo(btn, opts, onPick) {
    closeCombo();
    let at = Math.max(0, opts.findIndex((o) => String(o[0]) === btn.dataset.value));
    const el = document.createElement('div');
    el.className = 'st-flyout';
    el.setAttribute('role', 'listbox');
    el.innerHTML = opts.map(([, l], i) => '<button type="button" class="st-opt' + (i === at ? ' on' : '') + '" role="option" data-i="' + i + '" aria-selected="' + (i === at) + '">' + esc(l) + '</button>').join('');
    // inside the dialog, so it stays above it and clickable
    (btn.closest('dialog') || document.body).appendChild(el);
    const r = btn.getBoundingClientRect();
    el.style.minWidth = r.width + 'px';
    const below = window.innerHeight - r.bottom - 12;
    const up = el.offsetHeight > below && r.top > below;
    el.style.maxHeight = Math.min(300, up ? r.top - 12 : below) + 'px';
    el.style.top = (up ? r.top - 4 - el.offsetHeight : r.bottom + 4) + 'px';
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    const pick = (i) => {
      closeCombo();
      btn.dataset.value = opts[i][0];
      btn.querySelector('span').textContent = opts[i][1];
      onPick(opts[i][0]);
      btn.focus();
    };
    const mark = (i) => { at = (i + opts.length) % opts.length; [...el.children].forEach((c, j) => { c.classList.toggle('on', j === at); c.setAttribute('aria-selected', j === at); }); el.children[at].focus(); };
    el.addEventListener('click', (e) => { const o = e.target.closest('.st-opt'); if (o) pick(+o.dataset.i); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); mark(at + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mark(at - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(at); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeCombo(); btn.focus(); }
    });
    flyout = { el, btn };
    el.children[at].focus();
  }
  function closeCombo() {
    if (!flyout) return;
    flyout.btn.setAttribute('aria-expanded', 'false');
    flyout.el.remove();
    flyout = null;
  }
  document.addEventListener('mousedown', (e) => { if (flyout && !flyout.el.contains(e.target) && e.target.closest('.combo') !== flyout.btn) closeCombo(); }, true);

  // ------------------------------------------------------------------ start
  OS.win.setTitle('Clock');
  OS.win.keepState(() => ({ view }));
  const restored = OS.win.restored;
  load().then(() => {
    show(restored && TITLES[restored.view] ? restored.view : (OS.args.view && TITLES[OS.args.view] ? OS.args.view : 'timers'));
    raf = requestAnimationFrame(loop);
  });
});
