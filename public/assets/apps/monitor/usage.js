/*
 * System Monitor › Usage: the signed-in user's own time in apps, files and websites (App\Support\Usage, recorded by
 * the desktop's assets/js/usage.js). Day: the total, a timeline of the day in five-minute steps coloured by the app in
 * front, then apps, files and websites. Week and Month: the total and the average a day, a stacked area chart (the top
 * three apps and the rest, smooth curves, each day's total over it), and the apps against the stretch before.
 * Administrators also pick whose usage they see: their own, everyone's (each account with its time, top app and top
 * site, and the apps and websites used most), or any one account's, in the same views that account sees.
 * Loaded before app.js, which calls window.SMUsage(OS, host) and draws it into its section.
 */
window.SMUsage = function (OS, host) {
  'use strict';

  const esc = (s) => OS.util.escape(s == null ? '' : s);
  const ico = (n, s) => OS.icon(n, s || 16);
  const PERIODS = [['day', 'Day', 1], ['week', 'Week', 7], ['month', 'Month', 30]];
  const DAY = 86400000;

  // who: 'me', 'everyone' (administrators), or another account's username (administrators)
  const st = { period: 'day', end: today(), who: 'me', whoName: '', users: null, data: null, before: null, loading: false, error: '', query: '', seq: 0 };
  const admin = () => !!(OS.user && OS.user.role === 'admin');

  function today() { const d = new Date(); d.setHours(12, 0, 0, 0); return d; }
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const span = () => PERIODS.find((p) => p[0] === st.period)[2];
  const startOf = (end) => addDays(end, 1 - span());
  const isToday = () => key(st.end) === key(today());

  /** "5 h 12 min", "58 min", "40 s". */
  function dur(s) {
    s = Math.round(s || 0);
    if (s < 60) return s < 1 ? 'Under 1 s' : s + ' s';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + pad(m % 60) + ' min';
  }
  const durShort = (s) => { const m = Math.round((s || 0) / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad(m % 60); };
  const appOf = (id) => window.LOS_app(id) || { id, name: id, c: ['#8C929C', '#8C929C'] };
  const colour = (id) => { const a = appOf(id); return (a.c && (a.c[1] || a.c[0])) || '#8C929C'; };
  const matches = (s) => !st.query || String(s || '').toLowerCase().includes(st.query);

  // ------------------------------------------------------------------ data
  async function load(quiet) {
    const seq = ++st.seq;
    if (!quiet) { st.loading = true; st.error = ''; host.redraw(); }
    const end = st.end;
    const from = startOf(end);
    try {
      const who = admin() ? st.who : 'me';
      const ask = (a, b) => (who === 'me' ? OS.api('usage.get', undefined, { from: key(a), to: key(b) })
        : who === 'everyone' ? OS.api('usage.everyone', undefined, { from: key(a), to: key(b) })
          : OS.api('usage.of', undefined, { user: who, from: key(a), to: key(b) }));
      const [now, before] = await Promise.all([
        ask(from, end),
        st.period === 'day' || who === 'everyone' ? Promise.resolve(null) : ask(addDays(from, -span()), addDays(from, -1)),
      ]);
      if (now && now.users) st.users = now.users;
      if (now && now.user) st.whoName = now.user.name;
      if (seq !== st.seq) return;
      st.data = now;
      st.before = before;
      st.error = '';
    } catch (e) {
      if (seq !== st.seq) return;
      st.error = e.message;
    }
    st.loading = false;
    host.redraw();
  }

  /** Seconds per app over everything loaded, most first. */
  function appTotals(days) {
    const t = {};
    Object.values(days || {}).forEach((apps) => Object.entries(apps).forEach(([a, s]) => { t[a] = (t[a] || 0) + s; }));
    return Object.entries(t).sort((x, y) => y[1] - x[1]);
  }
  const sum = (pairs) => pairs.reduce((n, [, s]) => n + s, 0);

  // ------------------------------------------------------------------ drawing
  function head() {
    const p = st.period;
    const lab = { day: ['Previous day', 'Next day'], week: ['Previous week', 'Next week'], month: ['Previous 30 days', 'Next 30 days'] }[p];
    return '<div class="sm-hd"><h1>Usage</h1>' +
      (admin() ? '<span class="sm-muted">Showing</span><button type="button" class="sm-combo" data-act="who" aria-haspopup="menu">' + ico(st.who === 'everyone' ? 'users' : 'user', 15) +
        '<span>' + esc(whoLabel()) + '</span>' + ico('down', 12) + '</button>' : '') +
      '<div class="sm-seg" role="group" aria-label="Period">' + PERIODS.map(([id, label]) => '<button type="button" class="' + (id === p ? 'on' : '') + '" data-period="' + id + '" aria-pressed="' + (id === p) + '">' + label + '</button>').join('') + '</div>' +
      '<button type="button" class="btn sm-sq" data-step="-1" title="' + lab[0] + '" aria-label="' + lab[0] + '">' + ico('back', 14) + '</button>' +
      '<button type="button" class="btn sm-sq" data-step="1" title="' + lab[1] + '" aria-label="' + lab[1] + '"' + (isToday() ? ' disabled' : '') + '>' + ico('forward', 14) + '</button></div>';
  }
  function whoLabel() {
    if (st.who === 'me') return 'You';
    if (st.who === 'everyone') return 'Everyone';
    const u = (st.users || []).find((x) => x.username === st.who);
    return (u && u.name) || st.whoName || st.who;
  }
  function when() {
    const end = st.end;
    const fmt = (d, o) => d.toLocaleDateString([], o);
    if (st.period === 'day') return isToday() ? 'Today, ' + fmt(end, { day: 'numeric', month: 'long' }) : fmt(end, { weekday: 'long', day: 'numeric', month: 'long' });
    const a = startOf(end);
    const sameMonth = a.getMonth() === end.getMonth();
    return (sameMonth ? a.getDate() : fmt(a, { day: 'numeric', month: 'long' })) + ' to ' + fmt(end, { day: 'numeric', month: 'long' });
  }

  function render() {
    const d = st.data;
    if (!d && st.loading) return head() + '<div class="sm-empty">Loading…</div>';
    if (!d && st.error) return head() + '<div class="sm-empty">' + esc(st.error) + '</div>';
    if (!d) return head();
    let out = head();
    if (!d.tracking && st.who === 'me') {
      const admin = OS.user && OS.user.role === 'admin';
      out += '<div class="sm-off">' + ico('clock', 32) + '<b>Usage tracking is off</b><span>' +
        (admin ? 'Turn it on to see how long you spend in apps, files and websites. Everyone is told while it is on.' : 'An administrator can turn it on in Settings.') + '</span>' +
        (admin ? '<button type="button" class="btn" data-act="usage-settings">Open Settings</button>' : '') + '</div>';
      // what was recorded while it was on is still there to see
      if (!Object.keys(d.days || {}).length) return out;
    }
    if (st.who === 'everyone' && admin()) return out + '<div class="sm-usage">' + everyone(d) + '</div>';
    return out + '<div class="sm-usage">' + (st.period === 'day' ? day(d) : stretch(d)) + '</div>';
  }

  /** Everyone: each account with its time (open one to see theirs), and the apps and websites used most. */
  function everyone(d) {
    const total = (d.users || []).reduce((n, u) => n + (u.seconds || 0), 0);
    const col = { day: isToday() ? 'Today' : 'This day', week: 'This week', month: '30 days' }[st.period];
    const users = (d.users || []).filter((u) => matches(u.name) || matches(u.username));
    const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    const rows = users.map((u) => !u.recorded
      ? '<div class="sm-ur sm-muted"><span class="sm-who"><span class="sm-av" style="background:var(--sm-other)">' + esc(initials(u.name)) + '</span><span><b>' + esc(u.name) + '</b><small>Not recorded</small></span></span><span class="r"></span><span></span></div>'
      : '<div class="sm-ur link" data-user="' + esc(u.username) + '" title="Open ' + esc(u.name) + '’s usage">' +
        '<span class="sm-who"><span class="sm-av" style="background:' + esc(u.color || '#2F6FD6') + '">' + esc(initials(u.name)) + '</span><span><b>' + esc(u.name) + '</b><small>' + esc(u.roleLabel) + '</small></span></span>' +
        '<span class="r">' + (u.seconds ? dur(u.seconds) : '<span class="sm-muted">None</span>') + '</span>' +
        '<button type="button" class="icon-btn" data-user="' + esc(u.username) + '" aria-label="Open ' + esc(u.name) + '’s usage">' + ico('forward', 15) + '</button></div>').join('');
    const bars = (title, list, name, colourOf) => {
      const shown = list.filter((x) => matches(name(x)));
      const max = shown.length ? shown[0].seconds : 1;
      return '<h2 class="sm-sec">' + title + '</h2>' + (shown.length ? shown.slice(0, 6).map((x) => '<div class="sm-r"><span>' + esc(name(x)) + '</span><span class="t">' + dur(x.seconds) + '</span><span class="sm-bar"><i style="width:' + Math.max(2, Math.round(x.seconds / max * 100)) + '%;background:' + colourOf(x) + '"></i></span></div>').join('')
        : '<p class="sm-muted sm-small">None.</p>');
    };
    return '<div class="sm-total"><b>' + dur(total) + '</b><span>' + esc(when()) + ', everyone together</span></div>' +
      '<div class="sm-everyone"><div><h2 class="sm-sec">Users</h2>' +
      '<div class="sm-uh"><span>Name</span><span class="r">' + col + '</span><span></span></div>' +
      (rows || '<p class="sm-muted sm-small">Nobody matches.</p>') + '</div>' +
      '<div>' + bars('Apps, everyone', d.apps || [], (x) => appOf(x.app).name, (x) => colour(x.app)) +
      '<div style="height:12px"></div>' + bars('Websites, everyone', d.sites || [], (x) => x.item, () => colour('browser')) +
      '<p class="sm-muted sm-small">Only the site’s name is kept, never the page.</p></div></div>';
  }

  /** One day: the total, the timeline, then apps, files and websites. */
  function day(d) {
    const apps = appTotals(d.days);
    const total = sum(apps);
    let html = '<div class="sm-total"><b>' + dur(total) + '</b><span>' + esc(when()) + '</span><span class="end">Idle time isn’t counted</span></div>';
    if (!total) return html + '<div class="sm-empty">Nothing recorded ' + (isToday() ? 'yet today' : 'this day') + '.</div>';
    html += timeline(d.slots) + '<div class="sm-legend">' + apps.slice(0, 8).map(([a]) => '<span><i style="background:' + colour(a) + '"></i>' + esc(appOf(a).name) + '</span>').join('') + '</div>';
    return html + lists(apps, d.items, total);
  }

  /** The day from its first hour used to its last (8:00 to 18:00 at least), each five minutes coloured by its app. */
  function timeline(slots) {
    const by = new Map(); // slot -> [app, seconds] with the most time
    slots.forEach((s) => { const cur = by.get(s.slot); if (!cur || s.seconds > cur[1]) by.set(s.slot, [s.app, s.seconds]); });
    const used = [...by.keys()];
    let h0 = Math.min(8, Math.floor(Math.min(...used) / 12));
    let h1 = Math.max(18, Math.ceil((Math.max(...used) + 1) / 12));
    if ((h1 - h0) % 2) h1 < 24 ? h1++ : h0--;
    const n = (h1 - h0) * 12;
    const rects = [];
    for (let i = 0; i < n; i++) {
      const v = by.get(h0 * 12 + i);
      if (v) rects.push('<rect x="' + i + '" y="0" width="1.02" height="1" fill="' + colour(v[0]) + '"><title>' + esc(slotTime(h0 * 12 + i) + ', ' + appOf(v[0]).name) + '</title></rect>');
    }
    const ticks = [];
    for (let h = h0; h <= h1; h += 2) ticks.push('<span>' + esc(hourLabel(h)) + '</span>');
    return '<svg class="sm-tl" viewBox="0 0 ' + n + ' 1" preserveAspectRatio="none" role="img" aria-label="Timeline of the day from ' + esc(hourLabel(h0)) + ' to ' + esc(hourLabel(h1)) + '">' +
      '<rect x="0" y="0" width="' + n + '" height="1" class="sm-tl-bg"></rect>' + rects.join('') + '</svg><div class="sm-ax">' + ticks.join('') + '</div>';
  }
  const hourLabel = (h) => new Date(2000, 0, 1, h % 24, 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const slotTime = (slot) => new Date(2000, 0, 1, Math.floor(slot / 12), (slot % 12) * 5).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  /**
   * Apps, Files and Websites side by side (no boxes around them): each with how many, then a row each (its icon, its name, its share of the time
   * and, for a file or a site, the app it was in), the time at the right. Apps opens with a bar of every app's share.
   */
  function lists(apps, items, total) {
    const of = { day: isToday() ? 'of today' : 'of the day', week: 'of the week', month: 'of the 30 days' }[st.period];
    const pct = (s) => { const p = total ? s / total * 100 : 0; return p < 1 ? '<1%' : Math.round(p) + '%'; };
    const row = (r) => '<div class="sm-ur2' + (r.path ? ' link' : '') + '"' + (r.path ? ' data-open="' + esc(r.path) + '" title="' + esc(r.path) + '"' : '') + '>' +
      '<span class="sm-ic">' + r.icon + '</span><span class="sm-tx"><b>' + esc(r.name) + '</b><small>' + esc(r.sub) + '</small></span><span class="sm-t">' + dur(r.s) + '</span></div>';
    const card = (title, count, rows, empty, extra, foot) => '<section class="sm-card"><div class="sm-card-h"><h2>' + title + '</h2><span class="sm-muted">' + count + '</span>' + (extra || '') + '</div>' +
      (rows.length ? rows.map(row).join('') : '<p class="sm-muted sm-small">' + empty + '</p>') + (foot ? '<p class="sm-muted sm-small sm-foot">' + foot + '</p>' : '') + '</section>';
    const shown = (rows) => rows.filter((r) => matches(r.name) || matches(r.path) || matches(r.app));

    const files = shown(items.filter((i) => i.kind === 'file').map((i) => ({
      name: OS.util.basename(i.item), path: i.item, app: appOf(i.app).name, s: i.seconds,
      sub: 'in ' + appOf(i.app).name + ' · ' + pct(i.seconds), icon: OS.fileTile({ name: OS.util.basename(i.item), type: 'file' }, 28),
    }))).slice(0, 8);
    const sites = shown(items.filter((i) => i.kind === 'site').map((i) => ({
      name: i.item, app: appOf(i.app).name, s: i.seconds, sub: 'in ' + appOf(i.app).name + ' · ' + pct(i.seconds),
      icon: '<span class="sm-chip">' + ico('globe', 16) + '</span>',
    }))).slice(0, 8);
    const nFiles = items.filter((i) => i.kind === 'file').length;
    const nSites = items.filter((i) => i.kind === 'site').length;
    const filesCard = card('Files', nFiles + ' opened', files, st.query ? 'No file matches.' : 'No files.');
    const sitesCard = card('Websites', nSites + ' visited', sites, st.query ? 'No website matches.' : 'No websites.', '', 'Only the site’s name is kept, never the page.');
    if (!apps) return '<div class="sm-cards sm-cards-two">' + filesCard + sitesCard + '</div>';

    const appRows = shown(apps.map(([a, s]) => ({ name: appOf(a).name, s, sub: pct(s) + ' ' + of, icon: '<img src="' + esc(appOf(a).img || '') + '" alt="" width="28" height="28" draggable="false">' })));
    const share = '<div class="sm-share" role="img" aria-label="' + esc(apps.map(([a, s]) => appOf(a).name + ' ' + pct(s)).join(', ')) + '">' +
      apps.map(([a, s]) => '<i style="flex:' + Math.max(s, total * 0.004) + ';background:' + colour(a) + '" title="' + esc(appOf(a).name + ', ' + dur(s)) + '"></i>').join('') + '</div>';
    const appsCard = '<section class="sm-card"><div class="sm-card-h"><h2>Apps</h2><span class="sm-muted">' + apps.length + ' used</span><span class="sm-muted end">Share of ' + dur(total) + '</span></div>' +
      share + (appRows.length ? appRows.map(row).join('') : '<p class="sm-muted sm-small">No app matches.</p>') + '</section>';
    return '<div class="sm-cards">' + appsCard + '<div class="sm-cards-col">' + filesCard + sitesCard + '</div></div>';
  }

  /** A week or 30 days: total and average, the stacked chart, and the apps against the stretch before. */
  function stretch(d) {
    const days = [];
    for (let i = 0; i < span(); i++) { const k = key(addDays(startOf(st.end), i)); days.push({ k, date: addDays(startOf(st.end), i), apps: (d.days && d.days[k]) || {} }); }
    const apps = appTotals(d.days);
    const total = sum(apps);
    const top = apps.slice(0, 3).map(([a]) => a);
    let html = '<div class="sm-total"><b>' + dur(total) + '</b><span>' + esc(when()) + (total ? ', ' + dur(total / span()) + ' a day on average' : '') + '</span></div>';
    if (!total) return html + '<div class="sm-empty">Nothing recorded in these days.</div>';
    html += chart(days, top);
    const layers = top.concat(apps.length > 3 ? ['other'] : []);
    html += '<div class="sm-legend">' + layers.map((a) => '<span><i style="background:' + layerColour(a) + '"></i>' + esc(a === 'other' ? 'Other apps' : appOf(a).name) + '</span>').join('') + '</div>';
    const before = new Map(appTotals(st.before && st.before.days));
    const word = st.period === 'week' ? 'week' : '30 days';
    const rows = apps.filter(([a]) => matches(appOf(a).name));
    html += '<div class="sm-tbl"><div class="sm-th"><span>App</span><span>This ' + word + '</span><span>A day</span><span>The ' + word + ' before</span></div>' +
      rows.map(([a, s]) => '<div class="sm-tr"><span><i class="sm-sw" style="background:' + layerColour(top.includes(a) ? a : 'other') + '"></i>' + esc(appOf(a).name) + '</span><span>' + dur(s) + '</span><span>' + dur(s / span()) + '</span><span>' + (before.has(a) ? dur(before.get(a)) : '<span class="sm-muted">None</span>') + '</span></div>').join('') + '</div>';
    return html + lists(null, d.items || [], total);
  }
  const layerColour = (a) => (a === 'other' ? 'var(--sm-other)' : colour(a));

  /**
   * The stacked area chart: per day, the top three apps and the rest, one on the other, joined by smooth curves that
   * never overshoot (monotone), each day's total over its point, the days under.
   */
  function chart(days, top) {
    const W = 790, H = 222, L = 40, R = 780, T = 18, B = 190;
    const n = days.length;
    const x = (i) => (n === 1 ? (L + R) / 2 : L + (R - L) * i / (n - 1));
    const layersOf = (dd) => {
      const v = top.map((a) => dd.apps[a] || 0);
      const all = Object.values(dd.apps).reduce((p, q) => p + q, 0);
      return v.concat([Math.max(0, all - v.reduce((p, q) => p + q, 0))]);
    };
    const vals = days.map(layersOf);
    const totals = vals.map((v) => v.reduce((p, q) => p + q, 0));
    const maxH = Math.max(1, Math.ceil(Math.max(...totals) / 3600 / 2) * 2); // hours, to an even number
    const y = (sec) => B - (B - T) * (sec / 3600) / maxH;
    // cumulative tops of each layer
    const tops = [];
    let acc = days.map(() => 0);
    for (let k = 0; k < top.length + 1; k++) { acc = acc.map((s, i) => s + vals[i][k]); tops.push(acc.slice()); }
    const pts = (arr) => arr.map((s, i) => [x(i), y(s)]);
    const fills = top.map((a) => colour(a)).concat(['var(--sm-other)']);
    let paths = '';
    for (let k = tops.length - 1; k >= 0; k--) {
      if (k === tops.length - 1 && tops[k].every((s, i) => s === (k ? tops[k - 1][i] : 0))) continue; // no "other"
      paths += '<path d="' + smooth(pts(tops[k])) + ' L' + R + ',' + B + ' L' + L + ',' + B + ' Z" fill="' + fills[k] + '"' + (k < top.length ? ' fill-opacity="0.85"' : '') + '></path>';
    }
    const grid = [];
    const step = maxH <= 4 ? 1 : maxH <= 8 ? 2 : 4;
    for (let h = step; h <= maxH; h += step) grid.push(h);
    const every = n > 10 ? Math.ceil(n / 8) : 1;
    // a label every few days, and the last day's own; one that would crowd the last is left out
    const labelled = (i) => i === n - 1 || (i % every === 0 && n - 1 - i >= every * 0.75);
    const label = (i) => (n > 10 ? days[i].date.toLocaleDateString([], { day: 'numeric', month: 'short' }) : days[i].date.toLocaleDateString([], { weekday: 'short' }));
    const anchor = (i) => (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');
    return '<svg class="sm-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Time each day, stacked by app">' +
      '<g class="sm-grid">' + grid.map((h) => '<line x1="' + L + '" y1="' + y(h * 3600) + '" x2="' + R + '" y2="' + y(h * 3600) + '"></line>').join('') + '</g>' +
      '<g class="sm-yl">' + grid.map((h) => '<text x="0" y="' + (y(h * 3600) + 4) + '">' + h + ' h</text>').join('') + '</g>' +
      '<g class="sm-areas">' + paths + '</g>' +
      '<line class="sm-base" x1="' + L + '" y1="' + B + '" x2="' + R + '" y2="' + B + '"></line>' +
      '<g class="sm-vals">' + totals.map((s, i) => !labelled(i) || !s ? '' : '<text x="' + x(i) + '" y="' + (y(s) - 6) + '" text-anchor="' + anchor(i) + '">' + durShort(s) + '</text>').join('') + '</g>' +
      '<g class="sm-days">' + days.map((dd, i) => !labelled(i) ? '' : '<text x="' + x(i) + '" y="' + (H - 10) + '" text-anchor="' + anchor(i) + '">' + esc(label(i)) + '</text>').join('') + '</g>' +
      days.map((dd, i) => '<rect class="sm-hit" x="' + (x(i) - (R - L) / Math.max(1, n - 1) / 2) + '" y="' + T + '" width="' + ((R - L) / Math.max(1, n - 1)) + '" height="' + (B - T) + '"><title>' +
        esc(dd.date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) + ': ' + dur(totals[i])) + '</title></rect>').join('') +
      '</svg>';
  }
  /** A monotone cubic curve through the points (Fritsch and Carlson), as an SVG path. */
  function smooth(p) {
    const n = p.length;
    if (n === 1) return 'M' + (p[0][0] - 1) + ',' + p[0][1] + ' L' + (p[0][0] + 1) + ',' + p[0][1];
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = 'M' + p[0][0].toFixed(1) + ',' + p[0][1].toFixed(1);
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += ' C' + (p[i][0] + h).toFixed(1) + ',' + (p[i][1] + t[i] * h).toFixed(1) + ' ' + (p[i + 1][0] - h).toFixed(1) + ',' + (p[i + 1][1] - t[i + 1] * h).toFixed(1) + ' ' + p[i + 1][0].toFixed(1) + ',' + p[i + 1][1].toFixed(1);
    }
    return d;
  }

  // ------------------------------------------------------------------ pointer
  function click(e) {
    const per = e.target.closest('[data-period]');
    if (per) { if (st.period !== per.dataset.period) { st.period = per.dataset.period; st.data = null; load(); } return true; }
    const step = e.target.closest('[data-step]');
    if (step && !step.disabled) {
      const next = addDays(st.end, +step.dataset.step * span());
      st.end = next > today() ? today() : next;
      load();
      return true;
    }
    if (e.target.closest('[data-act="who"]')) { whoMenu(e.target.closest('[data-act="who"]')); return true; }
    const user = e.target.closest('[data-user]');
    if (user) { setWho(user.dataset.user); return true; }
    const open = e.target.closest('[data-open]');
    if (open) { OS.openFile(open.dataset.open); return true; }
    if (e.target.closest('[data-act="usage-settings"]')) { OS.open('settings', { page: 'system/usage' }); return true; }
    return false;
  }

  function setWho(who) {
    if (st.who === who) return;
    st.who = who;
    st.whoName = '';
    st.data = null;
    load();
  }
  /** Whose usage: you, everyone, or one account (a flyout menu, like every LiteOS drop-down). */
  async function whoMenu(btn) {
    if (!st.users) {
      try { st.users = (await OS.api('usage.everyone', undefined, { from: key(today()), to: key(today()) })).users; } catch (e) { st.users = []; }
    }
    const me = OS.user && OS.user.username;
    const others = (st.users || []).filter((u) => u.username !== me);
    const r = btn.getBoundingClientRect();
    OS.menu([
      { label: 'You', icon: 'user', checked: st.who === 'me', action: () => setWho('me') },
      { label: 'Everyone', icon: 'users', checked: st.who === 'everyone', action: () => setWho('everyone') },
    ].concat(others.length ? ['sep'] : [], others.map((u) => ({ label: u.name, checked: st.who === u.username, disabled: !u.recorded, title: u.recorded ? '' : 'Not recorded', action: () => setWho(u.username) }))),
    { x: r.left, y: r.bottom + 2 });
  }

  let timer = 0;
  return {
    render,
    click,
    search(q) { st.query = q; host.redraw(); },
    placeholder: 'Search apps, files and sites',
    show() {
      if (!st.data) load(); else load(true);
      clearInterval(timer);
      // while today is shown, it keeps up (the desktop hands in what it recorded every 30 seconds)
      timer = setInterval(() => { if (isToday() && !document.hidden) load(true); }, 60000);
    },
    hide() { clearInterval(timer); },
    keep: () => ({ period: st.period, who: st.who }),
    restore(k) {
      if (k && PERIODS.some((p) => p[0] === k.period)) st.period = k.period;
      if (k && typeof k.who === 'string' && admin()) st.who = k.who;
    },
  };
};
