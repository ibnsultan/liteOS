/* LiteOS Browser: tabs, new tab page, history, downloads (saved to your drive) and settings.
 * Browser data lives in the user's drive at /.browser/data.json (hidden from Files). */
LiteOS.ready((OS) => {
  'use strict';

  const U = OS.util;
  const esc = U.escape;
  const ic = (n, s) => LOS_icon(n, s || 16);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ------------------------------------------------------------ constants
  const NEWTAB = 'liteos://newtab';
  const PAGES = { [NEWTAB]: 'New tab', 'liteos://history': 'History', 'liteos://downloads': 'Downloads', 'liteos://settings': 'Browser settings' };
  const ENGINES = {
    google: { name: 'Google', url: 'https://www.google.com/search?igu=1&q=', host: 'google.com' },
    bing: { name: 'Bing', url: 'https://www.bing.com/search?q=', host: 'bing.com' },
    brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=', host: 'search.brave.com' },
    wikipedia: { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=', host: 'wikipedia.org' },
  };
  const DATA_DIR = '/.browser';
  const DATA_FILE = DATA_DIR + '/data.json';
  const LETTER_COLORS = ['#2F6FD6', '#0F7A6E', '#1A8A54', '#B7791F', '#DD630A', '#D63B41', '#C9306B', '#6B4CCB'];

  // ------------------------------------------------------------ data (history, shortcuts, downloads, settings)
  let data = { v: 1, history: [], shortcuts: [], hidden: [], downloads: [], settings: { engine: 'google', startup: 'newtab', homepage: '', saveHistory: true } };
  let dataLoaded = false;

  async function loadData() {
    try {
      const r = await OS.fs.read(DATA_FILE, { track: false });
      const j = JSON.parse(r.content || '{}');
      data = Object.assign(data, j, { settings: Object.assign({}, data.settings, j.settings || {}) });
    } catch (e) { /* first run: defaults */ }
    // Old downloads that were in progress when the window closed can't still be running.
    data.downloads.forEach((d) => { if (d.status === 'busy') { d.status = 'error'; d.error = 'Interrupted'; } });
    dataLoaded = true;
  }
  let dirReady = false;
  const saveData = U.debounce(async () => {
    if (!dataLoaded) return;
    try {
      if (!dirReady) { try { await OS.fs.mkdir(DATA_DIR); } catch (e) { /* exists */ } dirReady = true; }
      await OS.fs.write(DATA_FILE, JSON.stringify(data));
    } catch (e) { console.warn('Browser data not saved:', e.message); }
  }, 700);

  // ------------------------------------------------------------ URL helpers
  const isInternal = (u) => Object.prototype.hasOwnProperty.call(PAGES, u);
  const engine = () => ENGINES[data.settings.engine] || ENGINES.google;
  function safeUrl(u) {
    try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch (e) { return null; }
  }
  /** Address-bar text → URL, internal page or search. */
  function toUrl(text) {
    const s = String(text || '').trim();
    if (!s) return NEWTAB;
    if (isInternal(s)) return s;
    if (/^https?:\/\//i.test(s)) return safeUrl(s) || engine().url + encodeURIComponent(s);
    if (!/\s/.test(s)) {
      const hostLike = /^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d{1,5})?([/?#].*)?$/i;
      if (hostLike.test(s)) {
        const local = /^(localhost|127\.|\d{1,3}(\.\d{1,3}){3}|\[)/i.test(s);
        const u = safeUrl((local ? 'http://' : 'https://') + s);
        if (u) return u;
      }
    }
    return engine().url + encodeURIComponent(s);
  }
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
  const favUrl = (u) => 'https://www.google.com/s2/favicons?sz=64&domain=' + encodeURIComponent(hostOf(u));
  const colorFor = (s) => LETTER_COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % LETTER_COLORS.length];
  /** A favicon <img> that falls back to a coloured letter. */
  function favicon(u, cls) {
    const h = hostOf(u);
    return '<img class="' + (cls || 'br-fav') + '" src="' + esc(favUrl(u)) + '" alt="" referrerpolicy="no-referrer" data-letter="' + esc((h[0] || '?').toUpperCase()) + '" data-color="' + colorFor(h) + '">';
  }
  // Broken favicons become letter badges.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.letter) return;
    const span = document.createElement('span');
    span.className = img.classList.contains('br-fav') ? 'br-fav letter' : 'letter';
    span.textContent = img.dataset.letter;
    if (!img.classList.contains('br-fav')) span.style.background = img.dataset.color;
    img.replaceWith(span);
  }, true);

  // ------------------------------------------------------------ chrome
  const tabsEl = $('#tabs');
  const content = $('#content');
  const addr = $('#addr');
  const progress = $('#progress');
  $('#back').innerHTML = ic('back');
  $('#forward').innerHTML = ic('forward');
  $('#reload').innerHTML = ic('reload');
  $('#home').innerHTML = ic('home2');
  $('#downloads').innerHTML = ic('download');
  $('#menu').innerHTML = ic('more');
  $('#star').innerHTML = ic('star', 15);

  // Tabs live in the window's title bar: leave room for the window buttons and drag from empty space.
  if (OS.win.controlsWidth) {
    document.body.classList.add('in-shell');
    tabsEl.style.paddingRight = (OS.win.controlsWidth + 8) + 'px';
    OS.win.dragRegion(tabsEl, (t) => t === tabsEl);
  }

  // ------------------------------------------------------------ tabs
  let tabs = [];
  let active = null;
  let seq = 0;

  function makeTab(url, background) {
    const pane = document.createElement('div');
    pane.className = 'br-pane';
    pane.hidden = true;
    content.appendChild(pane);
    const t = { id: ++seq, stack: [], idx: -1, pane, frame: null, title: 'New tab', loading: false, url: NEWTAB, entering: tabs.length > 0 };
    tabs.push(t);
    if (!background || !active) activate(t);
    navigate(t, url || NEWTAB, true);
    return t;
  }

  function closeTab(t) {
    const i = tabs.indexOf(t);
    if (i < 0 || t.closing) return;
    const el = tabsEl.querySelector('[data-tab="' + t.id + '"]');
    if (el && tabs.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      t.closing = true;
      el.classList.add('leave');
      setTimeout(() => { t.closing = false; finishClose(t); }, 170);
      return;
    }
    finishClose(t);
  }

  function finishClose(t) {
    const i = tabs.indexOf(t);
    if (i < 0) return;
    t.pane.remove();
    tabs.splice(i, 1);
    if (!tabs.length) { OS.win.close(); return; }
    if (active === t) activate(tabs[Math.min(i, tabs.length - 1)]);
    renderTabs();
  }

  function activate(t) {
    active = t;
    tabs.forEach((x) => { x.pane.hidden = x !== t; });
    renderTabs();
    updateChrome();
  }

  function renderTabs() {
    tabsEl.innerHTML = tabs.map((t) => '<div class="br-tab' + (t === active ? ' active' : '') + (t.entering ? ' enter' : '') + (t.closing ? ' leave' : '') + '" role="tab" draggable="true" aria-selected="' + (t === active) + '" data-tab="' + t.id + '" title="' + esc(t.title) + '">' +
      (t.loading ? '<span class="br-spin"></span>' : isInternal(t.url) ? '<span class="br-fav">' + ic(t.url === 'liteos://history' ? 'clock' : t.url === 'liteos://downloads' ? 'download' : t.url === 'liteos://settings' ? 'settings' : 'globe', 14) + '</span>' : favicon(t.url)) +
      '<span class="br-tab-title">' + esc(t.title) + '</span><span class="br-tab-x" data-close="' + t.id + '" title="Close tab (Ctrl+W)" aria-label="Close tab">' + ic('x', 12) + '</span></div>').join('') +
      '<button class="icon-btn br-newtab" id="newTab" title="New tab (Ctrl+T)" aria-label="New tab">' + ic('plus') + '</button>';
    tabs.forEach((t) => { t.entering = false; });
  }

  function updateChrome() {
    if (!active) return;
    const t = active;
    if (document.activeElement !== addr) addr.value = isInternal(t.url) ? (t.url === NEWTAB ? '' : t.url) : t.url;
    $('#addrIco').innerHTML = ic(isInternal(t.url) ? 'search' : (t.url.startsWith('https:') ? 'lock' : 'globe'), 14);
    $('#back').disabled = t.idx <= 0;
    $('#forward').disabled = t.idx >= t.stack.length - 1;
    $('#reload').innerHTML = ic(t.loading ? 'x' : 'reload');
    $('#reload').title = t.loading ? 'Stop' : 'Reload (F5)';
    const star = $('#star');
    star.hidden = isInternal(t.url);
    const saved = data.shortcuts.some((s) => s.url === t.url);
    star.classList.toggle('on', saved);
    star.title = saved ? 'Remove from shortcuts' : 'Add to shortcuts';
    progress.hidden = !t.loading;
    $('#downloads').classList.toggle('busy', data.downloads.some((d) => d.status === 'busy'));
    OS.win.setTitle(t.title + ' — Browser');
    // usage tracking: the site's name only, never the page's address
    let host = '';
    try { host = isInternal(t.url) ? '' : new URL(t.url).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
    if (OS.win.setItem) OS.win.setItem(host ? { kind: 'site', name: host } : null);
  }

  function setLoading(t, on) {
    t.loading = on;
    clearTimeout(t.loadTimer);
    if (on) t.loadTimer = setTimeout(() => setLoading(t, false), 15000); // never spin forever
    else if (t.frame && t.frame.classList.contains('pending')) showPage(t, t.frame); // the tab stopped waiting: so does the page
    renderTabs();
    updateChrome();
  }

  // A new page loads hidden (the previous page, or a spinner, stays in front) and is swapped in: when its frame has
  // loaded, when the tab stops waiting (a page that never finishes loading, or a link that turned out to be a file),
  // or, in place of the spinner, as soon as the page reports itself. So the spinner never outlasts the tab's own.
  function showPage(t, f) {
    if (t.frame !== f || !f.classList.contains('pending')) return;
    f.classList.remove('pending');
    $$('.br-frame', t.pane).forEach((x) => { if (x !== f) x.remove(); });
    const blank = $('.br-blank', t.pane);
    if (blank) blank.remove();
  }

  // ------------------------------------------------------------ navigation
  function navigate(t, url, push) {
    if (!url) return;
    t.file = null;
    if (push) { t.stack = t.stack.slice(0, t.idx + 1); t.stack.push(url); t.idx = t.stack.length - 1; }
    t.url = url;
    if (isInternal(url)) {
      if (t.frame) { t.frame.remove(); t.frame = null; }
      t.title = PAGES[url];
      setLoading(t, false);
      renderPage(t);
      return;
    }
    // LiteOS's own address would put LiteOS inside itself
    if (isLiteOS(url)) { showSelf(t, url); return; }
    // Keep whatever is showing (previous page) until the new page has loaded, then swap.
    const hadPage = !!t.pane.querySelector('.br-frame:not(.pending)');
    if (!hadPage) { t.pane.innerHTML = '<div class="br-blank"><span class="br-spin big"></span></div>'; }
    $$('.br-frame.pending', t.pane).forEach((f) => f.remove());
    const f = makeFrame(t);
    f.classList.add('pending');
    t.pane.appendChild(f);
    t.frame = f;
    t.title = hostOf(url);
    f.src = url;
    t.expectReport = true;
    setLoading(t, true);
    recordVisit(url);
    checkFrame(t, url, f);
  }

  // ------------------------------------------------------------ follow links clicked inside pages
  // LiteOS can't see where another site's frame navigates. The LiteOS Frame Helper extension
  // reports each framed page's address and title; trust a report only from the tab's own frame,
  // and only for an address on the origin that actually sent it (no address-bar spoofing).
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'liteos-frame-location' || typeof m.url !== 'string') return;
    const t = tabs.find((x) => x.frame && x.frame.contentWindow === e.source);
    if (!t) return;
    const url = safeUrl(m.url);
    if (!url) return;
    try { if (new URL(url).origin !== e.origin) return; } catch (err) { return; }
    // The page reports itself as it starts, again once its HTML has been read, and at full load. Show it as soon as it
    // has something to show, not after every script and picture has loaded: right away in place of the spinner, and
    // over a previous page once it has its title (its head has been read and it's drawing) or shortly after it started.
    if (t.frame && t.frame.classList.contains('pending')) {
      const f = t.frame;
      if ($('.br-blank', t.pane) || (typeof m.title === 'string' && m.title.trim())) showPage(t, f);
      else { clearTimeout(t.showTimer); t.showTimer = setTimeout(() => showPage(t, f), 600); }
    }
    // A page without a title (a video or picture on its own) shows the site, not the previous page's title.
    t.title = typeof m.title === 'string' && m.title.trim() ? m.title.trim().slice(0, 200) : hostOf(url);
    if (url !== t.url) {
      if (t.expectReport) {
        t.stack[t.idx] = url; // the page we asked for, after redirects
      } else {
        t.stack = t.stack.slice(0, t.idx + 1); t.stack.push(url); t.idx = t.stack.length - 1;
        recordVisit(url);
      }
      t.url = url;
      checkFrame(t, url, t.frame); // a link to a file: save it to the drive rather than show the browser's viewer
    }
    t.expectReport = false;
    renderTabs();
    if (t === active) updateChrome();
  });

  // ------------------------------------------------------------ sites that refuse frames, and files
  // With the LiteOS Frame Helper extension (see /extension) such sites load normally. Without it,
  // ask the server whether the site refuses frames and show a card instead of a blank page.
  // The same check says whether the address is a file rather than a page (a video, a PDF, a download link). Frames
  // can't start downloads (no allow-downloads), so files never go to the computer's own Downloads: a file sent as a
  // download is saved to the drive's Downloads folder, and other files get a page with a preview and Save buttons.
  const hasFrameHelper = () => document.documentElement.hasAttribute('data-liteos-frame-helper');
  const frameChecks = new Map();
  function checkFrame(t, url, f) {
    if (!frameChecks.has(url)) {
      frameChecks.set(url, OS.api('net.framecheck', undefined, { url }).catch(() => ({ blocked: false })));
      if (frameChecks.size > 300) frameChecks.delete(frameChecks.keys().next().value);
    }
    frameChecks.get(url).then((r) => {
      if (!r || t.frame !== f || t.url !== url) return;
      if (r.file) { frameChecks.delete(url); openFile(t, url, r.file); return; }
      if (r.blocked && !hasFrameHelper()) showBlocked(t, url);
    });
  }

  /** The address is a file. A download link: save it to Downloads and stay on the page. Else show the file page. */
  function openFile(t, url, file) {
    const shown = $('.br-frame:not(.pending)', t.pane);
    if (file.attachment && t.frame && t.frame.classList.contains('pending') && shown && t.idx > 0) {
      t.frame.remove();
      t.frame = shown;
      t.stack.splice(t.idx, 1);
      t.idx--;
      t.url = t.stack[t.idx];
      t.title = hostOf(t.url);
      setLoading(t, false);
      download(url, null, { name: file.name, tab: t });
      return;
    }
    showFile(t, url, file);
    if (file.attachment) download(url, null, { name: file.name });
  }

  const KINDS = { video: 'Video', audio: 'Audio', image: 'Picture', 'application/pdf': 'PDF document', 'application/zip': 'ZIP archive', text: 'Text' };
  function kindOf(type) { return KINDS[type] || KINDS[String(type).split('/')[0]] || 'File'; }

  function showFile(t, url, file) {
    $$('.br-frame', t.pane).forEach((x) => x.remove());
    t.frame = null;
    t.file = file;
    t.title = file.name;
    setLoading(t, false);
    const major = String(file.type).split('/')[0];
    // Previews are our own elements: no download button in the video controls, and right-clicks get our menu.
    const preview = major === 'video' ? '<video class="br-file-media" controls controlslist="nodownload" preload="metadata" src="' + esc(url) + '"></video>'
      : major === 'audio' ? '<audio class="br-file-audio" controls controlslist="nodownload" preload="metadata" src="' + esc(url) + '"></audio>'
        : major === 'image' ? '<img class="br-file-media" src="' + esc(url) + '" alt="" referrerpolicy="no-referrer">' : '';
    const meta = [kindOf(file.type), file.size >= 0 ? U.formatSize(file.size) : '', hostOf(url)].filter(Boolean).join(' · ');
    t.pane.innerHTML = '<div class="br-file">' + (preview ? '<div class="br-file-preview">' + preview + '</div>' : '<span class="br-file-ico">' + ic(major === 'video' ? 'video' : major === 'audio' ? 'music' : 'file', 40) + '</span>') +
      '<div class="br-file-info"><h1>' + esc(file.name) + '</h1><p>' + esc(meta) + '</p></div>' +
      '<div class="br-file-actions"><button class="btn" data-act="file-save-as">Save as…</button><button class="btn btn-primary" data-act="file-save">Save to Downloads</button></div></div>';
    renderTabs();
    if (t === active) updateChrome();
  }
  function isLiteOS(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  }
  function showSelf(t, url) {
    $$('.br-frame', t.pane).forEach((x) => x.remove());
    t.frame = null;
    t.title = hostOf(url);
    setLoading(t, false);
    t.pane.innerHTML = '<div class="br-blocked"><div class="br-blocked-card">' + favicon(url, 'br-blocked-ico') +
      '<h1>This is LiteOS</h1>' +
      '<p>You’re already in LiteOS, so it can’t open inside itself. Open its apps from the launcher.</p>' +
      '</div></div>';
    renderTabs();
    if (t === active) updateChrome();
  }

  function showBlocked(t, url) {
    $$('.br-frame', t.pane).forEach((x) => x.remove());
    t.frame = null;
    setLoading(t, false);
    t.pane.innerHTML = '<div class="br-blocked"><div class="br-blocked-card">' + favicon(url, 'br-blocked-ico') +
      '<h1>' + esc(hostOf(url)) + ' can’t be shown here</h1>' +
      '<p>This site doesn’t allow other pages to display it, so it can’t open inside LiteOS.</p>' +
      '<div class="br-blocked-actions">' +
      '<button class="btn" data-act="copy-link">Copy link</button></div>' +
      '<p class="br-blocked-tip">The LiteOS Frame Helper browser extension lets sites like this open here.</p>' +
      '</div></div>';
  }

  function makeFrame(t) {
    const f = document.createElement('iframe');
    f.className = 'br-frame';
    // Sites get what a normal tab gives them, except taking over LiteOS itself (no allow-top-navigation) and starting
    // downloads to the computer (no allow-downloads): files are saved to the drive instead (see checkFrame).
    // Video sites need presentation (Cast), encrypted-media (licensed music and films) and picture-in-picture.
    // New tabs and windows never open outside LiteOS. With the Frame Helper, pages may open them: the helper turns
    // each one into a tab here (see 'liteos-open-tab'). Without it nothing could stop them, so pages can't open any.
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-presentation allow-pointer-lock allow-orientation-lock' +
      (hasFrameHelper() ? ' allow-popups allow-popups-to-escape-sandbox' : ''));
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    f.setAttribute('allow', 'fullscreen; clipboard-write; autoplay; encrypted-media; picture-in-picture; web-share; accelerometer; gyroscope');
    f.title = 'Web page';
    f.addEventListener('load', () => {
      sendVolume(f);
      if (t.frame !== f) return;
      showPage(t, f);
      setLoading(t, false);
      // Pages from other sites hide their address and title; keep ours.
      try { const doc = f.contentDocument; if (doc && doc.title) { t.title = doc.title; renderTabs(); updateChrome(); } } catch (e) { /* cross-origin */ }
      // Hand focus back so the next click inside the page can be noticed (see the blur handler).
      if (active === t && document.activeElement === f) setTimeout(() => { try { window.focus(); } catch (e) { /* ignore */ } }, 50);
    });
    return f;
  }

  // A click inside a web page moves focus into its frame. Links inside other sites can't be
  // observed directly, so treat that as "maybe navigating": show the loading bar until the
  // frame finishes loading, or briefly if nothing loads.
  window.addEventListener('blur', () => {
    const t = active;
    if (!t || !t.frame || document.activeElement !== t.frame) return;
    setTimeout(() => {
      if (document.activeElement !== t.frame || t.loading) return;
      setLoading(t, true);
      clearTimeout(t.loadTimer);
      t.loadTimer = setTimeout(() => setLoading(t, false), 2500);
    }, 0);
  });

  function go(text) { if (active) navigate(active, toUrl(text), true); addr.blur(); }
  function back() { const t = active; if (t && t.idx > 0) { t.idx--; navigate(t, t.stack[t.idx], false); } }
  function forward() { const t = active; if (t && t.idx < t.stack.length - 1) { t.idx++; navigate(t, t.stack[t.idx], false); } }
  function reload() {
    const t = active;
    if (!t) return;
    if (t.loading && t.frame) {
      const pending = $('.br-frame.pending', t.pane);
      const shown = $('.br-frame:not(.pending)', t.pane);
      if (pending && shown) { pending.remove(); t.frame = shown; } else t.frame.src = 'about:blank';
      setLoading(t, false);
      return;
    }
    navigate(t, t.url, false);
  }

  function recordVisit(url) {
    if (!data.settings.saveHistory) return;
    const last = data.history[0];
    if (last && last.url === url && Date.now() - last.t < 60000) return;
    data.history.unshift({ url, title: hostOf(url), t: Date.now() });
    if (data.history.length > 1500) data.history.length = 1500;
    saveData();
  }

  // ------------------------------------------------------------ shortcuts & top sites
  function tiles() {
    const out = [];
    const seen = new Set();
    data.shortcuts.forEach((s) => { const h = hostOf(s.url); if (!seen.has(h)) { seen.add(h); out.push(Object.assign({ custom: true }, s)); } });
    const counts = new Map();
    data.history.forEach((h) => {
      const host = hostOf(h.url);
      if (Object.values(ENGINES).some((e) => host.endsWith(e.host)) && /[?&](q|search)=/.test(h.url)) return; // skip search result pages
      const c = counts.get(host) || { n: 0, url: 'https://' + host + '/' };
      c.n++;
      counts.set(host, c);
    });
    [...counts.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([host, c]) => {
      if (out.length >= 8 || seen.has(host) || data.hidden.includes(host)) return;
      seen.add(host);
      out.push({ title: host, url: c.url, custom: false });
    });
    return out.slice(0, 8);
  }

  async function addShortcut(url, title) {
    if (!url) {
      const u = await OS.dialog.prompt({ title: 'Add shortcut', label: 'Web address', value: 'https://' });
      if (!u) return;
      url = toUrl(u);
      if (!safeUrl(url)) { OS.notify('Enter a web address.', { type: 'error', title: 'Invalid web address' }); return; }
      const n = await OS.dialog.prompt({ title: 'Add shortcut', label: 'Name', value: hostOf(url) });
      if (n === null) return;
      title = n.trim() || hostOf(url);
    }
    data.shortcuts = data.shortcuts.filter((s) => s.url !== url);
    data.shortcuts.push({ url, title: title || hostOf(url) });
    data.hidden = data.hidden.filter((h) => h !== hostOf(url));
    saveData();
    refreshPages();
  }

  function removeTile(tile) {
    if (tile.custom) data.shortcuts = data.shortcuts.filter((s) => s.url !== tile.url);
    else data.hidden.push(hostOf(tile.url));
    saveData();
    refreshPages();
  }

  // ------------------------------------------------------------ internal pages
  function refreshPages() { tabs.forEach((t) => { if (isInternal(t.url)) renderPage(t); }); updateChrome(); }

  function renderPage(t) {
    const u = t.url;
    if (u === NEWTAB) return renderNewTab(t);
    if (u === 'liteos://history') return renderHistory(t);
    if (u === 'liteos://downloads') return renderDownloads(t);
    if (u === 'liteos://settings') return renderSettings(t);
  }

  function renderNewTab(t) {
    const list = tiles();
    t.pane.innerHTML = '<div class="nt"><div class="nt-brand"><img src="../../assets/img/kite-blue.svg" alt="">LiteOS</div>' +
      '<form class="nt-search" data-form="search">' + ic('search', 18) + '<input class="input" name="q" placeholder="Search ' + esc(engine().name) + ' or type a web address" aria-label="Search or type a web address" autocomplete="off"></form>' +
      '<div class="nt-tiles">' + list.map((s, i) => '<button class="nt-tile" data-tile="' + i + '" title="' + esc(s.url) + '"><span class="nt-ring">' + favicon(s.url, '') + '</span>' +
        '<span class="nm">' + esc(s.title) + '</span><span class="nt-more" data-tilemenu="' + i + '" aria-label="Edit shortcut">' + ic('more', 13) + '</span></button>').join('') +
      (data.shortcuts.length < 8 ? '<button class="nt-tile" data-act="add-shortcut"><span class="nt-ring">' + ic('plus', 20) + '</span><span class="nm">Add shortcut</span></button>' : '') + '</div></div>';
    t.tileList = list;
    if (t === active) setTimeout(() => { const q = $('input[name=q]', t.pane); if (q) q.focus(); }, 30);
  }

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function renderHistory(t, query) {
    const q = (query != null ? query : (t.histQuery || '')).toLowerCase();
    t.histQuery = q;
    const items = data.history.filter((h) => !q || h.url.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q)).slice(0, 400);
    let html = '<div class="bp"><div class="bp-head"><h1>History</h1>' +
      '<label class="search" style="width:260px">' + ic('search', 14) + '<input class="input" data-input="hist" placeholder="Search history" value="' + esc(q) + '"></label>' +
      '<button class="btn" data-act="clear-history"' + (data.history.length ? '' : ' disabled') + '>Clear history</button></div>';
    if (!data.settings.saveHistory) html += '<div class="hint">History is turned off in Browser settings.</div>';
    if (!items.length) html += '<div class="bp-list"><div class="bp-empty">' + (q ? 'Nothing in your history matches “' + esc(q) + '”.' : 'Pages you visit will show up here.') + '</div></div>';
    let day = '';
    let open = false;
    items.forEach((h) => {
      const label = dayLabel(h.t);
      if (label !== day) { if (open) html += '</div>'; html += '<div class="bp-day">' + esc(label) + '</div><div class="bp-list">'; day = label; open = true; }
      const idx = data.history.indexOf(h);
      html += '<div class="bp-item"><span class="time">' + esc(new Date(h.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) + '</span>' + favicon(h.url) +
        '<button class="main" data-open="' + esc(h.url) + '"><b>' + esc(h.title || hostOf(h.url)) + '</b><small>' + esc(h.url) + '</small></button>' +
        '<span class="actions"><button class="icon-btn" data-newtab="' + esc(h.url) + '" title="Open in new tab" aria-label="Open in new tab">' + ic('plus', 14) + '</button>' +
        '<button class="icon-btn" data-delhist="' + idx + '" title="Remove from history" aria-label="Remove from history">' + ic('x', 14) + '</button></span></div>';
    });
    if (open) html += '</div>';
    t.pane.innerHTML = html + '</div>';
  }

  function renderDownloads(t) {
    // Like a browser's download history: a search and Clear all on the title line, files grouped by day.
    const q = (t.dlQuery || '').toLowerCase();
    const all = data.downloads;
    const items = all.filter((d) => !q || (d.name || '').toLowerCase().includes(q) || (d.url || '').toLowerCase().includes(q));
    let html = '<div class="bp dl"><div class="bp-head"><h1>Downloads</h1>' +
      '<label class="search dl-search">' + ic('search', 14) + '<input class="input" data-input="dl" placeholder="Search downloads" value="' + esc(t.dlQuery || '') + '" aria-label="Search downloads"></label>' +
      '<button class="btn" data-act="clear-downloads"' + (all.some((d) => d.status !== 'busy') ? '' : ' disabled') + '>Clear all</button></div>';
    if (!items.length) html += '<div class="bp-empty">' + (q ? 'No downloads match “' + esc(t.dlQuery) + '”.' : 'Files you download will show up here.') + '</div>';
    let day = '';
    items.forEach((d) => {
      const i = all.indexOf(d);
      const label = dayLabel(d.t || Date.now());
      if (label !== day) { html += '<div class="bp-day">' + esc(label) + '</div>'; day = label; }
      const name = d.name || hostOf(d.url);
      const look = window.LOS_fileLook ? window.LOS_fileLook({ name, type: 'file' }) : { icon: 'file', c: ['', 'currentColor'] };
      const title = d.status === 'done' ? '<button class="dl-name" data-dlopen="' + i + '" title="Open">' + esc(name) + '</button>' : '<span class="dl-name' + (d.status === 'error' ? ' failed' : '') + '">' + esc(name) + '</span>';
      const sub = d.status === 'busy' ? esc(progressText(d)) : d.status === 'done' ? esc(U.formatSize(d.size)) + ' · ' + esc(hostOf(d.url)) : d.error === 'Cancelled' ? 'Cancelled' : 'Failed · ' + esc(d.error || 'unknown error');
      html += '<div class="dl-item" data-dlid="' + esc(d.id || '') + '"><span class="dl-file" style="color:' + esc(look.c[1]) + '">' + ic(look.icon, 28) + '</span>' +
        '<div class="dl-main">' + title + '<small>' + sub + '</small>' +
        (d.status === 'busy' ? '<span class="dl-bar' + (d.total > 0 && d.phase !== 'save' ? ' known' : '') + '" style="--p:' + (d.total > 0 ? Math.min(100, (d.received / d.total) * 100).toFixed(1) : 0) + '%"></span>' : '') +
        (d.status === 'error' ? '<span><button class="btn btn-sm" data-dlretry="' + i + '">Retry</button></span>' : '') + '</div>' +
        '<span class="dl-actions"><button class="icon-btn" data-dlcopy="' + i + '" title="Copy download link" aria-label="Copy download link">' + ic('link', 16) + '</button>' +
        (d.status === 'done' ? '<button class="icon-btn" data-dlshow="' + i + '" title="Show in folder" aria-label="Show in folder">' + ic('folder', 16) + '</button>' : '') +
        (d.status !== 'busy' ? '<button class="icon-btn" data-dldel="' + i + '" title="Remove from list" aria-label="Remove from list">' + ic('x', 16) + '</button>'
          : d.phase !== 'save' ? '<button class="icon-btn" data-dlcancel="' + i + '" title="Cancel" aria-label="Cancel download">' + ic('x', 16) + '</button>' : '') + '</span></div>';
    });
    t.pane.innerHTML = html + '</div>';
  }

  function renderSettings(t) {
    const s = data.settings;
    const sw = (k) => '<button class="switch" role="switch" aria-checked="' + (!!s[k]) + '" data-setting="' + k + '"></button>';
    t.pane.innerHTML = '<div class="bp"><div class="bp-head"><h1>Browser settings</h1></div>' +
      '<section class="bp-section"><h2>Search engine</h2><div class="bp-engines">' +
      Object.entries(ENGINES).map(([id, e]) => '<button class="bp-engine' + (s.engine === id ? ' on' : '') + '" data-engine="' + id + '">' + favicon('https://' + e.host, '') + e.name + '</button>').join('') + '</div></section>' +
      '<section class="bp-section"><h2>On start-up</h2><div class="bp-list">' +
      '<div class="bp-row"><span class="txt"><b>Open the new tab page</b><small>Search box and your shortcuts</small></span><input type="radio" name="startup" value="newtab"' + (s.startup !== 'home' ? ' checked' : '') + ' aria-label="Open the new tab page"></div>' +
      '<div class="bp-row"><span class="txt"><b>Open a specific page</b><input class="input" data-input="homepage" placeholder="https://example.com" value="' + esc(s.homepage || '') + '" style="margin-top:6px"></span><input type="radio" name="startup" value="home"' + (s.startup === 'home' ? ' checked' : '') + ' aria-label="Open a specific page"></div></div></section>' +
      '<section class="bp-section"><h2>Privacy</h2><div class="bp-list">' +
      '<div class="bp-row"><span class="txt"><b>Save browsing history</b><small>Used for History and your most visited sites</small></span>' + sw('saveHistory') + '</div>' +
      '<div class="bp-row"><span class="txt"><b>Clear browsing history</b><small>' + data.history.length + ' pages</small></span><button class="btn" data-act="clear-history"' + (data.history.length ? '' : ' disabled') + '>Clear</button></div>' +
      '<div class="bp-row"><span class="txt"><b>Reset shortcuts</b><small>Remove your shortcuts and show hidden sites again</small></span><button class="btn" data-act="reset-shortcuts">Reset</button></div>' +
      '</div></section></div>';
  }

  // ------------------------------------------------------------ downloads
  /**
   * Saves a web file into the drive: to /Downloads, or where the user picks with opts.saveAs. The user's own browser
   * downloads it (through the Frame Helper, else directly when the site allows it), never the LiteOS server, and
   * never to the computer's own Downloads.
   */
  async function download(url, existing, opts) {
    opts = opts || {};
    url = toUrl(url);
    if (!safeUrl(url)) { OS.notify('Enter a link that starts with http:// or https://', { type: 'error', title: 'Invalid link' }); return; }
    let guess = opts.name || (existing && existing.name) || '';
    if (!guess) { const last = url.split(/[?#]/)[0].split('/').pop(); try { guess = decodeURIComponent(last); } catch (e) { guess = last; } }
    guess = guess || hostOf(url);
    let dir = '/Downloads';
    let chosen = '';
    if (opts.saveAs) {
      const path = await OS.dialog.save({ title: 'Save as', defaultName: '/Downloads/' + guess.replace(/[\\/<>:"|?*]+/g, '_') });
      if (!path) return;
      dir = U.dirname(path);
      chosen = path.split('/').pop();
      guess = chosen;
    }
    const d = existing || { url, name: guess, t: Date.now() };
    Object.assign(d, { id: 'dl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), status: 'busy', error: '', received: 0, total: -1, phase: 'download' });
    if (!existing) data.downloads.unshift(d);
    refreshPages();
    try {
      const got = await fetchInBrowser(d, opts.tab);
      const name = chosen || fileName(got.url || url, got.disposition, got.mime);
      d.name = name;
      d.phase = 'save';
      showProgress(d);
      if (chosen) { try { await OS.fs.remove(U.join(dir, name)); } catch (e) { /* nothing to replace (the save dialog asked before replacing) */ } }
      const [e] = await OS.fs.upload(dir, [new File(got.parts, name, { type: (got.mime || '').split(';')[0].trim() })]);
      Object.assign(d, { status: 'done', name: e.name, path: e.path, size: e.size });
      const folder = U.dirname(e.path);
      OS.notify(e.name + ' was saved to ' + (folder === '/' ? 'your drive' : folder.split('/').pop()) + '.', {
        type: 'success', title: 'Download complete',
        actions: [{ label: 'Open', action: () => openSaved(e.path) }, { label: 'Show in folder', action: () => OS.open('files', { path: folder, select: e.path }) }],
      });
    } catch (ex) {
      if (ex.cancelled) Object.assign(d, { status: 'error', error: 'Cancelled' });
      else {
        Object.assign(d, { status: 'error', error: ex.message });
        OS.notify(ex.message, { type: 'error', title: 'Download failed' });
      }
    }
    delete d.received; delete d.total; delete d.phase;
    saveData();
    refreshPages();
  }

  /** Opens a saved file in LiteOS. A file no LiteOS app opens would otherwise go to the computer's browser as a
   * download: show it in its folder instead. */
  function openSaved(path) {
    if (window.LOS_appForFile && !window.LOS_appForFile(path)) OS.open('files', { path: U.dirname(path), select: path });
    else OS.openFile(path);
  }

  const hasDownloadHelper = () => document.documentElement.hasAttribute('data-liteos-downloads');
  const NEED_HELPER = 'This site only lets your browser download its files through the LiteOS Frame Helper. Install the helper to save it to your drive.';
  const cancels = new Map(); // download id → cancel()

  /** Downloads in this browser, reporting progress on d (received / total bytes). → { parts, mime, disposition, url } */
  async function fetchInBrowser(d, tab) {
    if (!hasDownloadHelper()) return fetchDirect(d);
    const host = (u) => { try { return new URL(u).hostname; } catch (e) { return ''; } };
    if (!tab || host(tab.url) !== host(d.url)) tab = tabs.find((x) => x.frame && host(x.url) === host(d.url)) || tab; // e.g. Retry
    // A file from the site the tab is showing: that page downloads it. A site framed in LiteOS keeps its cookies (a
    // bot check it passed, a sign-in) under LiteOS, where only its own pages can use them, not the helper's background.
    const frame = tab && tab.frame && !tab.frame.classList.contains('pending') ? tab.frame : null;
    let sameSite = false;
    try { sameSite = !!frame && new URL(d.url).hostname === new URL(tab.url).hostname; } catch (e) { /* not a web page */ }
    if (sameSite) {
      try { return await fetchWithPage(d, frame); } catch (ex) {
        if (ex.cancelled) throw ex;
        if (!ex.noAnswer) console.warn('[Browser] The page couldn’t download the file, trying the helper:', ex.message);
        d.received = 0; d.total = -1;
      }
    }
    return fetchWithHelper(d);
  }

  // Through the Frame Helper's script in the tab's page (reporter.js): streamed chunks, trusted only from that frame.
  function fetchWithPage(d, frame) {
    return new Promise((resolve, reject) => {
      const parts = [];
      let meta = {};
      let timer = null;
      const send = (msg) => { try { frame.contentWindow.postMessage(Object.assign({ id: d.id }, msg), '*'); } catch (e) { /* frame gone */ } };
      const finish = (fn, v) => { clearTimeout(timer); window.removeEventListener('message', onMsg); cancels.delete(d.id); fn(v); };
      const wait = (ms, error) => { clearTimeout(timer); timer = setTimeout(() => { send({ type: 'liteos-frame-download-cancel' }); finish(reject, error); }, ms); };
      function onMsg(e) {
        const m = e.data;
        if (e.source !== frame.contentWindow || !m || m.id !== d.id || typeof m.type !== 'string') return;
        if (m.type === 'liteos-frame-download-ack') wait(60000, new Error('The download stopped responding.'));
        else if (m.type === 'liteos-frame-download-start') { meta = m; d.total = typeof m.total === 'number' ? m.total : -1; wait(60000, new Error('The download stopped responding.')); showProgress(d); }
        else if (m.type === 'liteos-frame-download-chunk' && m.buffer instanceof ArrayBuffer) { parts.push(m.buffer); d.received += m.buffer.byteLength; wait(60000, new Error('The download stopped responding.')); showProgress(d); }
        else if (m.type === 'liteos-frame-download-done') finish(resolve, { parts, mime: meta.mime || '', disposition: meta.disposition || '', url: meta.url || d.url });
        else if (m.type === 'liteos-frame-download-error') finish(reject, new Error(typeof m.error === 'string' ? m.error : 'The page couldn’t download the file.'));
      }
      window.addEventListener('message', onMsg);
      cancels.set(d.id, () => { send({ type: 'liteos-frame-download-cancel' }); finish(reject, Object.assign(new Error('Cancelled'), { cancelled: true })); });
      // An older helper, or a page it doesn't run in, never answers: hand over to the helper's background quickly.
      wait(2500, Object.assign(new Error('No answer from the page.'), { noAnswer: true }));
      send({ type: 'liteos-frame-download', url: d.url });
    });
  }

  // Through the Frame Helper (marker.js in this frame, the download itself in its background): the browser's own
  // session, cookies and any bot check it passed, and no cross-site limits.
  function fetchWithHelper(d) {
    return new Promise((resolve, reject) => {
      const parts = [];
      let meta = {};
      let idle = null;
      const finish = (fn, v) => { clearTimeout(idle); window.removeEventListener('message', onMsg); cancels.delete(d.id); fn(v); };
      const watchdog = () => { clearTimeout(idle); idle = setTimeout(() => { window.postMessage({ type: 'liteos-download-cancel', id: d.id }, location.origin); finish(reject, new Error('The download stopped responding.')); }, 60000); };
      function onMsg(e) {
        const m = e.data;
        if (e.source !== window || e.origin !== location.origin || !m || m.id !== d.id) return;
        if (m.type === 'liteos-download-start') { meta = m; d.total = typeof m.total === 'number' ? m.total : -1; watchdog(); showProgress(d); }
        else if (m.type === 'liteos-download-chunk' && m.buffer instanceof ArrayBuffer) { parts.push(m.buffer); d.received += m.buffer.byteLength; watchdog(); showProgress(d); }
        else if (m.type === 'liteos-download-done') finish(resolve, { parts, mime: meta.mime || '', disposition: meta.disposition || '', url: meta.url || d.url });
        else if (m.type === 'liteos-download-error') finish(reject, new Error(typeof m.error === 'string' ? m.error : 'The download couldn’t be completed.'));
      }
      window.addEventListener('message', onMsg);
      cancels.set(d.id, () => { window.postMessage({ type: 'liteos-download-cancel', id: d.id }, location.origin); finish(reject, Object.assign(new Error('Cancelled'), { cancelled: true })); });
      watchdog();
      window.postMessage({ type: 'liteos-download', id: d.id, url: d.url }, location.origin);
    });
  }

  // Without the helper: a plain fetch from this page. Works only for sites that allow other sites to read their files
  // (CORS); the rest need the helper.
  async function fetchDirect(d) {
    const ctrl = new AbortController();
    let cancelled = false;
    cancels.set(d.id, () => { cancelled = true; ctrl.abort(); });
    try {
      let r;
      try { r = await fetch(d.url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctrl.signal }); } catch (e) {
        if (cancelled) throw Object.assign(new Error('Cancelled'), { cancelled: true });
        throw new Error(NEED_HELPER);
      }
      if (!r.ok) throw new Error('The website answered with an error (' + r.status + ').');
      const length = r.headers.get('content-length');
      d.total = length && /^\d+$/.test(length) ? +length : -1;
      showProgress(d);
      const parts = [];
      const reader = r.body.getReader();
      for (;;) {
        let step;
        try { step = await reader.read(); } catch (e) { throw cancelled ? Object.assign(new Error('Cancelled'), { cancelled: true }) : new Error('The download couldn’t be completed.'); }
        if (step.done) break;
        parts.push(step.value);
        d.received += step.value.length;
        showProgress(d);
      }
      return { parts, mime: r.headers.get('content-type') || '', disposition: r.headers.get('content-disposition') || '', url: r.url };
    } finally { cancels.delete(d.id); }
  }

  /** "3.2 MB of 9.8 MB" and the bar, updated in place on open Downloads pages (no full redraw: keeps the search box). */
  function progressText(d) {
    if (d.phase === 'save') return 'Saving to your drive…';
    if (d.total > 0) return U.formatSize(d.received) + ' of ' + U.formatSize(d.total);
    if (d.received > 0) return U.formatSize(d.received);
    return 'Starting…';
  }
  const progressFrames = new Map();
  function showProgress(d) {
    if (progressFrames.has(d.id)) return;
    progressFrames.set(d.id, requestAnimationFrame(() => {
      progressFrames.delete(d.id);
      if (d.status !== 'busy') return; // finished in the meantime: the row was redrawn
      $$('.dl-item[data-dlid="' + d.id + '"]').forEach((row) => {
        const small = $('.dl-main small', row);
        if (small) small.textContent = progressText(d);
        const bar = $('.dl-bar', row);
        if (bar) {
          const known = d.total > 0 && d.phase !== 'save';
          bar.classList.toggle('known', known);
          bar.style.setProperty('--p', known ? Math.min(100, (d.received / d.total) * 100).toFixed(1) + '%' : '0%');
        }
      });
    }));
  }

  const TYPE_EXT = { 'text/html': 'html', 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
    'image/svg+xml': 'svg', 'text/plain': 'txt', 'application/zip': 'zip', 'application/json': 'json', 'audio/mpeg': 'mp3', 'video/mp4': 'mp4',
    'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'text/csv': 'csv' };
  /** The name to save under, like the server's (WebFetcher::filename): the site's suggestion, else the address. */
  function fileName(url, disposition, type) {
    let name = '';
    const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition || '');
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition || '');
    try { name = star ? decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, '')) : plain ? plain[1].trim() : decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch (e) { name = ''; }
    name = name.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
    if (!name || name === '_') name = 'download';
    if (!name.includes('.')) { const ext = TYPE_EXT[String(type || '').split(';')[0].trim().toLowerCase()]; if (ext) name += '.' + ext; }
    return name.slice(0, 150);
  }

  // The LiteOS volume (top bar / Quick settings) for the sites in our tabs. LiteOS can't reach media in other sites'
  // pages; the Frame Helper (volume.js) applies the level we send to every <audio>/<video> in them. Without the
  // helper, sites play at their own volume.
  const masterLevel = () => { const s = OS.settings || {}; return s.muted ? 0 : (s.volume == null ? 80 : +s.volume) / 100; };
  function sendVolume(frame) {
    try { frame.contentWindow.postMessage({ type: 'liteos-volume', level: masterLevel() }, '*'); } catch (e) { /* not loaded */ }
  }
  let lastLevel = masterLevel();
  OS.onSettings(() => {
    const level = masterLevel();
    if (level === lastLevel) return;
    lastLevel = level;
    tabs.forEach((t) => $$('.br-frame', t.pane).forEach(sendVolume));
  });
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'liteos-volume-request') return;
    const t = tabs.find((x) => x.frame && x.frame.contentWindow === e.source);
    if (t) sendVolume(t.frame);
  });

  // New tabs and windows from web pages open here, never as tabs of the computer's browser. The Frame Helper sends
  // links meant for a new tab (target=_blank, middle-click, Ctrl/Shift + click) from the page itself, trusted only from
  // one of our tabs' frames, and anything else a page opened (window.open…) after closing that tab, from its script in
  // this frame (e.source is this window; pages can't send that).
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m.url !== 'string') return;
    let background = false;
    if (m.type === 'liteos-frame-open') {
      if (!tabs.some((x) => x.frame && x.frame.contentWindow === e.source)) return;
      background = !!m.background;
    } else if (m.type === 'liteos-open-tab') {
      if (e.source !== window || e.origin !== location.origin) return;
    } else return;
    const url = safeUrl(m.url);
    if (url) makeTab(url, background);
  });

  // Ctrl+S inside a web page (the Frame Helper passes it on): LiteOS's Save as, not the computer's.
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'liteos-frame-save') return;
    const t = tabs.find((x) => x.frame && x.frame.contentWindow === e.source);
    if (t && t === active) saveCurrent(t, true);
  });

  // ------------------------------------------------------------ menu
  function openMenu(btn) {
    const t = active;
    const r = btn.getBoundingClientRect();
    const web = t && !isInternal(t.url);
    OS.menu([
      { label: 'New tab', icon: 'plus', key: 'Ctrl+T', action: () => makeTab(NEWTAB) },
      { label: 'New window', icon: 'external', action: () => OS.open('browser') },
      'sep',
      { label: 'History', icon: 'clock', key: 'Ctrl+H', action: () => openInternal('liteos://history') },
      { label: 'Downloads', icon: 'download', key: 'Ctrl+J', action: () => openInternal('liteos://downloads') },
      'sep',
      { label: data.shortcuts.some((s) => s.url === (t && t.url)) ? 'Remove from shortcuts' : 'Add to shortcuts', icon: 'star', disabled: !web, action: () => toggleShortcut() },
      { label: 'Copy link', icon: 'link', disabled: !web, action: () => { navigator.clipboard && navigator.clipboard.writeText(t.url).then(() => OS.notify('The page link is on your clipboard.', { type: 'success', title: 'Link copied' }), () => {}); } },
      { label: 'Save to Downloads', icon: 'download', disabled: !web, action: () => saveCurrent(t) },
      { label: 'Save as…', icon: 'save', key: 'Ctrl+S', disabled: !web, action: () => saveCurrent(t, true) },
      'sep',
      { label: 'Settings', icon: 'settings', action: () => openInternal('liteos://settings') },
      'sep',
      { label: 'Close tab', icon: 'x', key: 'Ctrl+W', action: () => closeTab(t) },
    ], { x: r.right - 230, y: r.bottom + 4 });
  }

  /** Saves what the tab shows (the page or the file) into the drive. */
  function saveCurrent(t, saveAs) {
    if (!t || isInternal(t.url)) return;
    download(t.url, null, { saveAs, name: t.file ? t.file.name : '', tab: t });
  }

  /** Reuse an open tab showing that page, else open it in a new tab. */
  function openInternal(page) {
    const t = tabs.find((x) => x.url === page);
    if (t) { activate(t); renderPage(t); } else makeTab(page);
  }

  function toggleShortcut() {
    const t = active;
    if (!t || isInternal(t.url)) return;
    if (data.shortcuts.some((s) => s.url === t.url)) {
      data.shortcuts = data.shortcuts.filter((s) => s.url !== t.url);
      saveData(); refreshPages();
      OS.notify('This page no longer appears on the new tab page.', { title: 'Shortcut removed' });
    } else {
      addShortcut(t.url, hostOf(t.url));
      OS.notify('Added to shortcuts on the new tab page.', { type: 'success', title: 'Shortcut added' });
    }
  }

  // ------------------------------------------------------------ events
  $('#addrForm').addEventListener('submit', (e) => { e.preventDefault(); go(addr.value); });
  addr.addEventListener('focus', () => addr.select());
  $('#back').addEventListener('click', back);
  $('#forward').addEventListener('click', forward);
  $('#reload').addEventListener('click', reload);
  $('#home').addEventListener('click', () => { if (active) navigate(active, NEWTAB, true); });
  $('#menu').addEventListener('click', (e) => openMenu(e.currentTarget));
  $('#downloads').addEventListener('click', () => openInternal('liteos://downloads'));
  $('#star').addEventListener('click', toggleShortcut);

  tabsEl.addEventListener('click', (e) => {
    const x = e.target.closest('[data-close]');
    if (x) { const t = tabs.find((y) => y.id === +x.dataset.close); if (t) closeTab(t); return; }
    if (e.target.closest('#newTab')) { makeTab(NEWTAB); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { const t = tabs.find((y) => y.id === +tab.dataset.tab); if (t) activate(t); }
  });
  // Drag a tab left or right to reorder it.
  let draggingTab = null;
  tabsEl.addEventListener('dragstart', (e) => {
    const el = e.target.closest('[data-tab]');
    if (!el) return;
    draggingTab = tabs.find((y) => y.id === +el.dataset.tab) || null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-liteos-tab', String(el.dataset.tab));
    setTimeout(() => el.classList.add('dragging'), 0);
  });
  tabsEl.addEventListener('dragover', (e) => {
    if (!draggingTab) return;
    e.preventDefault();
    const over = e.target.closest('[data-tab]');
    if (!over || +over.dataset.tab === draggingTab.id) return;
    const r = over.getBoundingClientRect();
    const target = tabs.find((y) => y.id === +over.dataset.tab);
    const from = tabs.indexOf(draggingTab);
    let to = tabs.indexOf(target) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
    if (to > from) to--;
    if (to === from) return;
    tabs.splice(from, 1);
    tabs.splice(to, 0, draggingTab);
    renderTabs();
    const el = tabsEl.querySelector('[data-tab="' + draggingTab.id + '"]');
    if (el) el.classList.add('dragging');
  });
  tabsEl.addEventListener('drop', (e) => { if (draggingTab) e.preventDefault(); });
  tabsEl.addEventListener('dragend', () => { draggingTab = null; renderTabs(); });

  tabsEl.addEventListener('auxclick', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (e.button === 1 && tab) { const t = tabs.find((y) => y.id === +tab.dataset.tab); if (t) closeTab(t); }
  });

  content.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    if (f.dataset.form === 'search') go(f.q.value);
    if (f.dataset.form === 'download') { const u = f.url.value.trim(); if (u) { f.url.value = ''; download(u); } }
  });

  // ------------------------------------------------------------ right-click menus
  // A web page's own right-click menu belongs to the page (it is another site, out of reach); everything around it,
  // the tabs and LiteOS's own pages (new tab, history, downloads, a page that can't be shown) get these.
  const copyLink = (url) => { if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => OS.notify('The link is on your clipboard.', { type: 'success', title: 'Link copied' }), () => {}); };
  const isShortcut = (url) => data.shortcuts.some((s) => s.url === url);

  function tileItems(tile) {
    return [
      { label: 'Open', icon: 'open', action: () => navigate(active, tile.url, true) },
      { label: 'Open in new tab', icon: 'plus', action: () => makeTab(tile.url, true) },
      'sep',
      { label: 'Copy link', icon: 'link', action: () => copyLink(tile.url) },
      { label: 'Rename', icon: 'rename', action: async () => {
        const n = await OS.dialog.prompt({ title: 'Rename shortcut', label: 'Name', value: tile.title });
        if (n && n.trim()) { data.shortcuts = data.shortcuts.filter((s) => s.url !== tile.url); data.shortcuts.push({ url: tile.url, title: n.trim() }); saveData(); refreshPages(); }
      } },
      { label: 'Remove', icon: 'x', danger: true, action: () => removeTile(tile) },
    ];
  }

  function tabItems(t) {
    const web = !isInternal(t.url);
    const i = tabs.indexOf(t);
    return [
      { label: 'New tab', icon: 'plus', key: 'Ctrl+T', action: () => makeTab(NEWTAB) },
      { label: 'Reload', icon: 'reload', key: 'F5', action: () => { activate(t); reload(); } },
      { label: 'Duplicate', icon: 'copy', action: () => makeTab(t.url, true) },
      'sep',
      { label: 'Copy link', icon: 'link', disabled: !web, action: () => copyLink(t.url) },
      { label: isShortcut(t.url) ? 'Remove from shortcuts' : 'Add to shortcuts', icon: 'star', disabled: !web, action: () => { activate(t); toggleShortcut(); } },
      'sep',
      { label: 'Close tab', icon: 'x', key: 'Ctrl+W', action: () => closeTab(t) },
      { label: 'Close other tabs', disabled: tabs.length < 2, action: () => tabs.filter((x) => x !== t).forEach(finishClose) },
      { label: 'Close tabs to the right', disabled: i === tabs.length - 1, action: () => tabs.slice(i + 1).forEach(finishClose) },
    ];
  }

  function pageItems(t) {
    const web = !isInternal(t.url);
    return [
      { label: 'Back', icon: 'back', key: 'Alt+Left', disabled: t.idx <= 0, action: back },
      { label: 'Forward', icon: 'forward', key: 'Alt+Right', disabled: t.idx >= t.stack.length - 1, action: forward },
      { label: 'Reload', icon: 'reload', key: 'F5', action: reload },
      'sep',
      { label: 'Save to Downloads', icon: 'download', disabled: !web, action: () => saveCurrent(t) },
      { label: 'Save as…', icon: 'save', key: 'Ctrl+S', disabled: !web, action: () => saveCurrent(t, true) },
      { label: 'Copy link', icon: 'link', disabled: !web, action: () => copyLink(t.url) },
      { label: isShortcut(t.url) ? 'Remove from shortcuts' : 'Add to shortcuts', icon: 'star', disabled: !web, action: toggleShortcut },
    ];
  }

  tabsEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const el = e.target.closest('[data-tab]');
    const t = el && tabs.find((x) => x.id === +el.dataset.tab);
    OS.menu(t ? tabItems(t) : [{ label: 'New tab', icon: 'plus', key: 'Ctrl+T', action: () => makeTab(NEWTAB) }], e);
  });

  content.addEventListener('contextmenu', (e) => {
    if (!active || e.target.closest('input, textarea')) return;
    e.preventDefault();
    const tile = e.target.closest('[data-tile]');
    if (tile) { OS.menu(tileItems(active.tileList[+tile.dataset.tile]), e); return; }
    const link = e.target.closest('[data-open]');
    if (link) {
      OS.menu([
        { label: 'Open', icon: 'open', action: () => navigate(active, link.dataset.open, true) },
        { label: 'Open in new tab', icon: 'plus', action: () => makeTab(link.dataset.open, true) },
        'sep',
        { label: 'Copy link', icon: 'link', action: () => copyLink(link.dataset.open) },
      ], e);
      return;
    }
    OS.menu(pageItems(active), e);
  });

  // Right-clicks inside a web page arrive from the LiteOS Frame Helper (its reporter.js), with what was under the
  // pointer. Trusted only from the tab's own frame; every address is checked again here before it is used.
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== 'liteos-frame-contextmenu') return;
    const t = tabs.find((x) => x.frame && x.frame.contentWindow === e.source);
    if (!t || t !== active) return;
    const r = t.frame.getBoundingClientRect();
    const x = r.left + Math.max(0, Math.min(+m.x || 0, r.width));
    const y = r.top + Math.max(0, Math.min(+m.y || 0, r.height));
    const link = typeof m.link === 'string' ? safeUrl(m.link) : null;
    const image = typeof m.image === 'string' ? safeUrl(m.image) : null;
    const media = typeof m.media === 'string' ? safeUrl(m.media) : null;
    const text = typeof m.selection === 'string' ? m.selection.trim().slice(0, 2000) : '';
    const short = text.length > 28 ? text.slice(0, 26).trim() + '…' : text;
    const copy = (value, what) => { if (navigator.clipboard) navigator.clipboard.writeText(value).then(() => OS.notify(what + ' is on your clipboard.', { type: 'success', title: 'Copied' }), () => {}); };

    const items = [];
    if (link) {
      items.push(
        { label: 'Open link in new tab', icon: 'plus', action: () => makeTab(link, true) },
        { label: 'Open link in new window', icon: 'external', action: () => OS.open('browser', { url: link }) },
        'sep',
        { label: 'Save link to Downloads', icon: 'download', action: () => download(link, null, { tab: t }) },
        { label: 'Save link as…', icon: 'save', action: () => download(link, null, { saveAs: true, tab: t }) },
        { label: 'Copy link address', icon: 'link', action: () => copy(link, 'The link') },
        'sep',
      );
    }
    if (image) {
      items.push(
        { label: 'Open image in new tab', icon: 'image', action: () => makeTab(image, true) },
        { label: 'Save image to Downloads', icon: 'download', action: () => download(image, null, { tab: t }) },
        { label: 'Save image as…', icon: 'save', action: () => download(image, null, { saveAs: true, tab: t }) },
        { label: 'Copy image address', icon: 'link', action: () => copy(image, 'The image address') },
        'sep',
      );
    }
    if (media && !image) {
      items.push(
        { label: 'Save video or audio to Downloads', icon: 'download', action: () => download(media, null, { tab: t }) },
        { label: 'Save video or audio as…', icon: 'save', action: () => download(media, null, { saveAs: true, tab: t }) },
        { label: 'Copy media address', icon: 'link', action: () => copy(media, 'The address') },
        'sep',
      );
    }
    if (text) {
      items.push(
        { label: 'Copy', icon: 'copy', key: 'Ctrl+C', action: () => copy(text, 'The text') },
        { label: 'Search ' + engine().name + ' for “' + short + '”', icon: 'search', action: () => makeTab(engine().url + encodeURIComponent(text)) },
        'sep',
      );
    }
    if (!link && !image && !media && !text) items.push(...pageItems(t));
    else items.push(...pageItems(t).slice(0, 3)); // Back, Forward, Reload
    OS.menu(items, { x, y });
  });

  content.addEventListener('click', async (e) => {
    const b = e.target.closest('button, [data-tilemenu]');
    if (!b || !active) return;
    if (b.dataset.tilemenu != null) {
      e.stopPropagation();
      const r = b.getBoundingClientRect();
      OS.menu(tileItems(active.tileList[+b.dataset.tilemenu]), { x: r.left, y: r.bottom + 4 });
      return;
    }
    if (b.dataset.tile != null) { navigate(active, active.tileList[+b.dataset.tile].url, true); return; }
    if (b.dataset.open) { navigate(active, b.dataset.open, true); return; }
    if (b.dataset.newtab) { makeTab(b.dataset.newtab, true); return; }
    if (b.dataset.delhist != null) { data.history.splice(+b.dataset.delhist, 1); saveData(); renderHistory(active); return; }
    if (b.dataset.engine) { data.settings.engine = b.dataset.engine; saveData(); refreshPages(); return; }
    if (b.dataset.setting) { data.settings[b.dataset.setting] = !data.settings[b.dataset.setting]; saveData(); refreshPages(); return; }
    if (b.dataset.dlopen != null) {
      const d = data.downloads[+b.dataset.dlopen];
      if (d && d.path) openSaved(d.path);
      return;
    }
    if (b.dataset.dlshow != null) { const d = data.downloads[+b.dataset.dlshow]; if (d && d.path) OS.open('files', { path: U.dirname(d.path), select: d.path }); return; }
    if (b.dataset.dlretry != null) { const d = data.downloads[+b.dataset.dlretry]; if (d) download(d.url, d); return; }
    if (b.dataset.dlcancel != null) { const d = data.downloads[+b.dataset.dlcancel]; const c = d && cancels.get(d.id); if (c) c(); return; }
    if (b.dataset.dlcopy != null) { const d = data.downloads[+b.dataset.dlcopy]; if (d) copyLink(d.url); return; }
    if (b.dataset.dldel != null) { data.downloads.splice(+b.dataset.dldel, 1); saveData(); refreshPages(); return; }
    switch (b.dataset.act) {
      case 'add-shortcut': addShortcut(); break;
      case 'file-save': saveCurrent(active); break;
      case 'file-save-as': saveCurrent(active, true); break;
      case 'copy-link': if (navigator.clipboard) navigator.clipboard.writeText(active.url).then(() => OS.notify('The page link is on your clipboard.', { type: 'success', title: 'Link copied' }), () => {}); break;
      case 'open-downloads': OS.open('files', { path: '/Downloads' }); break;
      case 'clear-downloads': data.downloads = data.downloads.filter((d) => d.status === 'busy'); saveData(); refreshPages(); break;
      case 'clear-history':
        if (await OS.dialog.confirm({ title: 'Clear browsing history?', message: 'All ' + data.history.length + ' pages will be removed from your history.', okLabel: 'Clear history', danger: true })) {
          data.history = []; saveData(); refreshPages();
        }
        break;
      case 'reset-shortcuts': data.shortcuts = []; data.hidden = []; saveData(); refreshPages(); OS.notify('Your shortcut changes on the new tab page were cleared.', { title: 'Shortcuts reset' }); break;
      default: break;
    }
  });

  content.addEventListener('input', (e) => {
    if (e.target.dataset.input === 'dl') { const pos = e.target.selectionStart; active.dlQuery = e.target.value; renderDownloads(active); const i = $('[data-input=dl]', active.pane); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
    if (e.target.dataset.input === 'hist') { const pos = e.target.selectionStart; renderHistory(active, e.target.value); const i = $('[data-input=hist]', active.pane); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
  });
  content.addEventListener('change', (e) => {
    if (e.target.name === 'startup') { data.settings.startup = e.target.value; saveData(); }
    if (e.target.dataset.input === 'homepage') {
      const u = toUrl(e.target.value);
      data.settings.homepage = safeUrl(u) ? u : '';
      if (data.settings.homepage) data.settings.startup = 'home';
      saveData(); refreshPages();
    }
  });

  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 't') { e.preventDefault(); makeTab(NEWTAB); }
    else if (ctrl && k === 'w') { e.preventDefault(); if (active) closeTab(active); }
    else if (ctrl && k === 'l') { e.preventDefault(); addr.focus(); }
    else if (ctrl && k === 'h') { e.preventDefault(); openInternal('liteos://history'); }
    else if (ctrl && k === 'j') { e.preventDefault(); openInternal('liteos://downloads'); }
    else if (ctrl && k === 's') { e.preventDefault(); saveCurrent(active, true); }
    else if (e.key === 'F5' || (ctrl && k === 'r')) { e.preventDefault(); reload(); }
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); forward(); }
    else if (ctrl && e.key === 'Tab' && tabs.length > 1) { e.preventDefault(); const i = tabs.indexOf(active); activate(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]); }
  });

  // ------------------------------------------------------------ start
  OS.win.setMenus && OS.win.setMenus([
    { label: 'File', items: [
      { label: 'New tab', icon: 'plus', key: 'Ctrl+T', action: () => makeTab(NEWTAB) },
      { label: 'Save as…', icon: 'save', key: 'Ctrl+S', action: () => saveCurrent(active, true) },
      'sep',
      { label: 'Close tab', icon: 'x', key: 'Ctrl+W', action: () => active && closeTab(active) },
    ] },
    { label: 'History', items: [
      { label: 'Back', icon: 'back', key: 'Alt+Left', action: back },
      { label: 'Forward', icon: 'forward', key: 'Alt+Right', action: forward },
      'sep',
      { label: 'Show all history', icon: 'clock', key: 'Ctrl+H', action: () => openInternal('liteos://history') },
    ] },
  ]);

  loadData().then(() => {
    const first = OS.args.url ? toUrl(OS.args.url) : (data.settings.startup === 'home' && data.settings.homepage ? data.settings.homepage : NEWTAB);
    makeTab(first);
  });
});
