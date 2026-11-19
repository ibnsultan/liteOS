/* LiteOS Settings */
LiteOS.ready((OS) => {
  'use strict';
  const { util } = OS;
  const I = (n, s) => OS.icon(n, s || 16);
  const esc = util.escape;
  const $ = (s, el) => (el || document).querySelector(s);

  const isAdmin = () => OS.user && OS.user.role === 'admin';
  const SECTIONS = [
    // [id, label, icon role in the system icon set, admins only]
    ['personalisation', 'Personalisation', 'settings.personalisation'],
    ['taskbar', 'Taskbar', 'settings.taskbar'],
    ['apps', 'Apps', 'settings.apps'],
    ['notifications', 'Notifications', 'settings.notifications'],
    ['storage', 'Storage', 'settings.storage'],
    ['accessibility', 'Accessibility', 'settings.accessibility'],
    ['account', 'Accounts', 'settings.accounts'],
    ['system', 'System', 'settings.system', true],
    ['about', 'About', 'settings.about'],
  ];

  const wanted = OS.args.section === 'users' ? 'account' : OS.args.section;
  let section = SECTIONS.some((s) => s[0] === wanted) ? wanted : 'personalisation';
  const a11yOpen = new Set(['text']);
  const cache = {};

  const s = () => OS.settings;
  const save = (changes) => OS.saveSettings(changes);
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const avatar = (u, size) => '<span class="avatar" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.38) + 'px;background:' + esc(u.color || '#2F6FD6') + '">' + esc(initials(u.name)) + '</span>';
  const tile = (app, size) => '<img src="' + app.img + '" alt="" width="' + size + '" height="' + size + '" style="flex-shrink:0">';
  const sw = (on) => '<button class="switch" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"';
  const seg = (key, opts, val) => '<div class="seg">' + opts.map(([v, l]) => '<button data-set="' + key + '" data-val="' + v + '" class="' + (val === v ? 'active' : '') + '">' + l + '</button>').join('') + '</div>';
  const row = (title, hint, control) => '<div class="srow"><span class="txt"><b>' + title + '</b>' + (hint ? '<small>' + hint + '</small>' : '') + '</span>' + control + '</div>';
  const toggle = (key, title, hint) => row(title, hint, sw(!!s()[key]) + ' data-toggle="' + key + '" aria-label="' + esc(title) + '"></button>');
  const head = (title) => '<div><h1 class="h1">' + title + '</h1></div>';

  function wallCss(id) {
    if (id && id.startsWith('file:')) return 'url("' + OS.fs.rawUrl(id.slice(5)) + '") center/cover no-repeat';
    const w = window.LOS_WALLPAPERS.find((x) => x.id === id) || window.LOS_WALLPAPERS[0];
    return w.css;
  }

  // ------------------------------------------------------------------ nav
  function renderNav() {
    const u = OS.user;
    $('#nav').innerHTML = '<div class="me">' + avatar(u, 42) + '<span class="txt"><b>' + esc(u.name) + '</b><small>' + (isAdmin() ? 'Administrator' : 'Standard user') + '</small></span></div>' +
      SECTIONS.filter((x) => !x[3] || isAdmin()).map(([id, label, icon]) => '<button class="nav-item' + (section === id ? ' active' : '') + '" data-sec="' + id + '">' + OS.sysGlyph(icon, 18) + '<span>' + label + '</span></button>').join('');
  }

  // ------------------------------------------------------------------ sections
  const views = {
    personalisation() {
      const st = s();
      const dark = (st.theme === 'dark') || (st.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const fileWall = st.wallpaper && st.wallpaper.startsWith('file:');
      return head('Personalisation') +
        '<div class="preview" style="background:' + esc(wallCss(st.wallpaper)) + '">' +
        (st.taskbar === 'classic' ? '' : '<span class="pv-bar"></span>') +
        '<span class="pv-win"><span class="h" style="display:block"></span><i class="l" style="width:60%"></i><i class="l"></i><i class="l" style="width:85%"></i><i class="a"></i></span>' +
        (st.taskbar === 'classic' ? '<span class="pv-task"><i style="background:var(--accent);width:22px"></i>' + window.LOS_APPS.slice(0, 6).map((a) => '<i style="background:' + a.c[1] + '"></i>').join('') + '</span>'
          : '<span class="pv-dock"><i style="background:var(--accent)"></i>' + window.LOS_APPS.slice(0, 7).map((a) => '<i style="background:' + a.c[1] + '"></i>').join('') + '</span>') +
        '</div>' +
        '<section class="group"><div class="row"><h2 class="section-title grow">Wallpaper</h2><span class="hint">' + esc(fileWall ? util.basename(st.wallpaper) : (window.LOS_WALLPAPERS.find((w) => w.id === st.wallpaper) || {}).name || '') + '</span></div>' +
        '<div class="walls">' + window.LOS_WALLPAPERS.map((w) => '<button class="wall-btn' + (st.wallpaper === w.id ? ' on' : '') + '" data-wall="' + w.id + '" aria-label="' + esc(w.name) + '" style="background:' + esc(w.css) + '"></button>').join('') +
        (fileWall ? '<button class="wall-btn on" data-wall="' + esc(st.wallpaper) + '" aria-label="Your picture" style="background:' + esc(wallCss(st.wallpaper)) + '"></button>' : '') +
        '<button class="wall-btn browse" data-act="browse-wall">' + I('plus') + 'Choose a picture…</button></div>' +
        '<div class="row" style="padding-top:4px"><span class="hint grow">Fit</span>' + seg('wallpaperFit', [['cover', 'Fill'], ['contain', 'Fit'], ['center', 'Centre']], st.wallpaperFit) + '</div></section>' +
        '<section class="group"><h2 class="section-title">Theme</h2><div class="cards three">' +
        [['light', 'Light', '#E9ECF1', '#FFFFFF', '#C9CED6'], ['dark', 'Dark', '#1B1F27', '#2A303B', '#566070'], ['auto', 'Automatic', 'linear-gradient(90deg,#E9ECF1 50%,#1B1F27 50%)', 'linear-gradient(90deg,#FFFFFF 50%,#2A303B 50%)', '#8A8F98']]
          .map(([v, l, bg, win, line]) => '<button class="pick' + (st.theme === v ? ' on' : '') + '" data-set="theme" data-val="' + v + '"><span class="theme-mini" style="background:' + bg + '"><span style="background:' + win + '"><i style="background:' + line + '"></i><em></em></span></span>' +
            '<span class="cap"><b>' + l + '</b><span class="check">' + I('check', 13) + '</span></span></button>').join('') + '</div>' +
        (st.theme === 'auto' ? '<span class="hint">Follows your device: currently ' + (dark ? 'dark' : 'light') + '.</span>' : '') + '</section>' +
        '<section class="group"><h2 class="section-title">Accent colour</h2><div class="swatches">' +
        window.LOS_ACCENTS.map(([n, c]) => '<button class="sw' + (st.accent.toUpperCase() === c ? ' on' : '') + '" data-accent="' + c + '" aria-label="' + n + '" style="background:' + c + ';color:' + c + '">' + (st.accent.toUpperCase() === c ? '<span style="color:#fff">' + I('check', 15) + '</span>' : '') + '</button>').join('') +
        '<label title="Custom colour" style="display:flex;align-items:center;gap:8px;margin-left:6px"><input class="custom-color" type="color" value="' + esc(st.accent) + '" aria-label="Custom accent colour"><span class="hint">Custom</span></label></div></section>' +
        '<div class="box">' + toggle('transparency', 'Transparency effects', 'Frosted glass on the dock, menus and top bar') + toggle('nightLight', 'Night light', 'Warmer colours that are easier on the eyes at night') +
        toggle('clock24', '24-hour clock', 'Show 13:00 instead of 1:00 PM') + '</div>' +
        desktopIconsSection();
    },

    taskbar() {
      const st = s();
      const pinned = st.pinned || [];
      const all = window.LOS_APPS;
      const ordered = pinned.map(window.LOS_app).filter(Boolean).concat(all.filter((a) => !pinned.includes(a.id)));
      const floating = st.taskbar !== 'classic';
      return head('Taskbar') +
        '<section class="group"><h2 class="section-title">Layout</h2><div class="cards">' +
        '<button class="pick' + (floating ? ' on' : '') + '" data-set="taskbar" data-val="floating"><span class="mini" style="background:' + esc(wallCss(st.wallpaper)) + '">' +
        '<i style="left:0;right:0;top:0;height:10px;background:rgba(255,255,255,.8)"></i><i style="left:60px;right:60px;top:22px;bottom:34px;background:#fff;border-radius:5px"></i>' +
        '<i style="left:50%;bottom:8px;transform:translateX(-50%);width:110px;height:20px;border-radius:7px;background:rgba(255,255,255,.85)"></i></span>' +
        '<span class="cap"><span><b>Floating dock</b><small>Top bar with a centred dock</small></span><span class="check">' + I('check', 13) + '</span></span></button>' +
        '<button class="pick' + (!floating ? ' on' : '') + '" data-set="taskbar" data-val="classic"><span class="mini" style="background:' + esc(wallCss(st.wallpaper)) + '">' +
        '<i style="left:60px;right:60px;top:14px;bottom:30px;background:#fff;border-radius:5px"></i><i style="left:0;right:0;bottom:0;height:18px;background:rgba(255,255,255,.88)"></i></span>' +
        '<span class="cap"><span><b>Classic taskbar</b><small>Full-width bar with Start and tray</small></span><span class="check">' + I('check', 13) + '</span></span></button></div></section>' +
        '<div class="box">' +
        row('Icon size', 'Larger icons are easier to tap on touch screens', seg('iconSize', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], st.iconSize)) +
        toggle('autohide', 'Automatically hide the taskbar', 'Shows again when you move the pointer to the bottom edge') +
        (floating ? toggle('labels', 'Show app names', 'Text labels under each icon') + toggle('topbar', 'Show top bar', 'App name, search and clock along the top') : '') +
        toggle('magnify', 'Lift icons on hover', 'A small motion cue when pointing at an app') + '</div>' +
        '<section class="group"><h2 class="section-title">Pinned apps</h2><div class="box">' +
        ordered.map((a) => {
          const on = pinned.includes(a.id);
          const idx = pinned.indexOf(a.id);
          return '<div class="pin-row">' + tile(a, 30) + '<span class="nm">' + esc(a.name) + '</span>' +
            (on ? '<button class="icon-btn" data-move="' + a.id + '" data-dir="-1" aria-label="Move ' + esc(a.name) + ' left"' + (idx === 0 ? ' disabled' : '') + '>' + I('up') + '</button>' +
              '<button class="icon-btn" data-move="' + a.id + '" data-dir="1" aria-label="Move ' + esc(a.name) + ' right"' + (idx === pinned.length - 1 ? ' disabled' : '') + '>' + I('down') + '</button>' : '') +
            sw(on) + ' data-pin="' + a.id + '" aria-label="Pin ' + esc(a.name) + '"></button></div>';
        }).join('') + '</div></section>';
    },

    apps() {
      const st = s();
      return head('Apps') +
        '<section class="group"><h2 class="section-title">Installed apps</h2><div class="box">' +
        window.LOS_APPS.map((a) => '<div class="pin-row">' + tile(a, 30) + '<span class="nm">' + esc(a.name) +
          '<small class="hint" style="display:block;font-weight:400">' + (a.exts.length ? 'Opens ' + esc(a.exts.slice(0, 8).map((e) => '.' + e).join(', ')) + (a.exts.length > 8 ? '…' : '') : 'Built-in') + '</small></span>' +
          '<button class="btn btn-sm" data-launch="' + a.id + '">Open</button></div>').join('') + '</div></section>' +
        '<section class="group"><h2 class="section-title">Browser</h2><div class="box">' +
        row('Home page', 'Opens when you start the Browser', '<form data-form="homepage" class="row"><input class="input" name="homepage" type="url" value="' + esc(st.homepage || '') + '" style="width:280px" required><button class="btn">Save</button></form>') + '</div></section>';
    },

    notifications() {
      return head('Notifications') + '<div class="box">' + toggle('dnd', 'Do not disturb', 'Hide notifications. Errors still show.') +
        row('Test', 'Send a sample notification', '<button class="btn" data-act="test-notify">Send</button>') + '</div>';
    },

    storage() {
      const u = cache.usage;
      const t = cache.trash;
      const pct = u ? Math.min(100, (u.used / u.quota) * 100) : 0;
      const trashSize = t ? t.reduce((a, x) => a + (x.size || 0), 0) : 0;
      return head('Storage') +
        '<div class="box" style="padding:18px;display:flex;flex-direction:column;gap:10px"><div class="row"><b class="grow" style="font-size:15px">My drive</b><span class="hint">' + (u ? util.formatSize(u.used) + ' of ' + util.formatSize(u.quota) + ' used' : 'Loading…') + '</span></div>' +
        '<div class="meter-l"><i style="width:' + pct.toFixed(1) + '%' + (pct > 90 ? ';background:var(--danger)' : '') + '"></i></div>' +
        '<span class="hint">' + (u ? util.formatSize(Math.max(0, u.quota - u.used)) + ' free.' : '') + (isAdmin() ? '' : ' Ask an administrator if you need more space.') + '</span></div>' +
        '<div class="box">' + row('Trash', t ? (t.length + ' item' + (t.length === 1 ? '' : 's') + ' · ' + util.formatSize(trashSize)) : 'Loading…', '<button class="btn" data-act="open-trash">Open</button><button class="btn btn-danger" data-act="empty-trash"' + (t && t.length ? '' : ' disabled') + '>Empty Trash</button>') +
        row('Files', 'Browse and manage everything on your drive', '<button class="btn" data-launch="files">Open Files</button>') + '</div>';
    },

    accessibility() {
      const st = s();
      const v = (k, d) => String(st[k] == null ? d : st[k]);
      const row = (id, icon, title, hint, body) => {
        if (!body) {
          return '<div class="a11y-row disabled" aria-disabled="true"><span class="a11y-ico">' + I(icon, 20) + '</span>' +
            '<span class="txt"><b>' + title + '</b><small>' + hint + '</small></span><span class="a11y-na">Not available</span></div>';
        }
        const open = a11yOpen.has(id);
        return '<div class="a11y-item' + (open ? ' open' : '') + '"><button class="a11y-row" data-a11y="' + id + '" aria-expanded="' + open + '">' +
          '<span class="a11y-ico">' + I(icon, 20) + '</span><span class="txt"><b>' + title + '</b><small>' + hint + '</small></span>' +
          '<span class="a11y-chev">' + I('down', 16) + '</span></button>' + (open ? '<div class="a11y-body">' + body + '</div>' : '') + '</div>';
      };
      const ctl = (title, hint, control) => '<div class="a11y-ctl"><span class="txt"><b>' + title + '</b>' + (hint ? '<small>' + hint + '</small>' : '') + '</span>' + control + '</div>';
      const tog = (key, title, hint, invert) => ctl(title, hint, sw(invert ? !st[key] : !!st[key]) + ' data-toggle="' + key + '" aria-label="' + esc(title) + '"></button>');
      const note = (t) => '<div class="a11y-note">' + I('info', 14) + '<span>' + t + '</span></div>';
      const carets = [['auto', 'Default', 'var(--text)'], ['accent', 'Accent', 'var(--accent)'], ['red', 'Red', '#E5484D'], ['green', 'Green', '#1F9D61'], ['purple', 'Purple', '#8E4EC6']];

      return head('Accessibility') +
        '<section class="group"><h2 class="section-title">Vision</h2><div class="a11y-list">' +
        row('text', 'text', 'Text size', 'Size of text and controls inside apps',
          ctl('Text size', '', seg('textSize', [['default', 'Default'], ['large', 'Large'], ['larger', 'Larger']], v('textSize', 'default')))) +
        row('effects', 'glass', 'Visual effects', 'Transparency, animations, notification timeout',
          tog('transparency', 'Transparency effects', 'Frosted glass on the dock, menus and top bar') +
          tog('reduceMotion', 'Animation effects', 'Turn off to stop windows and menus from animating', true) +
          ctl('Dismiss notifications after', '', seg('notifyTimeout', [['5', '5 s'], ['10', '10 s'], ['20', '20 s'], ['30', '30 s']], v('notifyTimeout', 5)))) +
        row('pointer', 'pointer', 'Mouse pointer', 'Pointer size',
          ctl('Pointer size', '', seg('cursorSize', [['default', 'Default'], ['large', 'Large'], ['larger', 'Larger']], v('cursorSize', 'default')))) +
        row('caret', 'caret', 'Text cursor', 'Colour of the text cursor',
          ctl('Cursor colour', '', '<div class="swatches">' + carets.map(([val, n, c]) => '<button class="sw' + (v('caretColor', 'auto') === val ? ' on' : '') + '" data-set="caretColor" data-val="' + val + '" aria-label="' + n + '" title="' + n + '" style="background:' + c + ';color:' + c + '"></button>').join('') + '</div>') +
          note('Cursor thickness and the cursor indicator aren’t available in LiteOS.')) +
        row('magnifier', 'zoom', 'Magnifier', 'Use your browser’s zoom instead (Ctrl and +)') +
        row('filters', 'palette', 'Colour filters', 'Greyscale and inverted colours',
          ctl('Filter', '', seg('colorFilter', [['none', 'Off'], ['grayscale', 'Greyscale'], ['invert', 'Inverted'], ['grayscale-invert', 'Greyscale inverted']], v('colorFilter', 'none'))) +
          note('Colour-blindness filters aren’t available yet.')) +
        row('tint', 'sunset', 'Screen tint', 'A warm overlay that’s easier on the eyes',
          tog('nightLight', 'Night light', 'Warmer colours across the whole screen')) +
        row('contrast', 'contrast', 'Contrast themes', 'High-contrast colours for low vision',
          ctl('Contrast theme', '', seg('contrast', [['off', 'None'], ['dark', 'Dark'], ['light', 'Light']], v('contrast', 'off')))) +
        row('narrator', 'volume', 'Narrator', 'Use your device’s screen reader; LiteOS apps support it') +
        '</div></section>' +
        '<section class="group"><h2 class="section-title">Hearing</h2><div class="a11y-list">' +
        row('audio', 'volume', 'Audio', 'Notification sounds',
          tog('notifySound', 'Notification sounds', 'Play a short chime when a notification arrives') + note('Mono audio isn’t available in LiteOS.')) +
        row('flash', 'bell', 'Visual notifications', 'Flash the screen when a notification arrives',
          tog('flashOnNotify', 'Flash the screen', 'Useful when sound is off or hard to hear')) +
        row('hearing', 'ear', 'Hearing devices', 'Presets and audio routing') +
        row('captions', 'captions', 'Captions', 'Caption size in videos',
          ctl('Caption size', '', seg('captionSize', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], v('captionSize', 'medium'))) +
          note('Live captions aren’t available yet.')) +
        '</div></section>' +
        '<section class="group"><h2 class="section-title">Interaction</h2><div class="a11y-list">' +
        row('speech', 'mic', 'Speech', 'Voice access, voice typing') +
        row('keyboard', 'keyboard', 'Keyboard', 'Focus outline, shortcuts',
          tog('focusRing', 'Stronger focus outline', 'A thick outline around whatever has keyboard focus') +
          ctl('Shortcuts', 'Alt + Space opens the launcher · Esc closes menus · Ctrl + S saves in apps', '') +
          note('The on-screen keyboard and sticky keys aren’t available yet.')) +
        row('mouse', 'mouse', 'Mouse', 'Mouse keys, speed, acceleration') +
        row('eye', 'eye', 'Eye control', 'Eye tracker, text-to-speech') +
        '</div></section>';
    },

    // Your own account: who you are, then one row per thing you can change (each opens a small dialog).
    account() {
      const u = OS.user;
      return head('Accounts') +
        '<div class="acct-head">' + avatar(u, 64) + '<span class="txt"><b>' + esc(u.name) + '</b>' +
        '<small>' + esc(u.username) + ' · ' + (isAdmin() ? 'Administrator' : 'Standard user') + '</small></span></div>' +
        '<section class="group"><h2 class="section-title">Your account</h2><div class="box">' +
        row('Display name', esc(u.name), '<button class="btn" data-act="edit-name">Change</button>') +
        row('Password', 'Used to sign in and to unlock the screen', '<button class="btn" data-act="change-password">Change</button>') +
        row('Account type', isAdmin() ? 'Administrator: can manage users and system settings' : 'Standard user: can change only their own settings', '') +
        '</div></section>' +
        (isAdmin() ? views.usersBlock() : '');
    },

    users() { return head('Accounts') + views.usersBlock(); },

    // Administrators: everyone else who can sign in to this computer (part of Settings › Accounts).
    usersBlock() {
      const others = cache.users ? cache.users.filter((x) => x.username !== OS.user.username) : null;
      const when = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
      const about = (x) => [
        esc(x.username),
        x.role === 'admin' ? 'Administrator' : 'Standard user',
        util.formatSize(x.used) + ' of ' + util.formatSize(x.quota) + ' used',
        x.lastLogin ? 'Last signed in ' + esc(when(x.lastLogin)) : 'Never signed in',
      ].join(' · ');
      const userRow = (x) => '<div class="srow user-row' + (x.disabled ? ' off' : '') + '">' + avatar(x, 36) +
        '<span class="txt"><b>' + esc(x.name) + (x.disabled ? '<span class="tag">Disabled</span>' : '') + '</b><small>' + about(x) + '</small></span>' +
        '<button class="icon-btn" data-user="' + esc(x.username) + '" title="More" aria-label="More for ' + esc(x.name) + '">' + I('more') + '</button></div>';
      return '<section class="group" id="users">' +
        '<div class="sec-head"><span class="txt"><h2 class="section-title">Other users</h2>' +
        '<small>Everyone here signs in with their own files and settings.</small></span>' +
        '<button class="btn" data-act="add-user">Add user</button></div>' +
        '<div class="box">' + (!others ? '<div class="srow"><span class="txt"><small>Loading…</small></span></div>'
          : !others.length ? '<div class="srow"><span class="txt"><b>No other users yet</b><small>Add a user so someone else can sign in to this computer.</small></span></div>'
            : others.map(userRow).join('')) +
        '</div></section>';
    },

    system() {
      const x = cache.system;
      if (!x) return head('System') + '<div class="empty">Loading…</div>';
      return head('System') +
        '<form class="box" data-form="system"><div class="form-grid">' +
        '<label class="field"><span>Computer name</span><input class="input" name="instanceName" maxlength="40" required value="' + esc(x.instanceName) + '"></label>' +
        '<label class="field"><span>Default storage per user (MB)</span><input class="input" name="defaultQuotaMB" type="number" min="10" value="' + esc(x.defaultQuotaMB) + '"></label>' +
        '<div class="full row"><span class="err grow"></span><button class="btn btn-primary">Save</button></div></div></form>' +
        '<section class="group"><h2 class="section-title">Server</h2><div class="box"><dl class="kv">' +
        '<dt>LiteOS version</dt><dd>' + esc(x.version) + '</dd><dt>PHP version</dt><dd>' + esc(x.php) + '</dd>' +
        '<dt>Largest upload</dt><dd>' + esc(x.uploadMax) + '</dd><dt>Accounts</dt><dd>' + esc(x.userCount) + '</dd>' +
        '<dt>Set up</dt><dd>' + (x.createdAt ? esc(new Date(x.createdAt).toLocaleString()) : '—') + '</dd></dl></div></section>';
    },

    about() {
      return head('About') +
        '<div class="box" style="padding:24px;display:flex;align-items:center;gap:18px"><img src="../../assets/img/kite-blue.svg" alt="" style="width:56px;height:56px">' +
        '<span><b style="font-size:20px;display:block">' + esc(OS.system.instanceName || 'LiteOS') + '</b><span class="hint">LiteOS ' + esc(OS.system.version || '') + ' · an open, web-based desktop</span></span></div>' +
        '<div class="box"><dl class="kv"><dt>Signed in as</dt><dd>' + esc(OS.user.name) + ' (' + esc(OS.user.username) + ')</dd>' +
        '<dt>Account type</dt><dd>' + (isAdmin() ? 'Administrator' : 'Standard user') + '</dd>' +
        '<dt>Screen</dt><dd>' + window.screen.width + ' × ' + window.screen.height + '</dd>' +
        '<dt>Browser</dt><dd>' + esc(navigator.userAgent) + '</dd></dl></div>';
    },
  };

  // ------------------------------------------------------------------ data loading per section
  async function loadData() {
    try {
      if (section === 'storage') { [cache.usage, cache.trash] = await Promise.all([OS.fs.usage(), OS.fs.trash.list()]); }
      if ((section === 'account' || section === 'users') && isAdmin()) cache.users = await OS.api('users.list', undefined, {});
      if (section === 'system' && isAdmin()) cache.system = await OS.api('system.get', undefined, {});
    } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t load settings' }); }
  }

  function render() {
    renderNav();
    const page = $('#page');
    const scroll = page.scrollTop;
    page.innerHTML = '<div class="page-inner">' + views[section]() + '</div>';
    page.scrollTop = scroll;
    OS.win.setTitle((SECTIONS.find((x) => x[0] === section) || [])[1] + ' — Settings');
  }

  // Settings › Personalisation › Desktop icons: which system items sit on the desktop.
  function desktopIconsSection() {
    const on = s().desktopIcons || [];
    const items = [
      { id: 'files', name: 'My drive', hint: 'Opens Files', img: window.LOS_app('files').img },
      { id: 'trash', name: 'Trash', hint: 'Deleted files, until you empty it', img: window.LOS_appIconUrl('trash') },
      { id: 'settings', name: 'Settings', hint: 'Personalisation, account and more', img: window.LOS_app('settings').img },
    ].concat(window.LOS_APPS.filter((a) => a.id !== 'files' && a.id !== 'settings').map((a) => ({ id: a.id, name: a.name, hint: '', img: a.img })));
    const rowFor = (it) => '<div class="pin-row"><img src="' + esc(it.img) + '" alt="" width="30" height="30" style="flex-shrink:0">' +
      '<span class="nm">' + esc(it.name) + (it.hint ? '<small class="hint" style="display:block;font-weight:400">' + esc(it.hint) + '</small>' : '') + '</span>' +
      sw(on.includes(it.id)) + ' data-desk="' + it.id + '" aria-label="Show ' + esc(it.name) + ' on the desktop"></button></div>';
    return '<section class="group" id="desktop-icons"><h2 class="section-title">Desktop icons</h2>' +
      '<span class="hint">Choose what appears on your desktop. Double-click an icon on the desktop to open it.</span>' +
      '<div class="box">' + items.slice(0, 3).map(rowFor).join('') + '</div>' +
      '<span class="hint" style="margin-top:4px">Apps</span><div class="box">' + items.slice(3).map(rowFor).join('') + '</div></section>';
  }

  async function go(id) {
    section = id;
    render();
    $('#page').scrollTop = 0;
    await loadData();
    if (section === id) render();
    // Opened from "Desktop icons" on the desktop: jump to that section.
    if (OS.args.focus === 'desktop' && id === 'personalisation') {
      const el = document.getElementById('desktop-icons');
      if (el) el.scrollIntoView({ block: 'start' });
    }
  }

  // ------------------------------------------------------------------ in-app dialog
  // A form dialog in the system style (docs/ui-dialogs.md): <dialog class="dlg">, Escape cancels, focus returns.
  function dialog(title, bodyHtml, okLabel, onOk, danger) {
    const d = $('#dlg');
    const prev = document.activeElement;
    d.innerHTML = '<form autocomplete="off"><h2 class="dlg-title" id="dlg-title">' + esc(title) + '</h2><div class="dlg-body">' + bodyHtml + '<div class="err"></div></div>' +
      '<div class="dlg-actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn ' + (danger ? 'btn-danger' : 'is-default') + '">' + esc(okLabel) + '</button></div></form>';
    const f = $('form', d);
    const close = () => { if (d.open) d.close(); d.innerHTML = ''; if (prev && prev.focus) prev.focus(); };
    $('[data-x]', f).addEventListener('click', close);
    d.oncancel = (e) => { e.preventDefault(); close(); };
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = f.querySelector('.dlg-actions button:last-child');
      btn.disabled = true;
      try { await onOk(f); close(); } catch (ex) { $('.err', f).textContent = ex.message; btn.disabled = false; }
    });
    d.showModal();
    const first = f.querySelector('input:not([disabled]), select') || btn0(f);
    if (first) first.focus();
  }
  const btn0 = (f) => f.querySelector('.dlg-actions button:last-child');

  function userForm(x) {
    const editing = !!x;
    return (editing ? '' : '<label class="field"><span>Username</span><input class="input" name="username" required maxlength="32" pattern="[a-z0-9][a-z0-9_.\\-]{1,31}" title="Lowercase letters, numbers, dot, dash or underscore"></label>') +
      '<label class="field"><span>Display name</span><input class="input" name="name" required maxlength="60" value="' + esc(x ? x.name : '') + '"></label>' +
      (editing ? '' : '<label class="field"><span>Password</span><input class="input" type="password" name="password" required minlength="6" autocomplete="new-password"></label>') +
      '<div class="row" style="gap:14px"><label class="field grow"><span>Account type</span><select class="select" name="role" style="height:38px">' +
      '<option value="user"' + (x && x.role === 'admin' ? '' : ' selected') + '>Standard user</option><option value="admin"' + (x && x.role === 'admin' ? ' selected' : '') + '>Administrator</option></select></label>' +
      '<label class="field grow"><span>Storage limit (MB)</span><input class="input" type="number" min="10" name="quotaMB" placeholder="Default" value="' + esc(x && x.quotaMB != null ? x.quotaMB : '') + '"></label></div>';
  }

  function userMenu(username, at) {
    const x = (cache.users || []).find((u) => u.username === username);
    if (!x) return;
    const me = x.username === OS.user.username;
    const items = [
      { label: 'Edit', icon: 'rename', action: () => dialog('Edit ' + x.name, userForm(x), 'Save', async (f) => {
        await OS.api('users.update', { username: x.username, changes: { name: f.name.value, role: f.role.value, quotaMB: f.quotaMB.value === '' ? null : +f.quotaMB.value } });
        OS.notify('Changes to ' + x.name + ' were saved.', { type: 'success', title: 'User updated' }); await refreshUsers();
      }) },
      { label: 'Reset password', icon: 'lock', action: () => dialog('Reset password for ' + x.name, '<label class="field"><span>New password</span><input class="input" type="password" name="pw" minlength="6" required autocomplete="new-password"></label>', 'Reset password', async (f) => {
        await OS.api('users.update', { username: x.username, changes: { password: f.pw.value } });
        OS.notify('Password changed for ' + x.name + '.', { type: 'success', title: 'Password reset' });
      }) },
    ];
    if (!me) {
      items.push({ label: x.disabled ? 'Enable account' : 'Disable account', icon: x.disabled ? 'check' : 'x', action: async () => {
        try { await OS.api('users.update', { username: x.username, changes: { disabled: !x.disabled } }); await refreshUsers(); } catch (e) { OS.notify(e.message, { type: 'error', title: x.disabled ? 'Couldn’t enable account' : 'Couldn’t disable account' }); }
      } });
      items.push('sep', { label: 'Delete user', icon: 'trash', danger: true, action: async () => {
        const ok = await OS.dialog.confirm({ title: 'Delete ' + x.name + '?', message: 'They won’t be able to sign in. Their files are kept aside on the server in case you need them.', okLabel: 'Delete user', danger: true });
        if (!ok) return;
        try { await OS.api('users.delete', { username: x.username }); OS.notify(x.name + ' can no longer sign in.', { type: 'success', title: 'User deleted' }); await refreshUsers(); } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t delete user' }); }
      } });
    }
    OS.menu(items, at);
  }

  async function refreshUsers() { cache.users = await OS.api('users.list', undefined, {}); if (section === 'account') render(); }

  // ------------------------------------------------------------------ events
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button, [data-sec]');
    if (!b || b.disabled) return;
    if (b.dataset.sec) { go(b.dataset.sec); return; }
    if (b.dataset.set) { save({ [b.dataset.set]: b.dataset.val }); return; }
    if (b.dataset.toggle) { save({ [b.dataset.toggle]: !s()[b.dataset.toggle] }); return; }
    if (b.dataset.wall) { save({ wallpaper: b.dataset.wall }); return; }
    if (b.dataset.accent) { save({ accent: b.dataset.accent }); return; }
    if (b.dataset.launch) { OS.open(b.dataset.launch); return; }
    if (b.dataset.user) { const r = b.getBoundingClientRect(); userMenu(b.dataset.user, { x: r.right - 210, y: r.bottom + 4 }); return; }
    if (b.dataset.a11y) { const id = b.dataset.a11y; const wasOpen = a11yOpen.has(id); a11yOpen.clear(); if (!wasOpen) a11yOpen.add(id); render(); return; }
    if (b.dataset.desk) {
      const d = (s().desktopIcons || []).slice();
      save({ desktopIcons: d.includes(b.dataset.desk) ? d.filter((x) => x !== b.dataset.desk) : d.concat(b.dataset.desk) });
      return;
    }
    if (b.dataset.pin) {
      const p = (s().pinned || []).slice();
      save({ pinned: p.includes(b.dataset.pin) ? p.filter((x) => x !== b.dataset.pin) : p.concat(b.dataset.pin) });
      return;
    }
    if (b.dataset.move) {
      const p = (s().pinned || []).slice();
      const i = p.indexOf(b.dataset.move);
      const j = i + +b.dataset.dir;
      if (i < 0 || j < 0 || j >= p.length) return;
      [p[i], p[j]] = [p[j], p[i]];
      save({ pinned: p });
      return;
    }
    if (b.dataset.sysToggle) { cache.system[b.dataset.sysToggle] = !cache.system[b.dataset.sysToggle]; b.setAttribute('aria-checked', cache.system[b.dataset.sysToggle] ? 'true' : 'false'); return; }
    switch (b.dataset.act) {
      case 'browse-wall': {
        const p = await OS.dialog.open({ title: 'Choose a wallpaper', accept: window.LOS_KINDS.image, startIn: '/Pictures' });
        if (p) save({ wallpaper: 'file:' + p });
        break;
      }
      case 'test-notify': OS.notify('This is how notifications look.', { type: 'success', title: 'Test notification' }); break;
      case 'open-trash': OS.open('files', { path: 'trash:' }); break;
      case 'empty-trash': {
        const ok = await OS.dialog.confirm({ title: 'Empty the Trash?', message: 'Everything in the Trash will be deleted. This can’t be undone.', okLabel: 'Empty Trash', danger: true });
        if (!ok) return;
        try { await OS.fs.trash.purge(); await loadData(); render(); OS.notify('Everything in the Trash was permanently deleted.', { type: 'success', title: 'Trash emptied' }); } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t empty Trash' }); }
        break;
      }
      case 'edit-name':
        dialog('Change display name', '<label class="field"><span>Display name</span><input class="input" name="name" maxlength="60" required value="' + esc(OS.user.name) + '"></label>', 'Save', async (f) => {
          const u = await OS.api('account.update', { name: f.name.value });
          try { window.parent.LiteOSHost.refreshUser(u); } catch (x) { /* standalone */ }
          OS.notify('Your display name was updated.', { type: 'success', title: 'Profile saved' });
          render();
        });
        break;
      case 'change-password':
        dialog('Change password',
          '<label class="field"><span>Current password</span><input class="input" type="password" name="current" required autocomplete="current-password"></label>' +
          '<label class="field"><span>New password</span><input class="input" type="password" name="new" minlength="6" required autocomplete="new-password"></label>' +
          '<label class="field"><span>Confirm new password</span><input class="input" type="password" name="confirm" minlength="6" required autocomplete="new-password"></label>',
          'Change password', async (f) => {
            if (f.new.value !== f.confirm.value) throw new Error('The new passwords don’t match.');
            await OS.api('account.password', { current: f.current.value, new: f.new.value });
            OS.notify('Use your new password the next time you sign in.', { type: 'success', title: 'Password changed' });
          });
        break;
      case 'add-user':
        dialog('Add user', userForm(null), 'Add user', async (f) => {
          await OS.api('users.create', { username: f.username.value, name: f.name.value, password: f.password.value, role: f.role.value, quotaMB: f.quotaMB.value });
          OS.notify('They can now sign in with the username ' + f.username.value + '.', { type: 'success', title: 'User added' }); await refreshUsers();
        });
        break;
      default: break;
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.classList.contains('custom-color')) debouncedAccent(e.target.value);
  });
  const debouncedAccent = util.debounce((v) => save({ accent: v }), 250);

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    const err = $('.err', f);
    if (err) err.textContent = '';
    try {
      if (f.dataset.form === 'profile') {
        const u = await OS.api('account.update', { name: f.name.value });
        try { window.parent.LiteOSHost.refreshUser(u); } catch (x) { /* standalone */ }
        OS.notify('Your display name was updated.', { type: 'success', title: 'Profile saved' });
        render();
      } else if (f.dataset.form === 'password') {
        if (f.new.value !== f.confirm.value) throw new Error('The new passwords don’t match.');
        await OS.api('account.password', { current: f.current.value, new: f.new.value });
        f.reset();
        OS.notify('Use your new password the next time you sign in.', { type: 'success', title: 'Password changed' });
      } else if (f.dataset.form === 'system') {
        cache.system = Object.assign(cache.system, await OS.api('system.save', { system: { instanceName: f.instanceName.value, defaultQuotaMB: +f.defaultQuotaMB.value } }));
        try { window.parent.LiteOSHost.refreshSystem({ instanceName: cache.system.instanceName }); } catch (x) { /* standalone */ }
        OS.notify('The instance name and default storage quota were updated.', { type: 'success', title: 'System settings saved' });
        render();
      } else if (f.dataset.form === 'homepage') {
        await save({ homepage: f.homepage.value });
        OS.notify('The Browser opens this page when it starts.', { type: 'success', title: 'Home page saved' });
      }
    } catch (ex) { if (err) err.textContent = ex.message; else OS.notify(ex.message, { type: 'error', title: 'Couldn’t save changes' }); }
  });

  // Re-render when settings change (from here, Quick settings or another window),
  // but not while the user is typing in a form.
  OS.onSettings(() => {
    const active = document.activeElement;
    if (active && active.closest && active.closest('form')) return;
    render();
  });

  go(section);
});
