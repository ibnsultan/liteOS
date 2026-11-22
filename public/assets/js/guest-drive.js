/* LiteOS guest drive (docs/account-types.md): the built-in Guest account has no drive on the server, so its files,
   Trash, Recent files and desktop settings live in this browser, in the Origin Private File System, and stay on this
   device until the browser's site data is cleared.

   For a guest, LOS_endpoint (apps.js) sends the drive's actions to BASE/os/guestfs/<area>/<verb> instead of
   BASE/os/<area>/<verb>; this script answers exactly those URLs, with the same arguments and replies as the server's
   DriveController, TrashController and SettingsController, so the shell, Files, the dialogs and every app work
   unchanged. It runs in two places:
   - in every page a guest opens (resources/views/partials/config.blade.php loads it for guests only, before the
     SDK): it answers fetch() of those URLs, which covers every API call and apps reading a file's bytes;
   - in the guest drive's service worker (public/guest-sw.js), where the browser allows one: then <img>, <video>,
     <audio> and downloads of a guest's files work too.
   Nothing else is touched, and real accounts never use /os/guestfs/. */
(function () {
'use strict';
const inPage = typeof window !== 'undefined';
const CFG = inPage ? (window.LOS_CONFIG || {}) : null;
const PARAMS = inPage ? null : new URL(self.location.href).searchParams;
const QUOTA = Math.max(10 * 1024 * 1024, Number(inPage ? CFG.guestQuota : PARAMS.get('quota')) || 2 * 1024 * 1024 * 1024);
const KINDS = inPage ? (CFG.kinds || {}) : (() => { try { return JSON.parse(PARAMS.get('kinds') || '{}'); } catch (e) { return {}; } })();
const BASE = new URL(inPage ? CFG.base : self.registration.scope, self.location.href);
const PREFIX = BASE.pathname + 'os/guestfs/';

const HOME_FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'];
const MAX_READ = 8 * 1024 * 1024;
const MAX_WRITE = 16 * 1024 * 1024;
const RECENT_KEEP = 20;
const RECENT_SHOW = 12;
const TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  svg: 'image/svg+xml', ico: 'image/x-icon', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
  mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4',
  flac: 'audio/flac', aac: 'audio/aac', pdf: 'application/pdf', txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8', html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8', vtt: 'text/vtt; charset=utf-8', srt: 'text/plain; charset=utf-8',
  m3u: 'audio/x-mpegurl', m3u8: 'application/vnd.apple.mpegurl',
};

/** Whether a URL is one of the guest drive's. */
const handles = (url) => url.origin === BASE.origin && url.pathname.startsWith(PREFIX);

// ------------------------------------------------------------------ replies
class Fail extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new Fail(status, message); };
const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
const ok = (result) => json({ success: true, message: '', result });
function failed(e) {
  if (e instanceof Fail) return json({ success: false, message: e.message }, e.status);
  if (e && e.name === 'QuotaExceededError') return json({ success: false, message: 'This browser has no room left for guest files. Empty the Trash or delete something.' }, 507);
  return json({ success: false, message: 'Something went wrong with the guest files in this browser.' }, 500);
}

// ------------------------------------------------------------------ storage
// liteos-guest/drive: the files; liteos-guest/trash/<id>: deleted items; liteos-guest/meta/*.json: Trash records,
// Recent files and the desktop settings
let rootP = null;
const root = () => (rootP = rootP || navigator.storage.getDirectory().then((r) => r.getDirectoryHandle('liteos-guest', { create: true })));
const area = async (name) => (await root()).getDirectoryHandle(name, { create: true });
let homeReady = null;
async function drive() {
  const d = await area('drive');
  homeReady = homeReady || Promise.all(HOME_FOLDERS.map((f) => d.getDirectoryHandle(f, { create: true })));
  await homeReady;
  return d;
}

// changes run one at a time, so two windows saving at once can't lose each other's Trash or Recent records
// (across every window and the service worker at once when the browser has Web Locks, else within this one)
let queue = Promise.resolve();
const serial = (fn) => {
  if (self.navigator.locks && self.navigator.locks.request) return self.navigator.locks.request('liteos-guest-drive', fn);
  const run = queue.then(fn, fn); queue = run.catch(() => {}); return run;
};

async function readMeta(name, fallback) {
  try {
    const f = await (await (await area('meta')).getFileHandle(name)).getFile();
    return JSON.parse(await f.text());
  } catch (e) { return fallback; }
}
async function writeMeta(name, value) {
  await writeFile(await area('meta'), name, new Blob([JSON.stringify(value)]));
}
async function writeFile(dir, name, data) {
  const h = await dir.getFileHandle(name, { create: true });
  if (!h.createWritable) fail(501, 'This browser can’t save guest files. Use a recent Chrome, Edge or Firefox.');
  const w = await h.createWritable();
  await w.write(data);
  await w.close();
  return h;
}

// ------------------------------------------------------------------ paths (the server's Drive::clean rules)
function clean(path) {
  const s = String(path == null ? '' : path);
  if (s.includes('\0')) fail(400, 'Invalid path.');
  const parts = [];
  for (const part of s.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') fail(400, 'Invalid path.');
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\x00-\x1F]/.test(part) || part.length > 200) fail(400, 'File names can’t contain < > : " | ? * characters.');
    parts.push(part);
  }
  return '/' + parts.join('/');
}
function validName(name) {
  const n = String(name == null ? '' : name).trim();
  if (n === '' || n === '.' || n === '..' || n.includes('/') || n.includes('\\')) fail(400, 'Enter a valid name.');
  clean(n);
  return n;
}
const partsOf = (p) => p.split('/').filter(Boolean);
const parentOf = (p) => { const a = partsOf(p); a.pop(); return '/' + a.join('/'); };
const baseName = (p) => partsOf(p).pop() || '';
const join = (dir, name) => (dir === '/' ? '' : dir) + '/' + name;
const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

// the handle at a clean path ({ kind, handle, parent, name }) or null
async function at(p) {
  let dir = await drive();
  const a = partsOf(p);
  if (!a.length) return { kind: 'directory', handle: dir, parent: null, name: '' };
  for (let i = 0; i < a.length - 1; i++) {
    try { dir = await dir.getDirectoryHandle(a[i]); } catch (e) { return null; }
  }
  const name = a[a.length - 1];
  try { return { kind: 'file', handle: await dir.getFileHandle(name), parent: dir, name }; } catch (e) { /* not a file */ }
  try { return { kind: 'directory', handle: await dir.getDirectoryHandle(name), parent: dir, name }; } catch (e) { return null; }
}
async function dirAt(p, message) {
  const x = await at(p);
  if (!x || x.kind !== 'directory') fail(404, message || 'Folder not found.');
  return x.handle;
}
async function exists(p) { return (await at(p)) !== null; }
// "name (2).ext" in a folder when "name.ext" is taken
async function unique(dir, name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let i = 2; await exists(join(dir, candidate)); i++) candidate = base + ' (' + i + ')' + ext;
  return join(dir, candidate);
}

// ------------------------------------------------------------------ entries (Drive::entry's keys)
async function entry(p, x) {
  x = x || await at(p);
  const name = baseName(p);
  if (x.kind === 'file') {
    const f = await x.handle.getFile();
    return { name, path: p, type: 'file', ext: extOf(name), size: f.size, mtime: Math.floor(f.lastModified / 1000), count: null };
  }
  let count = 0;
  let newest = 0;
  for await (const [, h] of x.handle.entries()) {
    count++;
    if (h.kind === 'file') newest = Math.max(newest, (await h.getFile()).lastModified);
  }
  return { name, path: p, type: 'dir', ext: '', size: null, mtime: Math.floor(newest / 1000), count };
}
async function sizeOf(h) {
  if (h.kind === 'file') return (await h.getFile()).size;
  let n = 0;
  for await (const [, c] of h.entries()) n += await sizeOf(c);
  return n;
}
async function usage() { return (await sizeOf(await drive())) + (await sizeOf(await area('trash'))); }
async function checkQuota(incoming) {
  if (incoming > 0 && (await usage()) + incoming > QUOTA) fail(507, 'Not enough storage space for guest files. Empty the Trash or delete something.');
}

// ------------------------------------------------------------------ copying and moving handles
async function copyInto(src, destDir, name) {
  if (src.kind === 'file') return writeFile(destDir, name, await src.getFile());
  const d = await destDir.getDirectoryHandle(name, { create: true });
  for await (const [n, c] of src.entries()) await copyInto(c, d, n);
  return d;
}
async function moveInto(x, destDir, name) {
  if (x.kind === 'file' && typeof x.handle.move === 'function') {
    try { await x.handle.move(destDir, name); return; } catch (e) { /* fall back to copying */ }
  }
  await copyInto(x.handle, destDir, name);
  await x.parent.removeEntry(x.name, { recursive: true });
}

// ------------------------------------------------------------------ Recent files
async function pushRecent(p) {
  if (p.includes('/.')) return;
  const list = (await readMeta('recent.json', [])).filter((x) => x !== p);
  list.unshift(p);
  await writeMeta('recent.json', list.slice(0, RECENT_KEEP));
}

// ------------------------------------------------------------------ the routes
async function body(req) {
  try { return await req.json(); } catch (e) { return {}; }
}

async function handle(req, url) {
  const route = url.pathname.slice(PREFIX.length);
  const q = url.searchParams;
  const get = req.method === 'GET';
  const R = ROUTES[(get ? 'GET ' : 'POST ') + route];
  if (!R) fail(404, 'Not found.');
  return get ? R(q, req) : serial(() => R(req));
}

const ROUTES = {
  // ---------------------------------------------------------------- reading
  async 'GET fs/list'(q) {
    const p = clean(q.get('path') || '/');
    const dir = await dirAt(p);
    const items = [];
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue;
      items.push(await entry(join(p, name), { kind: h.kind, handle: h }));
    }
    items.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
    return ok(items);
  },
  async 'GET fs/stat'(q) {
    const p = clean(q.get('path') || '/');
    const x = await at(p);
    if (!x) fail(404, 'Not found.');
    return ok(await entry(p, x));
  },
  async 'GET fs/read'(q) {
    const p = clean(q.get('path'));
    const x = await at(p);
    if (!x || x.kind !== 'file') fail(404, 'File not found.');
    const f = await x.handle.getFile();
    if (f.size > MAX_READ) fail(413, 'This file is too large to open here.');
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer()); } catch (e) { fail(415, 'This file can’t be opened as text.'); }
    if (q.get('track') !== '0') await serial(() => pushRecent(p));
    return ok({ content, entry: await entry(p, x) });
  },
  async 'GET fs/raw'(q, req) {
    const p = clean(q.get('path'));
    const x = await at(p);
    if (!x || x.kind !== 'file') return new Response('File not found.', { status: 404 });
    const f = await x.handle.getFile();
    const headers = {
      'Content-Type': TYPES[extOf(p)] || 'application/octet-stream',
      'Content-Security-Policy': "sandbox allow-scripts; default-src 'self' data: blob: 'unsafe-inline'",
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
    };
    if (q.get('download') === '1') headers['Content-Disposition'] = "attachment; filename*=UTF-8''" + encodeURIComponent(baseName(p));
    // ranges, so video and music can seek
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] === '' ? Math.max(0, f.size - Number(m[2])) : Number(m[1]);
      let end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), f.size - 1) : f.size - 1;
      if (start >= f.size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + f.size } });
      headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + f.size;
      headers['Content-Length'] = String(end - start + 1);
      return new Response(f.slice(start, end + 1), { status: 206, headers });
    }
    headers['Content-Length'] = String(f.size);
    return new Response(f, { status: 200, headers });
  },
  async 'GET fs/search'(q) {
    const term = (q.get('q') || '').trim().toLowerCase();
    const kind = q.get('kind') || '';
    const exts = kind ? (KINDS[kind] || []) : null;
    const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 200));
    const found = [];
    const walk = async (dir, p) => {
      for await (const [name, h] of dir.entries()) {
        if (found.length >= limit) return;
        if (name.startsWith('.')) continue;
        const path = join(p, name);
        const match = (!exts || (h.kind === 'file' && exts.includes(extOf(name)))) && (!term || name.toLowerCase().includes(term));
        if (match) found.push(await entry(path, { kind: h.kind, handle: h }));
        if (h.kind === 'directory') await walk(h, path);
      }
    };
    await walk(await drive(), '');
    found.sort((a, b) => b.mtime - a.mtime);
    return ok(found);
  },
  async 'GET fs/usage'() { return ok({ used: await usage(), quota: QUOTA }); },
  async 'GET fs/drives'() {
    return ok([{ id: 'drive', name: 'This browser', path: '/', kind: 'disk', used: await usage(), quota: QUOTA, icon: null }]);
  },
  async 'GET fs/recent'() {
    const out = [];
    for (const p of await readMeta('recent.json', [])) {
      const x = await at(p);
      if (x && x.kind === 'file') out.push(await entry(p, x));
      if (out.length >= RECENT_SHOW) break;
    }
    return ok(out);
  },

  // ---------------------------------------------------------------- changing
  async 'POST fs/write'(req) {
    const b = await body(req);
    const p = clean(b.path);
    if (p === '/') fail(400, 'Choose a file name.');
    let data = b.content == null ? '' : b.content;
    if (typeof data !== 'string') fail(400, 'Content must be text.');
    if (b.encoding === 'base64') {
      try { const s = atob(data); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); data = u; } catch (e) { fail(400, 'Invalid file data.'); }
    } else {
      data = new TextEncoder().encode(data);
    }
    if (data.byteLength > MAX_WRITE) fail(413, 'File is too large.');
    const parent = await dirAt(parentOf(p), 'The folder doesn’t exist.');
    const x = await at(p);
    if (x && x.kind === 'directory') fail(409, 'A folder with that name already exists.');
    if (x && b.overwrite === false) fail(409, 'A file with that name already exists.');
    await checkQuota(data.byteLength - (x ? (await x.handle.getFile()).size : 0));
    await writeFile(parent, baseName(p), data);
    await pushRecent(p);
    return ok(await entry(p));
  },
  async 'POST fs/mkdir'(req) {
    const p = clean((await body(req)).path);
    if (await exists(p)) fail(409, 'Something with that name already exists.');
    const parent = await dirAt(parentOf(p), 'The parent folder doesn’t exist.');
    await parent.getDirectoryHandle(baseName(p), { create: true });
    return ok(await entry(p));
  },
  async 'POST fs/rename'(req) {
    const b = await body(req);
    const p = clean(b.path);
    if (p === '/') fail(400, 'You can’t rename your drive.');
    const name = validName(b.name);
    const x = await at(p);
    if (!x) fail(404, 'Not found.');
    const target = clean(join(parentOf(p), name));
    if (target !== p && await exists(target)) fail(409, 'Something with that name already exists.');
    if (target !== p) await moveInto(x, x.parent, name);
    return ok(await entry(target));
  },
  'POST fs/move': (req) => transfer(req, false),
  'POST fs/copy': (req) => transfer(req, true),
  async 'POST fs/upload'(req) {
    let form;
    try { form = await req.formData(); } catch (e) { fail(400, 'No files were received.'); }
    const dir = clean(form.get('path') || '/');
    const folder = await dirAt(dir);
    const files = form.getAll('files[]').filter((f) => f && typeof f === 'object' && 'size' in f);
    if (!files.length) fail(413, 'No files were received.');
    await checkQuota(files.reduce((n, f) => n + f.size, 0));
    const saved = [];
    for (const f of files) {
      const target = await unique(dir, validName(String(f.name || 'file').replace(/\\/g, '/').split('/').pop()));
      await writeFile(folder, baseName(target), f);
      saved.push(await entry(target));
    }
    return ok(saved);
  },
  async 'POST fs/delete'(req) {
    const paths = (await body(req)).paths;
    const trash = await area('trash');
    const records = await readMeta('trash.json', []);
    let moved = 0;
    for (const raw of Array.isArray(paths) ? paths : []) {
      const p = clean(raw);
      if (p === '/') continue;
      const x = await at(p);
      if (!x) continue;
      const id = [...crypto.getRandomValues(new Uint8Array(6))].map((n) => n.toString(16).padStart(2, '0')).join('');
      const size = x.kind === 'file' ? (await x.handle.getFile()).size : null;
      await moveInto(x, trash, id);
      records.unshift({ id, name: x.name, original: p, type: x.kind === 'file' ? 'file' : 'dir', size, deletedAt: Math.floor(Date.now() / 1000) });
      moved++;
    }
    await writeMeta('trash.json', records);
    return ok({ trashed: moved });
  },

  // ---------------------------------------------------------------- Trash
  async 'GET trash/list'() { return ok(await readMeta('trash.json', [])); },
  async 'POST trash/restore'(req) {
    const ids = idsOf((await body(req)).ids);
    const trash = await area('trash');
    const records = await readMeta('trash.json', []);
    let restored = 0;
    for (const r of records.filter((x) => ids.includes(x.id))) {
      let folder = parentOf(r.original);
      if (!(await at(folder)) || (await at(folder)).kind !== 'directory') folder = '/';
      const target = await unique(folder, r.name);
      const kind = r.type === 'dir' ? 'directory' : 'file';
      let handle = null;
      try { handle = kind === 'file' ? await trash.getFileHandle(r.id) : await trash.getDirectoryHandle(r.id); } catch (e) { /* already gone: just clear the record */ }
      if (handle) await moveInto({ kind, handle, parent: trash, name: r.id }, await dirAt(folder), baseName(target));
      records.splice(records.indexOf(r), 1);
      restored++;
    }
    await writeMeta('trash.json', records);
    return ok({ restored });
  },
  async 'POST trash/purge'(req) {
    const ids = idsOf((await body(req)).ids);
    const trash = await area('trash');
    const records = await readMeta('trash.json', []);
    const gone = ids.length ? records.filter((r) => ids.includes(r.id)) : records.slice();
    for (const r of gone) {
      try { await trash.removeEntry(r.id, { recursive: true }); } catch (e) { /* already gone */ }
    }
    await writeMeta('trash.json', records.filter((r) => !gone.includes(r)));
    return ok({ deleted: gone.length });
  },

  // ---------------------------------------------------------------- desktop settings
  // Only what the guest changed is kept; the shell lays it over the defaults it got from the server and checks the
  // keys it knows, as the server does for everyone else.
  async 'GET settings/get'() { return ok(await readMeta('settings.json', {})); },
  async 'POST settings/save'(req) {
    const changes = (await body(req)).settings;
    const stored = Object.assign(await readMeta('settings.json', {}), changes && typeof changes === 'object' && !Array.isArray(changes) ? changes : {});
    if (JSON.stringify(stored).length > 256 * 1024) fail(413, 'Too many settings.');
    await writeMeta('settings.json', stored);
    return ok(stored);
  },
};

const idsOf = (ids) => (Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && /^[a-f0-9]{12}$/.test(id)) : []);

async function transfer(req, copy) {
  const b = await body(req);
  const dest = clean(b.dest || '/');
  const destDir = await dirAt(dest, 'Destination folder not found.');
  const results = [];
  for (const raw of Array.isArray(b.paths) ? b.paths : []) {
    const source = clean(raw);
    if (source === '/') continue;
    const x = await at(source);
    if (!x) continue;
    if (x.kind === 'directory' && (dest === source || (dest + '/').startsWith(source + '/'))) fail(400, 'You can’t move a folder into itself.');
    if (!copy && parentOf(source) === dest) { results.push(await entry(source, x)); continue; }
    const target = await unique(dest, baseName(source));
    if (copy) {
      await checkQuota(await sizeOf(x.handle));
      await copyInto(x.handle, destDir, baseName(target));
    } else {
      await moveInto(x, destDir, baseName(target));
    }
    results.push(await entry(target));
  }
  return ok(results);
}

self.LOS_guestDrive = { handles, handle: (req) => handle(req, new URL(req.url)).catch(failed) };

// in a page: answer fetch() of the guest drive's URLs here (the service worker, when there is one, would answer them
// too; answering here first means pages work the same whether or not the browser allows one)
if (inPage && CFG.guest && self.navigator.storage && self.navigator.storage.getDirectory) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const req = new Request(input, init);
      if (handles(new URL(req.url))) return self.LOS_guestDrive.handle(req);
    } catch (e) { /* not a request this answers */ }
    return nativeFetch(input, init);
  };
}
})();
