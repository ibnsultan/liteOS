/*
 * LiteOS usage recorder, loaded by the desktop after os.js: while an administrator has usage tracking on, adds up how
 * long each app, file and website is in front, for System Monitor's Usage (App\Support\Usage on the server).
 *
 * Counted only while someone is using the desktop: a window is in front, the browser tab is showing, the screen isn't
 * locked, and there was a key, click, scroll or move in the last 5 minutes (in an app too: the SDK passes those on).
 * Every 5 seconds the window in front gets the time since the last look, on the user's own calendar day and its five
 * minutes; a file is the window's open file, a website only its domain (the Browser says which, OS.win.setItem).
 * What is added up goes to the server every 30 seconds, before the screen locks or the session ends, and as the page
 * goes. Nothing is kept here but those few seconds; the guest is never recorded.
 */
(function () {
  'use strict';

  const H = window.LiteOSHost;
  if (!H || !H.tasks || !H.tasks.idle) return;

  const TICK = 5000;
  const SEND = 30000;
  const IDLE = 5 * 60 * 1000;
  const GAP = 15000; // a look this late (the tab was asleep, the computer suspended) counts only this much

  let last = Date.now();
  let buf = null; // { day, slots: Map 'slot|app' -> ms, items: Map 'kind|app|name' -> ms }
  let sending = null;

  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const tracking = () => {
    const st = H.state;
    return !!(st && st.user && st.user.role !== 'guest' && st.system && st.system.usageTracking);
  };

  function look() {
    const now = Date.now();
    const dt = Math.min(now - last, GAP);
    last = now;
    if (dt <= 0 || !tracking() || H.tasks.locked() || document.visibilityState !== 'visible' || H.tasks.idle() > IDLE) return;
    const w = H.tasks.list().find((x) => x.focused);
    if (!w) return; // the desktop itself, with no window in front
    const at = new Date(now - dt / 2);
    const day = dayOf(at);
    if (buf && buf.day !== day) send();
    if (!buf) buf = { day, slots: new Map(), items: new Map() };
    const slot = Math.floor((at.getHours() * 60 + at.getMinutes()) / 5);
    const sk = slot + '|' + w.app.id;
    buf.slots.set(sk, (buf.slots.get(sk) || 0) + dt);
    if (w.item && w.item.name) {
      const ik = w.item.kind + '|' + w.app.id + '|' + w.item.name;
      buf.items.set(ik, (buf.items.get(ik) || 0) + dt);
    }
  }

  /** What has been added up, as the server takes it; whole seconds, what is left over waits for the next time. */
  function take() {
    if (!buf) return null;
    const out = { day: buf.day, slots: [], items: [] };
    buf.slots.forEach((ms, k) => {
      const s = Math.floor(ms / 1000);
      if (s < 1) return;
      const [slot, app] = k.split('|');
      out.slots.push({ slot: +slot, app, seconds: s });
      buf.slots.set(k, ms - s * 1000);
    });
    buf.items.forEach((ms, k) => {
      const s = Math.floor(ms / 1000);
      if (s < 1) return;
      const i = k.indexOf('|');
      const j = k.indexOf('|', i + 1);
      out.items.push({ kind: k.slice(0, i), app: k.slice(i + 1, j), item: k.slice(j + 1), seconds: s });
      buf.items.set(k, ms - s * 1000);
    });
    // a new day leaves the old one behind once it is sent
    if (buf.day !== dayOf(new Date())) buf = null;
    return out.slots.length || out.items.length ? out : null;
  }
  /** Back into the buffer, when the server couldn't take it (the screen was locked, no connection). */
  function putBack(r) {
    if (!buf) buf = { day: r.day, slots: new Map(), items: new Map() };
    if (buf.day !== r.day) return; // a day gone by: let it go
    r.slots.forEach((s) => { const k = s.slot + '|' + s.app; buf.slots.set(k, (buf.slots.get(k) || 0) + s.seconds * 1000); });
    r.items.forEach((i) => { const k = i.kind + '|' + i.app + '|' + i.item; buf.items.set(k, (buf.items.get(k) || 0) + i.seconds * 1000); });
  }

  function send() {
    if (sending) return sending;
    const r = take();
    if (!r) return Promise.resolve();
    sending = H.api('usage.add', r).then((res) => {
      // turned off since the desktop started: stop looking until it is on again
      if (res && res.recorded === false && H.state.system && H.state.system.usageTracking && H.refreshSystem) H.refreshSystem({ usageTracking: false });
    }, (e) => {
      if (!/422|can’t be recorded|more time/i.test(String(e && e.message))) putBack(r);
    }).finally(() => { sending = null; });
    return sending;
  }

  setInterval(look, TICK);
  setInterval(send, SEND);
  // an administrator may turn it on (or off) while this desktop is open: ask now and then
  setInterval(() => {
    const st = H.state;
    if (!st || !st.user || st.user.role === 'guest' || H.tasks.locked()) return;
    const today = dayOf(new Date());
    H.api('usage.get', undefined, { from: today, to: today }).then((r) => {
      if (r && !!r.tracking !== !!(st.system && st.system.usageTracking) && H.refreshSystem) H.refreshSystem({ usageTracking: !!r.tracking });
    }, () => {});
  }, 5 * 60 * 1000);
  H.tasks.beforeLeaving(() => { look(); return send(); });
  // the page going (closed, reloaded): what is left goes with it
  window.addEventListener('pagehide', () => {
    look();
    const r = take();
    if (!r || !window.LOS_endpoint) return;
    try {
      fetch(window.LOS_endpoint('usage.add'), {
        method: 'POST', keepalive: true, credentials: 'same-origin', body: JSON.stringify(r),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': H.csrf || '' },
      });
    } catch (e) { /* gone */ }
  });
})();
