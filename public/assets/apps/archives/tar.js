/*
 * LiteOS Archives: the TAR and GZIP engine (.tar, .tar.gz / .tgz, and a single .gz file).
 *
 * A TAR has no directory: its files follow one another, each behind a 512-byte header. A plain .tar is read with
 * random access (only the headers are fetched while listing, then each file's bytes where they sit). A .tar.gz or
 * .gz can only be read from the start, through the browser's DecompressionStream('gzip'): listing reads it all once
 * (counting what it produces, so an archive that unpacks to more than the limits is stopped there), and extracting
 * reads it once more, keeping only the files wanted. Writing makes a .tar.gz (ustar headers, PAX for long names).
 *
 * Exposed as window.ArcTar. Entries look like ArcZip's: { name, path, dir, link, encrypted, method, size, packed,
 * mtime, offset }.
 */
(function () {
  'use strict';

  const Z = window.ArcZip;
  const BLOCK = 512;
  const latin = new TextDecoder('latin1');
  const utf8 = new TextDecoder('utf-8');
  const enc = new TextEncoder();
  const cancelled = () => new DOMException('Cancelled', 'AbortError');

  // ------------------------------------------------------------------ readers
  /** Reads a source in order, from cached 1 MB pieces, so headers that sit close together cost one request. */
  function sourceReader(src, start) {
    const PIECE = 1024 * 1024;
    let at = start || 0;
    let piece = null, pieceAt = -1;
    const get = async (from, to) => {
      const out = new Uint8Array(to - from);
      let o = 0;
      while (from < to) {
        const p = Math.floor(from / PIECE) * PIECE;
        if (p !== pieceAt) { piece = await src.read(p, Math.min(src.size, p + PIECE)); pieceAt = p; }
        const n = Math.min(to, p + piece.length) - from;
        if (n <= 0) break;
        out.set(piece.subarray(from - p, from - p + n), o);
        o += n; from += n;
      }
      return o === out.length ? out : out.subarray(0, o);
    };
    return {
      get pos() { return at; },
      async read(n) { const end = Math.min(src.size, at + n); const b = await get(at, end); at = end; return b; },
      async skip(n) { at = Math.min(src.size, at + n); },
    };
  }
  /** Reads a stream in order: read(n) gives n bytes (fewer at the end), skip(n) passes them; `produced` counts all. */
  function streamReader(stream, signal) {
    const r = stream.getReader();
    const chunks = [];
    let have = 0, done = false;
    const reader = {
      produced: 0,
      pos: 0, // bytes handed out (read or skipped), so entries know where their data starts
      onProduce: null,
      /** Puts bytes back at the front (a block looked at before deciding what the archive is). */
      unread(b) { chunks.unshift(b); have += b.length; reader.pos -= b.length; },
      async fill(n) {
        while (have < n && !done) {
          if (signal && signal.aborted) throw cancelled();
          const { value, done: d } = await r.read();
          if (d) { done = true; break; }
          chunks.push(value); have += value.length; reader.produced += value.length;
          if (reader.onProduce) reader.onProduce(reader.produced, value.length);
        }
      },
      async read(n) {
        await reader.fill(n);
        const take = Math.min(n, have);
        const out = new Uint8Array(take);
        let o = 0;
        while (o < take) {
          const c = chunks[0];
          const k = Math.min(c.length, take - o);
          out.set(c.subarray(0, k), o);
          o += k;
          if (k === c.length) chunks.shift(); else chunks[0] = c.subarray(k);
        }
        have -= take;
        reader.pos += take;
        return out;
      },
      async skip(n) {
        while (n > 0) {
          await reader.fill(Math.min(n, 1024 * 1024));
          if (!have) return;
          const k = Math.min(n, have);
          await reader.read(k);
          n -= k;
        }
      },
      cancel() { r.cancel().catch(() => {}); },
    };
    return reader;
  }
  /** The archive's bytes as a stream, read in 1 MB pieces. */
  function sourceStream(src, signal) {
    let at = 0;
    return new ReadableStream({
      async pull(ctl) {
        if (signal && signal.aborted) { ctl.error(cancelled()); return; }
        if (at >= src.size) { ctl.close(); return; }
        const next = Math.min(src.size, at + 1024 * 1024);
        ctl.enqueue(await src.read(at, next));
        at = next;
      },
    });
  }
  const gunzip = (src, signal) => sourceStream(src, signal).pipeThrough(new DecompressionStream('gzip'));

  // ------------------------------------------------------------------ headers
  const str = (b, o, n) => { let e = o; while (e < o + n && b[e]) e++; return utf8.decode(b.subarray(o, e)); };
  function num(b, o, n) {
    if (b[o] & 0x80) { // base-256, for sizes over 8 GB
      let v = b[o] & 0x7f;
      for (let i = 1; i < n; i++) v = v * 256 + b[o + i];
      return v;
    }
    const s = latin.decode(b.subarray(o, o + n)).replace(/\0.*$/, '').trim();
    return s ? parseInt(s, 8) || 0 : 0;
  }
  function checksumOk(h) {
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    return sum === num(h, 148, 8);
  }
  const isZero = (h) => { for (let i = 0; i < h.length; i++) if (h[i]) return false; return true; };
  /** PAX records ("27 path=a/long/name\n") as an object. */
  function pax(bytes) {
    const out = {};
    const s = utf8.decode(bytes);
    let i = 0;
    while (i < s.length) {
      const sp = s.indexOf(' ', i);
      if (sp < 0) break;
      const len = parseInt(s.slice(i, sp), 10);
      if (!len) break;
      const rec = s.slice(sp + 1, i + len - 1);
      const eq = rec.indexOf('=');
      if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
      i += len;
    }
    return out;
  }
  /** Looks like a TAR header (a checksum that adds up)? */
  const looksTar = (h) => h.length >= BLOCK && !isZero(h.subarray(0, BLOCK)) && checksumOk(h);

  /**
   * Walks a TAR from a reader: for each file, folder or link, onEntry(entry, reader) — it may read the entry's
   * bytes (entry.size of them) or leave them; what it leaves is skipped. Stops at the end blocks.
   */
  async function walk(reader, onEntry, signal) {
    let longName = null, longLink = null, ext = null;
    for (;;) {
      if (signal && signal.aborted) throw cancelled();
      const h = await reader.read(BLOCK);
      if (h.length < BLOCK || isZero(h)) return;
      if (!checksumOk(h)) throw new Error('The archive is damaged.');
      const type = String.fromCharCode(h[156] || 48);
      const size = num(h, 124, 12);
      const padded = Math.ceil(size / BLOCK) * BLOCK;
      if (type === 'L' || type === 'K' || type === 'x' || type === 'g') {
        const data = await reader.read(padded);
        const body = data.subarray(0, size);
        if (type === 'L') longName = str(body, 0, body.length);
        else if (type === 'K') longLink = str(body, 0, body.length);
        else if (type === 'x') ext = pax(body);
        continue;
      }
      const magic = latin.decode(h.subarray(257, 262));
      const prefix = magic === 'ustar' ? str(h, 345, 155) : '';
      let name = (ext && ext.path) || longName || (prefix ? prefix + '/' : '') + str(h, 0, 100);
      const realSize = ext && ext.size ? +ext.size : size;
      const mtime = ext && ext.mtime ? Math.floor(+ext.mtime) : num(h, 136, 12);
      longName = null; longLink = null; ext = null;
      const dir = type === '5' || name.endsWith('/');
      const entry = {
        name, path: Z.safePath(name), dir, link: type === '1' || type === '2', special: '346'.includes(type),
        encrypted: false, method: 'tar', size: dir ? 0 : realSize, packed: dir ? 0 : (reader.produced == null ? realSize : null), mtime,
        offset: reader.pos, crc: null,
      };
      let used = 0;
      const sub = {
        read: async (n) => { const b = await reader.read(Math.min(n, entry.size - used)); used += b.length; return b; },
      };
      await onEntry(entry, sub);
      const realPadded = Math.ceil(realSize / BLOCK) * BLOCK;
      await reader.skip(realPadded - used);
    }
  }

  // ------------------------------------------------------------------ opening
  /**
   * Opens a .tar, .tar.gz/.tgz or .gz. opts: { name (the archive's file name), maxBytes (stop listing a compressed
   * archive once it unpacks to more than this), maxRatio, signal, onProgress(fraction) }.
   * -> { kind: 'tar' | 'tgz' | 'gz', entries }.
   */
  async function open(src, opts) {
    opts = opts || {};
    const head = await src.read(0, Math.min(src.size, BLOCK));
    if (head[0] === 0x1f && head[1] === 0x8b) return openGz(src, head, opts);
    if (!looksTar(head)) throw new Error('This isn’t a TAR archive, or it is damaged.');
    const entries = [];
    await walk(sourceReader(src, 0), (e) => { entries.push(e); }, opts.signal);
    return { kind: 'tar', entries };
  }
  /** The name kept in a .gz file's header, if any. */
  function gzName(head) {
    const flg = head[3];
    let o = 10;
    if (flg & 4) o += 2 + (head[o] | (head[o + 1] << 8));
    if (!(flg & 8)) return '';
    let e = o;
    while (e < head.length && head[e]) e++;
    return latin.decode(head.subarray(o, e));
  }
  async function openGz(src, head, opts) {
    const stream = gunzip(src, opts.signal);
    const reader = streamReader(stream, opts.signal);
    const max = opts.maxBytes == null ? Infinity : opts.maxBytes;
    // listing a compressed archive unpacks it: stopped as soon as it outgrows the limit, or grows like a zip bomb
    reader.onProduce = (total) => {
      if (total > max) { reader.cancel(); throw new Z.LimitError('This archive unpacks to more than ' + fmt(max) + '. The limit is ' + fmt(max) + '.'); }
      if (opts.maxRatio && total > 1024 * 1024 && total / Math.max(1, src.size) > opts.maxRatio) { reader.cancel(); throw new Z.LimitError('This archive looks like a zip bomb.'); }
    };
    try {
      const first = await reader.read(BLOCK);
      reader.unread(first);
      // an empty TAR is just its end blocks of zeros
      if (first.length === BLOCK && isZero(first)) { reader.cancel(); return { kind: 'tgz', entries: [] }; }
      if (looksTar(first)) {
        const entries = [];
        await walk(reader, (e) => { entries.push(e); }, opts.signal);
        reader.cancel();
        return { kind: 'tgz', entries };
      }
      // one compressed file: its size is what it unpacks to
      await reader.skip(Infinity);
      const name = gzName(head) || String(opts.name || 'file.gz').replace(/\.gz$/i, '') || 'file';
      return { kind: 'gz', entries: [{ name, path: Z.safePath(name), dir: false, link: false, encrypted: false, method: 'gz', size: reader.produced, packed: src.size, mtime: 0, offset: 0, crc: null }] };
    } catch (ex) {
      if (ex instanceof Z.LimitError || ex instanceof Z.SourceError || (ex && ex.name === 'AbortError')) throw ex;
      throw new Error('This archive is damaged or incomplete.');
    }
  }
  const fmt = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.round(n / 1048576) + ' MB');

  // ------------------------------------------------------------------ extracting
  const unsupported = (e) => (e.special ? 'It is a device or pipe, which is never extracted.' : '');

  /**
   * Unpacks the wanted file entries, one at a time, in the order they sit in the archive. For each: handle(entry,
   * readBlob) — call readBlob() to have its bytes (checked against opts.maxBytes(entry)); not calling it skips the
   * file. opts: { maxBytes(entry), signal, onBytes(n) }.
   */
  async function extractMany(kind, src, wanted, opts, handle) {
    opts = opts || {};
    const want = new Set(wanted);
    const collect = async (entry, read) => {
      const limit = opts.maxBytes ? opts.maxBytes(entry) : Infinity;
      if (entry.size > limit) throw new Z.LimitError('“' + entry.name + '” is too large.');
      const parts = [];
      let got = 0;
      while (got < entry.size) {
        if (opts.signal && opts.signal.aborted) throw cancelled();
        const b = await read(Math.min(1024 * 1024, entry.size - got));
        if (!b.length) throw new Error('“' + entry.name + '” is incomplete.');
        got += b.length;
        parts.push(b);
        if (opts.onBytes) opts.onBytes(b.length);
      }
      return new Blob(parts);
    };
    if (kind === 'tar') {
      // random access: each file read where it sits
      for (const e of [...want].sort((a, b) => a.offset - b.offset)) {
        const r = sourceReader(src, e.offset);
        await handle(e, () => collect(e, (n) => r.read(n)));
      }
      return;
    }
    if (kind === 'gz') {
      const e = wanted[0];
      const reader = streamReader(gunzip(src, opts.signal), opts.signal);
      try {
        await handle(e, async () => {
          const limit = opts.maxBytes ? opts.maxBytes(e) : Infinity;
          const parts = [];
          for (;;) {
            const b = await reader.read(1024 * 1024);
            if (!b.length) break;
            if (reader.produced > limit) throw new Z.LimitError('“' + e.name + '” is too large.');
            parts.push(b);
            if (opts.onBytes) opts.onBytes(b.length);
          }
          return new Blob(parts);
        });
      } finally { reader.cancel(); }
      return;
    }
    // .tar.gz: one pass from the start, keeping what is wanted
    const byOffset = new Map([...want].map((e) => [e.offset, e]));
    const reader = streamReader(gunzip(src, opts.signal), opts.signal);
    let left = want.size;
    try {
      await walk(reader, async (e, sub) => {
        const w = byOffset.get(e.offset);
        if (!w || !left) return;
        left--;
        await handle(w, () => collect(w, (n) => sub.read(n)));
        if (!left) throw new DoneSignal();
      }, opts.signal);
    } catch (ex) {
      if (!(ex instanceof DoneSignal)) {
        if (ex instanceof Z.LimitError || ex instanceof Z.SourceError || (ex && ex.name === 'AbortError')) throw ex;
        throw new Error(ex && ex.message ? ex.message : 'The archive is damaged.');
      }
    } finally { reader.cancel(); }
  }
  class DoneSignal extends Error {}

  // ------------------------------------------------------------------ writing a .tar.gz
  function header(name, size, mtime, dir) {
    const h = new Uint8Array(BLOCK);
    const put = (s, o, n) => h.set(enc.encode(s).subarray(0, n), o);
    const oct = (v, o, n) => put(Math.floor(v).toString(8).padStart(n - 1, '0') + '\0', o, n);
    put(name, 0, 100);
    oct(dir ? 0o755 : 0o644, 100, 8); oct(0, 108, 8); oct(0, 116, 8);
    oct(size, 124, 12); oct(mtime || Date.now() / 1000, 136, 12);
    h[156] = dir ? 53 : 48; // '5' folder, '0' file
    put('ustar', 257, 6); put('00', 263, 2);
    for (let i = 148; i < 156; i++) h[i] = 32;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += h[i];
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return h;
  }
  function paxHeader(name) {
    // a record is "<length> path=<name>\n", the length counting its own digits
    const rec = (k, v) => {
      const body = ' ' + k + '=' + v + '\n';
      const bodyLen = enc.encode(body).length;
      let len = bodyLen + 1;
      while (String(len).length + bodyLen !== len) len = String(len).length + bodyLen;
      return len + body;
    };
    const data = enc.encode(rec('path', name));
    const parts = [header('PaxHeader', data.length, 0, false), data, new Uint8Array((BLOCK - (data.length % BLOCK)) % BLOCK)];
    parts[0][156] = 120; // 'x'
    let sum = 0;
    for (let i = 148; i < 156; i++) parts[0][i] = 32;
    for (let i = 0; i < BLOCK; i++) sum += parts[0][i];
    parts[0].set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
    return parts;
  }
  /**
   * Builds a .tar.gz (or a plain .tar with opts.gzip false) from items { name (folders end in "/"), blob | read(),
   * mtime }. opts: { gzip, signal, onItem }.
   */
  async function build(items, opts) {
    opts = opts || {};
    const parts = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (opts.signal && opts.signal.aborted) throw cancelled();
      if (opts.onItem) opts.onItem(i, items.length, it.name);
      const dir = it.name.endsWith('/');
      const blob = dir ? null : (it.blob || await it.read());
      const size = blob ? blob.size : 0;
      if (enc.encode(it.name).length > 99) parts.push(...paxHeader(it.name));
      parts.push(header(it.name, size, it.mtime, dir));
      if (blob) { parts.push(blob); const pad = (BLOCK - (size % BLOCK)) % BLOCK; if (pad) parts.push(new Uint8Array(pad)); }
    }
    parts.push(new Uint8Array(BLOCK * 2));
    if (opts.gzip === false) return new Blob(parts, { type: 'application/x-tar' });
    const gz = await new Response(new Blob(parts).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    return new Blob([gz], { type: 'application/gzip' });
  }
  const empty = (gzip) => build([], { gzip });

  window.ArcTar = Object.freeze({ open, extractMany, build, empty, unsupported, looksTar });
})();
