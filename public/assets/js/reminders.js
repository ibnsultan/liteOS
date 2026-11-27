/*
 * LiteOS reminders service, loaded by the desktop after os.js: rings Clock's alarms and timers while LiteOS is open,
 * whether or not the Clock window is. It reads what Clock keeps on the drive:
 *
 *   /.apps/clock/alarms.json  [{ id, time: "07:30", name, days: [0-6] (0 = Sunday; none: once), at (once: the time it
 *                                rings, ms), sound, snooze (minutes), on }]
 *   /.apps/clock/timers.json  [{ id, name, ms, state: 'idle' | 'running' | 'paused', endsAt (running), left (paused) }]
 *
 * Clock tells it about changes over the BroadcastChannel "liteos.clock"; it also reads the files again every few
 * minutes (changes made on another computer). It never writes them: a once alarm that has rung, or a timer that has
 * finished, is worked out from the time by Clock itself. Snoozes and what has rung are kept in this browser
 * (localStorage), with the last time it looked, so alarms and timers that came due while LiteOS was closed are
 * reported as missed when it opens again (up to a day back).
 *
 * Ringing is an urgent notification (shown through Do not disturb, kept until Snooze or Dismiss) with the alarm's
 * sound from sounds.js at the system volume, giving up after a minute.
 *
 * Calendar's reminders ring here too: the events of every calendar in /Calendar (read with LOS_ics, ics.js), each
 * reminder at its minutes before the event (repeats included). Once a minute it works out the reminders due in the
 * next quarter hour, and the tick rings those whose time has come (urgent, a short chime, Snooze for five minutes and
 * Open, which shows the day in Calendar). Calendar tells it about changes over "liteos.calendar". Reminders that came
 * due while LiteOS was closed (up to a day back) are told as one notification.
 */
(function () {
  'use strict';

  const H = window.LiteOSHost;
  if (!H) return;

  const ALARMS = '/.apps/clock/alarms.json';
  const TIMERS = '/.apps/clock/timers.json';
  const RELOAD = 5 * 60 * 1000;
  const LATE = 90 * 1000; // past this, a reminder is "missed" rather than rung
  const DAY = 86400000;

  let alarms = [];
  let timers = [];
  let user = null;
  let last = 0; // the last moment checked
  let started = false;
  const ringing = new Map(); // key → close()
  /** Calendar: every calendar's events, the reminders due soon, and the time that list reaches. */
  let calEvents = [];
  let calQueue = [];
  let calUntil = 0;
  const CAL_AHEAD = 15 * 60000;

  const key = (k) => 'los.reminders.' + (user && user.id != null ? user.id : 'me') + '.' + k;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(key(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch (e) { /* private window */ } },
  };

  async function read(path) {
    try {
      const r = await H.api('fs.read', undefined, { path, track: '0' });
      const v = JSON.parse(String(r.content || '[]'));
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  async function load() {
    [alarms, timers] = await Promise.all([read(ALARMS), read(TIMERS)]);
    await loadCalendars();
  }
  async function loadCalendars() {
    if (!window.LOS_ics) return;
    const all = [];
    try {
      const list = await H.api('fs.list', undefined, { path: '/Calendar' });
      for (const f of (list || []).filter((x) => x.type === 'file' && /\.ics$/i.test(x.name))) {
        try {
          const r = await H.api('fs.read', undefined, { path: f.path, track: '0' });
          window.LOS_ics.parse(r.content).events.forEach((e) => all.push(e));
        } catch (e) { /* a file that can't be read is left out */ }
      }
    } catch (e) { /* no /Calendar */ }
    calEvents = all;
    calUntil = 0; // worked out again on the next tick
  }

  // ------------------------------------------------------------------ when things ring
  /** The times an alarm rings between two moments (ms), for repeating and once alarms. */
  function occurrences(a, from, to) {
    if (!a || !a.on) return [];
    if (!a.days || !a.days.length) return a.at && a.at > from && a.at <= to ? [a.at] : [];
    const [h, m] = String(a.time || '0:0').split(':').map(Number);
    const out = [];
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 9 && d.getTime() <= to; i++) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0).getTime();
      if (a.days.includes(d.getDay()) && t > from && t <= to) out.push(t);
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  const volume = () => { const s = (H.state && H.state.settings) || {}; return s.muted ? 0 : (s.volume == null ? 80 : s.volume) / 100; };
  /** A time as the clock shows it (Settings' 24-hour time). */
  const timeText = (t) => { const s = (H.state && H.state.settings) || {}; return new Date(t).toLocaleTimeString([], { hour: s.clock24 === false ? 'numeric' : '2-digit', minute: '2-digit', hour12: s.clock24 === false }); };
  const lengthText = (ms) => {
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (h) parts.push(h + (h === 1 ? ' hour' : ' hours'));
    if (m) parts.push(m + (m === 1 ? ' minute' : ' minutes'));
    if (!h && !m) parts.push((s % 60) + ' seconds');
    return parts.join(' ');
  };

  function ring(id, title, message, sound, actions, opts) {
    if (ringing.has(id)) return;
    const o = opts || {};
    const stop = window.LOS_sounds ? window.LOS_sounds.play(sound || 'chimes', { volume: volume(), loop: o.loop !== false, maxSeconds: o.loop === false ? 6 : 60 }) : () => {};
    const close = H.notify(message, {
      app: o.app || 'clock', title, urgent: true, actions,
      onClose: () => { stop(); ringing.delete(id); },
    });
    ringing.set(id, close || (() => {}));
  }
  function missed(title, message) {
    H.notify(message, { app: 'clock', title });
  }

  function ringAlarm(a, at, snoozed) {
    const name = a.name || 'Alarm';
    ring('alarm:' + a.id, name, timeText(at) + (snoozed ? ' (snoozed)' : ''), a.sound, [
      { label: 'Snooze', action: () => snooze(a) },
      { label: 'Dismiss' },
    ]);
  }
  function snooze(a) {
    const mins = Math.max(1, +a.snooze || 10);
    const list = store.get('snoozes', []).filter((s) => s.id !== a.id);
    list.push({ id: a.id, at: Date.now() + mins * 60000 });
    store.set('snoozes', list);
  }

  function timerKey(t) { return t.id + '@' + t.endsAt; }

  /*
   * Calendar reminders
   */
  const dayKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  /** "In 15 minutes, 09:00 to 10:00, Room 4" (or Now, Tomorrow, or a date for one days away). */
  function eventText(o, now) {
    const st = o.start.getTime();
    const mins = Math.round((st - now) / 60000);
    const when = o.allDay ? (dayKey(o.start) === dayKey(new Date(now)) ? 'Today' : o.start.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }))
      : mins <= 0 ? 'Now' : mins < 60 ? 'In ' + mins + (mins === 1 ? ' minute' : ' minutes')
        : mins < 1440 && dayKey(o.start) === dayKey(new Date(now)) ? 'Today' : o.start.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    const span = o.allDay ? 'all day' : timeText(st) + ' to ' + timeText(o.end.getTime());
    return when + ', ' + span + (o.location ? ', ' + o.location : '');
  }
  function ringEvent(o, snoozed) {
    const id = 'cal:' + o.uid + '|' + o.occ.getTime();
    const now = Date.now();
    ring(id, o.title || 'Event', eventText(o, now) + (snoozed ? ' (snoozed)' : ''), 'chimes', [
      { label: 'Snooze 5 min', action: () => snoozeEvent(o) },
      { label: 'Open', action: () => H.openApp('calendar', { date: dayKey(o.start) }) },
    ], { app: 'calendar', loop: false });
  }
  function snoozeEvent(o) {
    const list = store.get('calSnoozes', []).filter((x) => !(x.uid === o.uid && x.occ === o.occ.getTime()));
    list.push({ uid: o.uid, occ: o.occ.getTime(), at: Date.now() + 5 * 60000, title: o.title, start: o.start.getTime(), end: o.end.getTime(), allDay: !!o.allDay, location: o.location || '' });
    store.set('calSnoozes', list);
  }
  const snoozedEvent = (x) => ({ uid: x.uid, occ: new Date(x.occ), title: x.title, start: new Date(x.start), end: new Date(x.end), allDay: x.allDay, location: x.location });
  /** The reminders due between two moments: rung, or (long past) gathered into one missed notification. */
  function calTick(from, now) {
    if (!window.LOS_ics) return;
    if (now + 60000 > calUntil) {
      calUntil = now + CAL_AHEAD;
      calQueue = calEvents.length ? window.LOS_ics.dueAlarms(calEvents, from, calUntil) : [];
    }
    const missedOnes = [];
    calQueue = calQueue.filter((d) => {
      if (d.at > now) return true;
      if (d.at <= from) return false;
      if (now - d.at > LATE) missedOnes.push(d.occ); else ringEvent(d.occ, false);
      return false;
    });
    const sn = store.get('calSnoozes', []);
    const keep = sn.filter((x) => {
      if (x.at > now) return true;
      if (now - x.at > LATE) missedOnes.push(snoozedEvent(x)); else ringEvent(snoozedEvent(x), true);
      return false;
    });
    if (keep.length !== sn.length) store.set('calSnoozes', keep);
    if (missedOnes.length) {
      const seen = new Set();
      const list = missedOnes.filter((o) => { const k = o.uid + '|' + o.occ.getTime(); if (seen.has(k)) return false; seen.add(k); return true; });
      H.notify(list.slice(0, 4).map((o) => (o.title || 'Event') + (o.allDay ? '' : ' (' + timeText(o.start.getTime()) + ')')).join(', ') + (list.length > 4 ? ' and ' + (list.length - 4) + ' more' : ''), {
        app: 'calendar', title: list.length === 1 ? '1 missed reminder' : list.length + ' missed reminders',
        actions: [{ label: 'Open Calendar', action: () => H.openApp('calendar', { date: dayKey(list[0].start) }) }],
      });
    }
  }

  // ------------------------------------------------------------------ the tick
  function tick() {
    const now = Date.now();
    const from = last || now;
    // alarms
    alarms.forEach((a) => {
      occurrences(a, from, now).forEach((t) => {
        if (now - t > LATE) missed('Missed alarm', (a.name || 'Alarm') + ' at ' + timeText(t));
        else ringAlarm(a, t, false);
      });
    });
    // snoozed alarms
    const snoozes = store.get('snoozes', []);
    const keep = [];
    snoozes.forEach((s) => {
      if (s.at > now) { keep.push(s); return; }
      const a = alarms.find((x) => x.id === s.id);
      if (!a) return;
      if (now - s.at > LATE) missed('Missed alarm', (a.name || 'Alarm') + ' (snoozed) at ' + timeText(s.at));
      else ringAlarm(a, s.at, true);
    });
    if (keep.length !== snoozes.length) store.set('snoozes', keep);
    // timers
    const rung = store.get('rung', []);
    let changed = false;
    timers.forEach((t) => {
      if (t.state !== 'running' || !t.endsAt || t.endsAt > now) return;
      const k = timerKey(t);
      if (rung.includes(k)) return;
      rung.push(k);
      changed = true;
      const name = t.name || 'Timer';
      if (now - t.endsAt > LATE) missed('Timer finished', name + ' finished at ' + timeText(t.endsAt) + ', while LiteOS was closed');
      else ring('timer:' + t.id, name, lengthText(t.ms) + ' are up', 'beeps', [{ label: 'Dismiss' }]);
    });
    if (changed) store.set('rung', rung.slice(-100));
    calTick(from, now);
    last = now;
    if (!tick.saved || now - tick.saved > 10000) { store.set('last', now); tick.saved = now; }
  }

  // ------------------------------------------------------------------ start
  async function start() {
    if (started) return;
    started = true;
    user = H.state.user;
    await load();
    // what came due while LiteOS was closed, up to a day back
    const before = store.get('last', 0);
    last = before && Date.now() - before < DAY ? before : Date.now();
    tick();
    setInterval(tick, 1000);
    setInterval(load, RELOAD);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
    try {
      const ch = new BroadcastChannel('liteos.clock');
      ch.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'changed') load();
        // Clock dismissed a timer or alarm that is ringing (its own Stop button)
        if (m.type === 'stop' && ringing.has(m.id)) ringing.get(m.id)();
      };
      const cal = new BroadcastChannel('liteos.calendar');
      cal.onmessage = (e) => { if ((e.data || {}).type === 'changed') loadCalendars(); };
    } catch (e) { /* no BroadcastChannel: the five-minute reload still picks changes up */ }
  }

  // the desktop signs in first: wait for a user
  (function wait() {
    if (H.state && H.state.user) start();
    else setTimeout(wait, 1000);
  })();
})();
