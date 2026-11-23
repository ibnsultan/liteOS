/*
 * LiteOS Archives: the ZIP engine. Reads an archive's central directory to list it (nothing is decompressed for
 * that), and decompresses one entry at a time with the browser's own DecompressionStream, counting the bytes it
 * really produces so the admin's limits hold even when the sizes the archive declares are lies.
 *
 * A source is { size, read(start, end) -> Promise<Uint8Array> }: a file on the drive is read in pieces with HTTP
 * Range requests (the whole file only if the server answers without ranges); a USB drive's file through its Blob.
 *
 * Exposed as window.ArcZip.
 */
(function () {
  'use strict';

  const SIG_EOCD = 0x06054b50;
  const SIG_EOCD64 = 0x06064b50;
  const SIG_LOC64 = 0x07064b50;
  const SIG_CEN = 0x02014b50;
  const SIG_LOC = 0x04034b50;
  const CHUNK = 1024 * 1024;

  // ------------------------------------------------------------------ sources
  /** The archive itself couldn't be read (moved, deleted, a USB drive pulled out): never mistaken for damage. */
  class SourceError extends Error {}

  /** A source over a URL (the drive's raw URL), read in ranges. */
  async function urlSource(url, size) {
    let whole = null; // the server ignored Range: the whole file, kept once
    const read = async (start, end) => {
      if (end <= start) return new Uint8Array(0);
      if (whole) return new Uint8Array(await whole.slice(start, end).arrayBuffer());
      let res;
      try { res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { Range: 'bytes=' + start + '-' + (end - 1) } }); } catch (ex) {
        throw new SourceError('The archive couldn’t be read. Check the connection.');
      }
      if (res.status === 404) throw new SourceError('The archive was moved or deleted.');
      if (!res.ok) throw new SourceError('The archive couldn’t be read.');
      if (res.status === 206) return new Uint8Array(await res.arrayBuffer());
      whole = await res.blob();
      return new Uint8Array(await whole.slice(start, end).arrayBuffer());
    };
    return { size, read };
  }
  /** A source over a Blob (a USB drive's file, or a file dropped on the window). */
  function blobSource(blob) {
    return {
      size: blob.size,
      read: async (start, end) => {
        try { return new Uint8Array(await blob.slice(start, end).arrayBuffer()); } catch (ex) {
          throw new SourceError('The archive can’t be read any more. Was the USB drive removed?');
        }
      },
    };
  }

  // ------------------------------------------------------------------ helpers
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;
  const utf8 = new TextDecoder('utf-8');
  // names without the UTF-8 flag are in the old DOS code page (437): its upper half, so they show right
  const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
  function cp437(bytes) {
    let s = '';
    for (const c of bytes) s += c < 128 ? String.fromCharCode(c) : CP437[c - 128];
    return s;
  }
  function dosDate(date, time) {
    if (!date) return 0;
    const d = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
    return isNaN(d) ? 0 : Math.round(d.getTime() / 1000);
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(crc, bytes) {
    let c = crc ^ 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /**
   * An entry's name made safe to write under a folder, or null when it climbs out of it: absolute paths, drive
   * letters and ".." are refused; backslashes count as separators; "." segments and empty ones are dropped.
   */
  function safePath(name) {
    const raw = String(name).replace(/\\/g, '/');
    if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return null;
    const parts = [];
    for (const p of raw.split('/')) {
      if (p === '' || p === '.') continue;
      if (p === '..') return null;
      if (/[\u0000-\u001f]/.test(p)) return null;
      parts.push(p);
    }
    return parts.length ? parts.join('/') : null;
  }

  // ------------------------------------------------------------------ reading the directory
  /**
   * Opens a ZIP: -> { entries: [{ name, path (safe, or null), dir, link, encrypted, method, size, packed, mtime,
   * crc, offset }], comment }. Throws when it isn't a ZIP or is damaged.
   */
  async function open(src) {
    if (src.size < 22) throw new Error('This isn’t a ZIP archive.');
    const tailLen = Math.min(src.size, 22 + 65535 + 20);
    const tailStart = src.size - tailLen;
    const tail = await src.read(tailStart, src.size);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === SIG_EOCD) { e = i; break; }
    if (e < 0) throw new Error('This isn’t a ZIP archive, or it is incomplete.');
    let count = u16(tail, e + 10);
    let cdSize = u32(tail, e + 12);
    let cdOffset = u32(tail, e + 16);
    const commentLen = u16(tail, e + 20);
    const comment = utf8.decode(tail.subarray(e + 22, e + 22 + commentLen));
    // ZIP64: the real numbers are in the ZIP64 end record, found through its locator just before
    if ((count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) && e >= 20 && u32(tail, e - 20) === SIG_LOC64) {
      const at = u64(tail, e - 20 + 8);
      const rec = await src.read(at, at + 56);
      if (u32(rec, 0) !== SIG_EOCD64) throw new Error('The archive is damaged.');
      count = u64(rec, 32);
      cdSize = u64(rec, 40);
      cdOffset = u64(rec, 48);
    }
    if (cdOffset + cdSize > src.size) throw new Error('The archive is damaged or incomplete.');
    const cd = await src.read(cdOffset, cdOffset + cdSize);
    const entries = [];
    let o = 0;
    for (let n = 0; n < count; n++) {
      if (o + 46 > cd.length || u32(cd, o) !== SIG_CEN) throw new Error('The archive is damaged.');
      const madeBy = u16(cd, o + 4);
      const flags = u16(cd, o + 8);
      const method = u16(cd, o + 10);
      const time = u16(cd, o + 12);
      const date = u16(cd, o + 14);
      const crc = u32(cd, o + 16);
      let packed = u32(cd, o + 20);
      let size = u32(cd, o + 24);
      const nameLen = u16(cd, o + 28);
      const extraLen = u16(cd, o + 30);
      const cmtLen = u16(cd, o + 32);
      const ext = u32(cd, o + 38);
      let offset = u32(cd, o + 42);
      const nameBytes = cd.subarray(o + 46, o + 46 + nameLen);
      const name = flags & 0x800 ? utf8.decode(nameBytes) : cp437(nameBytes);
      // ZIP64 extra field: the 32-bit fields that overflowed, in this order
      let x = o + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = u16(cd, x);
        const len = u16(cd, x + 2);
        if (id === 0x0001) {
          let p = x + 4;
          if (size === 0xFFFFFFFF) { size = u64(cd, p); p += 8; }
          if (packed === 0xFFFFFFFF) { packed = u64(cd, p); p += 8; }
          if (offset === 0xFFFFFFFF) { offset = u64(cd, p); p += 8; }
        }
        x += 4 + len;
      }
      const unix = madeBy >> 8 === 3;
      const mode = unix ? ext >>> 16 : 0;
      const dir = name.endsWith('/') || name.endsWith('\\') || (!unix && (ext & 0x10) !== 0);
      entries.push({
        name, path: safePath(name), dir,
        link: unix && (mode & 0o170000) === 0o120000,
        encrypted: (flags & 1) !== 0,
        method, size, packed, crc, offset, mtime: dosDate(date, time),
      });
      o += 46 + nameLen + extraLen + cmtLen;
    }
    return { entries, comment };
  }

  const METHODS = { 0: 'Stored', 8: 'Deflate', 9: 'Deflate64', 12: 'BZIP2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 99: 'AES' };
  const methodName = (m) => METHODS[m] || 'Method ' + m;
  /** Why an entry can't be extracted here, or ''. */
  function unsupported(entry) {
    if (entry.encrypted) return 'It is password-protected.';
    if (entry.method !== 0 && entry.method !== 8) return 'Its format (' + methodName(entry.method) + ') isn’t supported yet.';
    return '';
  }

  // ------------------------------------------------------------------ extracting one entry
  class LimitError extends Error {}

  /**
   * Decompresses one entry into a Blob. opts: { maxBytes (stop beyond this), maxRatio (stop when the output
   * outgrows the packed size by more than this, past 1 MB), signal (AbortSignal), onBytes(n) (progress) }.
   * Throws a LimitError when a limit is passed: nothing of the entry is kept.
   */
  async function extract(src, entry, opts) {
    opts = opts || {};
    const why = unsupported(entry);
    if (why) throw new Error(why);
    const loc = await src.read(entry.offset, entry.offset + 30);
    if (u32(loc, 0) !== SIG_LOC) throw new Error('“' + entry.name + '” is damaged.');
    const start = entry.offset + 30 + u16(loc, 26) + u16(loc, 28);
    const end = start + entry.packed;
    if (end > src.size) throw new Error('“' + entry.name + '” is incomplete.');
    const signal = opts.signal;
    let at = start;
    const packedStream = new ReadableStream({
      async pull(ctl) {
        if (signal && signal.aborted) { ctl.error(new DOMException('Cancelled', 'AbortError')); return; }
        if (at >= end) { ctl.close(); return; }
        const next = Math.min(end, at + CHUNK);
        ctl.enqueue(await src.read(at, next));
        at = next;
      },
    });
    const out = entry.method === 8 ? packedStream.pipeThrough(new DecompressionStream('deflate-raw')) : packedStream;
    const reader = out.getReader();
    const parts = [];
    let produced = 0;
    let crc = 0;
    const maxBytes = opts.maxBytes == null ? Infinity : opts.maxBytes;
    try {
      for (;;) {
        if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const { value, done } = await reader.read();
        if (done) break;
        produced += value.length;
        if (produced > entry.size) throw new LimitError('“' + entry.name + '” is larger than the archive says.');
        if (produced > maxBytes) throw new LimitError('“' + entry.name + '” is too large.');
        if (opts.maxRatio && produced > 1024 * 1024 && produced / Math.max(1, entry.packed) > opts.maxRatio) {
          throw new LimitError('“' + entry.name + '” looks like a zip bomb.');
        }
        crc = crc32(crc, value);
        parts.push(value);
        if (opts.onBytes) opts.onBytes(value.length);
      }
    } catch (ex) {
      reader.cancel().catch(() => {});
      if (ex instanceof LimitError || ex instanceof SourceError || (ex && ex.name === 'AbortError')) throw ex;
      throw new Error('“' + entry.name + '” is damaged.');
    }
    if (produced !== entry.size) throw new Error('“' + entry.name + '” is damaged.');
    if (crc !== entry.crc) throw new Error('“' + entry.name + '” is damaged.');
    return new Blob(parts);
  }

  // ------------------------------------------------------------------ writing
  const enc = new TextEncoder();
  function dosTime(sec) {
    const d = new Date((sec || Date.now() / 1000) * 1000);
    const y = Math.max(1980, d.getFullYear());
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }
  /** Deflates a Blob with the browser's CompressionStream: -> { data (Uint8Array), crc, size }. */
  async function deflate(blob, signal) {
    const raw = new Uint8Array(await blob.arrayBuffer());
    if (signal && signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const crc = crc32(0, raw);
    const out = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return { data: new Uint8Array(out), raw, crc, size: raw.length };
  }

  /**
   * Builds a ZIP. items, in order: { name (its path in the archive, folders end in "/"), entry (copied as it is,
   * still compressed, from `src`) | blob (a new file, deflated here, or stored when that doesn't make it smaller),
   * mtime }. Names are written as UTF-8. opts: { comment, signal, onItem(i, n, name) }. -> Blob of the whole archive.
   * Only what fits in plain ZIP is written (under 4 GB, 65,535 items): larger is refused.
   */
  async function build(src, items, opts) {
    opts = opts || {};
    if (items.length > 0xFFFF) throw new Error('An archive can hold up to 65,535 items here.');
    const parts = [];
    const central = [];
    let at = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (opts.signal && opts.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (opts.onItem) opts.onItem(i, items.length, it.name);
      const name = enc.encode(it.name);
      let method, crc, size, packed, data, flags, mtime;
      if (it.entry) {
        // copied as it is: the compressed bytes and what the directory says about them, never unpacked
        const e = it.entry;
        const loc = await src.read(e.offset, e.offset + 30);
        if (u32(loc, 0) !== SIG_LOC) throw new Error('“' + e.name + '” is damaged.');
        const start = e.offset + 30 + u16(loc, 26) + u16(loc, 28);
        data = await src.read(start, start + e.packed);
        method = e.method; crc = e.crc; size = e.size; packed = e.packed; flags = (e.encrypted ? 1 : 0); mtime = e.mtime;
      } else if (it.name.endsWith('/')) {
        data = new Uint8Array(0); method = 0; crc = 0; size = 0; packed = 0; flags = 0; mtime = it.mtime;
      } else {
        const d = await deflate(it.blob || await it.read(), opts.signal);
        const store = d.data.length >= d.size;
        data = store ? d.raw : d.data; method = store ? 0 : 8; crc = d.crc; size = d.size; packed = data.length; flags = 0; mtime = it.mtime;
      }
      if (at + 30 + name.length + packed > 0xFFFFFFFF) throw new Error('The archive would be larger than 4 GB, which can’t be saved here.');
      flags |= 0x800; // names in UTF-8
      const t = dosTime(mtime);
      const lh = new Uint8Array(30);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, SIG_LOC, true); lv.setUint16(4, method === 8 ? 20 : 10, true); lv.setUint16(6, flags, true); lv.setUint16(8, method, true);
      lv.setUint16(10, t.time, true); lv.setUint16(12, t.date, true); lv.setUint32(14, crc, true); lv.setUint32(18, packed, true); lv.setUint32(22, size, true);
      lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      parts.push(lh, name, data);
      const ch = new Uint8Array(46);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, SIG_CEN, true); cv.setUint16(4, (3 << 8) | 20, true); cv.setUint16(6, method === 8 ? 20 : 10, true); cv.setUint16(8, flags, true); cv.setUint16(10, method, true);
      cv.setUint16(12, t.time, true); cv.setUint16(14, t.date, true); cv.setUint32(16, crc, true); cv.setUint32(20, packed, true); cv.setUint32(24, size, true);
      cv.setUint16(28, name.length, true); cv.setUint32(38, it.name.endsWith('/') ? ((0o40755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0, true); cv.setUint32(42, at, true);
      central.push(ch, name);
      at += 30 + name.length + packed;
    }
    const cdStart = at;
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const comment = enc.encode(opts.comment || '').subarray(0, 0xFFFF);
    const end = new Uint8Array(22 + comment.length);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, SIG_EOCD, true); ev.setUint16(8, items.length, true); ev.setUint16(10, items.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, cdStart, true);
    ev.setUint16(20, comment.length, true);
    end.set(comment, 22);
    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }
  /** An empty archive (a new one). */
  const empty = () => { const b = new Uint8Array(22); new DataView(b.buffer).setUint32(0, SIG_EOCD, true); return new Blob([b], { type: 'application/zip' }); };

  window.ArcZip = Object.freeze({ urlSource, blobSource, open, extract, build, empty, unsupported, methodName, safePath, LimitError, SourceError });
})();
