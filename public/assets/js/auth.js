/*
 * The screens before the desktop (setup, sign-in, lock; resources/views/auth): the pages are server-rendered forms, and
 * this only adds what a page can't do by itself: icons, the wallpaper, the clock, the boot screen, the corner menus
 * (accessibility, language, power) and a busy state while a form is sent.
 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  // a role ("glass.power") is a system icon from the icon set; a plain name is a glyph (arrows, marks)
  const ICON = (n, s) => (n.includes('.') ? window.LOS_sysGlyph(n, s) : window.LOS_icon(n, s));
  const embedded = document.body.classList.contains('embedded');

  // ------------------------------------------------------------ icons and wallpaper
  function icons(scope) { $$('[data-icon]', scope).forEach((i) => { i.outerHTML = ICON(i.dataset.icon, +i.dataset.size || 16); }); }
  icons();
  $$('[data-wall]').forEach((el) => {
    const w = window.LOS_WALLPAPERS.find((x) => x.id === el.dataset.wall) || window.LOS_WALLPAPERS[0];
    el.style.background = w.css;
  });

  // ------------------------------------------------------------ clock
  function tick() {
    const d = new Date();
    $$('[data-clock]').forEach((n) => {
      n.textContent = n.dataset.clock === 't' ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    });
  }
  tick();
  setInterval(tick, 10000);

  // ------------------------------------------------------------ boot screen
  // The kite draws in full on the first page of a visit; the pages after it (sign-in → desktop) only fade.
  const boot = $('#boot');
  if (boot) {
    let seen = false;
    try { seen = sessionStorage.getItem('los_booted') === '1'; sessionStorage.setItem('los_booted', '1'); } catch (e) { /* storage blocked */ }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wait = seen || reduced ? 0 : Math.max(0, 2000 - performance.now());
    setTimeout(() => { boot.classList.add('done'); setTimeout(() => boot.classList.add('gone'), 500); }, wait);
  }
  function showBoot(message) {
    if (!boot) return;
    $('.boot-msg', boot).textContent = message || '';
    boot.className = 'boot shimmer';
  }

  // ------------------------------------------------------------ forms: one send at a time
  $$('form[data-busy]').forEach((form) => {
    form.addEventListener('submit', () => {
      const go = $('.g-go', form);
      if (go) { go.disabled = true; go.innerHTML = '<span class="g-spin"></span>'; }
    });
  });
  // a wrong password shakes the field; let the animation run again on the next try
  $$('.g-field.shake').forEach((f) => f.addEventListener('animationend', () => f.classList.remove('shake'), { once: true }));

  // ------------------------------------------------------------ corner buttons
  const screen = $('.lock, .oobe');
  const A11Y_KEY = 'los_auth_a11y';
  const a11y = () => { try { return JSON.parse(localStorage.getItem(A11Y_KEY) || '{}') || {}; } catch (e) { return {}; } };
  function applyA11y() {
    if (!screen) return;
    const a = a11y();
    screen.classList.toggle('a11y-large', !!a.large);
    screen.classList.toggle('a11y-contrast', !!a.contrast);
  }
  applyA11y();

  function note(text) {
    let n = $('.auth-note');
    if (!n) { n = document.createElement('div'); n.className = 'auth-note'; n.setAttribute('role', 'status'); (screen || document.body).appendChild(n); }
    n.textContent = text;
    clearTimeout(note.t);
    note.t = setTimeout(() => n.remove(), 5000);
  }

  // The device's power buttons, when LiteOS runs on a LiteLink device (its helper listens on this port).
  async function bridge(path, body) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 600);
    try {
      const r = await fetch('http://127.0.0.1:7777' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: ctl.signal });
      return r.ok;
    } catch (e) { return false; } finally { clearTimeout(t); }
  }

  const actions = $('.auth-actions');
  if (actions) {
    const above = (b) => { const r = b.getBoundingClientRect(); return { x: r.left, y: r.top - 6, above: true }; };
    actions.addEventListener('click', (e) => {
      const b = e.target.closest('[data-l]');
      if (!b) return;
      if (b.dataset.l === 'a11y') {
        const a = a11y();
        const toggle = (k) => () => { a[k] = !a[k]; try { localStorage.setItem(A11Y_KEY, JSON.stringify(a)); } catch (x) { /* ignore */ } applyA11y(); };
        window.LOS_menu.open([
          { label: 'Larger text', checked: !!a.large, action: toggle('large') },
          { label: 'High contrast', checked: !!a.contrast, action: toggle('contrast') },
        ], above(b));
      } else if (b.dataset.l === 'lang') {
        window.LOS_menu.open([{ label: 'English', checked: true }, { note: 'More languages are coming.' }], above(b));
      } else if (b.dataset.l === 'power') {
        const signOut = $('#sign-out');
        window.LOS_menu.open([
          signOut ? { label: 'Sign out', icon: 'logout', action: () => { showBoot('Signing out…'); signOut.submit(); } } : null,
          { label: 'Reload', icon: 'reload', action: () => (embedded ? window.top : window).location.reload() },
          'sep',
          { label: 'Restart device', icon: 'rotate', action: async () => { if (await bridge('/power', { action: 'reboot' })) showBoot('Restarting…'); else note('Restart isn’t available on this device.'); } },
          { label: 'Shut down', icon: 'power', action: async () => { if (await bridge('/power', { action: 'shutdown' })) showBoot('Shutting down…'); else note('Shut down isn’t available here. You can close this browser tab.'); } },
        ].filter(Boolean), above(b));
      }
    });
  }

  window.LOS_auth = { icons, note };
})();
