/*
|--------------------------------------------------------------------------
| iCalendar (.ics), read and written
|--------------------------------------------------------------------------
|
| Shared by the desktop (the calendar flyout's events) and the Calendar app: window.LOS_ics. A calendar is one .ics
| file in /Calendar; its events are VEVENTs. What this doesn't understand (other components, properties it doesn't
| use) is kept and written back as it was, so a file made elsewhere survives being edited here.
|
| Times: a time with Z is UTC, one with a TZID or none is taken as this computer's local time (an event's own time
| zone comes later). An all-day event is a DATE; its end is the day after its last day, as the format has it.
|
| Repeats: an event's RRULE (daily, weekly on chosen days, monthly, yearly; every N; until a date or a number of
| times), the dates left out of it (EXDATE), and single occurrences changed on their own (a VEVENT with the same UID
| and a RECURRENCE-ID). expand() turns them into the occurrences between two times; a rule with parts this doesn't
| read is kept as written and expanded by the parts it does.
|
| Reminders: an event's VALARMs, read as minutes before its start (a trigger after the start is a negative number; an
| all-day event's start is its midnight). An alarm this doesn't read (an absolute time) is kept as written and not
| rung. A calendar's default reminder for new events is its X-LITEOS-DEFAULT-ALARM (minutes).
|
*/
(function () {
  'use strict';

  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  /** Lines unfolded (a line starting with a space or tab continues the one before). */
  function unfold(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  }
  /** One line folded at 75 characters, as the format asks. */
  function fold(line) {
    const out = [];
    let s = line;
    while (s.length > 75) { out.push(s.slice(0, 75)); s = ' ' + s.slice(75); }
    out.push(s);
    return out.join('\r\n');
  }
  const unescape = (v) => String(v).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  const escape = (v) => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

  /** NAME;PARAM=V:VALUE -> { name, params, value } */
  function parseLine(line) {
    let i = 0, inQuote = false;
    for (; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuote = !inQuote;
      else if (c === ':' && !inQuote) break;
    }
    const head = line.slice(0, i);
    const value = line.slice(i + 1);
    const parts = head.split(';');
    const params = {};
    parts.slice(1).forEach((p) => { const k = p.indexOf('='); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ''); });
    return { name: parts[0].toUpperCase(), params, value };
  }

  function parseDate(value, params) {
    const v = String(value).trim();
    if ((params && params.VALUE === 'DATE') || /^\d{8}$/.test(v)) {
      return { date: new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)), allDay: true };
    }
    const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
    if (!m) return null;
    const a = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)];
    return { date: m[7] ? new Date(Date.UTC(...a)) : new Date(...a), allDay: false };
  }
  const fmtDate = (d) => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  const fmtLocal = (d) => fmtDate(d) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  const fmtUtc = (d) => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  const fmtWhen = (d, allDay) => (allDay ? ';VALUE=DATE:' + fmtDate(d) : ':' + fmtLocal(d));

  /**
   * An RRULE value -> { freq, interval, byday: [0-6], count, until, raw }. byday is read only as plain weekdays (MO,
   * WE); a rule with other parts keeps its text (raw) to be written back unchanged while it isn't edited here.
   */
  function parseRule(v) {
    const r = { freq: '', interval: 1, byday: [], count: 0, until: null, raw: v, other: false };
    String(v).split(';').forEach((kv) => {
      const [k, val] = kv.split('=');
      const K = (k || '').toUpperCase();
      if (K === 'FREQ') r.freq = (val || '').toUpperCase();
      else if (K === 'INTERVAL') r.interval = Math.max(1, +val || 1);
      else if (K === 'COUNT') r.count = Math.max(0, +val || 0);
      else if (K === 'UNTIL') { const d = parseDate(val); r.until = d ? d.date : null; if (d && d.allDay) r.until = new Date(d.date.getFullYear(), d.date.getMonth(), d.date.getDate(), 23, 59, 59); }
      else if (K === 'BYDAY') {
        (val || '').split(',').forEach((x) => { const i = DAYS.indexOf(x.trim().toUpperCase()); if (i >= 0) r.byday.push(i); else r.other = true; });
      } else if (K && K !== 'WKST') r.other = true;
    });
    return ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.freq) ? r : null;
  }
  function ruleText(r) {
    if (r.raw && !r.edited) return r.raw;
    const parts = ['FREQ=' + r.freq];
    if (r.interval > 1) parts.push('INTERVAL=' + r.interval);
    if (r.freq === 'WEEKLY' && r.byday && r.byday.length) parts.push('BYDAY=' + r.byday.slice().sort((a, b) => a - b).map((d) => DAYS[d]).join(','));
    if (r.count) parts.push('COUNT=' + r.count);
    else if (r.until) parts.push('UNTIL=' + fmtUtc(r.until));
    return parts.join(';');
  }

  /** A duration (-PT15M, P1D, -P1DT2H) -> minutes, before the start positive (the trigger's sign flipped), or null. */
  function triggerMinutes(v) {
    const m = String(v).trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!m) return null;
    const total = (+m[2] || 0) * 10080 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0) + Math.round((+m[6] || 0) / 60);
    return m[1] === '-' ? total : -total;
  }
  function triggerText(minutes) {
    const before = minutes >= 0;
    let n = Math.abs(minutes);
    if (!n) return 'PT0S';
    const d = Math.floor(n / 1440);
    n -= d * 1440;
    const h = Math.floor(n / 60);
    const mm = n - h * 60;
    return (before ? '-' : '') + 'P' + (d ? d + 'D' : '') + (h || mm ? 'T' + (h ? h + 'H' : '') + (mm ? mm + 'M' : '') : '');
  }
  /** One VALARM's lines -> { minutes, raw } (minutes null when its trigger isn't read). */
  function parseAlarm(lines) {
    let minutes = null;
    lines.forEach((l) => {
      const p = parseLine(l);
      if (p.name === 'TRIGGER' && (!p.params.VALUE || p.params.VALUE === 'DURATION') && p.params.RELATED !== 'END') minutes = triggerMinutes(p.value);
    });
    return { minutes, raw: lines };
  }

  /**
   * parse
   *
   * -> { name, color, events: [{ uid, title, start, end, allDay, location, notes, rrule, exdates, recurrenceId,
   * extra }], head, tail }. head and tail are the calendar's own lines and the components other than events, kept to
   * write back.
   */
  function parse(text) {
    const lines = unfold(text);
    const cal = { name: '', color: '', defaultAlarm: null, events: [], head: [], tail: [] };
    let ev = null;
    let other = null;
    let alarm = null;
    let depth = 0;
    lines.forEach((raw) => {
      if (!raw) return;
      const p = parseLine(raw);
      if (p.name === 'BEGIN' && p.value === 'VCALENDAR') return;
      if (p.name === 'END' && p.value === 'VCALENDAR') return;
      if (other) {
        other.push(raw);
        if (p.name === 'BEGIN') depth++;
        if (p.name === 'END' && --depth === 0) { cal.tail.push(other.join('\r\n')); other = null; }
        return;
      }
      if (alarm) {
        alarm.push(raw);
        if (p.name === 'END' && p.value === 'VALARM') { ev.alarms.push(parseAlarm(alarm)); alarm = null; }
        return;
      }
      if (p.name === 'BEGIN' && p.value === 'VEVENT' && !ev) { ev = { uid: '', title: '', start: null, end: null, allDay: false, location: '', notes: '', rrule: null, exdates: [], recurrenceId: null, alarms: [], extra: [] }; return; }
      if (p.name === 'BEGIN' && !ev) { other = [raw]; depth = 1; return; }
      if (ev) {
        if (p.name === 'END' && p.value === 'VEVENT') {
          if (ev.start) {
            if (!ev.end) ev.end = ev.allDay ? new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate() + 1) : new Date(ev.start.getTime() + 3600000);
            if (!ev.uid) ev.uid = uid();
            cal.events.push(ev);
          }
          ev = null;
          return;
        }
        if (p.name === 'BEGIN' && p.value === 'VALARM') { alarm = [raw]; return; }
        if (p.name === 'BEGIN') { ev.extra.push(raw); return; }
        switch (p.name) {
          case 'UID': ev.uid = p.value; break;
          case 'SUMMARY': ev.title = unescape(p.value); break;
          case 'LOCATION': ev.location = unescape(p.value); break;
          case 'DESCRIPTION': ev.notes = unescape(p.value); break;
          case 'DTSTART': { const d = parseDate(p.value, p.params); if (d) { ev.start = d.date; ev.allDay = d.allDay; } break; }
          case 'DTEND': { const d = parseDate(p.value, p.params); if (d) ev.end = d.date; break; }
          case 'RRULE': { const r = parseRule(p.value); if (r) ev.rrule = r; else ev.extra.push(raw); break; }
          case 'EXDATE': p.value.split(',').forEach((v) => { const d = parseDate(v, p.params); if (d) ev.exdates.push(d.date); }); break;
          case 'RECURRENCE-ID': { const d = parseDate(p.value, p.params); if (d) ev.recurrenceId = d.date; break; }
          default: ev.extra.push(raw);
        }
        return;
      }
      if (p.name === 'X-WR-CALNAME') cal.name = unescape(p.value);
      else if (p.name === 'X-APPLE-CALENDAR-COLOR' || p.name === 'COLOR') cal.color = p.value;
      else if (p.name === 'X-LITEOS-DEFAULT-ALARM') { const n = parseInt(p.value, 10); cal.defaultAlarm = isFinite(n) ? n : null; }
      else if (p.name !== 'VERSION' && p.name !== 'PRODID') cal.head.push(raw);
    });
    return cal;
  }

  function stringify(cal) {
    const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LiteOS//Calendar//EN'];
    if (cal.name) out.push('X-WR-CALNAME:' + escape(cal.name));
    if (cal.color) out.push('X-APPLE-CALENDAR-COLOR:' + cal.color);
    if (cal.defaultAlarm != null) out.push('X-LITEOS-DEFAULT-ALARM:' + cal.defaultAlarm);
    (cal.head || []).forEach((l) => out.push(l));
    const stamp = fmtUtc(new Date());
    (cal.events || []).forEach((e) => {
      out.push('BEGIN:VEVENT', 'UID:' + (e.uid || uid()), 'DTSTAMP:' + stamp);
      out.push('DTSTART' + fmtWhen(e.start, e.allDay), 'DTEND' + fmtWhen(e.end, e.allDay));
      if (e.recurrenceId) out.push('RECURRENCE-ID' + fmtWhen(e.recurrenceId, e.allDay));
      if (e.rrule) out.push('RRULE:' + ruleText(e.rrule));
      (e.exdates || []).forEach((d) => out.push('EXDATE' + fmtWhen(d, e.allDay)));
      out.push('SUMMARY:' + escape(e.title || ''));
      if (e.location) out.push('LOCATION:' + escape(e.location));
      if (e.notes) out.push('DESCRIPTION:' + escape(e.notes));
      (e.extra || []).filter((l) => !/^DTSTAMP[:;]/i.test(l)).forEach((l) => out.push(l));
      (e.alarms || []).forEach((a) => {
        if (a.raw && !a.edited) a.raw.forEach((l) => out.push(l));
        else if (a.minutes != null) out.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + escape(e.title || 'Reminder'), 'TRIGGER:' + triggerText(a.minutes), 'END:VALARM');
      });
      out.push('END:VEVENT');
    });
    (cal.tail || []).forEach((c) => out.push(c));
    out.push('END:VCALENDAR');
    return out.map(fold).join('\r\n') + '\r\n';
  }

  function uid() {
    const r = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    return r + '@liteos';
  }

  /*
  |--------------------------------------------------------------------------
  | Repeats turned into occurrences
  |--------------------------------------------------------------------------
  */

  /** The starts a rule makes, in order, from the event's own start; fn(start) returning false stops. */
  function eachStart(ev, fn) {
    const r = ev.rrule;
    const s = ev.start;
    const at = (y, m, d) => new Date(y, m, d, s.getHours(), s.getMinutes(), s.getSeconds());
    let n = 0;
    const emit = (d) => {
      if (d < s) return true;
      if (r.until && d > r.until) return false;
      if (r.count && n >= r.count) return false;
      n++;
      return fn(d) !== false;
    };
    const step = r.interval || 1;
    for (let k = 0; k < 20000; k++) {
      if (r.freq === 'DAILY') {
        if (!emit(at(s.getFullYear(), s.getMonth(), s.getDate() + k * step))) return;
      } else if (r.freq === 'WEEKLY') {
        const days = r.byday && r.byday.length ? r.byday.slice().sort((a, b) => a - b) : [s.getDay()];
        const wk = new Date(s.getFullYear(), s.getMonth(), s.getDate() - s.getDay() + k * step * 7);
        for (const d of days) { if (!emit(at(wk.getFullYear(), wk.getMonth(), wk.getDate() + d))) return; }
      } else if (r.freq === 'MONTHLY') {
        const d = at(s.getFullYear(), s.getMonth() + k * step, s.getDate());
        if (d.getDate() === s.getDate() && !emit(d)) return;
      } else if (r.freq === 'YEARLY') {
        const d = at(s.getFullYear() + k * step, s.getMonth(), s.getDate());
        if (d.getMonth() === s.getMonth() && !emit(d)) return;
      } else return;
    }
  }

  /**
   * expand
   *
   * The occurrences of events between a and b: a one-off event as it is; a repeating one as each of its occurrences
   * there (but the dates left out, and those changed on their own, which come as their own event). An occurrence is
   * { ...event, start, end, master, occ } where master is the stored event and occ its original start.
   */
  function expand(events, a, b) {
    const out = [];
    const changed = new Set();
    events.forEach((e) => { if (e.recurrenceId) changed.add(e.uid + '|' + e.recurrenceId.getTime()); });
    events.forEach((e) => {
      if (!e.rrule || e.recurrenceId) {
        if (e.start < b && e.end > a) out.push(Object.assign(Object.create(e), { master: e, occ: e.recurrenceId || e.start }));
        return;
      }
      const len = e.end - e.start;
      const skip = new Set((e.exdates || []).map((d) => d.getTime()));
      eachStart(e, (st) => {
        if (st >= b) return false;
        const en = new Date(st.getTime() + len);
        if (en > a && !skip.has(st.getTime()) && !changed.has(e.uid + '|' + st.getTime())) {
          out.push(Object.assign(Object.create(e), { start: st, end: en, master: e, occ: st }));
        }
        return true;
      });
    });
    return out;
  }

  /** The events that touch a day (local midnight to midnight), repeats included, all-day ones first, then by time. */
  function onDay(events, day) {
    const a = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1);
    return expand(events, a, b).sort((x, y) => (y.allDay - x.allDay) || (x.start - y.start));
  }

  /** The first day of the week: Settings' choice, or as the language has it. */
  function firstDay(settings) {
    const w = settings && settings.weekStart;
    if (w === 'sunday') return 0;
    if (w === 'monday') return 1;
    if (w === 'saturday') return 6;
    try { const l = new Intl.Locale(navigator.language || 'en'); const i = (l.getWeekInfo && l.getWeekInfo()) || l.weekInfo; return i ? i.firstDay % 7 : 0; } catch (e) { return 0; }
  }

  /**
   * The reminders that come due between a and b (ms): [{ at, minutes, occ }] where occ is the occurrence (expand()).
   * Events are expanded from a little before a to well after b, so a reminder days before an event is found.
   */
  function dueAlarms(events, a, b) {
    const maxBefore = Math.max(0, ...events.flatMap((e) => (e.alarms || []).map((x) => (x.minutes == null ? 0 : x.minutes)))) * 60000;
    const out = [];
    expand(events, new Date(a - 2 * 86400000), new Date(b + maxBefore + 60000)).forEach((o) => {
      (o.alarms || []).forEach((x) => {
        if (x.minutes == null) return;
        const at = o.start.getTime() - x.minutes * 60000;
        if (at > a && at <= b) out.push({ at, minutes: x.minutes, occ: o });
      });
    });
    return out.sort((x, y) => x.at - y.at);
  }

  window.LOS_ics = { parse, stringify, uid, onDay, expand, dueAlarms, firstDay, fmtDate, DAYS };
})();
