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
*/
(function () {
  'use strict';

  const pad = (n, w) => String(n).padStart(w || 2, '0');

  /** Lines unfolded (a line starting with a space or tab continues the one before). */
  function unfold(text) {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  }
  /** One line folded at 75 octets (here: characters), as the format asks. */
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

  /**
   * parse
   *
   * -> { name, color, events: [{ uid, title, start, end, allDay, location, notes, extra }], head, tail }. head and
   * tail are the calendar's own lines and the components other than events, kept to write back.
   */
  function parse(text) {
    const lines = unfold(text);
    const cal = { name: '', color: '', events: [], head: [], tail: [] };
    let ev = null;
    let other = null; // a component this doesn't read, kept whole
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
      if (p.name === 'BEGIN' && p.value === 'VEVENT' && !ev) { ev = { uid: '', title: '', start: null, end: null, allDay: false, location: '', notes: '', extra: [] }; return; }
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
        if (p.name === 'BEGIN') { ev.extra.push(raw); return; } // an alarm inside the event: kept as it is
        switch (p.name) {
          case 'UID': ev.uid = p.value; break;
          case 'SUMMARY': ev.title = unescape(p.value); break;
          case 'LOCATION': ev.location = unescape(p.value); break;
          case 'DESCRIPTION': ev.notes = unescape(p.value); break;
          case 'DTSTART': { const d = parseDate(p.value, p.params); if (d) { ev.start = d.date; ev.allDay = d.allDay; } break; }
          case 'DTEND': { const d = parseDate(p.value, p.params); if (d) ev.end = d.date; break; }
          default: ev.extra.push(raw);
        }
        return;
      }
      if (p.name === 'X-WR-CALNAME') cal.name = unescape(p.value);
      else if (p.name === 'X-APPLE-CALENDAR-COLOR' || p.name === 'COLOR') cal.color = p.value;
      else if (p.name !== 'VERSION' && p.name !== 'PRODID') cal.head.push(raw);
    });
    return cal;
  }

  function stringify(cal) {
    const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LiteOS//Calendar//EN'];
    if (cal.name) out.push('X-WR-CALNAME:' + escape(cal.name));
    if (cal.color) out.push('X-APPLE-CALENDAR-COLOR:' + cal.color);
    (cal.head || []).forEach((l) => out.push(l));
    const stamp = fmtUtc(new Date());
    (cal.events || []).forEach((e) => {
      out.push('BEGIN:VEVENT', 'UID:' + (e.uid || uid()), 'DTSTAMP:' + stamp);
      if (e.allDay) {
        out.push('DTSTART;VALUE=DATE:' + fmtDate(e.start), 'DTEND;VALUE=DATE:' + fmtDate(e.end));
      } else {
        out.push('DTSTART:' + fmtLocal(e.start), 'DTEND:' + fmtLocal(e.end));
      }
      out.push('SUMMARY:' + escape(e.title || ''));
      if (e.location) out.push('LOCATION:' + escape(e.location));
      if (e.notes) out.push('DESCRIPTION:' + escape(e.notes));
      (e.extra || []).filter((l) => !/^DTSTAMP[:;]/i.test(l)).forEach((l) => out.push(l));
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

  /** The events that touch a day (local midnight to midnight), soonest first, all-day ones first. */
  function onDay(events, day) {
    const a = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1);
    return events.filter((e) => e.start < b && e.end > a)
      .sort((x, y) => (y.allDay - x.allDay) || (x.start - y.start));
  }

  window.LOS_ics = { parse, stringify, uid, onDay, fmtDate };
})();
