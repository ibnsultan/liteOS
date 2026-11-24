/*
 * System Monitor › Storage: the user's own drive (used and free, split into Desktop, Documents, Downloads and the
 * rest; by top folder; the largest files; the Trash), each opened in Files; then, for administrators only, everyone's
 * storage: all users together and one bar per account, with what the colours mean beside them. The guest's files are
 * in its own browser: it sees its drive's total and Trash only. Loaded before app.js, which calls
 * window.SMStorage(OS, host).
 */
window.SMStorage = function (OS, host) {
  'use strict';

  const esc = (s) => OS.util.escape(s == null ? '' : s);
  const ico = (n, s) => OS.icon(n, s || 16);
  const size = (b) => OS.util.formatSize(b || 0);
  const PARTS = [
    ['desktop', 'Desktop', '#2F6FD6', 'Files and folders on the desktop'],
    ['documents', 'Documents', '#1D9E75', 'The Documents folder'],
    ['downloads', 'Downloads', '#B4500A', 'Files saved from the web'],
    ['other', 'Other', '#9A9BA3', 'Pictures, Music, Videos, other folders and Trash'],
  ];
  const admin = () => !!(OS.user && OS.user.role === 'admin');
  const guest = () => !!(OS.user && OS.user.role === 'guest');
  const st = { mine: null, users: null, error: '', loading: false, query: '' };
  const matches = (s) => !st.query || String(s || '').toLowerCase().includes(st.query);

  async function load() {
    st.loading = true;
    host.redraw();
    try {
      if (guest()) {
        const [u, t] = await Promise.all([OS.fs.usage(), OS.fs.trash.list().catch(() => [])]);
        st.mine = { used: u.used, quota: u.quota, folders: [], other: 0, trash: { bytes: t.reduce((a, x) => a + (x.size || 0), 0), items: t.length }, largest: [], guest: true };
      } else {
        const [mine, users] = await Promise.all([OS.api('fs.summary', undefined, {}), admin() ? OS.api('users.storage', undefined, {}) : Promise.resolve(null)]);
        st.mine = mine;
        st.users = users;
      }
      st.error = '';
    } catch (e) { st.error = e.message; }
    st.loading = false;
    host.redraw();
  }

  /** The four parts of a drive, from the folders of one's own drive. */
  function partsOf(m) {
    const p = { desktop: 0, documents: 0, downloads: 0, other: m.other + m.trash.bytes };
    m.folders.forEach((f) => { const k = f.name.toLowerCase(); if (k in p && k !== 'other') p[k] += f.bytes; else p.other += f.bytes; });
    return p;
  }
  /** A bar of the parts, each its share of `of` (the quota): free is what is left. */
  function meter(parts, of, label) {
    return '<span class="sm-meter" role="img" aria-label="' + esc(label) + '">' + PARTS.map(([k, , c]) => {
      const w = of ? Math.min(100, parts[k] / of * 100) : 0;
      return w > 0 ? '<i style="width:' + Math.max(0.4, w).toFixed(2) + '%;background:' + c + '"></i>' : '';
    }).join('') + '</span>';
  }
  const folderLabel = (m) => PARTS.map(([k, l]) => l + ' ' + size(partsOf(m)[k])).join(', ');
  const where = (path) => { const parts = OS.util.dirname(path).split('/').filter(Boolean); return parts.length ? parts.join(' › ') : 'My drive'; };

  function render() {
    const head = '<div class="sm-hd"><h1>Storage</h1>' + (guest() ? '' : '<button type="button" class="btn" data-act="files">Open Files</button>') + '</div>';
    const m = st.mine;
    if (!m) return head + '<div class="sm-empty">' + (st.error ? esc(st.error) : 'Loading…') + '</div>';
    const free = Math.max(0, m.quota - m.used);
    let html = head + '<div class="sm-usage">' +
      '<div class="sm-total sm-drive"><b>My drive</b><span>' + size(m.used) + ' used of ' + size(m.quota) + ', ' + size(free) + ' free</span></div>';
    if (m.guest) {
      html += '<span class="sm-meter"><i style="width:' + Math.min(100, m.used / Math.max(1, m.quota) * 100).toFixed(2) + '%;background:#2F6FD6"></i></span>' +
        '<p class="sm-muted sm-small">A guest’s files are kept in this browser.</p>' + trash(m) + '</div>';
      return html;
    }
    html += meter(partsOf(m), m.quota, size(m.used) + ' of ' + size(m.quota) + ' used: ' + folderLabel(m)) +
      '<div class="sm-legend">' + PARTS.map(([k, l, c]) => '<span><i style="background:' + c + '"></i>' + (k === 'other' ? 'Trash and other' : l) + '</span>').join('') + '</div>' +
      '<div class="sm-three sm-two">' +
      '<div><h2 class="sm-sec sm-sec-gap">By folder</h2>' + folders(m) + trash(m) + '</div>' +
      '<div><h2 class="sm-sec sm-sec-gap">Largest files</h2>' + largest(m) + '</div></div>';
    if (admin() && st.users) html += everyone();
    return html + '</div>';
  }
  function folders(m) {
    const rows = m.folders.filter((f) => matches(f.name));
    const max = Math.max(1, ...rows.map((f) => f.bytes));
    return rows.length ? rows.map((f) => '<div class="sm-fr"><span>' + esc(f.name) + '</span><span class="sm-bar"><i style="width:' + Math.max(f.bytes ? 2 : 0, Math.round(f.bytes / max * 100)) + '%;background:#2F6FD6"></i></span>' +
      '<span class="sm-muted r">' + size(f.bytes) + '</span><button type="button" class="icon-btn" data-folder="' + esc(f.path) + '" title="Open ' + esc(f.name) + ' in Files" aria-label="Open ' + esc(f.name) + ' in Files">' + ico('external', 15) + '</button></div>').join('')
      : '<p class="sm-muted sm-small">' + (st.query ? 'No folder matches.' : 'No folders.') + '</p>';
  }
  function trash(m) {
    const t = m.trash;
    return '<h2 class="sm-sec sm-sec-gap">Trash</h2><div class="sm-trash"><span>' + (t.items ? t.items + (t.items === 1 ? ' item, ' : ' items, ') + size(t.bytes) : 'Empty') + '</span>' +
      '<button type="button" class="btn" data-act="trash">Open Trash</button><button type="button" class="btn sm-danger" data-act="empty"' + (t.items ? '' : ' disabled') + '>Empty Trash</button></div>';
  }
  function largest(m) {
    const rows = m.largest.filter((f) => matches(f.name) || matches(f.path));
    return rows.length ? rows.map((f) => '<div class="sm-lf" title="' + esc(f.path) + '">' + OS.fileTile({ name: f.name, type: 'file' }, 18) + '<span>' + esc(f.name) + '</span><span class="sm-muted">' + esc(where(f.path)) + '</span>' +
      '<span class="sm-muted r">' + size(f.size) + '</span><button type="button" class="icon-btn" data-show="' + esc(f.path) + '" title="Show in Files" aria-label="Show ' + esc(f.name) + ' in Files">' + ico('external', 15) + '</button></div>').join('')
      : '<p class="sm-muted sm-small">' + (st.query ? 'No file matches.' : 'No files yet.') + '</p>';
  }
  /** Administrators: all users together, then one bar per account, and what the colours mean. */
  function everyone() {
    const users = st.users || [];
    const used = users.reduce((a, u) => a + u.used, 0);
    const given = users.reduce((a, u) => a + u.quota, 0);
    const sum = { desktop: 0, documents: 0, downloads: 0, other: 0 };
    users.forEach((u) => PARTS.forEach(([k]) => { sum[k] += u.parts[k] || 0; }));
    const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    const rows = users.filter((u) => matches(u.name) || matches(u.username)).map((u) => '<div class="sm-su">' +
      '<span class="sm-who"><span class="sm-av" style="background:' + esc(u.color || '#2F6FD6') + '">' + esc(initials(u.name)) + '</span><span><b>' + esc(u.name) + '</b><small>' + esc(u.roleLabel) + '</small></span></span>' +
      meter(u.parts, u.quota, u.name + ': ' + PARTS.map(([k, l]) => l + ' ' + size(u.parts[k])).join(', ') + ', ' + size(Math.max(0, u.quota - u.used)) + ' free') +
      '<span class="sm-amt">' + size(u.used) + ' / ' + size(u.quota) + '<small>' + size(Math.max(0, u.quota - u.used)) + ' free</small></span>' +
      '<button type="button" class="icon-btn" data-user="' + esc(u.username) + '" title="Change ' + esc(u.name) + '’s storage in Settings" aria-label="Change ' + esc(u.name) + '’s storage">' + ico('rename', 15) + '</button></div>').join('');
    return '<div class="sm-adm"><h2 class="sm-admh">Everyone’s storage</h2>' +
      '<div class="sm-total sm-drive"><b>All users</b><span>' + size(used) + ' used of ' + size(given) + ' given out</span></div>' +
      meter(sum, given, size(used) + ' of ' + size(given) + ' given to users is used') +
      '<div class="sm-lay"><div><h2 class="sm-sec sm-sec-gap">Storage by user</h2>' + (rows || '<p class="sm-muted sm-small">Nobody matches.</p>') +
      '<p class="sm-muted sm-small">Guests keep their files in their own browser, so they aren’t listed.</p></div>' +
      '<div><h2 class="sm-sec sm-sec-gap">What the colours mean</h2><div class="sm-key">' +
      PARTS.map(([, l, c, d]) => '<div><i style="background:' + c + '"></i><span><b>' + l + '</b><small>' + d + '</small></span></div>').join('') +
      '<div><i class="free"></i><span><b>Free</b><small>Space left of the user’s storage</small></span></div></div></div></div></div>';
  }

  async function click(e) {
    const t = e.target.closest('[data-act], [data-folder], [data-show], [data-user]');
    if (!t || t.disabled) return false;
    if (t.dataset.folder) OS.open('files', { path: t.dataset.folder });
    else if (t.dataset.show) OS.open('files', { path: OS.util.dirname(t.dataset.show), select: t.dataset.show });
    else if (t.dataset.user) OS.open('settings', { page: 'accounts/users', user: t.dataset.user });
    else if (t.dataset.act === 'files') OS.open('files', {});
    else if (t.dataset.act === 'trash') OS.open('files', { path: 'trash:' });
    else if (t.dataset.act === 'empty') {
      const ok = await OS.dialog.confirm({ title: 'Empty the Trash?', message: 'Everything in the Trash will be deleted. This can’t be undone.', okLabel: 'Empty Trash', danger: true });
      if (!ok) return true;
      try { await OS.fs.trash.purge(); OS.notify('Everything in the Trash was permanently deleted.', { type: 'success', title: 'Trash emptied' }); } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t empty Trash' }); }
      load();
    }
    return true;
  }

  return {
    render,
    click,
    search(q) { st.query = q; host.redraw(); },
    placeholder: 'Search folders, files and users',
    show() { load(); },
    hide() {},
    keep: () => ({}),
    restore() {},
  };
};
