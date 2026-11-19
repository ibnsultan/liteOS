/* LiteOS Media — video and audio from the user's drive. */
LiteOS.ready((OS) => {
  'use strict';
  const U = OS.util;
  const esc = U.escape;
  const ic = (n, s) => LOS_icon(n, s || 18);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const VIDEO = window.LOS_KINDS.video;
  const AUDIO = window.LOS_KINDS.audio;
  const IMAGE = window.LOS_KINDS.image;
  const isImage = (p) => IMAGE.includes(U.ext(p));
  const kindOf = (p) => { const e = U.ext(p); return VIDEO.includes(e) ? 'video' : AUDIO.includes(e) ? 'audio' : null; };
  const folderName = (p) => U.basename(U.dirname(p)) || 'My drive';
  /** Display name and subtitle of a queue item (files or live channels). */
  const titleOf = (it) => (it.kind === 'live' ? it.name : U.stem(it.name));
  const whereOf = (it) => (it.kind === 'live' ? (it.group || 'Live TV') : folderName(it.path));
  const isVideoItem = (it) => !!it && (it.kind === 'video' || (it.kind === 'live' && !it.audioOnly));
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  };
  const store = {
    get(k, d) { try { const x = localStorage.getItem('los.player.' + k); return x == null ? d : JSON.parse(x); } catch (e) { return d; } },
    set(k, x) { try { localStorage.setItem('los.player.' + k, JSON.stringify(x)); } catch (e) { /* ignore */ } },
  };
  const userKey = (OS.user && OS.user.username) || 'me';

  // "back 10" / "forward 30" icons: a circular arrow with the number inside
  const skipIcon = (n, fwd) => '<svg class="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    (fwd ? '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4h-4"/>' : '<path d="M4 12a8 8 0 1 0 2.34-5.66"/><path d="M4 4v4h4"/>') +
    '<text x="12" y="15.2" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" font-family="Segoe UI, system-ui, sans-serif">' + n + '</text></svg>';

  // ------------------------------------------------------------ elements
  const pl = $('#pl');
  const stage = $('#stage');
  const v = $('#video');
  const seek = $('#seek');
  $$('[data-i]').forEach((el) => { el.outerHTML = ic(el.dataset.i, 17); });
  const setIcon = (sel, name, size) => { $(sel).innerHTML = ic(name, size); };
  setIcon('#prevBtn', 'prev'); setIcon('#nextBtn', 'next'); setIcon('#shuffleBtn', 'shuffle');
  setIcon('#ccBtn', 'captions'); setIcon('#pipBtn', 'restore'); setIcon('#fsBtn', 'expand'); setIcon('#moreBtn', 'more');
  setIcon('#backBtn', 'back', 16);
  $('#backTenBtn').innerHTML = skipIcon(10, false);
  $('#fwdBtn').innerHTML = skipIcon(30, true);
  $('#tbIcon').src = window.LOS_appIconUrl('media');
  // mini player buttons
  $('#nowView').insertAdjacentHTML('beforeend', '<div class="pl-mini-bar"><button data-mini="play" title="Play / pause" aria-label="Play or pause"></button>' +
    '<button data-mini="open" title="Back to the video" aria-label="Back to the video">' + ic('expand', 15) + '</button>' +
    '<button data-mini="close" title="Stop" aria-label="Stop">' + ic('x', 15) + '</button></div>');
  // the loader is the LiteOS kite with a band of light sweeping over it (the boot screen's shimmer)
  fetch('../../assets/img/kite-white.svg').then((r) => r.text()).then((svg) => {
    const m = /\sd="([^"]+)"/.exec(svg);
    if (!m) return;
    const d = m[1];
    $('#spinner').innerHTML = '<svg viewBox="0 0 552 552" aria-hidden="true"><defs>' +
      '<linearGradient id="plShimGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<mask id="plShim" maskUnits="userSpaceOnUse" x="-200" y="-200" width="952" height="952"><g class="band"><rect x="-260" y="-200" width="260" height="912" fill="url(#plShimGrad)" transform="rotate(20 -130 256)"/></g></mask></defs>' +
      '<g transform="translate(20 20)"><path d="' + d + '" fill="#f2f5fa" fill-rule="evenodd" opacity=".3"/><path d="' + d + '" fill="#f2f5fa" fill-rule="evenodd" mask="url(#plShim)"/></g></svg>';
  }).catch(() => {});

  // the window buttons are drawn by the shell over the right of our title bar
  if (OS.win.controlsWidth) {
    $('#titlebar').style.paddingRight = (OS.win.controlsWidth + 8) + 'px';
    OS.win.dragRegion($('#titlebar'), (t) => !t.closest('button'));
  }

  // ------------------------------------------------------------ state
  const st = {
    queue: [], idx: -1,
    shuffle: store.get('shuffle', false),
    repeat: store.get('repeat', 'off'), // off | all | one
    rate: 1,
    volume: store.get('volume', 1),
    muted: false,
    view: 'home', // home | music | videos | queue | now
  };
  const cur = () => st.queue[st.idx] || null;

  // Volume: our own level sits inside the system (top bar) volume, which the SDK applies.
  function applyVolume() {
    const s = OS.settings || {};
    const master = s.muted ? 0 : (s.volume == null ? 80 : s.volume) / 100;
    v.dataset.appVolume = String(st.volume);
    try { v.volume = Math.max(0, Math.min(1, master * st.volume)); } catch (e) { /* ignore */ }
    v.muted = st.muted;
  }
  OS.onSettings(() => setTimeout(applyVolume, 0));
  applyVolume();

  // ------------------------------------------------------------ cover colours
  const COVERS = [['#FF8A5B', '#E5484D'], ['#5B93EA', '#6B4CCB'], ['#3DBB7E', '#0F7A6E'], ['#F2C94C', '#DD630A'], ['#F0679A', '#8E4EC6'], ['#3FB3D1', '#2F6FD6']];
  const coverOf = (name) => COVERS[[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % COVERS.length];
  const coverBg = (name) => { const c = coverOf(name); return 'linear-gradient(145deg,' + c[0] + ',' + c[1] + ')'; };

  // ------------------------------------------------------------ views
  function showView(view) {
    if (view === 'now' && !cur()) view = 'home';
    st.view = view;
    $$('.pl-page').forEach((p) => { p.hidden = p.dataset.page !== view; });
    $$('.pl-nav-item[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    const now = view === 'now';
    // Leaving a video keeps it playing in a small window in the corner (click it to come back).
    const mini = !now && isVideoItem(cur()) && !!v.getAttribute('src');
    pl.classList.toggle('mini', mini);
    $('#nowView').hidden = !now && !mini;
    $('#backBtn').hidden = !now;
    pl.classList.toggle('np', now);
    pl.classList.toggle('np-video', !!(now && isVideoItem(cur())));
    pl.classList.toggle('np-audio', !!(now && cur() && !isVideoItem(cur())));
    if (!now) pl.classList.remove('idle');
    if (view === 'home') renderHome();
    if (view === 'music') renderMusic();
    if (view === 'photos') renderPhotos();
    if (view === 'videos') renderVideos();
    if (view === 'queue') renderQueue();
    if (view === 'tv') renderTv();
    if (now) { wake(); stage.focus({ preventScroll: true }); }
  }
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) showView(b.dataset.view); });
  $('#backBtn').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); showView(st.lastLib || 'home'); });
  $('#nowBtn').addEventListener('click', () => { if (cur()) { if (st.view !== 'now') st.lastLib = st.view; showView(st.view === 'now' ? (st.lastLib || 'home') : 'now'); } });

  function tile(f) {
    if (isImage(f.name)) {
      return '<button class="pl-tile" data-open="' + esc(f.path) + '" title="' + esc(f.name) + '"><span class="pl-tile-art"><img class="pl-tile-img" loading="lazy" alt="" src="' + esc(OS.fs.rawUrl(f.path)) + '"></span>' +
        '<b>' + esc(U.stem(f.name)) + '</b><small>Photo · ' + esc(folderName(f.path)) + '</small></button>';
    }
    const kind = kindOf(f.name);
    const art = kind === 'video'
      ? '<span class="pl-tile-art"><video muted preload="metadata" src="' + esc(OS.fs.rawUrl(f.path)) + '#t=2"></video><span class="pl-tile-play">' + ic('play', 16) + '</span></span>'
      : '<span class="pl-tile-art square" style="background:' + coverBg(f.name) + '">' + ic('music', 40) + '<span class="pl-tile-play">' + ic('play', 16) + '</span></span>';
    return '<button class="pl-tile" data-open="' + esc(f.path) + '" title="' + esc(f.name) + '">' + art +
      '<b>' + esc(U.stem(f.name)) + '</b><small>' + (kind === 'video' ? 'Video' : 'Song') + ' · ' + esc(folderName(f.path)) + '</small></button>';
  }
  function addDurations(box) {
    box.querySelectorAll('.pl-tile-art video').forEach((vid) => {
      vid.addEventListener('loadedmetadata', () => { vid.insertAdjacentHTML('afterend', '<span class="pl-tile-dur">' + fmt(vid.duration) + '</span>'); }, { once: true });
      vid.addEventListener('error', () => { vid.replaceWith(Object.assign(document.createElement('span'), { innerHTML: ic('video', 40) })); }, { once: true });
    });
  }

  let libCache = null;
  async function library(force) {
    if (libCache && !force) return libCache;
    const [vids, songs, pics] = await Promise.all([OS.fs.search('', 'video', 300).catch(() => []), OS.fs.search('', 'audio', 500).catch(() => []), OS.fs.search('', 'image', 2000).catch(() => [])]);
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    libCache = { video: vids.filter((f) => f.type !== 'folder').sort(byName), audio: songs.filter((f) => f.type !== 'folder').sort(byName),
      image: pics.filter((f) => f.type !== 'folder').sort((a, b) => (b.mtime || 0) - (a.mtime || 0)) };
    return libCache;
  }

  async function renderHome() {
    const box = $('#recent');
    try {
      const recent = (await OS.fs.recent()).filter((f) => kindOf(f.name) || isImage(f.name));
      const lib = await library();
      const seen = new Set(recent.map((r) => r.path));
      const list = recent.concat(lib.video.concat(lib.audio).filter((f) => !seen.has(f.path))).slice(0, 12);
      box.innerHTML = list.length ? list.map(tile).join('') : '<div class="pl-empty-note">Videos and music you play will show up here.</div>';
      addDurations(box);
    } catch (e) { box.innerHTML = ''; }
  }

  async function renderMusic() {
    const box = $('#musicList');
    const lib = await library();
    $('#playAllMusic').disabled = $('#shuffleAllMusic').disabled = !lib.audio.length;
    if (!lib.audio.length) { box.innerHTML = '<div class="pl-empty-note">No music yet. Put songs anywhere on your drive, for example in /Music, or drop them here.</div>'; return; }
    const playing = cur() && cur().path;
    box.innerHTML = lib.audio.map((f) => '<div class="pl-row' + (f.path === playing ? ' now' : '') + '" data-open="' + esc(f.path) + '">' +
      '<span class="pl-row-art" style="background:' + coverBg(f.name) + '">' + ic(f.path === playing && !v.paused ? 'volume' : 'music', 15) + '</span>' +
      '<b>' + esc(U.stem(f.name)) + '</b><span class="folder">' + esc(folderName(f.path)) + '</span><span class="num">' + esc(U.ext(f.name).toUpperCase()) + '</span><span></span></div>').join('');
  }

  async function renderVideos() {
    const box = $('#videoList');
    const lib = await library();
    box.innerHTML = lib.video.length ? lib.video.map(tile).join('') : '<div class="pl-empty-note">No videos yet. Put them anywhere on your drive, for example in /Videos, or drop them here.</div>';
    addDurations(box);
  }

  function renderQueue() {
    $('#qCount').textContent = st.queue.length || '';
    if (st.view !== 'queue') return;
    const box = $('#qlist');
    $('#clearBtn').disabled = !st.queue.length;
    if (!st.queue.length) { box.innerHTML = '<div class="pl-empty-note">The queue is empty. Play something, or add files.</div>'; return; }
    box.innerHTML = st.queue.map((q, i) => '<div class="pl-row' + (i === st.idx ? ' now' : '') + '" data-i="' + i + '">' +
      '<span class="pl-row-art" style="background:' + coverBg(q.name) + '">' + ic(i === st.idx && !v.paused ? 'volume' : q.kind === 'audio' ? 'music' : 'video', 15) + '</span>' +
      '<b>' + esc(titleOf(q)) + '</b><span class="folder">' + esc(whereOf(q)) + '</span><span class="num">' + ({ video: 'Video', audio: 'Song', live: 'Live' })[q.kind] + '</span>' +
      '<button class="pl-row-x" data-rm="' + i + '" title="Remove from queue" aria-label="Remove from queue">' + ic('x', 14) + '</button></div>').join('');
  }

  // clicks on tiles and rows
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { openPath(o.dataset.open); return; }
  });
  $('#qlist').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      const i = +rm.dataset.rm;
      st.queue.splice(i, 1);
      if (i < st.idx) st.idx--;
      else if (i === st.idx) {
        if (st.queue.length) playIndex(Math.min(i, st.queue.length - 1), { stay: true });
        else stopAll();
      }
      renderQueue(); updateButtons();
      return;
    }
    const row = e.target.closest('[data-i]');
    if (row) playIndex(+row.dataset.i, { stay: true });
  });

  // ------------------------------------------------------------ queue building
  async function folderMedia(dir, kind) {
    try {
      const list = await OS.fs.list(dir);
      return list.filter((e) => e.type === 'file' && (kind ? kindOf(e.name) === kind : kindOf(e.name)))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
        .map((e) => ({ path: e.path, name: e.name, kind: kindOf(e.name) }));
    } catch (e) { return []; }
  }
  const item = (p) => ({ path: p, name: U.basename(p), kind: kindOf(p) });

  /** Open a file: the queue becomes its folder's media of the same kind, starting at that file. */
  async function openPath(path) {
    if (['m3u', 'm3u8'].includes(U.ext(path))) { addPlaylistFromDrive(path); return; }
    if (isImage(path)) { openImage(path); return; }
    const kind = kindOf(path);
    if (!kind) { OS.notify('Media can’t open this kind of file.', { type: 'error', title: 'Can’t open “' + U.basename(path) + '”' }); return; }
    let list = await folderMedia(U.dirname(path), kind);
    if (!list.some((x) => x.path === path)) list = [item(path)].concat(list);
    st.queue = list;
    playIndex(list.findIndex((x) => x.path === path));
  }

  async function openFolder(dir) {
    const list = await folderMedia(dir);
    if (!list.length) { OS.notify('Pick a folder that has videos or songs in it.', { type: 'error', title: 'Nothing to play' }); return; }
    st.queue = list;
    playIndex(0);
  }

  function playList(paths, shuffle) {
    if (!paths.length) return;
    const list = paths.map(item);
    if (shuffle) for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    st.queue = list;
    playIndex(0);
  }

  function addToQueue(paths, quiet) {
    const items = paths.filter(kindOf).map(item);
    if (!items.length) { OS.notify('Only videos and audio files can go in the queue.', { type: 'error', title: 'Can’t add these files' }); return; }
    const wasEmpty = st.idx < 0;
    st.queue = st.queue.concat(items.filter((it) => !st.queue.some((q) => q.path === it.path)));
    if (wasEmpty) playIndex(0); else { renderQueue(); updateButtons(); }
    if (!quiet) OS.notify(items.length === 1 ? '“' + U.stem(items[0].name) + '” will play next in line.' : items.length + ' files will play after the current one.', { title: 'Added to queue' });
  }

  // ------------------------------------------------------------ playback
  let saveTimer = 0;
  function playIndex(i, opts) {
    if (i < 0 || i >= st.queue.length) return;
    savePosition();
    st.idx = i;
    const it = cur();
    $('#error').hidden = true;
    $('#resume').hidden = true;
    clearTracks();
    destroyHls();
    const live = it.kind === 'live';
    pl.classList.toggle('live', live);
    if (live) playLive(it); else v.src = OS.fs.rawUrl(it.path);
    v.playbackRate = live ? 1 : st.rate;
    const isAudio = it.kind === 'audio';
    $('#audioView').hidden = !isAudio;
    if (isAudio) paintCover(it);
    // transport: now playing
    $('#nowBtn').disabled = false;
    $('#barTitle').textContent = titleOf(it);
    $('#barSub').textContent = whereOf(it);
    $('#npArt').style.background = coverBg(it.name);
    $('#npArt').innerHTML = live && it.logo ? '<img src="' + esc(it.logo) + '" alt="" referrerpolicy="no-referrer">' : ic(isAudio ? 'music' : 'video', 20);
    const npImg = $('#npArt img');
    if (npImg) npImg.onerror = () => { $('#npArt').innerHTML = ic('video', 20); };
    OS.win.setTitle(titleOf(it) + ' — Media');
    applyVolume();
    if (!live) {
      v.play().catch(() => { /* autoplay blocked: the user presses play */ });
      offerResume(it);
      if (!isAudio) findSubtitles(it);
    }
    updateMediaSession();
    if (!(opts && opts.stay)) { if (st.view !== 'now') st.lastLib = st.view; showView('now'); }
    else showView(st.view);
    renderQueue();
    updateButtons();
  }

  function stopAll() {
    savePosition();
    destroyHls();
    pl.classList.remove('live');
    v.removeAttribute('src'); v.load();
    st.idx = -1;
    $('#nowBtn').disabled = true;
    $('#barTitle').textContent = 'Nothing playing';
    $('#barSub').textContent = 'Open a file to start';
    $('#npArt').style.background = ''; $('#npArt').innerHTML = '';
    OS.win.setTitle('Media');
    if (st.view === 'now') showView('home'); else showView(st.view);
    updateButtons(); updateTime();
  }

  function togglePlay() {
    if (!cur()) { openDialog(); return; }
    if (v.paused || v.ended) v.play().catch(() => {}); else v.pause();
  }

  function next(auto) {
    if (!st.queue.length) return;
    if (auto && st.repeat === 'one') { v.currentTime = 0; v.play().catch(() => {}); return; }
    let i;
    if (st.shuffle && st.queue.length > 1) { do { i = Math.floor(Math.random() * st.queue.length); } while (i === st.idx); }
    else i = st.idx + 1;
    if (i >= st.queue.length) {
      if (st.repeat === 'all') i = 0;
      else { if (auto) { v.pause(); v.currentTime = 0; } return; }
    }
    playIndex(i, { stay: st.view !== 'now' });
  }

  function prev() {
    if (v.currentTime > 3 || st.idx <= 0) { v.currentTime = 0; return; }
    playIndex(st.idx - 1, { stay: st.view !== 'now' });
  }

  function seekBy(sec) {
    if (!cur() || (cur().kind === 'live' && !(v.seekable && v.seekable.length && isFinite(v.duration)))) return;
    v.currentTime = Math.max(0, Math.min((v.duration || 0) - 0.1, v.currentTime + sec));
    flash((sec > 0 ? '+' : '−') + Math.abs(sec) + ' s');
  }
  function setVolume(x) {
    st.volume = Math.max(0, Math.min(1, x));
    if (st.volume > 0) st.muted = false;
    store.set('volume', st.volume);
    applyVolume(); updateButtons();
  }
  function toggleMute() { st.muted = !st.muted; applyVolume(); updateButtons(); flash(st.muted ? 'Muted' : Math.round(st.volume * 100) + '%'); }
  function setRate(r) { st.rate = r; v.playbackRate = r; flash(r + '×'); }

  // ------------------------------------------------------------ resume where you left off
  const posKey = (p) => 'pos.' + userKey + '.' + p;
  function savePosition() {
    const it = cur();
    if (!it || it.kind === 'live' || !isFinite(v.duration) || v.duration < 60) return;
    const left = v.duration - v.currentTime;
    store.set(posKey(it.path), v.currentTime > 20 && left > 15 ? Math.floor(v.currentTime) : null);
  }
  function offerResume(it) {
    const at = store.get(posKey(it.path), null);
    if (!at) return;
    const box = $('#resume');
    box.innerHTML = 'Continue from ' + fmt(at) + '?<button data-r="yes">Continue</button><button class="ghost" data-r="no">Start over</button>';
    box.hidden = false;
    box.onclick = (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      if (b.dataset.r === 'yes') v.currentTime = at; else store.set(posKey(it.path), null);
      box.hidden = true;
    };
    setTimeout(() => { box.hidden = true; }, 9000);
  }

  // ------------------------------------------------------------ subtitles
  function clearTracks() {
    Array.from(v.querySelectorAll('track')).forEach((t) => { if (t.src.startsWith('blob:')) URL.revokeObjectURL(t.src); t.remove(); });
  }
  function srtToVtt(text) {
    return 'WEBVTT\n\n' + String(text).replace(/\r/g, '').replace(/^﻿/, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').replace(/^\d+\n(?=\d{2}:\d{2})/gm, '');
  }
  async function addTrack(path, label) {
    try {
      const r = await OS.fs.read(path, { track: false });
      const vtt = U.ext(path) === 'srt' ? srtToVtt(r.content) : r.content;
      const t = document.createElement('track');
      t.kind = 'subtitles';
      t.label = label || U.stem(path);
      t.src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      t.addEventListener('load', () => { cuesLifted = null; placeCues(); });
      v.appendChild(t);
      const idx = v.textTracks.length - 1;
      setTimeout(() => showTrack(idx), 50);
    } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t load subtitles' }); }
  }
  function showTrack(i) {
    Array.from(v.textTracks).forEach((tt, j) => { tt.mode = j === i ? 'showing' : 'disabled'; });
    updateButtons();
  }
  async function findSubtitles(it) {
    const stem = U.stem(it.name).toLowerCase();
    try {
      const list = await OS.fs.list(U.dirname(it.path));
      if (cur() !== it) return;
      const subs = list.filter((e) => ['srt', 'vtt'].includes(U.ext(e.name)) && U.stem(e.name).toLowerCase().startsWith(stem));
      for (const s of subs) await addTrack(s.path, U.stem(s.name).slice(stem.length).replace(/^[._ -]+/, '') || 'Subtitles');
    } catch (e) { /* folder unreadable */ }
  }
  function subtitlesMenu(at) {
    const tts = Array.from(v.textTracks);
    const showing = tts.findIndex((t) => t.mode === 'showing');
    OS.menu([
      { label: 'Off', icon: showing === -1 ? 'check' : null, action: () => showTrack(-1) },
      ...tts.map((t, i) => ({ label: t.label || 'Subtitles ' + (i + 1), icon: showing === i ? 'check' : null, action: () => showTrack(i) })),
      'sep',
      { label: 'Add subtitles file…', icon: 'open', action: async () => {
        const p = await OS.dialog.open({ title: 'Add subtitles', accept: ['srt', 'vtt'], startIn: cur() ? U.dirname(cur().path) : '/Videos' });
        if (p) addTrack(p);
      } },
    ], at);
  }
  function toggleSubtitles() {
    const tts = Array.from(v.textTracks);
    if (!tts.length) { flash('No subtitles'); return; }
    const showing = tts.findIndex((t) => t.mode === 'showing');
    showTrack(showing === -1 ? 0 : -1);
    flash(showing === -1 ? 'Subtitles on' : 'Subtitles off');
  }

  // ------------------------------------------------------------ song view: cover + visualiser
  function paintCover(it) {
    const c = coverOf(it.name);
    $('#cover').style.background = coverBg(it.name);
    pl.style.setProperty('--pl-glow', c[1] + '55');
    $('#coverIcon').innerHTML = ic('music', 90);
    $('#nowTitle').textContent = titleOf(it);
    $('#nowSub').textContent = whereOf(it) + (st.queue.length > 1 ? ' · ' + (st.idx + 1) + ' of ' + st.queue.length : '');
    if (it.kind === 'live' && it.logo) {
      $('#coverIcon').innerHTML = '<img src="' + esc(it.logo) + '" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:contain">';
      const im = $('#coverIcon img'); im.onerror = () => { $('#coverIcon').innerHTML = ic('music', 90); };
    }
  }
  let actx = null; let analyser = null; let raf = 0;
  function ensureAudioGraph() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const src = actx.createMediaElementSource(v);
      analyser = actx.createAnalyser();
      analyser.fftSize = 128;
      src.connect(analyser); analyser.connect(actx.destination);
    } catch (e) { actx = null; analyser = null; }
  }
  function drawViz() {
    cancelAnimationFrame(raf);
    const cv = $('#viz');
    const g = cv.getContext('2d');
    let bins = null;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if ($('#audioView').hidden || $('#nowView').hidden) return;
      if (analyser && !bins) bins = new Uint8Array(analyser.frequencyBinCount);
      const w = cv.width; const h = cv.height;
      g.clearRect(0, 0, w, h);
      const n = 48; const bw = w / n;
      if (bins) analyser.getByteFrequencyData(bins);
      for (let i = 0; i < n; i++) {
        const val = bins ? bins[Math.floor(i * bins.length / n)] / 255 : (v.paused ? 0.04 : 0.15 + 0.1 * Math.sin(Date.now() / 300 + i));
        const bh = Math.max(3, val * h);
        g.fillStyle = 'rgba(255,255,255,' + (0.35 + val * 0.6) + ')';
        const x = i * bw + bw * 0.2;
        g.beginPath();
        if (g.roundRect) g.roundRect(x, h - bh, bw * 0.6, bh, 2); else g.rect(x, h - bh, bw * 0.6, bh);
        g.fill();
      }
    };
    loop();
  }

  // ------------------------------------------------------------ UI updates
  function updateButtons() {
    const playing = !v.paused && !v.ended;
    const has = !!cur();
    pl.classList.toggle('playing', playing);
    pl.classList.toggle('loaded', has);
    const mp = $('[data-mini="play"]');
    if (mp) mp.innerHTML = ic(playing ? 'pause' : 'play', 16);
    $('#playBtn').innerHTML = ic(playing ? 'pause' : 'play', 20);
    $('#playBtn').classList.toggle('paused', !playing);
    $('#playBtn').title = playing ? 'Pause (Space)' : 'Play (Space)';
    $('#playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    ['#prevBtn', '#backTenBtn', '#fwdBtn'].forEach((s) => { $(s).disabled = !has; });
    $('#nextBtn').disabled = !has || (st.idx >= st.queue.length - 1 && st.repeat !== 'all' && !st.shuffle);
    setIcon('#muteBtn', st.muted || st.volume === 0 ? 'mute' : 'volume');
    $('#vol').value = Math.round((st.muted ? 0 : st.volume) * 100);
    $('#shuffleBtn').classList.toggle('on', st.shuffle);
    $('#shuffleBtn').title = 'Shuffle: ' + (st.shuffle ? 'on' : 'off');
    $('#repeatBtn').classList.toggle('on', st.repeat !== 'off');
    $('#repeatBtn').innerHTML = ic('repeat') + (st.repeat === 'one' ? '<span class="pl-badge">1</span>' : '');
    $('#repeatBtn').title = 'Repeat: ' + ({ off: 'off', all: 'all', one: 'one' })[st.repeat];
    const isVideo = has && isVideoItem(cur());
    const liveNow = has && cur().kind === 'live';
    $('#ccBtn').disabled = !isVideo || liveNow;
    $('#backTenBtn').disabled = $('#fwdBtn').disabled = !has || (liveNow && !(isFinite(v.duration) && v.seekable && v.seekable.length));
    $('#ccBtn').classList.toggle('on', Array.from(v.textTracks).some((t) => t.mode === 'showing'));
    $('#pipBtn').disabled = !isVideo || !document.pictureInPictureEnabled;
    $('#fsBtn').disabled = !has;
    setIcon('#fsBtn', document.fullscreenElement ? 'restore' : 'expand');
    $('#fsBtn').title = document.fullscreenElement ? 'Exit full screen (F)' : 'Full screen (F)';
    // the "now playing" marker in lists
    $$('.pl-row.now .pl-row-art').forEach((a) => { a.innerHTML = ic(playing ? 'volume' : (cur() && cur().kind === 'audio' ? 'music' : 'video'), 15); });
    $$('.pl-ch.now').forEach((c) => c.classList.remove('now'));
    if (cur() && cur().kind === 'live') $$('.pl-ch').forEach((c) => { if (c.dataset.ch === cur().path) c.classList.add('now'); });
  }

  function updateTime() {
    const d = v.duration || 0;
    const t = v.currentTime || 0;
    const pct = d && cur() ? (t / d) * 100 : 0;
    $('#played').style.width = pct + '%';
    $('#thumb').style.left = pct + '%';
    $('#curTime').textContent = fmt(cur() ? t : 0);
    $('#durTime').textContent = fmt(cur() ? d : 0);
    $('#buffered').style.width = cur() && v.buffered.length && d ? (v.buffered.end(v.buffered.length - 1) / d) * 100 + '%' : '0';
    if (Date.now() - saveTimer > 5000) { saveTimer = Date.now(); savePosition(); }
    if ('mediaSession' in navigator && d && cur() && navigator.mediaSession.setPositionState) {
      try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(t, d), playbackRate: v.playbackRate }); } catch (e) { /* ignore */ }
    }
  }

  function flash(text) {
    if (st.view !== 'now') return;
    const f = $('#flash');
    f.innerHTML = text === 'play' ? ic('play', 28) : text === 'pause' ? ic('pause', 28) : esc(text);
    f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
  }

  // hide the transport over a playing video after a moment without the mouse
  let idleTimer = 0;
  function wake() {
    pl.classList.remove('idle');
    placeCues();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!v.paused && pl.classList.contains('np-video') && !$('#controls').matches(':hover')) { pl.classList.add('idle'); placeCues(); }
    }, 2600);
  }
  /** Keep subtitles above the transport bar while it shows over the picture. */
  let cuesLifted = null;
  function placeCues() {
    const lift = pl.classList.contains('np-video') && !pl.classList.contains('idle');
    const h = stage.clientHeight || 1;
    const line = lift ? Math.max(50, 100 - (($('#controls').offsetHeight + 28) / h) * 100) : 92;
    const key = Math.round(line);
    if (cuesLifted === key) return;
    cuesLifted = key;
    Array.from(v.textTracks).forEach((tt) => Array.from(tt.cues || []).forEach((c) => { c.snapToLines = false; c.line = key; }));
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator) || !cur()) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: titleOf(cur()), artist: whereOf(cur()), album: cur().kind === 'live' ? 'Live TV' : 'LiteOS', artwork: cur().logo ? [{ src: cur().logo }] : [] });
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => v.play());
      ms.setActionHandler('pause', () => v.pause());
      ms.setActionHandler('previoustrack', prev);
      ms.setActionHandler('nexttrack', () => next(false));
      ms.setActionHandler('seekbackward', () => seekBy(-10));
      ms.setActionHandler('seekforward', () => seekBy(30));
      ms.setActionHandler('seekto', (d) => { v.currentTime = d.seekTime; });
    } catch (e) { /* not supported */ }
  }

  // ------------------------------------------------------------ media events
  v.addEventListener('play', () => {
    if (cur() && cur().kind === 'audio') { ensureAudioGraph(); if (actx && actx.state === 'suspended') actx.resume(); }
    applyVolume(); updateButtons(); wake();
  });
  v.addEventListener('pause', () => { updateButtons(); pl.classList.remove('idle'); placeCues(); savePosition(); });
  v.addEventListener('timeupdate', updateTime);
  v.addEventListener('progress', updateTime);
  v.addEventListener('durationchange', updateTime);
  v.addEventListener('waiting', () => { $('#spinner').hidden = false; });
  v.addEventListener('loadstart', () => { if (cur() && v.getAttribute('src')) $('#spinner').hidden = false; });
  ['playing', 'canplay', 'pause', 'error', 'emptied'].forEach((ev) => v.addEventListener(ev, () => { $('#spinner').hidden = true; }));
  v.addEventListener('ended', () => { if (cur()) store.set(posKey(cur().path), null); next(true); });
  v.addEventListener('error', () => {
    if (!cur() || !v.getAttribute('src') || cur().kind === 'live') return; // live channels handle their own errors
    const e = $('#error');
    e.innerHTML = '<b>Can’t play this file</b>“' + esc(cur().name) + '” is in a format this browser can’t play (' + esc(U.ext(cur().name).toUpperCase()) + '). MP4 (H.264), WebM, MP3, OGG and WAV work everywhere.';
    e.hidden = false;
  });

  // ------------------------------------------------------------ transport: mouse
  $('#playBtn').addEventListener('click', togglePlay);
  $('#prevBtn').addEventListener('click', prev);
  $('#nextBtn').addEventListener('click', () => next(false));
  $('#backTenBtn').addEventListener('click', () => seekBy(-10));
  $('#fwdBtn').addEventListener('click', () => seekBy(30));
  $('#muteBtn').addEventListener('click', toggleMute);
  $('#vol').addEventListener('input', (e) => setVolume(+e.target.value / 100));
  $('#ccBtn').addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); subtitlesMenu({ x: r.left - 140, y: r.top - 150 }); });
  $('#shuffleBtn').addEventListener('click', () => { st.shuffle = !st.shuffle; store.set('shuffle', st.shuffle); updateButtons(); flash(st.shuffle ? 'Shuffle on' : 'Shuffle off'); });
  $('#repeatBtn').addEventListener('click', () => {
    st.repeat = ({ off: 'all', all: 'one', one: 'off' })[st.repeat];
    store.set('repeat', st.repeat); updateButtons();
    flash(({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' })[st.repeat]);
  });
  $('#pipBtn').addEventListener('click', async () => {
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await v.requestPictureInPicture(); }
    catch (e) { OS.notify('This browser doesn’t allow a mini player for this video.', { type: 'error', title: 'Mini player unavailable' }); }
  });
  $('#fsBtn').addEventListener('click', toggleFullscreen);
  $('#moreBtn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const isVideo = isVideoItem(cur());
    const liveNow = cur() && cur().kind === 'live';
    OS.menu([
      { header: 'Speed' },
      ...[0.5, 0.75, 1, 1.25, 1.5, 2].map((x) => ({ label: x === 1 ? 'Normal' : x + '×', icon: st.rate === x ? 'check' : null, disabled: liveNow, action: () => setRate(x) })),
      'sep',
      { label: 'Save frame to Pictures', icon: 'image', disabled: !isVideo, action: saveFrame },
      { label: stage.classList.contains('fill') ? 'Fit video to window' : 'Fill the window', icon: 'expand', disabled: !isVideo, action: () => stage.classList.toggle('fill') },
      'sep',
      { label: 'Add files to queue…', icon: 'plus', action: addFilesDialog },
      { label: 'Show play queue', icon: 'list', action: () => showView('queue') },
      'sep',
      { label: 'Send streams through LiteOS', icon: tv.proxyAlways ? 'check' : null, action: () => { tv.proxyAlways = !tv.proxyAlways; saveTv(); if (liveNow) playIndex(st.idx, { stay: true }); } },
    ], { x: r.right - 240, y: r.top - 380 });
  });
  $('#openBtn').addEventListener('click', openDialog);
  $('#openFolderBtn').addEventListener('click', folderDialog);
  $('#addBtn').addEventListener('click', addFilesDialog);
  $('#clearBtn').addEventListener('click', () => {
    const it = cur();
    st.queue = it ? [it] : [];
    st.idx = it ? 0 : -1;
    renderQueue(); updateButtons();
  });
  $('#playAllMusic').addEventListener('click', async () => playList((await library()).audio.map((f) => f.path), false));
  $('#shuffleAllMusic').addEventListener('click', async () => playList((await library()).audio.map((f) => f.path), true));

  // seek bar with hover time and dragging
  function seekRatio(e) { const r = seek.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); }
  seek.addEventListener('pointermove', (e) => {
    const x = seekRatio(e);
    $('#tip').textContent = fmt(x * (v.duration || 0));
    $('#tip').style.left = (x * 100) + '%';
  });
  seek.addEventListener('pointerdown', (e) => {
    if (!cur() || !v.duration) return;
    seek.setPointerCapture(e.pointerId);
    seek.classList.add('dragging');
    const set = (ev) => { v.currentTime = seekRatio(ev) * v.duration; updateTime(); };
    set(e);
    const up = () => { seek.classList.remove('dragging'); seek.removeEventListener('pointermove', set); seek.removeEventListener('pointerup', up); };
    seek.addEventListener('pointermove', set);
    seek.addEventListener('pointerup', up);
  });

  // the picture: click to play/pause, double-click for full screen
  let clickTimer = 0;
  stage.addEventListener('click', (e) => {
    if (e.target.closest('.pl-resume, .pl-error')) return;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { togglePlay(); flash(v.paused ? 'pause' : 'play'); }, 220);
  });
  // the mini player: its buttons, or click anywhere on it to go back to the video
  $('#nowView').addEventListener('click', (e) => {
    if (!pl.classList.contains('mini')) return;
    e.stopPropagation();
    const b = e.target.closest('[data-mini]');
    if (b && b.dataset.mini === 'close') { stopAll(); return; }
    if (b && b.dataset.mini === 'play') { togglePlay(); return; }
    st.lastLib = st.view; showView('now');
  });
  stage.addEventListener('dblclick', () => { if (pl.classList.contains('mini')) return; clearTimeout(clickTimer); toggleFullscreen(); });
  pl.addEventListener('mousemove', wake);
  stage.addEventListener('wheel', (e) => { if (!cur()) return; e.preventDefault(); setVolume(st.volume + (e.deltaY < 0 ? 0.05 : -0.05)); flash(Math.round(st.volume * 100) + '%'); }, { passive: false });

  function toggleFullscreen() {
    if (!cur()) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else { if (st.view !== 'now') { st.lastLib = st.view; showView('now'); } pl.requestFullscreen().catch(() => OS.notify('This browser blocked full screen for this window.', { type: 'error', title: 'Full screen unavailable' })); }
  }
  document.addEventListener('fullscreenchange', updateButtons);

  async function saveFrame() {
    const it = cur();
    if (!it || !isVideoItem(it) || !v.videoWidth) return;
    try {
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const name = titleOf(it).replace(/[\\/<>:"|?*]+/g, ' ').trim() + ' ' + fmt(v.currentTime).replace(/:/g, '.') + '.png';
      let path = '/Pictures/' + name;
      try { await OS.fs.writeBase64(path, await U.toBase64(blob), { overwrite: false }); }
      catch (e) { path = '/Pictures/' + U.stem(name) + ' ' + Date.now() + '.png'; await OS.fs.writeBase64(path, await U.toBase64(blob)); }
      OS.notify('“' + U.basename(path) + '” is in your Pictures folder.', { type: 'success', title: 'Frame saved', image: path });
    } catch (e) { OS.notify(it.kind === 'live' ? 'This channel doesn’t allow saving frames. Turn on “Send streams through LiteOS” in the … menu and try again.' : e.message, { type: 'error', title: 'Couldn’t save the frame' }); }
  }

  async function openDialog() {
    const p = await OS.dialog.open({ title: 'Open media', accept: VIDEO.concat(AUDIO), startIn: '/Videos' });
    if (p) openPath(p);
  }
  async function folderDialog() {
    const d = await OS.dialog.folder({ title: 'Play a folder', startIn: '/Music' });
    if (d) openFolder(d);
  }
  async function addFilesDialog() {
    const p = await OS.dialog.open({ title: 'Add to queue', accept: VIDEO.concat(AUDIO), startIn: '/Music' });
    if (p) addToQueue([p]);
  }



  // ============================================================ Photos
  /** The built-in picture wallpapers, shown in Photos for everyone (they can't be deleted). */
  const WALL_PHOTOS = (window.LOS_WALLPAPERS || []).map((w) => {
    const m = /url\(([^)]+)\)/.exec(w.css || '');
    return m ? { name: w.name, url: m[1].replace(/^['"]|['"]$/g, ''), wallId: w.id, builtin: true } : null;
  }).filter(Boolean);
  const photoSrc = (e) => (e.builtin ? e.url : OS.fs.rawUrl(e.path));
  let photoList = [];
  const photoRatio = {}; // photo url -> width / height

  function renderPhotos() {
    const box = $('#photoList');
    library().then((lib) => {
      const mine = lib.image;
      photoList = mine.concat(WALL_PHOTOS);
      $('#slideAll').disabled = !photoList.length;
      const groups = [];
      let last = null;
      mine.forEach((e, i) => {
        const d = new Date((e.mtime || 0) * 1000);
        const key = d.getFullYear() + '-' + d.getMonth();
        if (!last || last.key !== key) { last = { key, label: d.toLocaleDateString([], { month: 'long', year: 'numeric' }), list: [] }; groups.push(last); }
        last.list.push(i);
      });
      if (WALL_PHOTOS.length) groups.push({ label: 'Wallpapers', list: WALL_PHOTOS.map((w, j) => mine.length + j), walls: true });
      // Justified rows: each tile grows in proportion to its photo's shape, so every row is the
      // same height and fills the width. Shapes are learned as photos load, then remembered.
      const tileOf = (idx, g) => {
        const e = photoList[idx];
        const src = photoSrc(e);
        const r = photoRatio[src] || 1.5;
        return '<button class="pl-photo" data-r="' + r + '" data-photo="' + idx + '" title="' + esc(e.name) + '" aria-label="' + esc(e.name) + '"><img loading="lazy" decoding="async" alt="" src="' + esc(src) + '">' +
          (g.walls ? '<span class="pl-photo-label">' + esc(e.name) + '</span>' : '') + '</button>';
      };
      box.innerHTML = (mine.length ? '' : '<p class="pl-photo-hint">Your own pictures show up here too, from anywhere on your drive. Drop some in this window to add them to /Pictures.</p>') +
        groups.map((g) => '<section class="pl-pgroup"><h2>' + esc(g.label) + '</h2><div class="pl-pgrid' + (g.walls ? ' walls' : '') + '">' +
          g.list.map((idx) => tileOf(idx, g)).join('') + '</div></section>').join('');
      justifyPhotos();
      box.querySelectorAll('.pl-photo img').forEach((img) => {
        const fitShape = () => {
          if (!img.naturalWidth) return;
          const r = Math.min(4, Math.max(0.25, img.naturalWidth / img.naturalHeight));
          photoRatio[img.getAttribute('src')] = r;
          img.parentElement.dataset.r = r;
          justifySoon();
        };
        if (img.complete) fitShape(); else img.addEventListener('load', fitShape, { once: true });
      });
      box.querySelectorAll('.pl-photo img').forEach((img) => img.addEventListener('error', () => { img.replaceWith(Object.assign(document.createElement('span'), { className: 'pl-photo-broken', innerHTML: ic('image', 26) })); }, { once: true }));
    });
  }
  /**
   * Justified rows, like Google Photos: photos keep their shape, every full row is filled edge to
   * edge, and no row is taller than ROW_H (a row that can't be filled, like the last, stays at ROW_H).
   */
  function justifyPhotos() {
    const GAP = 4;
    $$('#photoList .pl-pgrid').forEach((grid) => {
      const W = grid.clientWidth;
      if (!W) return;
      const ROW_H = W < 520 ? 120 : 190;
      let row = []; let sum = 0;
      const place = (items, h, full) => items.forEach((t, i) => {
        t.style.height = Math.floor(h) + 'px';
        t.style.width = Math.floor(+t.dataset.r * h) + 'px';
        t.style.flexGrow = full && i === items.length - 1 ? '1' : '0'; // soaks up rounding
      });
      Array.from(grid.children).forEach((t) => {
        row.push(t); sum += +t.dataset.r || 1.5;
        if (sum * ROW_H + GAP * (row.length - 1) >= W) {
          place(row, (W - GAP * (row.length - 1)) / sum, true);
          row = []; sum = 0;
        }
      });
      if (row.length) place(row, ROW_H, false);
    });
  }
  let justifyTimer = 0;
  function justifySoon() { cancelAnimationFrame(justifyTimer); justifyTimer = requestAnimationFrame(justifyPhotos); }
  new ResizeObserver(justifySoon).observe($('#photoList'));

  $('#photoList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-photo]');
    if (b) openViewer(photoList, +b.dataset.photo, false);
  });
  $('#slideAll').addEventListener('click', () => openViewer(photoList, 0, true));

  /** Open one picture; the viewer can step through the other pictures in its folder. */
  async function openImage(path) {
    let list = [];
    try {
      list = (await OS.fs.list(U.dirname(path))).filter((e) => e.type === 'file' && isImage(e.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    } catch (e) { /* folder unreadable */ }
    if (!list.some((e) => e.path === path)) list.unshift({ path, name: U.basename(path) });
    openViewer(list, list.findIndex((e) => e.path === path), false);
  }

  async function uploadPhotos(files) {
    tvBusy('Uploading ' + (files.length === 1 ? '“' + files[0].name + '”' : files.length + ' photos') + '…');
    try {
      try { await OS.fs.mkdir('/Pictures'); } catch (x) { /* exists */ }
      const entries = await OS.fs.upload('/Pictures', files);
      libCache = null;
      OS.notify((entries.length === 1 ? '“' + entries[0].name + '” was' : entries.length + ' photos were') + ' saved to Pictures.', { type: 'success', title: entries.length === 1 ? 'Photo added' : 'Photos added' });
      if (st.view === 'photos' || st.view === 'home') showView(st.view);
      if (entries.length === 1 && !cur()) openImage(entries[0].path);
    } catch (err) { OS.notify(err.message, { type: 'error', title: 'Upload failed' }); }
    finally { tvBusy(''); }
  }

  // ------------------------------------------------------------ the viewer: zoom, pan, rotate, slideshow
  const viewer = $('#viewer');
  const vImg = $('#vImg');
  const vStage = $('#vStage');
  const PV = { list: [], i: 0, zoom: 1, rot: 0, tx: 0, ty: 0, base: 1, timer: null, open: false };

  function openViewer(list, i, slideshow) {
    if (!list.length) return;
    PV.list = list.slice();
    PV.open = true;
    viewer.hidden = false;
    if (!v.paused && isVideoItem(cur())) v.pause(); // a video shouldn't keep playing behind a photo
    showPhoto(i);
    setSlideshow(!!slideshow);
    viewer.focus({ preventScroll: true });
  }
  function closeViewer() {
    setSlideshow(false);
    PV.open = false;
    viewer.hidden = true;
    vImg.removeAttribute('src');
    OS.win.setTitle(cur() ? titleOf(cur()) + ' — Media' : 'Media');
  }
  function showPhoto(i) {
    const n = PV.list.length;
    if (!n) { closeViewer(); return; }
    PV.i = ((i % n) + n) % n;
    const e = PV.list[PV.i];
    PV.zoom = 1; PV.rot = 0; PV.tx = 0; PV.ty = 0;
    vStage.classList.add('nofx');
    vImg.style.visibility = 'hidden';
    vImg.onload = () => { photoBase(); photoTransform(); vImg.style.visibility = ''; requestAnimationFrame(() => vStage.classList.remove('nofx')); };
    vImg.onerror = () => { vImg.style.visibility = 'hidden'; OS.notify('“' + e.name + '” couldn’t be loaded. The file may be damaged or in a format the browser can’t show.', { type: 'error', title: 'Can’t open photo' }); };
    vImg.src = photoSrc(e);
    $('#vShow').hidden = $('#vDelete').hidden = !!e.builtin; // built-in wallpapers aren't files on the drive
    vImg.alt = e.name;
    $('#vName').textContent = e.name;
    $('#vIndex').textContent = n > 1 ? (PV.i + 1) + ' of ' + n : '';
    $('#vPrev').hidden = $('#vNext').hidden = n < 2;
    OS.win.setTitle(e.name + ' — Media');
    if (n > 1) { const pre = new Image(); pre.src = photoSrc(PV.list[(PV.i + 1) % n]); }
  }
  function photoBase() {
    const w = vImg.naturalWidth || 1; const h = vImg.naturalHeight || 1;
    const r = vStage.getBoundingClientRect();
    const sw = Math.max(1, r.width - 32); const sh = Math.max(1, r.height - 32);
    const turned = Math.abs(PV.rot % 180) === 90;
    PV.base = Math.min(sw / (turned ? h : w), sh / (turned ? w : h), 1);
    vImg.style.width = w + 'px';
    vImg.style.height = h + 'px';
  }
  function photoTransform() {
    const sc = PV.base * PV.zoom;
    vImg.style.transform = 'translate(-50%, -50%) translate(' + PV.tx + 'px,' + PV.ty + 'px) rotate(' + PV.rot + 'deg) scale(' + sc + ')';
    $('#vZoom').textContent = Math.round(sc * 100) + '%';
    vStage.classList.toggle('pan', PV.zoom > 1);
  }
  function photoZoom(k, cx, cy) {
    const nz = Math.min(Math.max(PV.zoom * k, 0.2), 12 / Math.max(PV.base, 0.01));
    const kk = nz / PV.zoom;
    if (cx != null) { PV.tx = (PV.tx - cx) * kk + cx; PV.ty = (PV.ty - cy) * kk + cy; } else { PV.tx *= kk; PV.ty *= kk; }
    PV.zoom = nz;
    if (PV.zoom <= 1) { PV.tx = 0; PV.ty = 0; }
    photoTransform();
  }
  const photoFit = () => { PV.zoom = 1; PV.tx = 0; PV.ty = 0; photoTransform(); };
  const photoRotate = () => { PV.rot = (PV.rot + 90) % 360; photoBase(); PV.tx = 0; PV.ty = 0; photoTransform(); };
  function setSlideshow(on) {
    clearInterval(PV.timer); PV.timer = null;
    if (on && PV.list.length > 1) PV.timer = setInterval(() => showPhoto(PV.i + 1), 4000);
    $('#vSlide').classList.toggle('on', !!PV.timer);
    $('#vSlide').textContent = PV.timer ? 'Stop slideshow' : 'Slideshow';
  }
  async function deletePhoto() {
    const e = PV.list[PV.i];
    if (!e || e.builtin) return;
    const was = !!PV.timer; setSlideshow(false);
    const ok = await OS.dialog.confirm({ title: 'Move to Trash?', message: '“' + e.name + '” will be moved to the Trash.', okLabel: 'Move to Trash', danger: true });
    if (!ok) { if (was) setSlideshow(true); return; }
    try {
      await OS.fs.remove(e.path);
      libCache = null;
      OS.notify('You can restore “' + e.name + '” from the Trash if you need it.', { type: 'success', title: 'Moved to Trash' });
      PV.list.splice(PV.i, 1);
      if (st.view === 'photos' || st.view === 'home') showView(st.view);
      if (!PV.list.length) closeViewer(); else showPhoto(PV.i);
    } catch (err) { OS.notify(err.message, { type: 'error', title: 'Couldn’t delete the photo' }); }
  }
  const stepPhoto = (d) => { showPhoto(PV.i + d); if (PV.timer) setSlideshow(true); };
  $('#vPrev').addEventListener('click', () => stepPhoto(-1));
  $('#vNext').addEventListener('click', () => stepPhoto(1));
  $('#vZoomIn').addEventListener('click', () => photoZoom(1.25));
  $('#vZoomOut').addEventListener('click', () => photoZoom(0.8));
  $('#vFit').addEventListener('click', photoFit);
  $('#vRotate').addEventListener('click', photoRotate);
  $('#vSlide').addEventListener('click', () => setSlideshow(!PV.timer));
  $('#vShow').addEventListener('click', () => { const e = PV.list[PV.i]; if (e) { closeViewer(); OS.open('files', { path: U.dirname(e.path), select: e.path }); } });
  $('#vDelete').addEventListener('click', deletePhoto);
  $('#vWall').addEventListener('click', async () => {
    const e = PV.list[PV.i];
    if (!e) return;
    try {
      await OS.saveSettings({ wallpaper: e.builtin ? e.wallId : 'file:' + e.path });
      OS.notify('“' + e.name + '” is now your desktop background.', { type: 'success', title: 'Wallpaper changed' });
    } catch (err) { OS.notify(err.message, { type: 'error', title: 'Couldn’t set the wallpaper' }); }
  });
  $('#vClose').addEventListener('click', closeViewer);
  vStage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = vStage.getBoundingClientRect();
    photoZoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX - r.left - r.width / 2, ev.clientY - r.top - r.height / 2);
  }, { passive: false });
  vStage.addEventListener('dblclick', (ev) => {
    if (ev.target.closest('.pl-varrow')) return;
    if (PV.zoom > 1) photoFit();
    else { const r = vStage.getBoundingClientRect(); photoZoom(2, ev.clientX - r.left - r.width / 2, ev.clientY - r.top - r.height / 2); }
  });
  let pdrag = null;
  vStage.addEventListener('pointerdown', (ev) => {
    if (PV.zoom <= 1 || ev.target.closest('.pl-varrow')) return;
    pdrag = { x: ev.clientX, y: ev.clientY, tx: PV.tx, ty: PV.ty, id: ev.pointerId };
    vStage.setPointerCapture(ev.pointerId);
    vStage.classList.add('panning');
  });
  vStage.addEventListener('pointermove', (ev) => {
    if (!pdrag || ev.pointerId !== pdrag.id) return;
    PV.tx = pdrag.tx + ev.clientX - pdrag.x; PV.ty = pdrag.ty + ev.clientY - pdrag.y;
    photoTransform();
  });
  const endPDrag = () => { pdrag = null; vStage.classList.remove('panning'); };
  vStage.addEventListener('pointerup', endPDrag);
  vStage.addEventListener('pointercancel', endPDrag);
  window.addEventListener('resize', () => { if (PV.open && vImg.naturalWidth) { photoBase(); photoTransform(); } });
  // the viewer's keys come first while it is open
  document.addEventListener('keydown', (ev) => {
    if (!PV.open) return;
    const k = ev.key;
    const map = { Escape: closeViewer, ArrowLeft: () => stepPhoto(-1), ArrowRight: () => stepPhoto(1), '+': () => photoZoom(1.25), '=': () => photoZoom(1.25),
      '-': () => photoZoom(0.8), _: () => photoZoom(0.8), 0: photoFit, r: photoRotate, R: photoRotate, ' ': () => setSlideshow(!PV.timer), Delete: deletePhoto };
    if (!map[k] || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    map[k]();
  }, true);

  // ============================================================ Live TV (IPTV)
  // Everything lives in the user's drive under /.player/ (hidden from Files):
  //   tv.json            channels added one by one, imported playlists, favourites, picture index
  //   <playlistId>.json  the channels of an imported playlist
  //   thumbs/<key>.jpg   a picture grabbed from each channel's stream
  const TV_DIR = '/.player';
  const tv = { lists: [], mine: [], favorites: [], thumbs: {}, radio: {}, proxyAlways: false, source: 'all', group: '', query: '' };
  const tvChannels = {}; // playlist id -> channels
  let tvLoaded = false;

  const hashKey = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36) + s.length.toString(36); };
  const thumbPath = (url) => TV_DIR + '/thumbs/' + hashKey(url) + '.jpg';

  async function loadTv() {
    if (tvLoaded) return;
    tvLoaded = true;
    let d = {};
    try { d = JSON.parse((await OS.fs.read(TV_DIR + '/tv.json', { track: false })).content || '{}'); } catch (e) { /* first use */ }
    tv.lists = Array.isArray(d.lists) ? d.lists : [];
    tv.mine = Array.isArray(d.mine) ? d.mine : [];
    tv.favorites = (Array.isArray(d.favorites) ? d.favorites : []).map((f) => (typeof f === 'string' ? f : f && f.url)).filter(Boolean);
    tv.thumbs = d.thumbs && typeof d.thumbs === 'object' ? d.thumbs : {};
    tv.radio = d.radio && typeof d.radio === 'object' ? d.radio : {};
    tv.proxyAlways = !!d.proxyAlways;
    // older format: every source was a "playlist"
    if (Array.isArray(d.playlists)) d.playlists.forEach((p) => tv.lists.push(Object.assign({ removed: [], names: {} }, p)));
    await Promise.all(tv.lists.map(async (p) => {
      try { tvChannels[p.id] = JSON.parse((await OS.fs.read(TV_DIR + '/' + p.id + '.json', { track: false })).content || '[]'); }
      catch (e) { tvChannels[p.id] = []; }
    }));
    if (Array.isArray(d.playlists)) saveTvNow();
  }
  async function ensureTvDir(sub) { try { await OS.fs.mkdir(TV_DIR); } catch (e) { /* exists */ } if (sub) { try { await OS.fs.mkdir(TV_DIR + '/' + sub); } catch (e) { /* exists */ } } }
  async function saveTvNow() {
    await ensureTvDir();
    const data = { lists: tv.lists, mine: tv.mine, favorites: tv.favorites, thumbs: tv.thumbs, radio: tv.radio, proxyAlways: tv.proxyAlways };
    await OS.fs.write(TV_DIR + '/tv.json', JSON.stringify(data)).catch(() => {});
  }
  let saveTvTimer = 0;
  function saveTv() { clearTimeout(saveTvTimer); saveTvTimer = setTimeout(saveTvNow, 400); }

  /** Parse an M3U / M3U8 channel list. Returns null for a single HLS stream. */
  function parseM3U(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
    if (lines.some((l) => /^#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/.test(l))) return null;
    const out = [];
    let info = null; let group = '';
    for (const raw of lines) {
      const l = raw.trim();
      if (!l) continue;
      if (l.startsWith('#EXTINF')) {
        const body = l.slice(l.indexOf(':') + 1);
        let q = false; let cut = -1;
        for (let i = 0; i < body.length; i++) { if (body[i] === '"') q = !q; else if (body[i] === ',' && !q) { cut = i; break; } }
        const attrs = {};
        (cut >= 0 ? body.slice(0, cut) : body).replace(/([\w-]+)="([^"]*)"/g, (m, k, val) => { attrs[k.toLowerCase()] = val; return m; });
        info = { name: (cut >= 0 ? body.slice(cut + 1) : '').trim() || attrs['tvg-name'] || '', logo: attrs['tvg-logo'] || '', group: attrs['group-title'] || '' };
      } else if (l.startsWith('#EXTGRP:')) {
        group = l.slice(8).trim();
      } else if (!l.startsWith('#')) {
        if (/^https?:\/\//i.test(l)) {
          const it = info || { name: '', logo: '', group: '' };
          out.push({ name: it.name || hostName(l), logo: /^https?:\/\//i.test(it.logo) ? it.logo : '', group: it.group || group || '', url: l });
        }
        info = null; group = '';
      }
    }
    return out;
  }
  const hostName = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'Channel'; } };

  /**
   * Read the start of a web address (directly when the server allows it, otherwise through
   * the LiteOS relay). Stops early when it is clearly a media stream, not a playlist.
   * -> { text, isList }
   */
  async function sniff(url) {
    const read = async (res) => {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = ''; let first = true;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        if (first) {
          first = false;
          if (!/^\s*#EXTM3U/.test(text.replace(/^﻿/, '')) && !/mpegurl/i.test(res.headers.get('content-type') || '')) { reader.cancel().catch(() => {}); return { text: '', isList: false }; }
        }
        if (text.length > 32 * 1024 * 1024) { reader.cancel().catch(() => {}); break; }
      }
      return { text, isList: true };
    };
    if (!(location.protocol === 'https:' && /^http:/i.test(url)) && !tv.proxyAlways) {
      try { const r = await fetch(url, { credentials: 'omit' }); if (r.ok) return await read(r); } catch (e) { /* CORS or network: try the relay */ }
    }
    const r = await fetch(await signUrl(url, false), { credentials: 'same-origin' });
    if (!r.ok) { let msg = 'The server answered with an error.'; try { const j = await r.json(); msg = j.message || j.error || msg; } catch (e) { /* not json */ } throw new Error(msg); }
    return read(r);
  }
  const signed = {};
  async function signUrl(url, rewrite) {
    const key = (rewrite === false ? '0|' : '1|') + url;
    if (!signed[key]) signed[key] = (await OS.api('net.sign', { urls: [url], rewrite: rewrite !== false }))[url];
    if (!signed[key]) throw new Error('That web address isn’t supported.');
    return signed[key];
  }
  function tvBusy(text) { const up = $('#uploading'); up.querySelector('span').textContent = text; up.hidden = !text; }

  // ------------------------------------------------------------ adding channels and playlists
  async function newChannelFromUrl() {
    const raw = await OS.dialog.prompt({ title: 'New channel', label: 'Stream or playlist address', value: 'https://', okLabel: 'Next' });
    if (raw == null) return;
    const url = raw.trim();
    if (!/^https?:\/\/\S+$/i.test(url) || url === 'https://') { OS.notify('Enter an address that starts with http:// or https://', { type: 'error', title: 'Not a web address' }); return; }
    let list = null; let text = '';
    if (!DIRECT_EXT.test(url.split('#')[0])) {
      tvBusy('Checking the address…');
      try {
        const res = await sniff(url);
        if (res.isList) { text = res.text; list = parseM3U(text); }
      } catch (e) { tvBusy(''); OS.notify(e.message, { type: 'error', title: 'Couldn’t reach that address' }); return; }
      tvBusy('');
    }
    await loadTv();
    if (list && list.length) {
      await storeList(playlistTitle(text) || hostName(url), { url }, list);
      return;
    }
    if (list && !list.length) { OS.notify('No channels were found in that playlist.', { type: 'error', title: 'Empty playlist' }); return; }
    // a single stream
    if (tv.mine.some((c) => c.url === url)) { OS.notify('That stream is already in My channels.', { title: 'Already added' }); return; }
    const name = streamName(url);
    tv.mine.push({ name, url, logo: '', group: '' });
    await saveTvNow();
    tv.source = 'mine'; tv.group = '';
    showView('tv');
    OS.notify('“' + name + '” is in My channels. Right-click it and choose Edit name to change the name.', { type: 'success', title: 'Channel added' });
  }
  /** A playlist's own title, when it carries one (#PLAYLIST: or a title attribute on #EXTM3U). */
  function playlistTitle(text) {
    const t = String(text || '');
    const m = /^#PLAYLIST:\s*(.+)$/m.exec(t) || /^#EXTM3U[^\n]*?\b(?:title|x-tvg-name|tvg-name|name)="([^"]+)"/m.exec(t);
    return m ? m[1].trim().slice(0, 80) : '';
  }
  /** A readable name for a lone stream, from its address (generic parts like index, master or ids are skipped). */
  function streamName(url) {
    try {
      const u = new URL(url);
      const generic = /^(index|master|playlist|chunklist|manifest|stream|streams|live|hls|dash|play|video|audio|tracks?|mono|out|url|v\d+|\d+p?)(_?\d+)?$/i;
      const isId = (x) => /[0-9a-f]{12,}/i.test(x) || /^\d{4,}/.test(x) || /^[A-Za-z0-9]{7,}$/.test(x) && /\d/.test(x) && /[a-z]/i.test(x) && !/[aeiou]{1}.*[aeiou]/i.test(x.replace(/\d/g, ''));
      const parts = u.pathname.split('/').map((x) => decodeURIComponent(x).replace(/\.[a-z0-9.]+$/i, '')).filter(Boolean).reverse();
      const pick = parts.find((x) => !generic.test(x) && !isId(x) && /[a-z]/i.test(x));
      const host = u.hostname.split('.');
      const site = host.length > 1 ? host[host.length - 2] : host[0];
      const words = (pick || site).replace(/[_\-.+]+/g, ' ').trim();
      return words.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60) || 'Channel';
    } catch (e) { return 'Channel'; }
  }
  async function addPlaylistFromDrive(path) {
    if (!path) path = await OS.dialog.open({ title: 'Add a playlist', accept: ['m3u', 'm3u8'], startIn: '/Downloads' });
    if (!path) return;
    try {
      const content = (await OS.fs.read(path, { track: false })).content;
      const list = parseM3U(content);
      if (!list || !list.length) throw new Error('No channels were found in “' + U.basename(path) + '”.');
      await loadTv();
      await storeList(playlistTitle(content) || U.stem(U.basename(path)), { path }, list);
    } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t read the playlist' }); }
  }
  async function storeList(name, src, channels) {
    const id = 'p' + Date.now().toString(36);
    tv.lists.push(Object.assign({ id, name, count: channels.length, updated: Date.now(), removed: [], names: {} }, src));
    tvChannels[id] = channels;
    await ensureTvDir();
    await OS.fs.write(TV_DIR + '/' + id + '.json', JSON.stringify(channels));
    await saveTvNow();
    tv.source = id; tv.group = '';
    showView('tv');
    OS.notify(channels.length + ' channel' + (channels.length === 1 ? '' : 's') + ' from “' + name + '” are ready to watch.', { type: 'success', title: 'Playlist added' });
  }

  async function refreshList(p) {
    tvBusy('Updating “' + p.name + '”…');
    try {
      const text = p.url ? (await sniff(p.url)).text : (await OS.fs.read(p.path, { track: false })).content;
      const list = parseM3U(text);
      if (!list || !list.length) throw new Error('The playlist is empty or no longer available.');
      tvChannels[p.id] = list;
      p.count = list.length; p.updated = Date.now();
      await OS.fs.write(TV_DIR + '/' + p.id + '.json', JSON.stringify(list));
      await saveTvNow();
      renderTv();
      OS.notify('“' + p.name + '” has ' + list.length + ' channel' + (list.length === 1 ? '' : 's') + '.', { type: 'success', title: 'Playlist updated' });
    } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t update “' + p.name + '”' }); }
    finally { tvBusy(''); }
  }

  // ------------------------------------------------------------ the channel list
  function channelsOf(id) {
    if (id === 'mine') return tv.mine.map((c) => Object.assign({ src: 'mine' }, c));
    const p = tv.lists.find((x) => x.id === id);
    if (!p) return [];
    const removed = new Set(p.removed || []);
    return (tvChannels[id] || []).filter((c) => !removed.has(c.url)).map((c) => Object.assign({}, c, { name: (p.names && p.names[c.url]) || c.name, src: id }));
  }
  function allChannels() {
    const ids = ['mine'].concat(tv.lists.map((p) => p.id));
    const seen = new Set(); const out = [];
    ids.forEach((id) => channelsOf(id).forEach((c) => { if (!seen.has(c.url)) { seen.add(c.url); out.push(c); } }));
    return out;
  }
  function sourceChannels() {
    if (tv.source === 'all') return allChannels();
    if (tv.source === 'fav') { const all = allChannels(); return tv.favorites.map((u) => all.find((c) => c.url === u)).filter(Boolean); }
    return channelsOf(tv.source);
  }
  function visibleChannels() {
    const q = tv.query.trim().toLowerCase();
    return sourceChannels().filter((c) => (!tv.group || c.group === tv.group) && (!q || c.name.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q)));
  }
  const isFav = (url) => tv.favorites.includes(url);
  const initials = (n) => (String(n).replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || 'TV').toUpperCase();
  const TV_PAGE = 120;
  let tvShown = TV_PAGE;
  let tvVisible = [];

  async function renderTv() {
    await loadTv();
    const sources = (tv.mine.length ? 1 : 0) + tv.lists.length;
    const valid = ['all', 'fav', 'mine'].includes(tv.source) ? (tv.source !== 'mine' || tv.mine.length) : tv.lists.some((p) => p.id === tv.source);
    if (!valid || (tv.source === 'all' && sources === 1)) tv.source = tv.mine.length ? (sources > 1 ? 'all' : 'mine') : (tv.lists[0] ? (sources > 1 ? 'all' : tv.lists[0].id) : 'all');
    // which channels to show: a plain dropdown, only when there is more than one choice
    const opts = [];
    if (sources > 1) opts.push(['all', 'All channels']);
    if (tv.mine.length) opts.push(['mine', 'My channels']);
    tv.lists.forEach((p) => opts.push([p.id, p.name]));
    if (tv.favorites.length) opts.push(['fav', 'Favourites']);
    const srcSel = $('#tvSource');
    srcSel.innerHTML = opts.map(([id, label]) => '<option value="' + esc(id) + '"' + (tv.source === id ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
    srcSel.hidden = opts.length < 2;
    const groups = Array.from(new Set(sourceChannels().map((c) => c.group).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    if (tv.group && !groups.includes(tv.group)) tv.group = '';
    const sel = $('#tvGroup');
    sel.innerHTML = '<option value="">All groups</option>' + groups.map((g) => '<option' + (g === tv.group ? ' selected' : '') + '>' + esc(g) + '</option>').join('');
    sel.hidden = groups.length < 2;
    $('#tvSearch').hidden = false;
    $('#tvSearch').disabled = !sources; // shown but disabled until there are channels
    $('#tvRefresh').disabled = !tv.lists.length;
    renderChannels();
  }

  function renderChannels() {
    const box = $('#tvList');
    const sources = (tv.mine.length ? 1 : 0) + tv.lists.length;
    if (!sources) {
      box.innerHTML = '<div class="pl-notice"><b>No channels yet</b><span>Use New channel to add a stream address (HLS .m3u8, MP4 or internet radio) or a whole M3U playlist.</span></div>';
      return;
    }
    tvVisible = visibleChannels();
    if (!tvVisible.length) {
      box.innerHTML = '<div class="pl-notice"><b>' + (tv.query || tv.group ? 'No channels match' : 'Nothing here yet') + '</b><span>' + (tv.query || tv.group ? 'Try a different search or group.' : 'Right-click a channel and choose Add to favourites.') + '</span></div>';
      return;
    }
    const playing = cur() && cur().kind === 'live' ? cur().path : '';
    box.innerHTML = tvVisible.slice(0, tvShown).map((c, i) => {
      const k = hashKey(c.url);
      const thumb = tv.thumbs[k] > 0 ? '<img class="pl-ch-shot" loading="lazy" src="' + esc(OS.fs.rawUrl(thumbPath(c.url))) + '&t=' + tv.thumbs[k] + '" alt="">' : '';
      const logo = c.logo ? '<img class="pl-ch-logo" loading="lazy" referrerpolicy="no-referrer" src="' + esc(c.logo) + '" alt="">' : '';
      return '<div class="pl-ch' + (c.url === playing ? ' now' : '') + (thumb ? ' has-shot' : '') + (tv.radio[k] ? ' radio' : '') + '" data-n="' + i + '" data-ch="' + esc(c.url) + '" tabindex="0" role="button" title="' + esc(c.name) + '">' +
        '<span class="pl-ch-art" style="background:' + coverBg(c.name) + '"><i>' + esc(initials(c.name)) + '</i>' + logo + thumb +
        (isFav(c.url) ? '<span class="pl-ch-star">' + ic('star', 13) + '</span>' : '') +
        '<button class="pl-ch-menu" data-menu="' + i + '" title="More options" aria-label="More options">' + ic('more', 16) + '</button></span>' +
        '<b class="pl-ch-name">' + esc(c.name) + '</b></div>';
    }).join('') + (tvVisible.length > tvShown ? '<button class="btn pl-more" id="tvMore">Show more (' + (tvVisible.length - tvShown) + ' left)</button>' : '');
    box.querySelectorAll('.pl-ch-logo').forEach((im) => { im.onload = () => im.closest('.pl-ch').classList.add('has-logo'); im.onerror = () => im.remove(); });
    box.querySelectorAll('.pl-ch-shot').forEach((im) => { im.onerror = () => { im.closest('.pl-ch').classList.remove('has-shot'); im.remove(); }; });
    watchThumbs();
  }

  function playChannel(n) {
    if (!tvVisible[n]) return;
    st.queue = tvVisible.map((c) => ({ kind: 'live', path: c.url, name: c.name, logo: c.logo, group: c.group }));
    playIndex(n);
  }

  function channelMenu(c, at) {
    const fav = isFav(c.url);
    OS.menu([
      { label: 'Play', icon: 'play', action: () => playChannel(tvVisible.indexOf(c)) },
      { label: fav ? 'Remove from favourites' : 'Add to favourites', icon: 'star', action: () => toggleFav(c) },
      { label: 'Edit name…', icon: 'rename', key: 'F2', action: () => renameChannel(c) },
      { label: 'Update picture', icon: 'image', action: () => { delete tv.thumbs[hashKey(c.url)]; delete tv.radio[hashKey(c.url)]; thumbTried.delete(c.url); queueThumb(c, true); } },
      { label: 'Copy stream address', icon: 'copy', action: () => navigator.clipboard && navigator.clipboard.writeText(c.url).catch(() => {}) },
      'sep',
      { label: 'Delete', icon: 'trash', danger: true, action: () => deleteChannel(c) },
      ...(c.src !== 'mine' && tv.lists.some((p) => p.id === c.src) ? ['sep', { header: 'Playlist “' + (tv.lists.find((p) => p.id === c.src).name) + '”' }].concat(playlistItems(c.src)) : []),
    ], at);
  }
  function toggleFav(c) {
    if (isFav(c.url)) tv.favorites = tv.favorites.filter((u) => u !== c.url); else tv.favorites.push(c.url);
    saveTv(); renderTv();
  }
  async function renameChannel(c) {
    const name = await OS.dialog.prompt({ title: 'Edit channel name', label: 'Name', value: c.name, okLabel: 'Save' });
    if (!name || !name.trim()) return;
    if (c.src === 'mine') { const m = tv.mine.find((x) => x.url === c.url); if (m) m.name = name.trim(); }
    else { const p = tv.lists.find((x) => x.id === c.src); if (p) { p.names = p.names || {}; p.names[c.url] = name.trim(); } }
    await saveTvNow(); renderTv();
  }
  async function deleteChannel(c) {
    const ok = await OS.dialog.confirm({ title: 'Delete “' + c.name + '”?', message: c.src === 'mine' ? 'The channel is removed from My channels.' : 'The channel is hidden from this playlist, also after you refresh it.', okLabel: 'Delete', danger: true });
    if (!ok) return;
    if (c.src === 'mine') tv.mine = tv.mine.filter((x) => x.url !== c.url);
    else { const p = tv.lists.find((x) => x.id === c.src); if (p) { p.removed = (p.removed || []).concat(c.url); } }
    tv.favorites = tv.favorites.filter((u) => u !== c.url);
    await saveTvNow(); renderTv();
  }
  function playlistItems(id) {
    const p = tv.lists.find((x) => x.id === id);
    if (!p) return [];
    return [
      { label: 'Rename…', icon: 'rename', action: async () => { const n = await OS.dialog.prompt({ title: 'Rename playlist', label: 'Name', value: p.name, okLabel: 'Rename' }); if (n && n.trim()) { p.name = n.trim().slice(0, 80); await saveTvNow(); renderTv(); } } },
      { label: 'Refresh', icon: 'reload', disabled: !p.url && !p.path, action: () => refreshList(p) },
      'sep',
      { label: 'Delete playlist', icon: 'trash', danger: true, action: async () => {
        const ok = await OS.dialog.confirm({ title: 'Delete “' + p.name + '”?', message: 'Its ' + p.count + ' channels disappear from Live TV.', okLabel: 'Delete', danger: true });
        if (!ok) return;
        const urls = new Set((tvChannels[p.id] || []).map((c) => c.url));
        tv.favorites = tv.favorites.filter((u) => !urls.has(u));
        tv.lists = tv.lists.filter((x) => x.id !== p.id);
        delete tvChannels[p.id];
        OS.fs.write(TV_DIR + '/' + p.id + '.json', '[]').catch(() => {});
        await saveTvNow();
        tv.source = 'all';
        renderTv();
      } },
    ];
  }

  $('#tvSource').addEventListener('change', (e) => { tv.source = e.target.value; tv.group = ''; tvShown = TV_PAGE; renderTv(); });
  $('#tvGroup').addEventListener('change', (e) => { tv.group = e.target.value; tvShown = TV_PAGE; renderChannels(); });
  $('#tvSearch').addEventListener('input', (e) => { tv.query = e.target.value; tvShown = TV_PAGE; renderChannels(); });
  $('#tvList').addEventListener('click', (e) => {
    if (e.target.closest('#tvMore')) { tvShown += TV_PAGE; renderChannels(); return; }
    const m = e.target.closest('[data-menu]');
    if (m) { e.stopPropagation(); const r = m.getBoundingClientRect(); channelMenu(tvVisible[+m.dataset.menu], { x: r.left - 160, y: r.bottom + 4 }); return; }
    const ch = e.target.closest('[data-n]');
    if (ch) playChannel(+ch.dataset.n);
  });
  $('#tvList').addEventListener('contextmenu', (e) => {
    const ch = e.target.closest('[data-n]');
    if (!ch) return;
    e.preventDefault();
    channelMenu(tvVisible[+ch.dataset.n], { x: e.clientX, y: e.clientY });
  });
  $('#tvList').addEventListener('keydown', (e) => {
    if (e.target.dataset.n == null) return;
    if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); playChannel(+e.target.dataset.n); }
    if (e.key === 'Delete') { e.stopPropagation(); deleteChannel(tvVisible[+e.target.dataset.n]); }
    if (e.key === 'F2') { e.stopPropagation(); e.preventDefault(); renameChannel(tvVisible[+e.target.dataset.n]); }
  });
  $('#tvAdd').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    OS.menu([
      { label: 'Stream or playlist address…', icon: 'globe', action: newChannelFromUrl },
      { label: 'Playlist file from my drive…', icon: 'open', action: () => addPlaylistFromDrive() },
    ], { x: r.right - 230, y: r.bottom + 4 });
  });
  $('#tvRefresh').addEventListener('click', () => {
    const ps = tv.lists.some((p) => p.id === tv.source) ? tv.lists.filter((p) => p.id === tv.source) : tv.lists;
    ps.forEach(refreshList);
  });

  // ------------------------------------------------------------ channel pictures
  // A frame is grabbed from each channel's stream (lowest quality, one segment), scaled to
  // 320×200 and kept in the drive. Only channels that scroll into view are fetched, one at a time.
  const thumbTried = new Set();
  const thumbQueue = [];
  let thumbBusy = false;
  let thumbObserver = null;
  function watchThumbs() {
    if (thumbObserver) thumbObserver.disconnect();
    thumbObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        thumbObserver.unobserve(en.target);
        const c = tvVisible[+en.target.dataset.n];
        if (c) queueThumb(c);
      });
    }, { root: $('[data-page="tv"]'), rootMargin: '100px' });
    $$('#tvList .pl-ch:not(.has-shot):not(.radio)').forEach((el) => thumbObserver.observe(el));
  }
  function queueThumb(c, front) {
    const k = hashKey(c.url);
    if (tv.thumbs[k] > 0 && !front) return;
    if (tv.radio[k] || thumbTried.has(c.url)) return;
    thumbTried.add(c.url);
    if (front) thumbQueue.unshift(c); else thumbQueue.push(c);
    pumpThumbs();
  }
  async function pumpThumbs() {
    if (thumbBusy) return;
    const c = thumbQueue.shift();
    if (!c) return;
    if (st.view !== 'tv') { thumbQueue.unshift(c); return; } // wait until Live TV is shown again
    thumbBusy = true;
    try { await grabFrame(c); } catch (e) { /* no picture for this one */ }
    thumbBusy = false;
    pumpThumbs();
  }
  function grabFrame(c) {
    return new Promise(async (resolve) => {
      const vid = document.createElement('video');
      vid.muted = true; vid.playsInline = true; vid.crossOrigin = 'anonymous'; vid.preload = 'auto';
      vid.style.cssText = 'position:fixed;left:-9999px;width:320px;height:200px';
      document.body.appendChild(vid);
      let h = null; let done = false;
      const finish = (ok) => {
        if (done) return; done = true;
        clearTimeout(timer);
        if (h) { try { h.destroy(); } catch (e) { /* ignore */ } }
        vid.removeAttribute('src'); try { vid.load(); } catch (e) { /* ignore */ }
        vid.remove();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 25000);
      vid.addEventListener('loadeddata', () => {
        if (!vid.videoWidth) { tv.radio[hashKey(c.url)] = 1; saveTv(); markTile(c.url, 'radio'); finish(true); return; }
        setTimeout(async () => { const ok = await saveShot(c.url, vid); finish(ok); }, 700);
      });
      const tryLoad = async (relay) => {
        let src = c.url;
        if (relay) { try { src = await signUrl(c.url, true); } catch (e) { finish(false); return; } }
        if (done) return;
        if (DIRECT_EXT.test(c.url.split('#')[0])) {
          vid.onerror = () => { vid.onerror = null; if (!relay) tryLoad(true); else finish(false); };
          vid.src = src; vid.play().catch(() => {});
          return;
        }
        const Hls = await loadHlsLib();
        if (done) return;
        if (!Hls || !Hls.isSupported()) { vid.src = src; vid.play().catch(() => {}); return; }
        if (h) { try { h.destroy(); } catch (e) { /* ignore */ } }
        h = new Hls({ startLevel: 0, capLevelToPlayerSize: true, maxBufferLength: 4, maxMaxBufferLength: 6, enableWorker: true });
        h.on(Hls.Events.MANIFEST_PARSED, () => vid.play().catch(() => {}));
        h.on(Hls.Events.ERROR, (ev, d) => { if (d.fatal) { if (!relay) tryLoad(true); else finish(false); } });
        h.loadSource(src); h.attachMedia(vid);
      };
      tryLoad(tv.proxyAlways || (location.protocol === 'https:' && /^http:/i.test(c.url)));
    });
  }
  /** Draw `video` into a 320×200 picture and keep it for channel `url`. */
  async function saveShot(url, video) {
    try {
      const cv = document.createElement('canvas');
      cv.width = 320; cv.height = 200;
      const g = cv.getContext('2d');
      const s = Math.max(320 / video.videoWidth, 200 / video.videoHeight);
      const w = video.videoWidth * s; const hh = video.videoHeight * s;
      g.drawImage(video, (320 - w) / 2, (200 - hh) / 2, w, hh);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.72));
      if (!blob) return false;
      await ensureTvDir('thumbs');
      await OS.fs.writeBase64(thumbPath(url), await U.toBase64(blob));
      tv.thumbs[hashKey(url)] = Date.now();
      saveTv();
      markTile(url, 'shot');
      return true;
    } catch (e) { return false; } // e.g. a picture the browser won't let us read
  }
  function markTile(url, what) {
    $$('#tvList .pl-ch').forEach((el) => {
      if (el.dataset.ch !== url) return;
      if (what === 'radio') { el.classList.add('radio'); return; }
      const art = el.querySelector('.pl-ch-art');
      let im = art.querySelector('.pl-ch-shot');
      if (!im) { im = document.createElement('img'); im.className = 'pl-ch-shot'; im.alt = ''; art.insertBefore(im, art.querySelector('.pl-ch-star, .pl-ch-menu')); }
      im.src = OS.fs.rawUrl(thumbPath(url)) + '&t=' + tv.thumbs[hashKey(url)];
      el.classList.add('has-shot');
    });
  }
  // refresh a channel's picture while it is being watched
  let liveShotTimer = 0;
  v.addEventListener('playing', () => {
    clearTimeout(liveShotTimer);
    const it = cur();
    if (!it || it.kind !== 'live') return;
    liveShotTimer = setTimeout(() => {
      if (cur() !== it || v.paused || !v.videoWidth) return;
      const last = tv.thumbs[hashKey(it.path)] || 0;
      if (Date.now() - last > 10 * 60 * 1000) saveShot(it.path, v);
    }, 5000);
  });

  // ------------------------------------------------------------ playing a live stream
  let hls = null;
  let hlsLib = null;
  function loadHlsLib() {
    if (hlsLib) return hlsLib;
    hlsLib = new Promise((resolve) => {
      const sc = document.createElement('script');
      sc.src = '../../assets/vendor/hls.min.js';
      sc.onload = () => resolve(window.Hls || null);
      sc.onerror = () => resolve(null);
      document.head.appendChild(sc);
    });
    return hlsLib;
  }
  function destroyHls() { if (hls) { try { hls.destroy(); } catch (e) { /* ignore */ } hls = null; } }
  const DIRECT_EXT = /\.(mp4|m4v|webm|ogv|mp3|aac|m4a|ogg|oga|opus|wav|flac)(\?|$)/i;

  async function playLive(it) {
    const token = (it._token = Date.now() + Math.random());
    const mustRelay = tv.proxyAlways || (location.protocol === 'https:' && /^http:/i.test(it.path));
    $('#spinner').hidden = false;
    const fail = (msg) => {
      if (it._token !== token || cur() !== it) return;
      destroyHls();
      $('#spinner').hidden = true;
      const e = $('#error');
      e.innerHTML = '<b>Can’t play this channel</b>' + esc(msg);
      e.hidden = false;
    };
    const attempt = async (relay) => {
      if (it._token !== token || cur() !== it) return;
      destroyHls();
      let src = it.path;
      if (relay) { try { src = await signUrl(it.path, true); } catch (e) { fail(e.message); return; } }
      const retry = (why) => { if (!relay) attempt(true); else fail(why); };
      if (DIRECT_EXT.test(it.path.split('#')[0])) {
        v.onerror = () => { v.onerror = null; retry('The stream is offline, or it uses a format this browser can’t play.'); };
        v.src = src;
        v.play().catch(() => {});
        return;
      }
      const Hls = await loadHlsLib();
      if (it._token !== token || cur() !== it) return;
      if (Hls && Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 60 });
        let manifestOk = false;
        hls.on(Hls.Events.MANIFEST_PARSED, () => { manifestOk = true; v.play().catch(() => {}); });
        hls.on(Hls.Events.ERROR, (ev, d) => {
          if (!d.fatal) return;
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && manifestOk) { hls.recoverMediaError(); return; }
          if (!manifestOk && d.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR) {
            // not HLS after all: let the browser try the stream itself (e.g. an internet radio)
            destroyHls();
            v.onerror = () => { v.onerror = null; retry('This channel uses a format browsers can’t play (for example raw MPEG-TS). Ask the provider for an HLS (.m3u8) link.'); };
            v.src = src; v.play().catch(() => {});
            return;
          }
          retry(d.response && d.response.code ? 'The stream server answered with an error (' + d.response.code + ').' : 'The channel is offline or blocked this connection.');
        });
        hls.loadSource(src);
        hls.attachMedia(v);
      } else {
        v.onerror = () => { v.onerror = null; retry('The channel is offline, or this browser can’t play it.'); };
        v.src = src;
        v.play().catch(() => {});
      }
    };
    attempt(mustRelay);
  }
  // audio-only channels (radio) get the song view
  v.addEventListener('loadedmetadata', () => {
    const it = cur();
    if (!it || it.kind !== 'live') return;
    const audioOnly = !v.videoWidth;
    if (audioOnly !== !!it.audioOnly) {
      it.audioOnly = audioOnly;
      $('#audioView').hidden = !audioOnly;
      if (audioOnly) paintCover(it);
      showView(st.view);
    }
    updateButtons();
  });
  v.addEventListener('playing', () => { if (cur() && cur().kind === 'live') $('#error').hidden = true; });

  // ------------------------------------------------------------ keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input[type=text], input[type=search], textarea')) return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'o') { e.preventDefault(); openDialog(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const keyMap = {
      ' ': () => { togglePlay(); flash(v.paused ? 'pause' : 'play'); }, k: () => { togglePlay(); flash(v.paused ? 'pause' : 'play'); },
      ArrowLeft: () => seekBy(-5), ArrowRight: () => seekBy(5), j: () => seekBy(-10), l: () => seekBy(30),
      ArrowUp: () => { setVolume(st.volume + 0.05); flash(Math.round(st.volume * 100) + '%'); },
      ArrowDown: () => { setVolume(st.volume - 0.05); flash(Math.round(st.volume * 100) + '%'); },
      m: toggleMute, f: toggleFullscreen, n: () => next(false), p: prev, c: toggleSubtitles, q: () => showView('queue'),
      Escape: () => { if (!document.fullscreenElement && st.view === 'now') showView(st.lastLib || 'home'); },
      '[': () => setRate(Math.max(0.25, +(st.rate - 0.25).toFixed(2))), ']': () => setRate(Math.min(2, +(st.rate + 0.25).toFixed(2))),
    };
    if (e.target.closest('button') && (k === ' ' || k === 'Enter')) return; // let buttons work
    const fn = keyMap[k] || keyMap[k.toLowerCase()];
    if (fn) { e.preventDefault(); fn(); wake(); return; }
    if (/^[0-9]$/.test(k) && cur() && v.duration) { v.currentTime = v.duration * (+k / 10); wake(); }
  });

  // ------------------------------------------------------------ drag & drop: from Files, or upload from the computer
  const DND = 'application/x-liteos-paths';
  document.addEventListener('dragover', (e) => {
    const types = Array.from(e.dataTransfer.types || []);
    if (types.includes(DND) || types.includes('Files')) { e.preventDefault(); pl.classList.add('drop'); }
  });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) pl.classList.remove('drop'); });
  document.addEventListener('drop', (e) => {
    pl.classList.remove('drop');
    const raw = e.dataTransfer.getData(DND);
    if (raw) {
      e.preventDefault();
      let paths = []; try { paths = JSON.parse(raw); } catch (x) { /* ignore */ }
      if (!cur() && paths.length === 1) openPath(paths[0]); else addToQueue(paths);
    } else if (e.dataTransfer.files && e.dataTransfer.files.length) {
      e.preventDefault();
      uploadAndPlay(Array.from(e.dataTransfer.files));
    }
  });

  /** Files dropped from the computer: upload to /Videos or /Music, then play or queue them. */
  async function uploadAndPlay(files) {
    const pics = files.filter((f) => isImage(f.name));
    if (pics.length) uploadPhotos(pics);
    const media = files.filter((f) => kindOf(f.name));
    if (!media.length) { if (!pics.length) OS.notify('Drop photos, videos or audio files to add them.', { type: 'error', title: 'Can’t open these files' }); return; }
    const skipped = files.length - media.length - pics.length;
    const groups = { video: media.filter((f) => kindOf(f.name) === 'video'), audio: media.filter((f) => kindOf(f.name) === 'audio') };
    const up = $('#uploading');
    up.querySelector('span').textContent = 'Uploading ' + (media.length === 1 ? '“' + media[0].name + '”' : media.length + ' files') + '…';
    up.hidden = false;
    const paths = [];
    try {
      for (const [kind, list] of Object.entries(groups)) {
        if (!list.length) continue;
        const dir = kind === 'video' ? '/Videos' : '/Music';
        try { await OS.fs.mkdir(dir); } catch (x) { /* already exists */ }
        const entries = await OS.fs.upload(dir, list);
        entries.forEach((en) => paths.push(en.path));
      }
    } catch (err) {
      OS.notify(err.message, { type: 'error', title: 'Upload failed' });
    } finally { up.hidden = true; }
    if (!paths.length) return;
    libCache = null;
    const where = groups.video.length && groups.audio.length ? 'Videos and Music' : groups.video.length ? 'Videos' : 'Music';
    const playingAlready = !!cur();
    OS.notify((paths.length === 1 ? '“' + U.basename(paths[0]) + '” was saved to ' : paths.length + ' files were saved to ') + where + (playingAlready ? ' and added to the queue.' : '.') +
      (skipped ? ' Skipped ' + skipped + ' file' + (skipped > 1 ? 's' : '') + ' that can’t be played.' : ''),
    { type: 'success', title: paths.length === 1 ? 'Uploaded' : 'Uploaded ' + paths.length + ' files' });
    if (!playingAlready) {
      if (paths.length === 1) openPath(paths[0]); else playList(paths, false);
    } else addToQueue(paths, true);
  }

  // ------------------------------------------------------------ menus in the top bar
  OS.win.setMenus([
    { label: 'File', items: [
      { label: 'Open file…', icon: 'open', key: 'Ctrl+O', action: openDialog },
      { label: 'Open folder…', icon: 'folder', action: folderDialog },
      { label: 'Add files to queue…', icon: 'plus', action: addFilesDialog },
    ] },
    { label: 'Playback', items: [
      { label: 'Play / pause', icon: 'play', key: 'Space', action: togglePlay },
      { label: 'Next', icon: 'next', key: 'N', action: () => next(false) },
      { label: 'Previous', icon: 'prev', key: 'P', action: prev },
      'sep',
      { label: 'Forward 30 seconds', icon: 'forward', key: 'L', action: () => seekBy(30) },
      { label: 'Back 10 seconds', icon: 'back', key: 'J', action: () => seekBy(-10) },
      'sep',
      { label: 'Save frame to Pictures', icon: 'image', action: saveFrame },
      { label: 'Full screen', icon: 'expand', key: 'F', action: toggleFullscreen },
    ] },
  ]);

  // ------------------------------------------------------------ start
  drawViz();
  updateButtons();
  updateTime();
  showView('home');
  if (OS.args.path) openPath(OS.args.path);
  else if (OS.args.folder) openFolder(OS.args.folder);
  window.addEventListener('beforeunload', savePosition);
});
