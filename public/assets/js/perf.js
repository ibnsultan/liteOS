/*
 * LiteOS performance sampler, loaded by the desktop after os.js: keeps the last 5 minutes of how the desktop's page is
 * doing, for System Monitor › Performance (LiteOSHost.perf, OS.perf in the SDK). Every app window shares this page, so
 * these are figures for the whole desktop, never for one app.
 *
 * Every 2 seconds one sample: the page's memory (where the browser reports it), how busy the page was (time in long
 * tasks, which the browser reports for every window's frame too, and how late a timer ran), bytes received (this page's
 * and every window's own, handed over by the SDK) and sent (the bodies of LiteOS's API requests), and the frame rate,
 * counted only while someone is watching (counting frames keeps the page awake).
 */
(function () {
  'use strict';

  const H = window.LiteOSHost;
  if (!H) return;

  const EVERY = 2000;
  const KEEP = 150; // 5 minutes
  const samples = [];
  const since = Date.now();
  let busy = 0; // ms in long tasks since the last sample
  let tasks = 0;
  let longest = 0;
  let lag = 0; // the most a timer ran late since the last sample
  let rx = 0;
  let tx = 0;
  let rxAll = 0;
  let txAll = 0;
  let memHigh = 0;
  let frames = 0;
  let watching = 0;
  let raf = 0;
  const subs = new Map(); // fn -> the window watching (dropped once it closes)

  try {
    new PerformanceObserver((list) => {
      list.getEntries().forEach((e) => { busy += e.duration; tasks++; longest = Math.max(longest, e.duration); });
    }).observe({ type: 'longtask', buffered: false });
  } catch (e) { /* the browser doesn't report long tasks */ }
  try {
    new PerformanceObserver((list) => { list.getEntries().forEach((e) => { rx += e.transferSize || 0; }); }).observe({ type: 'resource', buffered: false });
  } catch (e) { /* no resource timing */ }

  // how late a timer runs: a page that is stuck can't run it on time
  let expect = performance.now() + 500;
  (function tick() {
    const now = performance.now();
    lag = Math.max(lag, now - expect);
    expect = now + 500;
    setTimeout(tick, 500);
  })();

  /** Body sizes of what LiteOS's API sends (os.js calls this). */
  window.LOS_perfSent = (body) => {
    let n = 0;
    try {
      if (typeof body === 'string') n = new Blob([body]).size;
      else if (body && typeof body.forEach === 'function') body.forEach((v, k) => { n += String(k).length + (typeof v === 'string' ? v.length : (v && v.size) || 0); });
    } catch (e) { n = 0; }
    tx += n;
  };

  const memory = () => {
    const m = performance.memory;
    return m && m.usedJSHeapSize ? m.usedJSHeapSize : null;
  };

  function stop(fn) {
    if (!subs.delete(fn)) return;
    watching = Math.max(0, watching - 1);
    if (!watching && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  function frame() { frames++; raf = watching ? requestAnimationFrame(frame) : 0; }

  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = Math.max(1, now - last);
    last = now;
    const mem = memory();
    if (mem) memHigh = Math.max(memHigh, mem);
    rxAll += rx;
    txAll += tx;
    const s = {
      t: Date.now(),
      mem,
      busy: Math.min(100, Math.round(busy / dt * 1000) / 10), // % of the time
      lag: Math.round(Math.max(0, lag)),
      longest: Math.round(longest),
      tasks,
      rx: Math.round(rx / dt * 1000), // bytes a second
      tx: Math.round(tx / dt * 1000),
      fps: watching && document.visibilityState === 'visible' ? Math.round(frames / dt * 1000) : null,
    };
    busy = 0; tasks = 0; longest = 0; lag = 0; rx = 0; tx = 0; frames = 0;
    samples.push(s);
    if (samples.length > KEEP) samples.shift();
    const open = new Set(H.tasks ? H.tasks.list().map((w) => w.id) : []);
    subs.forEach((win, fn) => {
      if (win && !open.has(win)) { stop(fn); return; }
      try { fn(s); } catch (e) { stop(fn); }
    });
  }, EVERY);

  H.perf = {
    /** The last 5 minutes, oldest first: [{ t, mem, busy, lag, longest, tasks, rx, tx, fps }]. */
    history: () => samples.slice(),
    /** Totals since the desktop started. */
    totals: () => ({ since, received: rxAll, sent: txAll, memHigh: memHigh || null }),
    /** A window's page received this many bytes (the SDK). */
    received(n) { if (n > 0) rx += n; },
    /** A window's page has gone: its watchers go with it. */
    forget(winId) { subs.forEach((win, fn) => { if (win === winId) stop(fn); }); },
    /** fn(sample) every 2 seconds; the frame rate is counted while anyone watches. Returns the way to stop. */
    watch(fn, winId) {
      subs.set(fn, winId || null);
      watching++;
      if (!raf) raf = requestAnimationFrame(frame);
      return () => stop(fn);
    },
  };
})();
