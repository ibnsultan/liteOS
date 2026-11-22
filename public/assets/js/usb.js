/* LiteOS: USB drives on a LiteLink thin client, for the shell (the Open / Save picker) and the SDK (apps reading and
 * writing files on a stick). LiteLink gives every LiteOS frame its own window.LiteLink (docs/litelink-integration.md);
 * this file only wraps this frame's one. A file on a stick has a path of its own kind, "usb:<drive>:/folder/name"
 * (the same as in Files). Off a LiteLink device, or with USB drives turned off for the connection, there are no
 * drives: list() is empty and every call on a usb: path is refused, so nothing here shows. */
(function () {
  'use strict';
  const LL = typeof window.LiteLink === 'object' && window.LiteLink && window.LiteLink.version >= 1 ? window.LiteLink : null;
  // the connection's USB drives setting: 'read' | 'write', or null (off, or not a LiteLink device)
  // the account must be allowed them too (the guest isn't: App\Support\Capabilities, LOS_CONFIG.can)
  const CAN = (window.LOS_CONFIG && window.LOS_CONFIG.can) || null;
  const access = LL && !(CAN && CAN.usb === false) ? Promise.resolve(LL.ready).then((c) => (c && c.storage && c.storage.usb) || null, () => null) : Promise.resolve(null);
  let accessNow = null;
  access.then((a) => { accessNow = a; });
  const names = new Map(); // drive id -> its name, from the last list()

  const isUsb = (p) => typeof p === 'string' && p.startsWith('usb:');
  /** "usb:sdb1:/Reports/q3.pdf" -> { id: 'sdb1', path: '/Reports/q3.pdf' }, or null */
  const parse = (p) => { const m = /^usb:([^:/]+):(\/.*)$/.exec(p || ''); return m ? { id: m[1], path: m[2] } : null; };
  const make = (id, path) => 'usb:' + id + ':' + (path || '/');
  const dirname = (p) => { const s = p.replace(/\/+$/, ''); const i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i); };
  const basename = (p) => p.replace(/\/+$/, '').split('/').pop() || '';
  const joinPath = (a, b) => ('/' + a + '/' + b).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
  const extOf = (n) => (String(n).includes('.') ? String(n).split('.').pop().toLowerCase() : '');
  /** The folder a usb: path is in (the drive's top folder for itself), or null at the top. */
  function parent(p) { const u = parse(p); return !u || u.path === '/' ? null : make(u.id, dirname(u.path)); }
  function join(dir, name) { const u = parse(dir); return u ? make(u.id, joinPath(u.path, name)) : null; }
  function driveName(id) { return names.get(id) || 'USB drive'; }
  /** What to show for a usb: path: "KINGSTON", "KINGSTON › Reports" */
  function where(p) { const u = parse(p); return u ? driveName(u.id) + (u.path === '/' ? '' : u.path.replace(/\//g, ' › ')) : ''; }

  function refused(msg) { return Promise.reject(new Error(msg)); }
  async function ready() {
    const a = await access;
    if (!a) throw new Error('USB drives aren’t available here.');
    return a;
  }

  /** The drives plugged in: [{ id, name, size, fstype, model, path: 'usb:<id>:/' }]; [] without LiteLink or USB. */
  async function drives() {
    if (!(await access)) return [];
    const list = await LL.storage.list();
    names.clear();
    return list.map((d) => { names.set(d.id, d.name); return { id: d.id, name: d.name, size: d.size, fstype: d.fstype, model: d.model, path: make(d.id, '/') }; });
  }
  /** A folder's entries in the SDK's shape ({ name, path, type: 'dir' | 'file', ext, size, mtime, usb: true }); the
   *  array's free is the drive's free space. */
  async function list(p) {
    await ready();
    const u = parse(p);
    if (!u) return refused('That isn’t a USB drive path.');
    const items = await LL.storage.browse(u.id, u.path);
    const out = items.map((e) => ({ name: e.name, path: make(u.id, joinPath(u.path, e.name)), type: e.dir ? 'dir' : 'file',
      ext: e.dir ? '' : extOf(e.name), size: e.size, mtime: e.mtime, usb: true }));
    out.free = items.free == null ? null : items.free;
    return out;
  }
  async function stat(p) {
    const u = parse(p);
    if (!u) return refused('That isn’t a USB drive path.');
    if (u.path === '/') { await ready(); return { name: driveName(u.id), path: p, type: 'dir', ext: '', size: 0, mtime: 0, usb: true }; }
    const e = (await list(make(u.id, dirname(u.path)))).find((x) => x.name === basename(u.path));
    if (!e) throw new Error('“' + basename(u.path) + '” isn’t on the USB drive any more.');
    return e;
  }
  /** The file as a Blob (up to 64 MB; LiteLink says so past that). */
  async function readBlob(p, opts) {
    await ready();
    const u = parse(p);
    if (!u) return refused('That isn’t a USB drive path.');
    return LL.storage.read(u.id, u.path, opts || {});
  }
  /** Write text, a Blob or bytes; overwrite defaults to true, as fs.write does. -> the entry */
  async function write(p, data, opts) {
    if ((await ready()) !== 'write') throw new Error('This USB drive can only be read.');
    const u = parse(p);
    if (!u) return refused('That isn’t a USB drive path.');
    const e = await LL.storage.write(u.id, u.path, data, { overwrite: !(opts && opts.overwrite === false) });
    return Object.assign({ path: p, type: 'file', ext: extOf(e.name || u.path), usb: true }, e);
  }
  async function mkdir(p) {
    if ((await ready()) !== 'write') throw new Error('This USB drive can only be read.');
    const u = parse(p);
    if (!u) return refused('That isn’t a USB drive path.');
    const e = await LL.storage.mkdir(u.id, u.path);
    return Object.assign({ path: p, type: 'dir', ext: '', usb: true }, e);
  }
  /** Calls when the drives change (plugged in, pulled out, ejected). */
  function onChange(fn) {
    access.then((a) => { if (a) ['device-added', 'device-removed', 'device-ejected'].forEach((ev) => LL.on(ev, () => fn())); });
  }

  // On a LiteLink thin client (the bridge is here), the browser's own file chooser must not open from any LiteOS page:
  // people mustn't browse the device's own files. What LiteLink offers (USB sticks, through Files and LiteOS's Open
  // dialog) is the way in. Apps hide their "from this device" commands; this is the net under them, for a chooser
  // input clicked on the page or made in code, and the file picker API. Off a LiteLink device nothing changes.
  if (LL) {
    const say = () => {
      const msg = 'This device’s own files can’t be opened here. Open files from My drive, or from a USB drive in Files.';
      try { if (window.LiteOS) window.LiteOS.notify(msg, 'error'); else if (window.LiteOSHost) window.LiteOSHost.notify(msg, { type: 'error' }); } catch (e) { /* no shell */ }
    };
    const isChooser = (el) => el && el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'file';
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () { if (isChooser(this)) { say(); return undefined; } return click.call(this); };
    if (HTMLInputElement.prototype.showPicker) {
      const showPicker = HTMLInputElement.prototype.showPicker;
      HTMLInputElement.prototype.showPicker = function () { if (isChooser(this)) { say(); return undefined; } return showPicker.call(this); };
    }
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('input[type=file], label') : null;
      const input = t && (isChooser(t) ? t : t.tagName === 'LABEL' ? t.control : null);
      if (isChooser(input)) { e.preventDefault(); say(); }
    }, true);
    ['showOpenFilePicker', 'showDirectoryPicker'].forEach((k) => {
      if (window[k]) window[k] = () => { say(); return Promise.reject(new DOMException('Not available on this device.', 'AbortError')); };
    });
  }

  window.LOS_usb = Object.freeze({
    isUsb, parse, make, parent, join, where, driveName,
    /** Resolves to 'read' | 'write', or null when there are no USB drives here. */
    access: () => access,
    /** True once known that drives may be written. */
    get writable() { return accessNow === 'write'; },
    drives, list, stat, readBlob, write, mkdir, onChange,
  });
})();
