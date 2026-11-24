/*
 * System Monitor › Server, for administrators: first this LiteOS (versions, the database, the largest upload, up since),
 * the server disk and who is signed in now; then Activity, live charts of the server's processor, memory, disk reads
 * and writes and network in and out over the last minute, every 2 seconds, with Pause. The server hands over its
 * running totals (system.counters, App\Support\ServerStats); the rates are worked out here between two reads, and
 * nothing is kept once the section closes. Loaded before app.js, which calls window.SMServer(OS, host).
 */
window.SMServer = function (OS, host) {
  'use strict';

  const esc = (s) => OS.util.escape(s == null ? '' : s);
  const size = (b) => (b == null ? 'Not reported' : OS.util.formatSize(b));
  const rate = (b) => OS.util.formatSize(Math.max(0, b || 0)) + '/s';
  const KEEP = 30; // a minute of 2-second reads
  const st = { facts: null, error: '', samples: [], last: null, paused: false, timer: 0 };

  async function loadFacts() {
    try { st.facts = await OS.api('system.server', undefined, {}); st.error = ''; } catch (e) { st.error = e.message; }
    host.redraw();
  }
  async function read() {
    if (st.paused || !st.facts || !st.facts.live || document.hidden) return;
    let c;
    try { c = await OS.api('system.counters', undefined, {}); } catch (e) { return; }
    if (!c) return;
    const p = st.last;
    st.last = c;
    if (!p) return;
    const dt = Math.max(0.001, (c.t - p.t) / 1000);
    const cpuAll = c.cpuTotal - p.cpuTotal;
    st.samples.push({
      cpu: cpuAll > 0 ? Math.max(0, Math.min(100, (1 - (c.cpuIdle - p.cpuIdle) / cpuAll) * 100)) : 0,
      mem: c.memUsed, memTotal: c.memTotal,
      read: (c.disk.read - p.disk.read) / dt, write: (c.disk.write - p.disk.write) / dt,
      rx: (c.net.in - p.net.in) / dt, tx: (c.net.out - p.net.out) / dt,
    });
    if (st.samples.length > KEEP) st.samples.shift();
    host.redraw();
  }

  // ------------------------------------------------------------------ drawing
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) : 'Not reported');
  function chart(title, value, series, max, label) {
    const W = 360, H = 100;
    const lines = series.map(([vals, colour]) => {
      const n = vals.length;
      if (!n) return '';
      const pts = vals.map((v, i) => [W - (n - 1 - i) * (W / (KEEP - 1)), H - (H - 2) * Math.min(1, v / max)]);
      const p = pts.map(([x, y]) => Math.max(0, x).toFixed(1) + ',' + y.toFixed(1)).join(' ');
      const fill = series.length === 1 && n > 1 ? '<polygon points="' + p + ' ' + pts[n - 1][0].toFixed(1) + ',' + H + ' ' + Math.max(0, pts[0][0]).toFixed(1) + ',' + H + '" fill="' + colour + '" fill-opacity="0.12"></polygon>' : '';
      return fill + '<polyline points="' + p + '" fill="none" stroke="' + colour + '" stroke-width="2" vector-effect="non-scaling-stroke"></polyline>';
    }).join('');
    return '<div class="sm-g"><h3>' + esc(title) + '<span>' + esc(value) + '</span></h3>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '"><g class="sm-grid"><line x1="0" y1="25" x2="' + W + '" y2="25"></line><line x1="0" y1="50" x2="' + W + '" y2="50"></line><line x1="0" y1="75" x2="' + W + '" y2="75"></line></g>' + lines + '</svg>' +
      (series.length > 1 ? '<div class="sm-legend">' + series.map(([, c, n]) => '<span><i style="background:' + c + '"></i>' + esc(n) + '</span>').join('') + '</div>' : '') + '</div>';
  }

  function render() {
    const head = '<div class="sm-hd"><h1>Server</h1></div>';
    const f = st.facts;
    if (!f) return head + '<div class="sm-empty">' + (st.error ? esc(st.error) : 'Loading…') + '</div>';
    const db = f.database || {};
    const kv = [['LiteOS', f.liteos], ['PHP', f.php], ['Operating system', f.os],
      ['Database', [db.engine, db.version].filter(Boolean).join(' ') + (db.bytes != null ? ', ' + size(db.bytes) : '')],
      ['Largest upload', String(f.uploadMax || '').replace(/^(\d+)([KMG])$/i, '$1 $2B')], ['Up since', day(f.upSince)]];
    const used = Math.max(0, f.disk.total - f.disk.free);
    const pct = f.disk.total ? used / f.disk.total * 100 : 0;
    let html = head + '<div class="sm-usage"><div class="sm-srv">' +
      '<div><h2 class="sm-sec">This LiteOS</h2><dl class="sm-dl">' + kv.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl></div>' +
      '<div><h2 class="sm-sec">Server disk</h2><span class="sm-meter" role="img" aria-label="' + esc(size(used) + ' of ' + size(f.disk.total) + ' used') + '"><i style="width:' + pct.toFixed(1) + '%;background:#2F6FD6"></i></span>' +
      '<p class="sm-muted sm-small">' + size(f.disk.free) + ' free of ' + size(f.disk.total) + '</p>' +
      '<h2 class="sm-sec sm-sec-gap">Signed in now (' + f.signedIn.length + ')</h2>' +
      (f.signedIn.length ? f.signedIn.map((u) => '<div class="sm-on"><i></i><span>' + esc(u.name) + '</span><span class="sm-muted">' + (u.since ? 'since ' + esc(time(u.since)) : '') + '</span></div>').join('') : '<p class="sm-muted sm-small">Nobody.</p>') +
      '</div></div>';
    html += '<div class="sm-act"><h2>Activity</h2>' + (f.live ? '<span class="sm-live' + (st.paused ? ' paused' : '') + '"><i></i>' + (st.paused ? 'Paused' : 'Live, every 2 seconds') + '</span>' +
      '<button type="button" class="btn" data-act="pause">' + (st.paused ? 'Resume' : 'Pause') + '</button>' : '') + '</div>';
    if (!f.live) {
      return html + '<p class="sm-muted sm-small">This server doesn’t offer live figures: only Linux servers let LiteOS read their processor, memory, disk and network use. ' +
        (f.cores ? 'It has ' + f.cores + ' processor cores.' : '') + '</p></div>';
    }
    const s = st.samples;
    const last = s[s.length - 1];
    const memMax = last ? last.memTotal : 1;
    const ioMax = (a, b) => Math.max(1024, ...s.map((x) => Math.max(x[a], x[b]))) * 1.25;
    html += '<div class="sm-charts">' +
      chart('Processor', last ? Math.round(last.cpu) + '%' + (f.cores ? ', ' + f.cores + ' cores' : '') : 'Measuring', [[s.map((x) => x.cpu), '#2F6FD6']], 100, 'Server processor use over the last minute') +
      chart('Memory', last ? size(last.mem) + ' of ' + size(last.memTotal) : 'Measuring', [[s.map((x) => x.mem), '#7F77DD']], memMax, 'Server memory over the last minute') +
      chart('Disk', last ? 'Read ' + rate(last.read) + ', write ' + rate(last.write) : 'Measuring', [[s.map((x) => x.read), '#1D9E75', 'Read'], [s.map((x) => x.write), '#B4500A', 'Write']], ioMax('read', 'write'), 'Server disk reads and writes over the last minute') +
      chart('Network', last ? 'In ' + rate(last.rx) + ', out ' + rate(last.tx) : 'Measuring', [[s.map((x) => x.rx), '#2F6FD6', 'In'], [s.map((x) => x.tx), '#9A9BA3', 'Out']], ioMax('rx', 'tx'), 'Server network traffic over the last minute') +
      '</div><p class="sm-muted sm-small">Last minute. Read from the server itself; nothing is kept once System Monitor is closed.</p></div>';
    return html;
  }

  function toggle() { st.paused = !st.paused; host.redraw(); }
  return {
    render,
    click(e) { return !!e.target.closest('[data-act="pause"]'); },
    // the charts redraw every 2 seconds: Pause acts as the button goes down, so a redraw can't swallow the click
    press(e) { if (e.button === 0 && e.target.closest('[data-act="pause"]')) toggle(); },
    placeholder: '',
    show() {
      st.samples = [];
      st.last = null;
      loadFacts().then(read);
      clearInterval(st.timer);
      st.timer = setInterval(read, 2000);
    },
    hide() { clearInterval(st.timer); st.timer = 0; st.samples = []; st.last = null; },
    keep: () => ({}),
    restore() {},
  };
};
