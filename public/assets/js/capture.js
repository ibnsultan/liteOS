/*
 * LiteOS screen capture, loaded by the desktop after os.js: LiteOSHost.capture (OS.capture in the SDK), used by the
 * Screenshot app and the shell keys Ctrl+Alt+S and Shift+PrtSc (a region), PrtSc (the screen), Alt+PrtSc (the
 * active window) and Ctrl+Alt+R (a screen recording; see Recording below).
 *
 * The picture comes from the browser's screen capture of this tab (getDisplayMedia, preferring the current tab): the
 * exact pixels, video and canvases included. The browser asks for permission each time and only after something the
 * person did (a click, a key); the stream stops as soon as one frame is taken. A region or a window is then chosen on
 * that frozen frame. The picture is saved as a PNG in /Pictures/Screenshots, copied to the clipboard, and shown in a
 * notification with Open and Show in folder.
 */
(function () {
  'use strict';

  const H = window.LiteOSHost;
  if (!H) return;

  const DIR = '/Pictures/Screenshots';
  const DIM = 'rgba(0, 0, 0, 0.45)';
  let busy = false;
  /** When PrtSc last went down: its keyup then doesn't take a second picture. */
  let downAt = 0;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');
  const fileName = (d) => 'Screenshot ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.png';
  const icon = (n, s) => window.LOS_icon(n, s || 16);
  const signedIn = () => { const st = H.state; return !!(st && st.user) && !H.tasks.locked(); };
  const supported = () => !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  const fail = (msg) => H.notify(msg, { type: 'error', title: 'Couldn’t take a screenshot', app: 'screenshot' });

  /** The browser's capture of this tab. Throws as getDisplayMedia does (NotAllowedError: they said no). */
  function openStream() {
    const dpr = window.devicePixelRatio || 1;
    return navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: 30, width: { ideal: Math.round(innerWidth * dpr) }, height: { ideal: Math.round(innerHeight * dpr) } },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',
    });
  }

  /**
   * One frame of the stream, with the page's size and windows as they were then. It is taken a moment in: the page has
   * drawn itself without the Screenshot window, and the browser's own prompt has gone.
   */
  async function frameOf(stream) {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    await v.play();
    await wait(300);
    if (v.requestVideoFrameCallback) await new Promise((r) => { v.requestVideoFrameCallback(() => r()); setTimeout(r, 400); });
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    v.pause();
    v.srcObject = null;
    if (!c.width || !c.height) throw new Error('The browser gave an empty picture. Try again.');
    return { canvas: c, vw: innerWidth, vh: innerHeight, fx: c.width / innerWidth, fy: c.height / innerHeight, wins: H.tasks.list() };
  }

  const clip = (r, shot) => {
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    return { x, y, w: Math.max(0, Math.min(shot.vw, r.x + r.w) - x), h: Math.max(0, Math.min(shot.vh, r.y + r.h) - y) };
  };
  const whole = (shot) => ({ x: 0, y: 0, w: shot.vw, h: shot.vh });
  /** The windows on the picture, frontmost first (not the one taking it, nor minimised ones). */
  const windowsOf = (shot, skip) => shot.wins.filter((w) => !w.min && w.id !== skip && w.rect.w > 0 && w.rect.h > 0).sort((a, b) => (b.z || 0) - (a.z || 0));

  function crop(shot, r) {
    const px = { x: Math.round(r.x * shot.fx), y: Math.round(r.y * shot.fy), w: Math.round(r.w * shot.fx), h: Math.round(r.h * shot.fy) };
    px.w = Math.max(1, Math.min(px.w, shot.canvas.width - px.x));
    px.h = Math.max(1, Math.min(px.h, shot.canvas.height - px.y));
    const c = document.createElement('canvas');
    c.width = px.w;
    c.height = px.h;
    c.getContext('2d').drawImage(shot.canvas, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
    return c;
  }

  /*
  |--------------------------------------------------------------------------
  | Choosing a region or a window on the frozen picture
  |--------------------------------------------------------------------------
  */

  /**
   * choose
   *
   * -> a rectangle in the page's pixels, or null when cancelled. sel is the rectangle shown clear. A mousedown outside
   * the bar is held back so no text is selected behind it; a click without a drag: choose again.
   */
  function choose(shot, startMode, skip, rec) {
    // rec: { mic, sound } when choosing what to record: the bar adds the microphone, the tab's sound and Start, and a
    // region, a window or the screen stays chosen until Start
    return new Promise((resolve) => {
      let mode = startMode === 'screen' && !rec ? 'region' : startMode;
      let sel = null;
      let drag = null;
      const dpr = window.devicePixelRatio || 1;
      const ov = document.createElement('div');
      ov.className = 'cap-ov';
      ov.tabIndex = -1;
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-label', 'Choose what to capture');
      ov.innerHTML = '<canvas class="cap-cv"></canvas>' +
        '<div class="cap-bar" role="toolbar" aria-label="Screenshot">' +
        '<button type="button" class="cap-b" data-m="region" title="Region (Ctrl+Alt+S)" aria-label="Region">' + icon('region', 18) + '</button>' +
        '<button type="button" class="cap-b" data-m="window" title="Window (Alt+PrtSc)" aria-label="Window">' + icon('window', 18) + '</button>' +
        '<button type="button" class="cap-b" data-m="screen" title="Screen (PrtSc)" aria-label="Screen">' + icon('screen', 18) + '</button>' +
        '<span class="cap-sep"></span>' +
        (rec ? '<button type="button" class="cap-b" data-mic title="Microphone" aria-label="Microphone"></button>' +
          '<button type="button" class="cap-b" data-sound title="Sound from LiteOS" aria-label="Sound from LiteOS"></button>' +
          '<span class="cap-sep"></span>' +
          '<button type="button" class="cap-b cap-start" data-start title="Start (Enter)">' + icon('record', 16) + '<span>Start</span></button>' : '') +
        '<button type="button" class="cap-b" data-x title="Cancel (Esc)" aria-label="Cancel">' + icon('x', 18) + '</button></div>' +
        '<span class="cap-size" hidden></span>' +
        '<p class="cap-hint"></p>';
      document.body.appendChild(ov);
      const cv = ov.querySelector('.cap-cv');
      const size = ov.querySelector('.cap-size');
      const hint = ov.querySelector('.cap-hint');
      const ctx = cv.getContext('2d');
      const fit = () => {
        cv.width = Math.round(innerWidth * dpr);
        cv.height = Math.round(innerHeight * dpr);
        draw();
      };

      function draw() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, innerWidth, innerHeight);
        ctx.drawImage(shot.canvas, 0, 0, shot.vw, shot.vh);
        ctx.fillStyle = DIM;
        ctx.fillRect(0, 0, innerWidth, innerHeight);
        if (sel && sel.w > 0 && sel.h > 0) {
          ctx.drawImage(shot.canvas, sel.x * shot.fx, sel.y * shot.fy, sel.w * shot.fx, sel.h * shot.fy, sel.x, sel.y, sel.w, sel.h);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.strokeRect(sel.x + 0.5, sel.y + 0.5, Math.max(0, sel.w - 1), Math.max(0, sel.h - 1));
          size.hidden = false;
          size.textContent = Math.round(sel.w * shot.fx) + ' × ' + Math.round(sel.h * shot.fy);
          const above = sel.y >= 28;
          size.style.left = Math.max(4, Math.min(innerWidth - size.offsetWidth - 4, sel.x + sel.w - size.offsetWidth)) + 'px';
          size.style.top = (above ? sel.y - 26 : Math.min(innerHeight - 26, sel.y + sel.h + 4)) + 'px';
        } else size.hidden = true;
      }
      function setMode(m) {
        mode = m;
        ov.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
        ov.dataset.mode = mode;
        if (rec) hint.textContent = mode === 'region' ? 'Drag to choose an area, then Start. Esc cancels.' : mode === 'window' ? 'Click a window, then Start. Esc cancels.' : 'The whole screen is recorded. Start when you’re ready.';
        else hint.textContent = mode === 'region' ? 'Drag to choose an area. Esc cancels.' : 'Click a window to capture it. Esc cancels.';
        sel = mode === 'screen' ? whole(shot) : null;
        draw();
      }
      function toggles() {
        if (!rec) return;
        const m = ov.querySelector('[data-mic]');
        const s = ov.querySelector('[data-sound]');
        m.innerHTML = icon(rec.mic ? 'mic' : 'micOff', 18);
        m.classList.toggle('on', rec.mic);
        m.setAttribute('aria-pressed', String(rec.mic));
        m.title = rec.mic ? 'Microphone on' : 'Microphone off';
        s.innerHTML = icon(rec.sound ? 'volume' : 'mute', 18);
        s.classList.toggle('on', rec.sound);
        s.setAttribute('aria-pressed', String(rec.sound));
        s.title = rec.sound ? 'Sound from LiteOS on' : 'Sound from LiteOS off';
      }
      function done(r) {
        removeEventListener('resize', fit);
        ov.remove();
        try { getSelection().removeAllRanges(); } catch (e) { /* nothing selected */ }
        resolve(r && r.w >= 2 && r.h >= 2 ? r : null);
      }
      const windowAt = (x, y) => {
        const w = windowsOf(shot, skip).find((x2) => x >= x2.rect.x && x < x2.rect.x + x2.rect.w && y >= x2.rect.y && y < x2.rect.y + x2.rect.h);
        return w ? Object.assign(clip(w.rect, shot), { win: w.id }) : whole(shot);
      };
      let picked = false; // recording: a window clicked stays chosen

      ov.addEventListener('mousedown', (e) => { if (!e.target.closest('.cap-bar')) e.preventDefault(); });
      ov.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.cap-bar')) return;
        e.preventDefault();
        if (mode === 'window') {
          if (rec) { sel = windowAt(e.clientX, e.clientY); picked = true; draw(); } else done(windowAt(e.clientX, e.clientY));
          return;
        }
        if (mode === 'screen') return;
        drag = { x: e.clientX, y: e.clientY };
        ov.setPointerCapture(e.pointerId);
        sel = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
        draw();
      });
      ov.addEventListener('pointermove', (e) => {
        if (mode === 'window') { if (!picked && !e.target.closest('.cap-bar')) { sel = windowAt(e.clientX, e.clientY); draw(); } return; }
        if (!drag) return;
        const x = Math.max(0, Math.min(shot.vw, e.clientX)), y = Math.max(0, Math.min(shot.vh, e.clientY));
        sel = { x: Math.min(drag.x, x), y: Math.min(drag.y, y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) };
        draw();
      });
      ov.addEventListener('pointerup', () => {
        if (!drag) return;
        drag = null;
        if (sel && sel.w >= 4 && sel.h >= 4) { if (!rec) done(sel); }
        else { sel = null; draw(); }
      });
      const start = () => done(sel || (mode === 'region' ? null : whole(shot)));
      ov.querySelector('.cap-bar').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-x')) done(null);
        else if (b.hasAttribute('data-start')) start();
        else if (b.hasAttribute('data-mic')) { rec.mic = !rec.mic; toggles(); }
        else if (b.hasAttribute('data-sound')) { rec.sound = !rec.sound; toggles(); }
        else if (b.dataset.m === 'screen' && !rec) done(whole(shot));
        else { picked = false; setMode(b.dataset.m); }
      });
      ov.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
        if (e.key === 'Enter' && rec) { e.preventDefault(); start(); }
        else if (e.key === 'Enter' && mode === 'window' && sel) { e.preventDefault(); done(sel); }
      });
      addEventListener('resize', fit);
      fit();
      toggles();
      setMode(mode);
      ov.focus();
    });
  }

  /*
  |--------------------------------------------------------------------------
  | Saving
  |--------------------------------------------------------------------------
  */

  /** The picture with Screenshot's border around it, when that setting is on. */
  function bordered(canvas, set, scale) {
    if (!set.shotBorder) return canvas;
    const bw = Math.max(1, Math.round((+set.shotBorderWidth || 2) * scale));
    const c = document.createElement('canvas');
    c.width = canvas.width + bw * 2;
    c.height = canvas.height + bw * 2;
    const g = c.getContext('2d');
    g.fillStyle = /^#[0-9a-f]{6}$/i.test(set.shotBorderColor || '') ? set.shotBorderColor : '#000000';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(canvas, bw, bw);
    return c;
  }

  /** Each folder of a path, made where it isn't there yet. */
  async function makeFolders(dir) {
    let at = '';
    for (const part of dir.split('/').filter(Boolean)) {
      at += '/' + part;
      try { await H.api('fs.mkdir', { path: at }); } catch (e) { /* it's there already */ }
    }
  }

  /**
   * Copies and saves the picture as Screenshot's settings say (both on unless turned off): saved in its folder
   * (/Pictures/Screenshots unless changed) named by date and time, copied to the clipboard, then a notification with
   * an object URL of the picture as its preview.
   */
  async function save(canvas, scale) {
    const set = (H.state && H.state.settings) || {};
    const toCopy = set.shotCopy !== false;
    const toSave = set.shotSave !== false;
    canvas = bordered(canvas, set, scale || 1);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('The picture couldn’t be made.');
    let copied = false;
    if (toCopy) {
      try {
        if (navigator.clipboard && window.ClipboardItem) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); copied = true; }
      } catch (e) { /* the browser kept the clipboard to itself */ }
    }
    let path = null;
    const dir = typeof set.shotFolder === 'string' && set.shotFolder.startsWith('/') ? set.shotFolder : DIR;
    if (toSave) {
      const name = fileName(new Date());
      await makeFolders(dir);
      const fd = new FormData();
      fd.append('path', dir);
      fd.append('files[]', new File([blob], name, { type: 'image/png' }), name);
      const saved = await H.api('fs.upload', fd);
      const entry = Array.isArray(saved) ? saved[0] : saved;
      path = (entry && entry.path) || dir + '/' + name;
    }
    if (!path && !copied) {
      fail(toCopy ? 'The browser didn’t allow copying it, and saving is off in Screenshot’s settings.' : 'Copying and saving are both off in Screenshot’s settings.');
      return null;
    }
    const folder = dir.split('/').filter(Boolean).pop() || 'My drive';
    const url = URL.createObjectURL(blob);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60000);
    H.notify(path ? 'Automatically saved to the ' + folder + ' folder.' : '', {
      title: copied ? 'Screenshot copied to clipboard' : 'Screenshot saved',
      app: 'screenshot',
      preview: url,
      onPreview: path ? () => H.openApp('screenshot', { path }) : null,
      actions: path ? [{ label: 'Markup and share', action: () => H.openApp('screenshot', { path }) }] : [],
    });
    return { path, width: canvas.width, height: canvas.height, copied };
  }

  /*
  |--------------------------------------------------------------------------
  | Taking one
  |--------------------------------------------------------------------------
  */

  /**
   * take
   *
   * o: { mode: 'region' | 'window' | 'screen' | 'active', delay: seconds }; winId: the window asking (hidden meanwhile).
   * 'window' lets the person pick a window, 'active' takes the one in front. -> { path, width, height, copied } | null
   *
   * InvalidStateError means nothing the person did came first, so a notification offers to take it. NotAllowedError or
   * AbortError refused at once means the browser (or its policy) doesn't allow it here; later, the person said no.
   */
  async function take(o, winId) {
    o = o || {};
    if (busy || !signedIn()) return null;
    if (!supported()) {
      fail(window.isSecureContext ? 'This browser can’t capture the screen.' : 'Screenshots need LiteOS to be opened over HTTPS.');
      return null;
    }
    busy = true;
    if (winId) H.win.hide(winId, true);
    document.documentElement.classList.add('los-capturing');
    let stream = null;
    try {
      const asked = Date.now();
      try { stream = await openStream(); } catch (e) {
        if (e && e.name === 'InvalidStateError') { askToTake(o); return null; }
        if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
          if (Date.now() - asked < 400) fail('This browser doesn’t allow LiteOS to capture the screen.');
          return null;
        }
        throw e;
      }
      const track = stream.getVideoTracks()[0];
      const surface = track && track.getSettings ? track.getSettings().displaySurface : '';
      if (surface && surface !== 'browser') { fail('Choose this tab when the browser asks what to share.'); return null; }
      const delay = Math.max(0, Math.min(10, +o.delay || 0));
      if (delay) await wait(delay * 1000);
      const shot = await frameOf(stream);
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      document.documentElement.classList.remove('los-capturing');
      let r;
      if (o.mode === 'screen') r = whole(shot);
      else if (o.mode === 'active') { const w = windowsOf(shot, winId).find((x) => x.focused); r = w ? clip(w.rect, shot) : whole(shot); }
      else r = await choose(shot, o.mode === 'window' ? 'window' : 'region', winId);
      if (!r) return null;
      return await save(crop(shot, r), shot.fx);
    } catch (e) {
      fail(e && e.message ? e.message : 'Something went wrong.');
      return null;
    } finally {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      document.documentElement.classList.remove('los-capturing');
      if (winId) H.win.hide(winId, false);
      busy = false;
    }
  }

  /**
   * The browser asks for permission only after a click or a key: when a key came too late (PrtSc on Windows arrives
   * only as it is let go), a notification offers the button that can.
   */
  function askToTake(o) {
    H.notify('The browser needs a click before it can capture the screen.', {
      title: 'Take a screenshot',
      app: 'screenshot',
      actions: [{ label: 'Take screenshot', action: () => take(o) }],
    });
  }

  /*
  |--------------------------------------------------------------------------
  | Recording
  |--------------------------------------------------------------------------
  |
  | The same capture of this tab, with its sound, kept running: the area is chosen on a frozen frame (with the
  | microphone and the tab's sound switched there), then the video is cropped to it where the browser can (Chrome and
  | Edge: a window follows the window), mixed with the sound into one track and recorded to WebM. A bar in the top bar
  | shows the time and has the microphone, Pause and Stop; the browser's own Stop sharing ends it too. It is saved in
  | /Videos/Recordings (unless changed, or asked where when saving by itself is off) with a notification.
  */

  const RDIR = '/Videos/Recordings';
  let rec = null; // the recording under way
  const recName = (d) => 'Screen Recording ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.webm';
  const recFail = (msg) => H.notify(msg, { type: 'error', title: 'Couldn’t record the screen', app: 'screenshot' });
  const clock = (ms) => { const s = Math.floor(ms / 1000); return pad(Math.floor(s / 60)) + ':' + pad(s % 60); };

  /**
   * record
   *
   * o: { mode: 'region' | 'window' | 'screen' }; winId: the window asking (hidden until the recording ends). While one
   * is under way, asking again stops it. -> { recording: true } once it has started, or null
   */
  async function record(o, winId) {
    o = o || {};
    if (rec) { stopRecording(); return null; }
    if (busy || !signedIn()) return null;
    if (!supported() || !window.MediaRecorder) {
      recFail(window.isSecureContext ? 'This browser can’t record the screen.' : 'Screen recording needs LiteOS to be opened over HTTPS.');
      return null;
    }
    const set = (H.state && H.state.settings) || {};
    busy = true;
    if (winId) H.win.hide(winId, true);
    document.documentElement.classList.add('los-capturing');
    let stream = null;
    let started = false;
    try {
      const asked = Date.now();
      const dpr = window.devicePixelRatio || 1;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'browser', frameRate: 30, width: { ideal: Math.round(innerWidth * dpr) }, height: { ideal: Math.round(innerHeight * dpr) } },
          audio: { suppressLocalAudioPlayback: false },
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          surfaceSwitching: 'exclude',
          monitorTypeSurfaces: 'exclude',
          systemAudio: 'exclude',
        });
      } catch (e) {
        if (e && e.name === 'InvalidStateError') { askToRecord(o); return null; }
        if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
          if (Date.now() - asked < 400) recFail('This browser doesn’t allow LiteOS to record the screen.');
          return null;
        }
        throw e;
      }
      const video = stream.getVideoTracks()[0];
      const surface = video && video.getSettings ? video.getSettings().displaySurface : '';
      if (surface && surface !== 'browser') { recFail('Choose this tab when the browser asks what to share.'); return null; }
      const shot = await frameOf(stream);
      document.documentElement.classList.remove('los-capturing');
      const choice = { mic: !!set.shotRecMic, sound: set.shotRecSound !== false };
      const r = await choose(shot, ['region', 'window', 'screen'].includes(o.mode) ? o.mode : 'region', winId, choice);
      if (!r || video.readyState === 'ended') return null;
      await startRecording(stream, r, choice, shot, winId);
      started = true;
      return { recording: true };
    } catch (e) {
      recFail(e && e.message ? e.message : 'Something went wrong.');
      return null;
    } finally {
      if (!started && stream) stream.getTracks().forEach((t) => t.stop());
      document.documentElement.classList.remove('los-capturing');
      if (!started && winId) H.win.hide(winId, false);
      busy = false;
    }
  }

  /** A few frames of a speck changing in a corner, so a still page draws (and a capture gets new frames). */
  function nudge() {
    const s = document.createElement('div');
    s.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;z-index:2147483000;background:rgba(0,0,0,0.01)';
    document.body.appendChild(s);
    let n = 0;
    const step = () => { s.style.opacity = n % 2 ? '1' : '0.5'; if (++n < 12) requestAnimationFrame(step); else s.remove(); };
    requestAnimationFrame(step);
  }

  async function startRecording(stream, r, choice, shot, winId) {
    const video = stream.getVideoTracks()[0];
    const full = r.x <= 0 && r.y <= 0 && r.w >= shot.vw - 1 && r.h >= shot.vh - 1;
    const winEl = r.win ? document.querySelector('.win[data-id="' + r.win + '"]') : null;
    // the video cropped to the area: an element there (the window itself, or a box over the region) is the target
    let box = null;
    if (!full && window.CropTarget && video.cropTo) {
      let el = winEl;
      if (!el) {
        box = document.createElement('div');
        box.className = 'cap-croparea';
        Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
        document.body.appendChild(box);
        el = box;
      }
      try {
        const cropping = video.cropTo(await window.CropTarget.fromElement(el));
        // the crop takes hold with the next frame the tab draws, and a still desktop draws none: the page is nudged
        // into drawing, and the crop is never waited on for long (failing that, the whole screen is recorded)
        nudge();
        await Promise.race([cropping, wait(1500)]);
      } catch (e) { /* the whole screen is recorded */ }
    }
    // a red line just outside the area while it records (outside it, so it isn't in the video)
    const line = full ? null : document.createElement('div');
    if (line) { line.className = 'cap-recline'; document.body.appendChild(line); }
    const placeLine = () => {
      if (!line) return;
      const b = winEl && winEl.isConnected ? winEl.getBoundingClientRect() : r;
      Object.assign(line.style, { left: (b.left != null ? b.left : b.x) - 2 + 'px', top: (b.top != null ? b.top : b.y) - 2 + 'px', width: (b.width != null ? b.width : b.w) + 4 + 'px', height: (b.height != null ? b.height : b.h) + 4 + 'px' });
    };
    placeLine();

    // the sound: the tab's and the microphone's, mixed into one track (the microphone can join later)
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ac.createMediaStreamDestination();
    // a mix with nothing in it gives no sound at all, and the recorder then waits on it and records nothing (the tab's
    // sound not shared, no microphone): a silent source keeps its sound going
    try { const quiet = ac.createConstantSource(); quiet.offset.value = 0; quiet.connect(dest); quiet.start(); } catch (e) { /* older browser */ }
    const tab = stream.getAudioTracks()[0];
    let tabGain = null;
    if (tab) {
      tabGain = ac.createGain();
      tabGain.gain.value = choice.sound ? 1 : 0;
      ac.createMediaStreamSource(new MediaStream([tab])).connect(tabGain).connect(dest);
    }
    const R = { stream, video, ac, dest, tabGain, mic: null, micGain: null, chunks: [], box, line, winEl, winId, started: Date.now(), pausedAt: 0, paused: 0, timer: 0, bar: null, choice };
    R.micOn = async () => {
      if (!R.mic) {
        R.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        R.micGain = ac.createGain();
        ac.createMediaStreamSource(R.mic).connect(R.micGain).connect(dest);
      }
      R.micGain.gain.value = 1;
    };
    if (choice.mic) {
      try { await R.micOn(); } catch (e) { choice.mic = false; H.notify('Recording without it.', { title: 'The microphone couldn’t be used', app: 'screenshot' }); }
    }
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    // a sound mixer the browser keeps paused (nothing the person did came first) gives no sound at all, and a recorder
    // waiting on it records nothing: then the tab's own sound goes in as it is, or none
    try { await Promise.race([ac.resume(), wait(500)]); } catch (e) { /* stays paused */ }
    const mixing = ac.state === 'running';
    R.mixing = mixing;
    const sound = mixing ? dest.stream.getAudioTracks() : (tab && choice.sound ? [tab] : []);
    const out = new MediaStream([video].concat(sound));
    R.mr = new MediaRecorder(out, type ? { mimeType: type, videoBitsPerSecond: 5000000 } : undefined);
    R.mr.ondataavailable = (e) => { if (e.data && e.data.size) R.chunks.push(e.data); };
    R.mr.onstop = () => finishRecording(R);
    R.preview = (() => { try { return crop(shot, r).toDataURL('image/jpeg', 0.82); } catch (e) { return ''; } })();
    video.addEventListener('ended', () => stopRecording()); // the browser's own Stop sharing
    rec = R;
    R.mr.start(1000);
    showBar(R);
    R.timer = setInterval(() => { placeLine(); tick(R); }, 500);
  }

  // the bar in the top bar: the time, the microphone, Pause and Stop
  function showBar(R) {
    const bar = document.createElement('div');
    bar.className = 'cap-recbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Screen recording');
    bar.innerHTML = '<span class="cap-dot" aria-hidden="true"></span><span class="cap-time" aria-live="off">00:00</span>' +
      '<button type="button" class="cap-rb" data-mic></button>' +
      '<button type="button" class="cap-rb" data-pause></button>' +
      '<button type="button" class="cap-rb cap-stop" data-stop title="Stop (Ctrl+Alt+R)">' + icon('stop', 14) + '<span>Stop</span></button>';
    document.body.appendChild(bar);
    R.bar = bar;
    barState(R);
    bar.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-stop')) stopRecording();
      else if (b.hasAttribute('data-pause')) {
        if (R.mr.state === 'recording') { R.mr.pause(); R.pausedAt = Date.now(); } else if (R.mr.state === 'paused') { R.mr.resume(); R.paused += Date.now() - R.pausedAt; R.pausedAt = 0; }
        barState(R);
      } else if (b.hasAttribute('data-mic')) {
        if (R.choice.mic) { R.choice.mic = false; if (R.micGain) R.micGain.gain.value = 0; } else {
          try { await R.micOn(); R.choice.mic = true; } catch (err) { H.notify('Its permission was refused, or there is no microphone.', { type: 'error', title: 'The microphone couldn’t be used', app: 'screenshot' }); }
        }
        barState(R);
      }
    });
  }
  function barState(R) {
    const b = R.bar;
    if (!b) return;
    const paused = R.mr.state === 'paused';
    b.classList.toggle('paused', paused);
    const m = b.querySelector('[data-mic]');
    m.innerHTML = icon(R.choice.mic ? 'mic' : 'micOff', 15);
    m.title = R.choice.mic ? 'Turn the microphone off' : 'Turn the microphone on';
    m.setAttribute('aria-label', m.title);
    const p = b.querySelector('[data-pause]');
    p.innerHTML = icon(paused ? 'play' : 'pause', 15);
    p.title = paused ? 'Resume' : 'Pause';
    p.setAttribute('aria-label', p.title);
    tick(R);
  }
  function tick(R) {
    if (!R.bar) return;
    const now = R.pausedAt || Date.now();
    R.bar.querySelector('.cap-time').textContent = clock(now - R.started - R.paused);
  }

  function stopRecording() {
    if (rec && rec.mr && rec.mr.state !== 'inactive') rec.mr.stop();
  }

  /**
   * withDuration
   *
   * The browser's WebM has no length written in it (it is written as it goes), so players can't seek it until it has
   * played through. This writes the length into the file's Info: the header is read, Info is rebuilt with a Duration
   * (in its own timecode units), and the rest of the file is kept as it is. A file that isn't laid out as expected
   * comes back unchanged.
   */
  async function withDuration(blob, ms) {
    const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 1 << 16)).arrayBuffer());
    const idAt = (p) => {
      const b = head[p];
      const len = b & 0x80 ? 1 : b & 0x40 ? 2 : b & 0x20 ? 3 : b & 0x10 ? 4 : 0;
      if (!len || p + len > head.length) throw new Error('bad id');
      let v = 0;
      for (let i = 0; i < len; i++) v = v * 256 + head[p + i];
      return { len, v };
    };
    const sizeAt = (p) => {
      const b = head[p];
      let len = 1, mask = 0x80;
      while (len <= 8 && !(b & mask)) { len++; mask >>= 1; }
      if (len > 8 || p + len > head.length) throw new Error('bad size');
      let v = b & (mask - 1);
      let unknown = v === mask - 1;
      for (let i = 1; i < len; i++) { v = v * 256 + head[p + i]; if (head[p + i] !== 255) unknown = false; }
      return { len, v, unknown };
    };
    const size8 = (n) => { const out = new Uint8Array(8); out[0] = 0x01; for (let i = 7; i >= 1; i--) { out[i] = n % 256; n = Math.floor(n / 256); } return out; };
    const join = (parts) => { const n = parts.reduce((a, x) => a + x.length, 0); const out = new Uint8Array(n); let o = 0; parts.forEach((x) => { out.set(x, o); o += x.length; }); return out; };

    let e = idAt(0);
    if (e.v !== 0x1A45DFA3) return blob; // EBML
    let s = sizeAt(e.len);
    let p = e.len + s.len + s.v;
    e = idAt(p);
    if (e.v !== 0x18538067) return blob; // Segment
    const segAt = p;
    const seg = sizeAt(p + e.len);
    const segData = p + e.len + seg.len;
    p = segData;
    while (p < head.length - 12) {
      e = idAt(p);
      s = sizeAt(p + e.len);
      if (e.v === 0x1549A966) { // Info
        const infoData = p + e.len + s.len;
        const infoEnd = infoData + s.v;
        if (s.unknown || infoEnd > head.length) return blob;
        let q = infoData;
        let scale = 1000000;
        const kept = [];
        while (q < infoEnd) {
          const ce = idAt(q);
          const cs = sizeAt(q + ce.len);
          const end = q + ce.len + cs.len + cs.v;
          if (ce.v === 0x2AD7B1) { let v = 0; for (let i = q + ce.len + cs.len; i < end; i++) v = v * 256 + head[i]; scale = v || scale; } // TimecodeScale
          if (ce.v !== 0x4489) kept.push(head.subarray(q, end)); // an old Duration goes
          q = end;
        }
        const dur = new Uint8Array(11);
        dur.set([0x44, 0x89, 0x88]);
        new DataView(dur.buffer).setFloat64(3, (ms * 1e6) / scale);
        const body = join(kept.concat([dur]));
        const info = join([new Uint8Array([0x15, 0x49, 0xA9, 0x66]), size8(body.length), body]);
        const delta = info.length - (infoEnd - p);
        const segHead = seg.unknown ? head.subarray(segAt, segData) : join([new Uint8Array([0x18, 0x53, 0x80, 0x67]), size8(seg.v + delta)]);
        return new Blob([head.subarray(0, segAt), segHead, head.subarray(segData, p), info, blob.slice(infoEnd)], { type: blob.type });
      }
      if (s.unknown) return blob; // a cluster before any Info: leave it
      p += e.len + s.len + s.v;
    }
    return blob;
  }

  async function finishRecording(R) {
    clearInterval(R.timer);
    const ms = (R.pausedAt || Date.now()) - R.started - R.paused;
    R.stream.getTracks().forEach((t) => t.stop());
    if (R.mic) R.mic.getTracks().forEach((t) => t.stop());
    try { R.ac.close(); } catch (e) { /* already closed */ }
    [R.bar, R.line, R.box].forEach((el) => { if (el) el.remove(); });
    if (R.winId) H.win.hide(R.winId, false);
    rec = null;
    const raw = new Blob(R.chunks, { type: 'video/webm' });
    if (!raw.size) { recFail('Nothing was recorded.'); return; }
    let blob = raw;
    try { blob = await withDuration(raw, ms); } catch (e) { blob = raw; } // its length written in, so it can be seeked
    const set = (H.state && H.state.settings) || {};
    let dir = typeof set.shotRecFolder === 'string' && set.shotRecFolder.startsWith('/') ? set.shotRecFolder : RDIR;
    let name = recName(new Date());
    try {
      if (set.shotRecSave === false) { // saving by itself is off: asked where
        const to = await H.dialog.save({ title: 'Save the recording', defaultName: name.replace(/\.webm$/, ''), ext: 'webm', startIn: dir });
        if (!to) return;
        const i = to.lastIndexOf('/');
        dir = i > 0 ? to.slice(0, i) : '/';
        name = /\.webm$/i.test(to.slice(i + 1)) ? to.slice(i + 1) : to.slice(i + 1) + '.webm';
      } else await makeFolders(dir);
      const fd = new FormData();
      fd.append('path', dir);
      fd.append('files[]', new File([blob], name, { type: 'video/webm' }), name);
      const saved = await H.api('fs.upload', fd);
      const entry = Array.isArray(saved) ? saved[0] : saved;
      const path = (entry && entry.path) || dir.replace(/\/$/, '') + '/' + name;
      const folder = dir.split('/').filter(Boolean).pop() || 'My drive';
      H.notify(clock(ms).replace(/^0/, '') + ', ' + (set.shotRecSave === false ? 'saved to the ' : 'automatically saved to the ') + folder + ' folder.', {
        title: 'Screen recording saved',
        app: 'screenshot',
        preview: R.preview || undefined,
        onPreview: () => H.openFile(path),
        actions: [
          { label: 'Open', action: () => H.openFile(path) },
          { label: 'Show in folder', action: () => H.openApp('files', { path: dir, select: path }) },
        ],
      });
    } catch (e) {
      recFail(e && e.message ? e.message : 'The recording couldn’t be saved.');
    }
  }

  function askToRecord(o) {
    H.notify('The browser needs a click before it can record the screen.', {
      title: 'Record the screen',
      app: 'screenshot',
      actions: [{ label: 'Start recording', action: () => record(o) }],
    });
  }

  /*
  |--------------------------------------------------------------------------
  | The keys
  |--------------------------------------------------------------------------
  */

  /**
   * Ctrl+Alt+S, PrtSc, Alt+PrtSc and Shift+PrtSc, on the desktop or (passed on by the SDK) in an app. -> whether it was
   * one. Ctrl+Alt+S is a region, as the snipping tool's key (it goes down like any key, so the browser lets it ask). A
   * PrtSc keyup soon after its keydown was already taken as it went down.
   */
  function key(e) {
    if (!e) return false;
    // Ctrl+Alt+R: a recording (or, while one is under way, its end)
    if (e.ctrlKey && e.altKey && !e.shiftKey && (e.code === 'KeyR' || String(e.key).toLowerCase() === 'r')) {
      if (e.type !== 'keydown' || !signedIn()) return e.type !== 'keydown';
      record({ mode: 'region' });
      return true;
    }
    if (e.ctrlKey && e.altKey && !e.shiftKey && (e.code === 'KeyS' || String(e.key).toLowerCase() === 's')) {
      if (e.type !== 'keydown' || !signedIn()) return e.type !== 'keydown';
      take({ mode: 'region' });
      return true;
    }
    if (e.key !== 'PrintScreen' && e.code !== 'PrintScreen') return false;
    if (!signedIn()) return false;
    if (e.type === 'keyup' && Date.now() - downAt < 3000) return true;
    if (e.type === 'keydown') downAt = Date.now();
    const o = { mode: e.shiftKey ? 'region' : e.altKey ? 'active' : 'screen' };
    if (navigator.userActivation && !navigator.userActivation.isActive) askToTake(o);
    else take(o);
    return true;
  }
  ['keydown', 'keyup'].forEach((t) => document.addEventListener(t, (e) => { if (key(e)) e.preventDefault(); }, true));

  H.capture = {
    take: (o, winId) => take(o, winId),
    /** A screen recording: o { mode }; asked again while one is under way, it stops. */
    record: (o, winId) => record(o, winId),
    stop: () => stopRecording(),
    get recording() { return !!rec; },
    key: (e) => key(e),
    /** Whether this browser, on this address, can capture the screen. */
    supported: () => supported(),
    get busy() { return busy; },
  };
})();
