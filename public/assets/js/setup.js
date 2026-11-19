/*
 * First-run setup (resources/views/auth/setup.blade.php): the form holds every step; this shows one at a time with a
 * slide between them, checks each step before moving on, fills the summary, and lets the form post at the end.
 * Moving forward the page slides out to the left and the next comes in from the right (reversed going back).
 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const form = $('.oobe-main');
  const bodies = $$('.oobe-body', form);
  const last = bodies.length - 1;
  const err = $('.oobe-err', form);
  const LEAVE_MS = 150;
  const motionOff = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let step = +form.dataset.start || 0;
  let moving = false;
  const nameInput = form.elements.namedItem('name'); // form.name is the form's own name attribute
  let userTouched = !!form.username.value;

  function draw(dir, from) {
    bodies.forEach((b, i) => { b.hidden = i !== step; b.classList.remove('enter-fwd', 'enter-back', 'leave-fwd', 'leave-back'); });
    $$('.oobe-steps li').forEach((li, i) => {
      li.className = (i < step ? 'done' : i === step ? 'on' : '') + (dir && i === from ? ' was' : '');
      $('.n', li).innerHTML = i < step ? window.LOS_icon('check', 13) : String(i + 1);
    });
    $('.oobe-steps').classList.toggle('moved', !!dir);
    $('[data-count]').textContent = step + 1;
    // the dots start on the step we came from, then stretch to the new one
    const dots = $$('.oobe-dots i', form);
    dots.forEach((d, i) => d.classList.toggle('on', i === (dir ? from : step)));
    if (dir) {
      bodies[step].classList.add('enter-' + dir);
      requestAnimationFrame(() => requestAnimationFrame(() => dots.forEach((d, i) => d.classList.toggle('on', i === step))));
    }
    $('[data-back]', form).style.visibility = step > 0 ? '' : 'hidden';
    $('[data-next-label]', form).textContent = bodies[step].dataset.next || 'Continue';
    const arrow = $('svg', $('button[type=submit]', form));
    if (arrow) arrow.style.display = step === last ? 'none' : '';
    if (step === last) review();
    const first = $('input:not([type=radio]):not([type=hidden])', bodies[step]);
    if (first) { first.focus({ preventScroll: true }); if (first.value) first.select(); } else $('button[type=submit]', form).focus({ preventScroll: true });
  }

  function goTo(n) {
    if (moving || n === step) return;
    err.textContent = '';
    const dir = n > step ? 'fwd' : 'back';
    if (motionOff()) { step = n; draw(); return; }
    moving = true;
    bodies[step].classList.add('leave-' + dir);
    setTimeout(() => { const from = step; step = n; draw(dir, from); moving = false; }, LEAVE_MS);
  }

  function fail(message, field) {
    err.textContent = message;
    if (field && form[field]) form[field].focus({ preventScroll: true });
    return false;
  }
  function valid() {
    if (step === 1 && !form.instanceName.value.trim()) return fail('Enter a name for this computer.', 'instanceName');
    if (step === 2) {
      form.username.value = form.username.value.trim().toLowerCase();
      if (!nameInput.value.trim()) { err.textContent = 'Enter your name.'; nameInput.focus({ preventScroll: true }); return false; }
      if (!/^[a-z0-9][a-z0-9_.-]{1,31}$/.test(form.username.value)) return fail('Usernames are 2–32 characters: lowercase letters, numbers, dot, dash or underscore.', 'username');
      if (form.password.value.length < 6) return fail('Passwords must be at least 6 characters.', 'password');
      if (form.password.value !== form.password_confirmation.value) return fail('The passwords don’t match.', 'password_confirmation');
    }
    return true;
  }

  // ------------------------------------------------------------ the account step
  function strength() {
    const p = form.password.value;
    let score = 0;
    if (p.length >= 6) score++;
    if (p.length >= 10) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score++;
    const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['var(--danger)', 'var(--danger)', 'var(--warning)', 'var(--success)', 'var(--success)'];
    const box = $('.oobe-strength', form);
    $('i', box).style.cssText = 'width:' + (p ? Math.max(8, score * 25) : 0) + '%;background:' + colors[score];
    $('small', box).textContent = p ? labels[p.length < 6 ? 0 : score] : 'At least 6 characters.';
  }
  nameInput.addEventListener('input', () => {
    if (!userTouched) form.username.value = nameInput.value.toLowerCase().trim().split(/\s+/)[0].replace(/[^a-z0-9_.-]/g, '').slice(0, 32);
  });
  form.username.addEventListener('input', () => { userTouched = true; });
  form.password.addEventListener('input', strength);

  // ------------------------------------------------------------ the look step: shown live
  function applyLook() {
    const theme = form.theme.value;
    document.documentElement.dataset.theme = theme === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
    document.documentElement.style.setProperty('--accent', form.accent.value);
  }
  form.addEventListener('change', (e) => {
    const input = e.target;
    if (input.type !== 'radio') return;
    $$('input[name="' + input.name + '"]', form).forEach((r) => r.closest('label').classList.toggle('on', r.checked));
    applyLook();
  });

  // ------------------------------------------------------------ the summary
  function review() {
    const set = (k, v) => { $('[data-review="' + k + '"]', form).textContent = v; };
    const accent = $('input[name=accent]:checked', form);
    const name = nameInput.value.trim();
    set('instanceName', form.instanceName.value.trim());
    set('name', name);
    set('username', form.username.value);
    const av = $('[data-review=avatar]', form);
    av.textContent = name.split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
    av.style.background = form.accent.value;
    set('look', ({ light: 'Light', dark: 'Dark', auto: 'Automatic' })[form.theme.value] + ' theme, ' + (accent ? accent.getAttribute('aria-label').toLowerCase() : 'custom') + ' accent');
    const classic = form.taskbar.value === 'classic';
    set('taskbar', classic ? 'Classic taskbar' : 'Floating dock');
    $('[data-review=mini]', form).innerHTML = $('input[name=taskbar]:checked', form).closest('label').querySelector('.oobe-mini').outerHTML;
  }

  // ------------------------------------------------------------ moving between steps, and sending
  form.addEventListener('submit', (e) => {
    if (moving || !valid()) { e.preventDefault(); return; }
    if (step < last) { e.preventDefault(); goTo(step + 1); return; }
    const go = $('button[type=submit]', form);
    $('[data-next-label]', go).textContent = 'Setting up…';
    setTimeout(() => { go.disabled = true; });
  });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-back')) goTo(step - 1);
    else if (b.dataset.goto) goTo(+b.dataset.goto);
  });

  strength();
  applyLook();
  draw();
})();
