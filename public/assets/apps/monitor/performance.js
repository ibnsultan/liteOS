/*
 * System Monitor › Performance: how the desktop's page is doing over the last 5 minutes (OS.perf, the desktop's
 * assets/js/perf.js): memory, responsiveness, network and frame rate down the side with a small graph each, the one
 * picked as a large graph with its figures under it. Every app window shares one page, so these are for the whole
 * desktop, never for one app. Loaded before app.js, which calls window.SMPerf(OS, host).
 */
window.SMPerf = function (OS, host) {
  'use strict';

  const esc = (s) => OS.util.escape(s == null ? '' : s);
  const KEEP = 150; // 5 minutes of 2-second samples
  const st = { metric: 'memory', samples: [], stop: null };
  const COLOURS = { memory: '#2F6FD6', busy: '#1D9E75', net: '#B4500A', net2: '#7F77DD', fps: '#7F77DD' };

  const size = (b) => (b == null ? 'Not reported' : OS.util.formatSize(b));
  const rate = (b) => OS.util.formatSize(b || 0) + '/s';
  const last = (n) => st.samples.slice(-n);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const deviceBytes = () => (navigator.deviceMemory ? navigator.deviceMemory * 1024 * 1024 * 1024 : null);

  function browserName() {
    const b = navigator.userAgentData && navigator.userAgentData.brands;
    const real = b && b.find((x) => !/not.?a.?brand/i.test(x.brand) && x.brand !== 'Chromium') || (b && b.find((x) => x.brand === 'Chromium'));
    if (real) return real.brand + ' ' + real.version;
    const m = navigator.userAgent.match(/(Firefox|Edg|Chrome|Safari)\/(\d+)/);
    return m ? (m[1] === 'Edg' ? 'Edge' : m[1]) + ' ' + m[2] : 'Unknown';
  }
  const screenSize = () => Math.round(screen.width * devicePixelRatio) + ' × ' + Math.round(screen.height * devicePixelRatio);
  const windows = () => OS.tasks.list().length;

  // ------------------------------------------------------------------ the measures
  const METRICS = {
    memory: {
      label: 'Memory',
      value: (s) => s.mem,
      line: () => {
        const s = st.samples[st.samples.length - 1];
        if (!s || s.mem == null) return 'Not reported';
        const dev = deviceBytes();
        return size(s.mem) + (dev ? ', ' + Math.max(1, Math.round(s.mem / dev * 100)) + '%' : '');
      },
      sub: 'used by LiteOS’s scripts in this browser',
      side: () => (navigator.deviceMemory ? (navigator.deviceMemory >= 8 ? 'At least 8 GB' : navigator.deviceMemory + ' GB') + ' on this device' : ''),
      axis: (max) => size(max),
      figures: () => {
        const s = st.samples[st.samples.length - 1] || {};
        const t = OS.perf.totals() || {};
        return [['In use', size(s.mem)], ['Highest since the desktop started', size(t.memHigh)], ['Open windows', windows()],
          ['Browser', browserName()], ['Processor cores', navigator.hardwareConcurrency || 'Not reported'], ['Screen', screenSize()]];
      },
      note: () => (st.samples.some((s) => s.mem != null) ? 'The browser reports the memory scripts use, for the whole desktop, not for each app: every app window shares one page. Pictures, video and the page itself aren’t included.'
        : 'This browser doesn’t report how much memory a page uses. Chromium-based browsers such as Chrome and Edge do.'),
    },
    busy: {
      label: 'Responsiveness',
      value: (s) => s.busy,
      max: () => 100,
      line: () => 'Busy ' + Math.round(avg(last(30).map((s) => s.busy))) + '% of the time',
      sub: 'how much of the time the page was busy',
      side: () => '',
      axis: (max) => Math.round(max) + '%',
      figures: () => {
        const five = st.samples;
        return [['Busy, last minute', Math.round(avg(last(30).map((s) => s.busy))) + '%'],
          ['Longest wait', Math.max(0, ...five.map((s) => s.longest)) + ' ms'],
          ['Timers late by, at most', Math.max(0, ...five.map((s) => s.lag)) + ' ms'],
          ['Long tasks', five.reduce((n, s) => n + s.tasks, 0)],
          ['Open windows', windows()], ['Processor cores', navigator.hardwareConcurrency || 'Not reported']];
      },
      note: () => 'A long task is a moment the page couldn’t answer anything: every window waits while one runs, whichever app it is in.',
    },
    net: {
      label: 'Network',
      value: (s) => s.rx,
      second: (s) => s.tx,
      line: () => 'Received ' + rate(avg(last(5).map((s) => s.rx))),
      sub: 'LiteOS network traffic',
      side: () => '',
      axis: (max) => rate(max),
      legend: [['Received', 'net'], ['Sent', 'net2']],
      figures: () => {
        const t = OS.perf.totals() || {};
        const c = navigator.connection;
        return [['Received now', rate(avg(last(5).map((s) => s.rx)))], ['Sent now', rate(avg(last(5).map((s) => s.tx)))],
          ['Connection', navigator.onLine ? (c && c.effectiveType ? c.effectiveType.toUpperCase() + (c.downlink ? ', about ' + c.downlink + ' Mbit/s' : '') : 'Online') : 'Offline'],
          ['Received since the desktop started', size(t.received)], ['Sent since the desktop started', size(t.sent)], ['Open windows', windows()]];
      },
      note: () => 'Counts what LiteOS loads and sends. Websites open in the Browser keep their traffic to themselves, so a download or a speed test there doesn’t show here.',
    },
    fps: {
      label: 'Frame rate',
      value: (s) => s.fps,
      max: (vals) => Math.max(60, ...vals),
      line: () => { const f = last(3).map((s) => s.fps).filter((x) => x != null); return f.length ? Math.round(avg(f)) + ' per second' : 'Measuring'; },
      sub: 'frames drawn each second',
      side: () => '',
      axis: (max) => Math.round(max),
      figures: () => {
        const f = st.samples.map((s) => s.fps).filter((x) => x != null);
        const m = last(30).map((s) => s.fps).filter((x) => x != null);
        return [['Now', f.length ? f[f.length - 1] + ' per second' : 'Measuring'], ['Lowest, last minute', m.length ? Math.min(...m) + ' per second' : 'Measuring'],
          ['Average', f.length ? Math.round(avg(f)) + ' per second' : 'Measuring'], ['Screen', screenSize()], ['Browser', browserName()], ['Open windows', windows()]];
      },
      note: () => 'Counted only while System Monitor is open, and while the desktop is showing: counting keeps the page awake.',
    },
  };
  const ORDER = ['memory', 'busy', 'net', 'fps'];

  // ------------------------------------------------------------------ drawing
  /** Points for a series over the 5 minutes, right-aligned (the newest at the right edge). */
  function points(vals, w, h, max) {
    const n = vals.length;
    const out = [];
    vals.forEach((v, i) => {
      if (v == null) return;
      const x = w - (n - 1 - i) * (w / (KEEP - 1));
      out.push([Math.max(0, x), h - (h - 2) * Math.min(1, v / max)]);
    });
    return out;
  }
  const poly = (p) => p.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
  function scale(m) {
    const vals = st.samples.map(m.value).filter((v) => v != null);
    const vals2 = m.second ? st.samples.map(m.second).filter((v) => v != null) : [];
    if (m.max) return m.max(vals);
    const top = Math.max(1, ...vals, ...vals2);
    return top * 1.25;
  }
  function spark(id) {
    const m = METRICS[id];
    const max = scale(m);
    const p = points(st.samples.map(m.value), 64, 36, max);
    return '<svg class="sm-spark" viewBox="0 0 64 36" preserveAspectRatio="none" aria-hidden="true">' +
      (p.length ? '<polyline points="' + poly(p) + '" fill="none" stroke="' + COLOURS[id] + '" stroke-width="1.5" vector-effect="non-scaling-stroke"></polyline>' : '') + '</svg>';
  }
  function chart(id) {
    const m = METRICS[id];
    const W = 640, H = 250;
    const max = scale(m);
    const p = points(st.samples.map(m.value), W, H, max);
    const p2 = m.second ? points(st.samples.map(m.second), W, H, max) : [];
    const grid = [0.25, 0.5, 0.75].map((f) => '<line x1="0" y1="' + (H * f) + '" x2="' + W + '" y2="' + (H * f) + '"></line>').join('');
    const area = p.length > 1 ? '<polygon points="' + poly(p) + ' ' + p[p.length - 1][0].toFixed(1) + ',' + H + ' ' + p[0][0].toFixed(1) + ',' + H + '" fill="' + COLOURS[id] + '" fill-opacity="0.12"></polygon>' : '';
    return '<div class="sm-pchart"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(m.label + ' over the last 5 minutes') + '">' +
      '<g class="sm-grid">' + grid + '</g>' + area +
      (p.length ? '<polyline points="' + poly(p) + '" fill="none" stroke="' + COLOURS[id] + '" stroke-width="2" vector-effect="non-scaling-stroke"></polyline>' : '') +
      (p2.length ? '<polyline points="' + poly(p2) + '" fill="none" stroke="' + COLOURS.net2 + '" stroke-width="2" vector-effect="non-scaling-stroke"></polyline>' : '') +
      '</svg><span class="sm-pmax">' + esc(m.axis(max)) + '</span>' +
      (p.length ? '' : '<span class="sm-pwait">' + (st.samples.length ? 'Not reported in this browser' : 'Measuring…') + '</span>') + '</div>' +
      '<div class="sm-pax"><span>5 minutes ago</span>' + (m.legend ? '<span class="sm-legend">' + m.legend.map(([l, c]) => '<span><i style="background:' + COLOURS[c] + '"></i>' + l + '</span>').join('') + '</span>' : '') + '<span>Now</span></div>';
  }

  function render() {
    const m = METRICS[st.metric];
    return '<div class="sm-hd"><h1>Performance</h1><span class="sm-muted">Last 5 minutes</span></div>' +
      '<div class="sm-perf"><div class="sm-plist" role="tablist" aria-label="Measures">' + ORDER.map((id) =>
        '<button type="button" role="tab" class="sm-mt' + (id === st.metric ? ' on' : '') + '" data-metric="' + id + '" aria-selected="' + (id === st.metric) + '">' + spark(id) +
        '<span><b>' + METRICS[id].label + '</b><small>' + esc(METRICS[id].line()) + '</small></span></button>').join('') + '</div>' +
      '<div class="sm-pdet"><div class="sm-pdh"><h2>' + m.label + '</h2><span class="sm-muted">' + esc(m.sub) + '</span><span class="sm-muted end">' + esc(m.side()) + '</span></div>' +
      chart(st.metric) +
      '<div class="sm-kv">' + m.figures().map(([k, v]) => '<div><small>' + esc(k) + '</small><b>' + esc(v) + '</b></div>').join('') + '</div>' +
      '<p class="sm-muted sm-small">' + esc(m.note()) + '</p></div></div>';
  }

  function click(e) {
    const b = e.target.closest('[data-metric]');
    if (b && b.dataset.metric !== st.metric) { st.metric = b.dataset.metric; host.redraw(); }
    return !!b;
  }

  return {
    render,
    click,
    // picked as the button goes down: the view is redrawn every 2 seconds, and a redraw between press and release would
    // lose the click
    press(e) { if (e.button === 0) click(e); },
    placeholder: 'Search apps and windows',
    show() {
      st.samples = OS.perf.history();
      if (st.stop) st.stop();
      st.stop = OS.perf.watch((s) => {
        st.samples.push(s);
        if (st.samples.length > KEEP) st.samples.shift();
        host.redraw();
      });
      host.redraw();
    },
    hide() { if (st.stop) { st.stop(); st.stop = null; } },
    keep: () => ({ metric: st.metric }),
    restore(k) { if (k && METRICS[k.metric]) st.metric = k.metric; },
    key(e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
      const i = ORDER.indexOf(st.metric) + (e.key === 'ArrowDown' ? 1 : -1);
      if (i < 0 || i >= ORDER.length) return true;
      st.metric = ORDER[i];
      host.redraw();
      const b = document.querySelector('[data-metric="' + st.metric + '"]');
      if (b) b.focus();
      return true;
    },
  };
};
