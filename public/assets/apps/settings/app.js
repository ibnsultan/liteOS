/* LiteOS Settings, laid out like Windows 11 Settings: a navigation pane (your account, Find a setting, the sections),
   a Home page of cards, and pages made of setting rows that open subpages (System › Display). Page ids are paths:
   "system", "system/display".

   Settings that act on the device itself (screen, sound, power, Bluetooth, network, keyboard layout, time zone, USB
   drives, device information) go through LiteLink's device bridge, window.LiteLink, which exists only when LiteOS
   runs on a LiteLink thin client (docs: LiteLink-OS docs/litelink-web-api.md). Everywhere else those rows are shown
   greyed out with the reason, and nothing calls the bridge. */
LiteOS.ready((OS) => {
  'use strict';
  const { util } = OS;
  const esc = util.escape;
  const $ = (s, el) => (el || document).querySelector(s);
  const G = (n, s) => OS.icon(n, s || 16);                       // line glyphs: chevrons, search
  const ico = (role, s) => window.LOS_sysIconImg(role, s || 20);  // system icons from the icon set
  // what this account may do (OS.user.can, from App\Support\Capabilities): pages and rows it can't use aren't shown,
  // and the server refuses them anyway. An older server without "can" means everything, as before.
  const can = (k) => !!OS.user && (!OS.user.can || !!OS.user.can[k]);
  const isAdmin = () => !!OS.user && (OS.user.can ? !!OS.user.can.admin : OS.user.role === 'admin');
  const roleName = (r) => ({ admin: 'Administrator', local: 'Local account', guest: 'Guest' })[r] || 'Standard user';
  const isGuest = () => !!OS.user && OS.user.role === 'guest';
  const MANAGED = 'Your administrator manages this for your account';
  const st = () => OS.settings;
  const save = (changes) => OS.saveSettings(changes);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  // ------------------------------------------------------------------ the LiteLink device bridge
  const LL = OS.device.api; // window.LiteLink on a LiteLink device, null elsewhere (sdk.js)
  const dev = { ready: !LL, caps: null, err: {} };
  const has = (area) => !!(dev.caps && dev.caps[area]);
  const NO_LITELINK = 'Available when LiteOS runs on a LiteLink device';
  // why a device setting can't be used here ('' when it can)
  function why(area) {
    if (has(area)) return '';
    if (!LL || (dev.ready && !dev.caps)) return NO_LITELINK;
    if (!dev.ready) return 'Connecting to the LiteLink device…';
    return ({
      bluetooth: 'This device has no Bluetooth adapter',
      audio: 'This device has no sound output',
      storage: 'USB drives are turned off for this connection',
      print: 'Printing is turned off for this connection, or not installed on this device',
    })[area] || 'Not available on this device';
  }

  // ------------------------------------------------------------------ pages
  // [id, title, icon role, subtitle on its parent page]; a page's parent is its id up to the last "/"
  const PAGE_LIST = [
    ['home', 'Home', 'settings.home'],
    ['system', 'System', 'settings.display'],
    ['system/display', 'Display', 'settings.display', 'Brightness, night light, text size, resolution'],
    ['system/sound', 'Sound', 'settings.sound', 'Volume levels, output, input, sound devices'],
    ['system/notifications', 'Notifications', 'settings.notifications', 'Alerts from apps and the system, do not disturb'],
    ['system/power', 'Power', 'settings.power', 'Lock, sign out, restart, shut down'],
    ['system/storage', 'Storage', 'settings.storage', 'Storage space, Trash, USB drives'],
    ['system/about', 'About', 'settings.about', 'Device specifications, rename this computer, LiteOS version'],
    ['bluetooth', 'Bluetooth & devices', 'settings.bluetooth'],
    ['bluetooth/devices', 'Devices', 'settings.bluetooth', 'Bluetooth devices: pair, connect, remove'],
    ['bluetooth/usb', 'USB drives', 'settings.usb', 'Drives plugged into this device'],
    ['bluetooth/printers', 'Printers', 'device.printer', 'This device’s printers, your documents printing'],
    ['bluetooth/mouse', 'Mouse', 'settings.mouse', 'Pointer size'],
    ['network', 'Network & internet', 'settings.network'],
    ['network/wifi', 'Wi-Fi', 'settings.wifi', 'Networks in range'],
    ['network/ethernet', 'Ethernet', 'settings.ethernet', 'Address, gateway, DNS'],
    ['network/vpn', 'VPN', 'settings.vpn', 'VPN connections'],
    ['personalisation', 'Personalisation', 'settings.personalisation'],
    ['personalisation/background', 'Background', 'settings.wallpaper', 'Background picture, fit'],
    ['personalisation/colours', 'Colours', 'settings.colour', 'Light or dark mode, accent colour, transparency'],
    ['personalisation/taskbar', 'Taskbar', 'settings.taskbar', 'Dock or taskbar, behaviours, pinned apps'],
    ['personalisation/desktop', 'Desktop icons', 'device.computer', 'Which icons are on the desktop, icon size'],
    ['apps', 'Apps', 'settings.apps'],
    ['apps/installed', 'Installed apps', 'settings.apps', 'Open, pin and find your apps'],
    ['apps/defaults', 'Default apps', 'settings.default-apps', 'Which app opens each kind of file'],
    ['apps/browser', 'Browser', 'app.browser', 'Home page'],
    ['accounts', 'Accounts', 'settings.accounts'],
    ['accounts/info', 'Your info', 'settings.user', 'Display name, account type'],
    ['accounts/signin', 'Sign-in options', 'status.password', 'Password'],
    ['accounts/users', 'Other users', 'settings.accounts', 'Add, edit or remove people who sign in here'],
    ['time', 'Time & language', 'settings.time'],
    ['time/datetime', 'Date & time', 'settings.time', 'Time zone, clock format'],
    ['time/language', 'Language & region', 'settings.language', 'Display language, regional format'],
    ['time/typing', 'Typing', 'settings.keyboard', 'Keyboard layout'],
    ['accessibility', 'Accessibility', 'settings.accessibility'],
    ['accessibility/text', 'Text size', 'settings.font', 'Size of text and controls in apps'],
    ['accessibility/effects', 'Visual effects', 'settings.personalisation', 'Transparency, animations, notification timeout'],
    ['accessibility/pointer', 'Mouse pointer', 'settings.mouse', 'Pointer size'],
    ['accessibility/caret', 'Text cursor', 'settings.keyboard', 'Colour of the text cursor'],
    ['accessibility/filters', 'Colour filters', 'settings.colour', 'Greyscale and inverted colours'],
    ['accessibility/contrast', 'Contrast themes', 'settings.personalisation', 'High-contrast colours for low vision'],
    ['accessibility/audio', 'Audio', 'settings.sound', 'Notification sounds, flash the screen'],
    ['accessibility/captions', 'Captions', 'settings.accessibility', 'Caption size in videos'],
    ['accessibility/keyboard', 'Keyboard', 'settings.keyboard', 'Focus outline, shortcuts'],
  ];
  const PAGES = Object.fromEntries(PAGE_LIST.map(([id, title, icon, sub]) => [id, { id, title, icon, sub }]));
  const parentOf = (id) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : null);
  const NAV = ['home', 'system', 'bluetooth', 'network', 'personalisation', 'apps', 'accounts', 'time', 'accessibility'];
  // pages that need a capability; a page's subpages need it too (network covers network/wifi)
  const NEEDS = { 'accounts/users': 'admin', network: 'settingsDevice', 'bluetooth/devices': 'settingsDevice', 'bluetooth/printers': 'settingsDevice',
    'time/typing': 'settingsDevice', 'bluetooth/usb': 'usb', 'apps/browser': 'web', 'system/storage': 'files' };
  function allowed(id) {
    if (isGuest() && id === 'accounts/signin') return false;
    for (let p = id; p; p = parentOf(p)) if (NEEDS[p] && !can(NEEDS[p])) return false;
    return true;
  }

  // older section names (other apps and the shell open Settings with these)
  const OLD = { personalisation: 'personalisation', taskbar: 'personalisation/taskbar', apps: 'apps', notifications: 'system/notifications',
    storage: 'system/storage', accessibility: 'accessibility', account: 'accounts', users: 'accounts/users', system: 'system/about', about: 'system/about' };
  function startPage() {
    if (OS.args.focus === 'desktop') return 'personalisation/desktop';
    const a = OS.args.page || OLD[OS.args.section] || OS.args.section;
    return PAGES[a] && allowed(a) ? a : 'home';
  }

  // inside the desktop, the page is see-through over the window's Mica (settings.css)
  if (OS.inShell) document.documentElement.classList.add('in-shell');

  let page = startPage();
  const history = [];
  const openExp = new Set();
  const data = {};   // loaded per page: usage, trash, users, system; device: net, audio, bt, disp, input, time, info, drives, wifi

  // ------------------------------------------------------------------ building blocks
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const avatar = (u, size) => '<span class="avatar" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.38) + 'px;background:' + esc(u.color || '#2F6FD6') + '">' + esc(initials(u.name)) + '</span>';
  function wallCss(id) {
    if (id && id.startsWith('file:')) return 'url("' + OS.fs.rawUrl(id.slice(5)) + '") center/cover no-repeat';
    const w = window.LOS_WALLPAPERS.find((x) => x.id === id) || window.LOS_WALLPAPERS[0];
    return w.css;
  }

  /** One setting row. o: { icon, title, sub, ctl, go (a page id), act, off (why it can't be used), attrs, cls, dev (changes
   *  the device itself: left out for accounts without settingsDevice) }. Returns '' for a row the account can't use. */
  function row(o) {
    if ((o.go && !allowed(o.go)) || (!can('settingsDevice') && (o.dev || o.act === 'll-settings'))) return '';
    const link = !!(o.go || o.act);
    const tag = link ? 'button' : 'div';
    const off = o.off || '';
    const sub = off || o.sub || '';
    return '<' + tag + ' class="st-row' + (link ? ' link' : '') + (off ? ' off' : '') + (o.cls ? ' ' + o.cls : '') + '"' +
      (o.go ? ' data-go="' + o.go + '"' : '') + (o.act ? ' data-act="' + o.act + '"' : '') + (o.attrs || '') +
      (off ? (link ? ' disabled' : '') + ' aria-disabled="true"' : '') + '>' +
      (o.icon ? '<span class="st-ic">' + ico(o.icon) + '</span>' : '') +
      '<span class="st-tx"><b>' + o.title + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span>' +
      (o.ctl != null && o.ctl !== '' ? '<span class="st-ctl">' + o.ctl + '</span>' : '') +
      (o.go ? '<span class="st-chev">' + G('forward', 16) + '</span>' : '') + '</' + tag + '>';
  }
  /** A row that opens a page, with the page's own icon and subtitle. */
  const goRow = (id, extra) => row(Object.assign({ go: id, icon: PAGES[id].icon, title: PAGES[id].title, sub: PAGES[id].sub }, extra || {}));
  const rows = (...r) => '<div class="st-rows">' + r.join('') + '</div>';
  const h = (t) => '<h2 class="st-h">' + t + '</h2>';
  /** Toggle with its On/Off label, as Windows shows it. */
  const sw = (on, attrs, label, dis) => '<span class="st-tog"><span>' + (on ? 'On' : 'Off') + '</span><button class="switch" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"' + attrs + ' aria-label="' + esc(label) + '"' + (dis ? ' disabled' : '') + '></button></span>';
  /** A row with a toggle for one of the user's settings (invert: the toggle shows the opposite, "Animation effects"). */
  const tog = (key, title, sub, o) => {
    const v = !!st()[key];
    return row(Object.assign({ title, sub, ctl: sw((o && o.invert) ? !v : v, ' data-toggle="' + key + '"', title) }, o || {}));
  };
  /** Combo box (Windows' drop-down): a button that opens a flyout of choices over itself (openCombo). attrs carries
   *  data-set="key" (a user setting), data-dev="…" (a device setting) or data-name="field" (a form field, kept in a
   *  hidden input of that name). */
  function sel(attrs, opts, val, dis) {
    const cur = opts.find(([v]) => String(v) === String(val)) || opts[0] || ['', ''];
    const name = /data-name="([^"]+)"/.exec(attrs);
    return '<button type="button" class="st-combo"' + attrs + ' data-value="' + esc(cur[0]) + '" data-options="' + esc(JSON.stringify(opts)) + '"' +
      ' aria-haspopup="listbox" aria-expanded="false"' + (dis ? ' disabled' : '') + '><span>' + esc(cur[1]) + '</span>' + G('down', 14) + '</button>' +
      (name ? '<input type="hidden" name="' + name[1] + '" value="' + esc(cur[0]) + '">' : '');
  }
  const choose = (key, title, sub, opts, o) => row(Object.assign({ title, sub, ctl: sel(' data-set="' + key + '" aria-label="' + esc(title) + '"', opts, st()[key]) }, o || {}));
  const slider = (attrs, min, max, val, label, dis) => '<span class="st-slide"><input type="range" class="st-range"' + attrs + ' min="' + min + '" max="' + max + '" value="' + val + '" aria-label="' + esc(label) + '"' + (dis ? ' disabled' : '') + '><span class="st-num">' + val + '</span></span>';
  /** Expander: a row that opens to show more rows under it. */
  function exp(id, o, body) {
    const open = openExp.has(id) && !o.off;
    return '<div class="st-exp' + (open ? ' open' : '') + '">' +
      row(Object.assign({}, o, { act: null, go: null, attrs: ' data-exp="' + id + '" aria-expanded="' + open + '"' + (o.off ? ' disabled' : ''), cls: 'link exp-head', ctl: (o.ctl || '') + '<span class="st-chev st-down">' + G('down', 16) + '</span>' })).replace(/^<div/, '<button').replace(/<\/div>$/, '</button>') +
      (open ? '<div class="st-exp-body">' + body + '</div>' : '') + '</div>';
  }
  /** A row inside an expander. */
  const sub = (title, hint, ctl, off) => '<div class="st-sub' + (off ? ' off' : '') + '"><span class="st-tx"><b>' + title + '</b>' + (off || hint ? '<small>' + (off || hint) + '</small>' : '') + '</span>' + (ctl ? '<span class="st-ctl">' + ctl + '</span>' : '') + '</div>';
  /** Information bar at the top of a page. */
  const info = (text, btn) => '<div class="st-info">' + ico('status.info', 16) + '<span class="grow">' + text + '</span>' + (btn || '') + '</div>';
  const bridgeInfo = (areas) => (LL && dev.caps ? '' : areas.some((a) => !has(a)) && (!LL || dev.ready)
    ? info('Some of these settings are available only when LiteOS runs on a LiteLink device.') : '');
  const kv = (pairs) => '<dl class="st-kv">' + pairs.filter(Boolean).map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl>';

  function header(id) {
    const chain = [];
    for (let p = id; p; p = parentOf(p)) chain.unshift(p);
    return '<h1 class="st-title">' + chain.map((p, i) => (i < chain.length - 1
      ? '<button class="st-crumb" data-go="' + p + '">' + esc(PAGES[p].title) + '</button><span class="st-sep">' + G('forward', 18) + '</span>'
      : '<span class="st-cur">' + esc(PAGES[p].title) + '</span>')).join('') + '</h1>';
  }

  // the computer: its picture, name and model (Home and System)
  function hero() {
    const name = OS.system.instanceName || 'LiteOS';
    const model = data.info ? data.info.device : '';
    return '<div class="st-hero"><span class="st-thumb" style="background:' + esc(wallCss(st().wallpaper)) + '"></span>' +
      '<span class="st-hero-tx"><b>' + esc(name) + '</b><span>' + esc(model || (LL ? '' : 'LiteOS ' + (OS.system.version || ''))) + '</span>' +
      (isAdmin() ? '<button class="st-link" data-act="rename">Rename</button>' : '') + '</span>' +
      '<span class="st-hero-status">' + netStatus() + storageStatus() + '</span></div>';
  }
  function netStatus() {
    if (!has('network') || !data.net) return '';
    const n = data.net;
    const wifi = n.kind === 'wifi';
    if (!allowed('network')) return '';
    return '<button class="st-stat" data-go="network">' + ico(wifi ? 'settings.wifi' : 'settings.ethernet', 24) +
      '<span><b>' + esc(wifi ? (n.wifi && n.wifi.network) || 'Wi-Fi' : n.kind === 'ethernet' ? 'Ethernet' : 'Network') + '</b>' +
      '<small>' + (n.connected ? 'Connected' : 'Not connected') + '</small></span></button>';
  }
  function storageStatus() {
    const u = data.usage;
    if (!u) return '';
    return '<button class="st-stat" data-go="system/storage">' + ico('settings.storage', 24) +
      '<span><b>My drive</b><small>' + util.formatSize(Math.max(0, u.quota - u.used)) + ' free</small></span></button>';
  }
  const meter = (used, total) => {
    const pct = total ? Math.min(100, (used / total) * 100) : 0;
    return '<span class="st-meter"><i style="width:' + pct.toFixed(1) + '%' + (pct > 90 ? ';background:var(--danger)' : '') + '"></i></span>';
  };

  // ------------------------------------------------------------------ page views
  const views = {
    home() {
      const s = st();
      const u = data.usage;
      const net = data.net;
      const offNet = why('network');
      const wifiOn = net && net.wifi && net.wifi.present && net.wifi.enabled;
      const vpns = (net && net.vpn) || [];
      const bt = data.bt;
      const offBt = why('bluetooth');
      const card = (title, subText, body, cls) => '<section class="st-card' + (cls ? ' ' + cls : '') + '"><div class="st-card-h"><h2>' + title + '</h2>' + (subText ? '<small>' + subText + '</small>' : '') + '</div>' + body + '</section>';
      const recommended = card('Recommended settings', 'Recent and commonly used settings',
        row({ icon: 'settings.wifi', title: 'Wi-Fi', go: 'network/wifi', off: offNet, ctl: net ? (wifiOn ? 'On' : 'Off') : '' }) +
        row({ icon: 'settings.ethernet', title: 'Ethernet', go: 'network/ethernet', off: offNet, ctl: net && net.kind === 'ethernet' ? 'Connected' : '' }) +
        row({ icon: 'settings.vpn', title: 'VPN', go: 'network/vpn', off: offNet, ctl: vpns.some((v) => v.active) ? 'Connected' : '' }) +
        tog('nightLight', 'Night light', '', { icon: 'settings.display' }));
      const spec = (k, v, off) => '<div' + (off ? ' class="off" title="' + esc(off) + '"' : '') + '><b>' + k + '</b><span>' + v + '</span></div>';
      const offSys = why('system');
      const devInfo = card('Device info', '',
        '<div class="st-specs">' +
        spec('Processor', esc(data.info ? data.info.processor : offSys ? 'Not available here' : 'Loading…'), offSys) +
        spec('Installed RAM', esc(data.info && data.info.memory ? util.formatSize(data.info.memory) : offSys ? 'Not available here' : 'Loading…'), offSys) +
        (can('files') ? spec('Storage', u ? esc(util.formatSize(u.used) + ' of ' + util.formatSize(u.quota) + ' used') : 'Loading…') : '') +
        spec('Screen', window.screen.width + ' × ' + window.screen.height) + '</div>' +
        row({ title: 'About your device', go: 'system/about' }));
      const btCard = card('Bluetooth devices', 'Manage, add and remove devices',
        row({ icon: 'settings.bluetooth', title: 'Bluetooth', sub: bt ? (bt.powered ? 'Discoverable' : 'Bluetooth is turned off') : '', off: offBt,
          ctl: sw(!!(bt && bt.powered), ' data-dev="bt-power"', 'Bluetooth', !!offBt || !bt) }) +
        row({ title: 'View all devices', off: offBt, ctl: '<button class="btn" data-act="bt-add"' + (offBt ? ' disabled' : '') + '>Add device</button>' }).replace('<div class="st-row', '<div data-go-row="bluetooth/devices" class="st-row'));
      const walls = window.LOS_WALLPAPERS.slice(0, 6);
      const theme = card('Personalise your device', '',
        '<div class="st-walls home">' + walls.map((w) => '<button class="st-wall' + (s.wallpaper === w.id ? ' on' : '') + '" data-wall="' + w.id + '" aria-label="' + esc(w.name) + '" style="background:' + esc(w.css) + '"></button>').join('') + '</div>' +
        row({ icon: 'settings.colour', title: 'Colour mode', ctl: sel(' data-set="theme" aria-label="Colour mode"', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Automatic']], s.theme) }) +
        row({ title: 'Browse more backgrounds, colours and themes', go: 'personalisation' }));
      const device = can('settingsDevice');
      return hero() + (device ? bridgeInfo(['network', 'bluetooth', 'system']) : '') +
        '<div class="st-home"><div class="st-col">' + recommended + devInfo + '</div><div class="st-col">' + (device ? btCard : '') + theme + '</div></div>';
    },

    // ---------------------------------------------------------------- System
    system() {
      return hero() + rows(goRow('system/display'), goRow('system/sound'), goRow('system/notifications'), goRow('system/power'), goRow('system/storage'), goRow('system/about'));
    },

    'system/display'() {
      const s = st();
      const off = why('display');
      const disp = data.disp || [];
      const main = disp[0];
      const modes = main ? main.modes.map((m) => [m, m.replace('x', ' × ') + (m === main.preferred ? ' (Recommended)' : '')]) : [['', '—']];
      return (can('settingsDevice') ? bridgeInfo(['display']) : '') +
        h('Brightness & colour') +
        rows(row({ icon: 'settings.display', title: 'Brightness', sub: 'Dims the screen inside LiteOS', ctl: slider(' data-range="brightness"', 20, 100, s.brightness == null ? 100 : s.brightness, 'Brightness') }),
          tog('nightLight', 'Night light', 'Use warmer colours to help block blue light', { icon: 'settings.colour' })) +
        h('Scale & layout') +
        rows(choose('textSize', 'Text size', 'Size of text and controls in apps', [['default', 'Default'], ['large', 'Large'], ['larger', 'Larger']], { icon: 'settings.font' }),
          row({ icon: 'settings.display', title: 'Display resolution', sub: off ? '' : 'Adjust the resolution to fit your connected display', off, dev: true,
            ctl: sel(' data-dev="resolution" aria-label="Display resolution"', modes, main ? main.current : '', !!off || !main) })) +
        (disp.length > 1 ? h('Multiple displays') + rows(...disp.map((d) => row({ icon: 'device.display', title: esc(d.output), sub: esc(d.current.replace('x', ' × ') + (d.rate ? ' at ' + d.rate + ' Hz' : '')) }))) : '') +
        (can('settingsDevice') ? h('Related settings') +
        rows(row({ icon: 'settings.display', title: 'Advanced display', sub: 'Screens and resolutions in LiteLink’s Settings', act: 'll-settings', attrs: ' data-page="display"', off: why('session') })) : '');
    },

    'system/sound'() {
      const s = st();
      const off = why('audio');
      const a = data.audio;
      const outs = a ? a.outputs.map((o) => [o.id, o.name]) : [['', '—']];
      const ins = a && a.input && a.input.devices ? a.input.devices.map((o) => [o.id, o.name]) : [];
      return bridgeInfo(['audio']) +
        h('Output') +
        rows(row({ icon: 'device.headphones', title: 'Choose where to play sound', sub: off ? '' : 'Speakers or headphones on this device', off,
            ctl: sel(' data-dev="output" aria-label="Output device"', outs, a && a.output ? a.output.id : '', !!off || !a) }),
          row({ icon: 'settings.sound', title: 'Volume', off, ctl: slider(' data-dev-range="volume"', 0, 100, a ? a.volume : 0, 'Volume', !!off || !a) +
            sw(!!(a && !a.muted), ' data-dev="mute"', 'Sound on', !!off || !a) })) +
        h('Input') +
        rows(row({ icon: 'device.camera', title: 'Choose a device for speaking or recording', off: off || (a && !ins.length ? 'No microphone on this device' : ''),
            ctl: sel(' data-dev="input" aria-label="Input device"', ins.length ? ins : [['', '—']], a && a.input && a.input.device ? a.input.device.id : '', !!off || !ins.length) }),
          row({ icon: 'settings.sound', title: 'Input volume', off: off || (a && !ins.length ? 'No microphone on this device' : ''),
            ctl: slider(' data-dev-range="inputVolume"', 0, 100, a && a.input ? a.input.volume : 0, 'Input volume', !!off || !ins.length) })) +
        h('Advanced') +
        rows(row({ icon: 'app.media', title: 'LiteOS apps', sub: 'Volume for audio and video played in LiteOS apps', ctl: slider(' data-range="volume"', 0, 100, s.volume == null ? 80 : s.volume, 'LiteOS apps volume') +
            sw(!s.muted, ' data-toggle="muted"', 'LiteOS apps sound') }),
          tog('notifySound', 'Notification sounds', 'Play a short chime when a notification arrives', { icon: 'settings.notifications' }),
          row({ icon: 'settings.sound', title: 'More sound settings', sub: 'Sound devices in LiteLink’s Settings', act: 'll-settings', attrs: ' data-page="sound"', off: why('session') }));
    },

    'system/notifications'() {
      return rows(tog('dnd', 'Do not disturb', 'Hide notifications. Errors still show.', { icon: 'settings.notifications' }),
          choose('notifyTimeout', 'Dismiss notifications after this amount of time', '', [['5', '5 seconds'], ['10', '10 seconds'], ['20', '20 seconds'], ['30', '30 seconds']], { icon: 'settings.recent' }),
          tog('notifySound', 'Play a sound when a notification arrives', '', { icon: 'settings.sound' }),
          tog('flashOnNotify', 'Flash the screen when a notification arrives', 'Useful when sound is off or hard to hear', { icon: 'settings.display' })) +
        h('Try it') +
        rows(row({ icon: 'shell.notifications', title: 'Send a test notification', sub: 'See how notifications look', ctl: '<button class="btn" data-act="test-notify">Send</button>' }));
    },

    'system/power'() {
      const off = why('power');
      return bridgeInfo(['power']) +
        h('This session') +
        rows(can('lock') ? row({ icon: 'shell.lock', title: 'Lock', sub: 'Your windows stay open; sign in again to come back', ctl: '<button class="btn" data-act="lock">Lock</button>' }) : '',
          row({ icon: 'shell.logout', title: 'Sign out', sub: 'Closes your apps and returns to the sign-in screen', ctl: '<button class="btn" data-act="sign-out">Sign out</button>' })) +
        h('This device') +
        rows(row({ icon: 'shell.restart', title: 'Restart', sub: 'Restarts the LiteLink device', off, dev: true, ctl: '<button class="btn" data-act="restart"' + (off ? ' disabled' : '') + '>Restart</button>' }),
          row({ icon: 'shell.shutdown', title: 'Shut down', sub: 'Turns the LiteLink device off', off, dev: true, ctl: '<button class="btn" data-act="shutdown"' + (off ? ' disabled' : '') + '>Shut down</button>' }),
          row({ icon: 'device.computer', title: 'End session', sub: 'Leaves LiteOS and goes back to LiteLink', off: why('session'), ctl: '<button class="btn" data-act="end-session"' + (why('session') ? ' disabled' : '') + '>End session</button>' }));
    },

    'system/storage'() {
      const u = data.usage;
      const t = data.trash;
      const trashSize = t ? t.reduce((a, x) => a + (x.size || 0), 0) : 0;
      const offUsb = why('storage');
      const drives = data.drives || [];
      return '<div class="st-usage"><div class="row"><b class="grow">My drive</b><span class="hint">' + (u ? util.formatSize(u.used) + ' used of ' + util.formatSize(u.quota) : 'Loading…') + '</span></div>' +
          meter(u ? u.used : 0, u ? u.quota : 0) +
          '<span class="hint">' + (u ? util.formatSize(Math.max(0, u.quota - u.used)) + ' free.' : '') + (isAdmin() || !u ? '' : ' Ask an administrator if you need more space.') + '</span></div>' +
        h('Storage management') +
        rows(row({ icon: 'place.trash', title: 'Trash', sub: t ? plural(t.length, 'item') + ' · ' + util.formatSize(trashSize) : 'Loading…',
            ctl: '<button class="btn" data-act="open-trash">Open</button><button class="btn" data-act="empty-trash"' + (t && t.length ? '' : ' disabled') + '>Empty Trash</button>' }),
          row({ icon: 'app.files', title: 'Files', sub: 'Browse and manage everything on your drive', ctl: '<button class="btn" data-launch="files">Open Files</button>' })) +
        (can('usb') ? h('USB drives') +
        rows(...(offUsb ? [row({ icon: 'settings.usb', title: 'USB drives', off: offUsb })]
          : drives.length ? drives.map(usbRow) : [row({ icon: 'settings.usb', title: 'No USB drives', sub: 'Plug a USB drive into this device to see it here' })])) : '');
    },

    'system/about'() {
      const x = data.system;
      const i = data.info;
      const ua = navigator.userAgent;
      const browser = (/(Edg|Chrome|Firefox|Version)\/(\d+)/.exec(ua) || []);
      const browserName = browser[1] ? ({ Edg: 'Microsoft Edge', Chrome: 'Chromium', Firefox: 'Firefox', Version: 'Safari' })[browser[1]] + ' ' + browser[2] : 'Web browser';
      const name = OS.system.instanceName || 'LiteOS';
      return '<div class="st-hero small">' + ico('device.computer', 48) + '<span class="st-hero-tx"><b>' + esc(name) + '</b><span>' + esc(i ? i.device : 'LiteOS ' + (OS.system.version || '')) + '</span></span>' +
          (isAdmin() ? '<button class="btn" data-act="rename">Rename this computer</button>' : '') + '</div>' +
        exp('about-device', { icon: 'device.computer', title: 'Device specifications' },
          '<div class="st-sub col"><span class="st-copy"><button class="btn" data-act="copy-specs">Copy</button></span>' + kv([
            ['Device name', esc(name)],
            ['Device', i ? esc(i.device) : '<span class="hint">' + (i === undefined && has('system') ? 'Loading…' : NO_LITELINK) + '</span>'],
            i && ['Processor', esc(i.processor)],
            i && ['Installed RAM', esc(util.formatSize(i.memory))],
            i && ['IP address', esc(i.ip || '—')],
            ['Screen', window.screen.width + ' × ' + window.screen.height],
            ['Browser', esc(browserName)],
          ]) + '</div>') +
        exp('about-liteos', { icon: 'app.settings', title: 'LiteOS specifications' },
          kv([
            ['Edition', 'LiteOS'],
            ['Version', esc(OS.system.version || (x && x.version) || '—')],
            x && ['PHP', esc(x.php)],
            x && ['Largest upload', esc(x.uploadMax)],
            x && ['Accounts', esc(x.userCount)],
            x && ['Set up', x.createdAt ? esc(new Date(x.createdAt).toLocaleString()) : '—'],
          ])) +
        (i ? exp('about-litelink', { icon: 'settings.system', title: 'LiteLink specifications' },
          kv([['System', esc(i.os)], ['Build', esc(i.build || '—')], ['Host name', esc(i.hostname || '—')], ['MAC address', esc(i.mac || '—')]])) : '') +
        h('Related') +
        rows(goRow('system/storage'), row({ icon: 'settings.system', title: 'LiteLink settings', sub: 'Device settings, behind the LiteLink admin password', act: 'll-settings', attrs: ' data-page="about"', off: why('session') }));
    },

    // ---------------------------------------------------------------- Bluetooth & devices
    bluetooth() {
      const off = why('bluetooth');
      const bt = data.bt;
      const paired = bt ? bt.devices : [];
      const device = can('settingsDevice');
      return (device ? bridgeInfo(['bluetooth', 'storage']) +
        '<div class="st-devhead' + (off ? ' off' : '') + '">' +
        '<button class="st-addtile" data-act="bt-add"' + (off ? ' disabled' : '') + '><span class="plus">' + G('plus', 22) + '</span><span>Add device</span></button>' +
        paired.slice(0, 3).map((d) => '<span class="st-devtile">' + ico(btIcon(d), 40) + '<b>' + esc(d.name) + '</b><small>' + (d.connected ? 'Connected' : 'Paired') + '</small></span>').join('') + '</div>' : '') +
        rows(row({ icon: 'settings.bluetooth', title: 'Bluetooth', sub: bt ? (bt.powered ? 'Discoverable as “' + esc((data.info && data.info.hostname) || 'LiteLink') + '”' : 'Off') : '', off, dev: true,
            ctl: sw(!!(bt && bt.powered), ' data-dev="bt-power"', 'Bluetooth', !!off || !bt) }),
          goRow('bluetooth/devices', { off, ctl: bt ? plural(paired.length, 'device') : '' }),
          goRow('bluetooth/usb', { off: why('storage') }),
          goRow('bluetooth/printers', { off: why('print') }),
          goRow('bluetooth/mouse'),
          row({ go: 'time/typing', icon: 'settings.keyboard', title: 'Keyboard', sub: 'Keyboard layout' }));
    },

    'bluetooth/devices'() {
      const off = why('bluetooth');
      const bt = data.bt;
      return bridgeInfo(['bluetooth']) +
        rows(row({ icon: 'settings.bluetooth', title: 'Add a device', sub: 'Pair a headset, keyboard, mouse or speaker', off, ctl: '<button class="btn btn-primary" data-act="bt-add"' + (off ? ' disabled' : '') + '>Add device</button>' })) +
        h('Paired devices') +
        (off ? rows(row({ icon: 'settings.bluetooth', title: 'Bluetooth devices', off }))
          : !bt ? rows(row({ title: 'Loading…' }))
            : bt.devices.length ? rows(...bt.devices.map((d) => row({ icon: btIcon(d), title: esc(d.name), sub: d.connected ? 'Connected' : 'Paired',
              ctl: '<button class="btn" data-bt-connect="' + esc(d.mac) + '" data-on="' + (d.connected ? '0' : '1') + '">' + (d.connected ? 'Disconnect' : 'Connect') + '</button>' +
                '<button class="icon-btn" data-bt-more="' + esc(d.mac) + '" aria-label="More for ' + esc(d.name) + '">' + G('more') + '</button>' })))
              : rows(row({ title: 'No paired devices', sub: 'Turn on the device and put it in pairing mode, then choose Add device.' })));
    },

    'bluetooth/usb'() {
      const off = why('storage');
      const drives = data.drives;
      return bridgeInfo(['storage']) +
        (off ? rows(row({ icon: 'settings.usb', title: 'USB drives', off }))
          : !drives ? rows(row({ title: 'Loading…' }))
            : drives.length ? rows(...drives.map(usbRow)) : rows(row({ icon: 'settings.usb', title: 'No USB drives', sub: 'Plug a USB drive into this device to see it here' }))) +
        (has('storage') ? '<p class="st-note">' + (dev.caps.storage.usb === 'write' ? 'Files can be copied to and from these drives in Files.' : 'These drives can be read; this connection doesn’t allow writing to them.') + '</p>' : '');
    },

    // the device's printers (set up in LiteLink's own Settings) and this user's documents still printing
    'bluetooth/printers'() {
      const off = why('print');
      const printers = data.printers;
      const jobs = data.printJobs || [];
      const STATE = { idle: 'Ready', printing: 'Printing', stopped: 'Stopped', pending: 'Waiting' };
      const pRow = (p) => row({ icon: 'device.printer', title: esc(p.name),
        sub: esc((p.kind === 'usb' ? 'USB' : 'Network') + ' · ' + (p.state === 'stopped' && p.message ? p.message : STATE[p.state] || p.state) +
          (p.duplex ? ' · Two-sided' : '') + (p.color ? ' · Colour' : '')),
        // more options (print a test page, details, remove) in a menu
        ctl: (p.default ? '<span class="hint">Used last</span>' : '') +
          '<button class="icon-btn" data-print-more="' + esc(p.id) + '" aria-label="More for ' + esc(p.name) + '" title="More options">' + G('moreV') + '</button>' });
      return bridgeInfo(['print']) +
        rows(row({ icon: 'device.printer', title: 'Add a printer', sub: 'A printer plugged in by USB or on the network', off,
          ctl: '<button class="btn btn-primary" data-act="print-add"' + (off ? ' disabled' : '') + '>Add printer</button>' })) +
        h('Printers') +
        (off ? rows(row({ icon: 'device.printer', title: 'Printers', off }))
          : !printers ? rows(row({ title: 'Loading…' }))
            : printers.length ? rows(...printers.map(pRow)) : rows(row({ icon: 'device.printer', title: 'No printers', sub: 'Add one above, or in LiteLink’s own Settings' }))) +
        (has('print') ? rows(row({ icon: 'settings.system', title: 'Printer settings', sub: 'Printers in LiteLink’s Settings', act: 'll-settings', attrs: ' data-page="printers"', off: why('session') })) : '') +
        (has('print') ? h('Your documents') + (jobs.length
          ? rows(...jobs.map((j) => row({ icon: 'device.printer', title: esc(j.title), sub: esc(j.printer + ' · ' + (j.state === 'stopped' && j.message ? j.message : STATE[j.state] || j.state)),
            ctl: '<button class="btn" data-print-cancel="' + esc(j.job) + '">Cancel</button>' })))
          : rows(row({ title: 'Nothing printing', sub: 'Documents you print from LiteOS show here until they’re done' }))) +
          '<p class="st-note">Only your own documents are shown; others using this device see theirs.</p>' : '');
    },

    'bluetooth/mouse'() {
      return rows(choose('cursorSize', 'Mouse pointer size', '', [['default', 'Default'], ['large', 'Large'], ['larger', 'Larger']], { icon: 'settings.mouse' })) +
        h('Related settings') + rows(row({ go: 'accessibility/caret', icon: 'settings.keyboard', title: 'Text cursor', sub: 'Colour of the text cursor' }));
    },

    // ---------------------------------------------------------------- Network & internet
    network() {
      const off = why('network');
      const n = data.net;
      const wifi = n && n.kind === 'wifi';
      const vpns = (n && n.vpn) || [];
      return bridgeInfo(['network']) +
        '<div class="st-nethead' + (off ? ' off' : '') + '">' + ico(wifi ? 'settings.wifi' : 'settings.ethernet', 40) +
        '<span class="st-hero-tx"><b>' + (n ? esc(wifi ? (n.wifi && n.wifi.network) || 'Wi-Fi' : n.kind === 'ethernet' ? 'Ethernet' : 'Not connected') : 'Network') + '</b>' +
        '<span>' + (off ? esc(off) : n ? (n.connected ? 'Connected' + (n.ip ? ' · ' + esc(n.ip) : '') : 'No network connection') : 'Loading…') + '</span></span>' +
        '<button class="btn" data-act="ll-settings" data-page="network"' + (why('session') ? ' disabled' : '') + '>Properties</button></div>' +
        (has('network') ? info('LiteLink manages this device’s network. It’s shown here; change it in LiteLink’s Settings.') : '') +
        rows(goRow('network/wifi', { off, ctl: n && n.wifi && n.wifi.present ? (n.wifi.enabled ? 'On' : 'Off') : n ? 'No adapter' : '' }),
          goRow('network/ethernet', { off, ctl: n && n.kind === 'ethernet' ? 'Connected' : '' }),
          goRow('network/vpn', { off, ctl: vpns.length ? plural(vpns.filter((v) => v.active).length, 'connection') + ' on' : '' }),
          row({ icon: 'settings.network-advanced', title: 'Advanced network settings', sub: 'Network adapters and VPN in LiteLink’s Settings', act: 'll-settings', attrs: ' data-page="network"', off: why('session') }));
    },

    'network/wifi'() {
      const off = why('network');
      const n = data.net;
      const list = data.wifi;
      const bars = (sig) => (sig >= 75 ? 'Excellent' : sig >= 50 ? 'Good' : sig >= 25 ? 'Fair' : 'Weak');
      return bridgeInfo(['network']) +
        rows(row({ icon: 'settings.wifi', title: 'Wi-Fi', off: off || (n && n.wifi && !n.wifi.present ? 'This device has no Wi-Fi adapter' : ''),
          ctl: n && n.wifi && n.wifi.present ? '<span class="hint">' + (n.wifi.enabled ? 'On' : 'Off') + '</span>' : '' })) +
        (off ? '' : h('Networks in range') +
          (!list ? rows(row({ title: 'Looking for networks…' }))
            : list.length ? rows(...list.map((w) => row({ icon: 'settings.wifi', title: esc(w.ssid || 'Hidden network'), sub: (w.active ? 'Connected · ' : '') + (w.security ? 'Secured' : 'Open') + ' · ' + bars(w.signal) + ' signal' })))
              : rows(row({ title: 'No networks found' }))) +
          rows(row({ icon: 'settings.wifi', title: 'Join or forget a network', sub: 'Wi-Fi networks are managed in LiteLink’s Settings', act: 'll-settings', attrs: ' data-page="network"', off: why('session') })));
    },

    'network/ethernet'() {
      const off = why('network');
      const n = data.net;
      return bridgeInfo(['network']) +
        (off ? rows(row({ icon: 'settings.ethernet', title: 'Ethernet', off }))
          : !n ? rows(row({ title: 'Loading…' }))
            : rows(row({ icon: 'settings.ethernet', title: n.kind === 'ethernet' ? 'Connected' : 'Not in use', sub: n.kind === 'ethernet' ? esc(n.name || 'Ethernet') : 'This device is using ' + (n.kind === 'wifi' ? 'Wi-Fi' : 'no network') })) +
              (n.kind === 'ethernet' || n.ip ? h('Properties') + '<div class="st-panel">' + kv([['IPv4 address', esc(n.ip || '—')], ['Gateway', esc(n.gateway || '—')], ['DNS server', esc(n.dns || '—')], ['Physical address (MAC)', esc(n.mac || '—')]]) + '</div>' : ''));
    },

    'network/vpn'() {
      const off = why('network');
      const n = data.net;
      const vpns = (n && n.vpn) || [];
      return bridgeInfo(['network']) +
        (off ? rows(row({ icon: 'settings.vpn', title: 'VPN connections', off }))
          : !n ? rows(row({ title: 'Loading…' }))
            : vpns.length ? rows(...vpns.map((v) => row({ icon: 'settings.vpn', title: esc(v.name), sub: v.active ? 'Connected' : 'Not connected' })))
              : rows(row({ icon: 'settings.vpn', title: 'No VPN connections', sub: 'VPN connections are set up in LiteLink’s Settings' }))) +
        rows(row({ icon: 'settings.vpn', title: 'Manage VPN connections', sub: 'Turning a VPN on or off happens in LiteLink’s Settings', act: 'll-settings', attrs: ' data-page="network"', off: why('session') }));
    },

    // ---------------------------------------------------------------- Personalisation
    personalisation() {
      const s = st();
      const themes = [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Automatic']];
      return '<div class="st-pers">' + preview() +
        '<div class="st-pers-side"><b>Select a theme to apply</b><div class="st-themes">' +
        themes.map(([v, l]) => '<button class="st-theme ' + v + (s.theme === v ? ' on' : '') + '" data-set="theme" data-val="' + v + '" title="' + l + '" aria-label="' + l + '"><span class="st-theme-in" style="background:' + esc(wallCss(s.wallpaper)) + '"><i></i></span></button>').join('') +
        '</div></div></div>' +
        rows(goRow('personalisation/background'), goRow('personalisation/colours'), goRow('personalisation/taskbar'), goRow('personalisation/desktop'),
          row({ go: 'accessibility/contrast', icon: 'settings.personalisation', title: 'Contrast themes', sub: 'High-contrast colours for low vision' }));
    },

    'personalisation/background'() {
      const s = st();
      const fileWall = s.wallpaper && s.wallpaper.startsWith('file:');
      const current = fileWall ? util.basename(s.wallpaper) : (window.LOS_WALLPAPERS.find((w) => w.id === s.wallpaper) || {}).name || '';
      openExp.add('bg-pick');
      return '<div class="st-pers">' + preview() + '</div>' +
        rows(exp('bg-pick', { icon: 'settings.wallpaper', title: 'Personalise your background', sub: 'The picture on your desktop', ctl: '<span class="hint">' + esc(current) + '</span>' },
            '<div class="st-sub col"><span class="st-tx"><b>Pictures</b></span><div class="st-walls">' +
            window.LOS_WALLPAPERS.map((w) => '<button class="st-wall' + (s.wallpaper === w.id ? ' on' : '') + '" data-wall="' + w.id + '" title="' + esc(w.name) + '" aria-label="' + esc(w.name) + '" style="background:' + esc(w.css) + '"></button>').join('') +
            (fileWall ? '<button class="st-wall on" data-wall="' + esc(s.wallpaper) + '" title="Your picture" aria-label="Your picture" style="background:' + esc(wallCss(s.wallpaper)) + '"></button>' : '') + '</div></div>' +
            sub('Choose a photo', 'A picture from your drive', '<button class="btn" data-act="browse-wall">Browse photos</button>')),
          choose('wallpaperFit', 'Choose a fit for your desktop image', '', [['cover', 'Fill'], ['contain', 'Fit'], ['center', 'Centre']], { icon: 'settings.display' }));
    },

    'personalisation/colours'() {
      const s = st();
      const acc = (s.accent || '').toUpperCase();
      return '<div class="st-pers">' + preview() + '</div>' +
        rows(choose('theme', 'Choose your mode', 'Change the colours in LiteOS and your apps', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Automatic']], { icon: 'settings.colour' }),
          tog('transparency', 'Transparency effects', 'Windows and surfaces appear translucent', { icon: 'settings.personalisation' }),
          exp('accent', { icon: 'settings.colour', title: 'Accent colour', sub: 'Buttons, selections and highlights', ctl: '<span class="st-accnow" style="background:' + esc(s.accent) + '"></span>' },
            '<div class="st-sub col"><span class="st-tx"><b>Colours</b></span><div class="st-swatches">' +
            window.LOS_ACCENTS.map(([n, c]) => '<button class="st-swatch' + (acc === c ? ' on' : '') + '" data-accent="' + c + '" title="' + esc(n) + '" aria-label="' + esc(n) + '" style="background:' + c + '"></button>').join('') + '</div></div>' +
            sub('Custom colour', 'Pick any colour', '<input class="st-color" type="color" value="' + esc(s.accent) + '" aria-label="Custom accent colour">')),
          tog('clock24', 'Show time in 24-hour format', 'Show 13:00 instead of 1:00 PM', { icon: 'settings.time' }));
    },

    'personalisation/taskbar'() {
      const s = st();
      const pinned = s.pinned || [];
      const all = window.LOS_APPS;
      const ordered = pinned.map(window.LOS_app).filter(Boolean).concat(all.filter((a) => !pinned.includes(a.id)));
      const floating = s.taskbar !== 'classic';
      return rows(choose('taskbar', 'Taskbar style', floating ? 'A top bar with a centred dock' : 'A full-width bar with Start and the tray', [['floating', 'Floating dock'], ['classic', 'Classic taskbar']], { icon: 'settings.taskbar' })) +
        h('Taskbar items') +
        rows(exp('pinned', { icon: 'settings.apps', title: 'Pinned apps', sub: 'Apps on the taskbar, in order', ctl: '<span class="hint">' + plural(pinned.length, 'app') + '</span>' },
          ordered.map((a) => {
            const on = pinned.includes(a.id);
            const i = pinned.indexOf(a.id);
            return '<div class="st-sub"><img src="' + esc(a.img) + '" alt="" width="24" height="24"><span class="st-tx"><b>' + esc(a.name) + '</b></span><span class="st-ctl">' +
              (on ? '<button class="icon-btn" data-move="' + a.id + '" data-dir="-1" aria-label="Move ' + esc(a.name) + ' earlier"' + (i === 0 ? ' disabled' : '') + '>' + G('up') + '</button>' +
                '<button class="icon-btn" data-move="' + a.id + '" data-dir="1" aria-label="Move ' + esc(a.name) + ' later"' + (i === pinned.length - 1 ? ' disabled' : '') + '>' + G('down') + '</button>' : '') +
              sw(on, ' data-pin="' + a.id + '"', 'Pin ' + a.name) + '</span></div>';
          }).join(''))) +
        h('Taskbar behaviours') +
        rows(choose('iconSize', 'Icon size', 'Larger icons are easier to tap on touch screens', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]),
          tog('autohide', 'Automatically hide the taskbar', 'It shows again when you move the pointer to the bottom edge'),
          floating ? tog('labels', 'Show app names', 'Text labels under each icon') : '',
          floating ? tog('topbar', 'Show the top bar', 'App name, search and clock along the top') : '',
          tog('magnify', 'Lift icons on hover', 'A small motion cue when pointing at an app'));
    },

    'personalisation/desktop'() {
      const s = st();
      const on = s.desktopIcons || [];
      const items = [
        { id: 'files', name: 'This PC', img: window.LOS_hasSysIcon('device.computer') ? window.LOS_sysIcon('device.computer') : window.LOS_app('files').img },
        { id: 'trash', name: 'Trash', img: window.LOS_appIconUrl('trash') },
        { id: 'settings', name: 'Settings', img: window.LOS_app('settings').img },
      ];
      const apps = window.LOS_APPS.filter((a) => a.id !== 'files' && a.id !== 'settings');
      const item = (it) => '<div class="st-sub"><img src="' + esc(it.img) + '" alt="" width="24" height="24"><span class="st-tx"><b>' + esc(it.name) + '</b></span><span class="st-ctl">' +
        sw(on.includes(it.id), ' data-desk="' + it.id + '"', 'Show ' + it.name + ' on the desktop') + '</span></div>';
      openExp.add('desk-sys');
      return rows(tog('deskIcons', 'Show desktop icons', 'Hide them all without changing the choices below', { icon: 'device.computer' }),
          choose('deskIconSize', 'Icon size', '', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], { icon: 'settings.display' })) +
        h('Desktop icons') +
        rows(exp('desk-sys', { icon: 'device.computer', title: 'System icons', sub: 'This PC, Trash, Settings' }, items.map(item).join('')),
          exp('desk-apps', { icon: 'settings.apps', title: 'Apps', sub: 'Shortcuts to your apps' }, apps.map((a) => item({ id: a.id, name: a.name, img: a.img })).join('')));
    },

    // ---------------------------------------------------------------- Apps
    apps() {
      return rows(goRow('apps/installed', { ctl: plural(window.LOS_APPS.length, 'app') }), goRow('apps/defaults'), goRow('apps/browser'));
    },

    'apps/installed'() {
      const q = (data.appQuery || '').trim().toLowerCase();
      const list = window.LOS_APPS.filter((a) => !q || a.name.toLowerCase().includes(q));
      const pinned = st().pinned || [];
      return '<div class="st-tools"><label class="search st-find"><span class="ico-wrap">' + G('search', 15) + '</span><input class="input" data-app-search placeholder="Search apps" value="' + esc(data.appQuery || '') + '" aria-label="Search apps"></label>' +
        '<span class="hint">' + plural(list.length, 'app') + ' found</span></div>' +
        (list.length ? rows(...list.map((a) => '<div class="st-row"><img class="st-appic" src="' + esc(a.img) + '" alt="" width="32" height="32"><span class="st-tx"><b>' + esc(a.name) + '</b>' +
            '<small>' + esc((a.category || (a.exts.length ? 'Opens ' + a.exts.length + ' kinds of file' : 'Built-in')) + (pinned.includes(a.id) ? ' · Pinned to the taskbar' : '')) + '</small></span>' +
            '<span class="st-ctl"><button class="icon-btn" data-app-more="' + a.id + '" aria-label="More for ' + esc(a.name) + '">' + G('more') + '</button></span></div>'))
          : rows(row({ title: 'No apps match', sub: 'Try another name' })));
    },

    'apps/defaults'() {
      const apps = window.LOS_APPS.filter((a) => a.exts.length);
      return '<p class="st-note">Files open in the app that handles their kind. Choose “Open with” on a file in Files to use another app once.</p>' +
        rows(...apps.map((a) => exp('def-' + a.id, { title: esc(a.name), sub: plural(a.exts.length, 'file type') },
          '<div class="st-sub col"><div class="st-exts">' + a.exts.map((e) => '<span>.' + esc(e) + '</span>').join('') + '</div></div>')
          .replace('<span class="st-tx">', '<span class="st-ic"><img src="' + esc(a.img) + '" alt="" width="24" height="24"></span><span class="st-tx">')));
    },

    'apps/browser'() {
      return rows(row({ icon: 'app.browser', title: 'Home page', sub: 'Opens when you start the Browser',
        ctl: '<form data-form="homepage" class="st-inline"><input class="input" name="homepage" type="url" value="' + esc(st().homepage || '') + '" required aria-label="Home page"><button class="btn">Save</button></form>' }));
    },

    // ---------------------------------------------------------------- Accounts
    accounts() {
      const u = OS.user;
      return '<div class="st-acct">' + avatar(u, 88) + '<span class="st-hero-tx"><b>' + esc(u.name) + '</b><span>' + esc(u.username) + '</span><span>' + roleName(u.role) + '</span></span></div>' +
        h('Account settings') +
        rows(goRow('accounts/info'), goRow('accounts/signin'), isAdmin() ? goRow('accounts/users', { ctl: data.users ? plural(data.users.length - 1, 'user') : '' }) : '');
    },

    'accounts/info'() {
      const u = OS.user;
      return '<div class="st-acct">' + avatar(u, 88) + '<span class="st-hero-tx"><b>' + esc(u.name) + '</b><span>' + esc(u.username) + '</span></span></div>' +
        rows(row({ icon: 'settings.user', title: 'Display name', sub: esc(u.name) + (can('changeName') ? '' : ' · ' + MANAGED),
            ctl: '<button class="btn" data-act="edit-name"' + (can('changeName') ? '' : ' disabled') + '>Change</button>' }),
          row({ icon: 'settings.accounts', title: 'Account type', sub: roleName(u.role) + ': ' + (({
            admin: 'can manage users and system settings',
            local: 'can change their own look and basic settings; device settings are left to administrators',
            guest: 'anyone can use it without a password; files stay in this browser',
          })[u.role] || 'can change only their own settings') }));
    },

    'accounts/signin'() {
      return h('Ways to sign in') +
        rows(row({ icon: 'status.password', title: 'Password', sub: 'Used to sign in and to unlock the screen' + (can('changePassword') ? '' : ' · ' + MANAGED),
          ctl: '<button class="btn" data-act="change-password"' + (can('changePassword') ? '' : ' disabled') + '>Change</button>' })) +
        (can('lock') ? h('Additional settings') +
        rows(row({ icon: 'shell.lock', title: 'Lock the screen now', sub: 'Your windows stay open behind the lock screen', ctl: '<button class="btn" data-act="lock">Lock</button>' })) : '');
    },

    'accounts/users'() {
      const others = data.users ? data.users.filter((x) => x.username !== OS.user.username) : null;
      const x = data.system;
      const when = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
      const about = (p) => [esc(p.username), roleName(p.role), util.formatSize(p.used) + ' of ' + util.formatSize(p.quota),
        p.lastLogin ? 'Last signed in ' + esc(when(p.lastLogin)) : 'Never signed in'].join(' · ');
      return rows(row({ icon: 'settings.accounts', title: 'Add other user', sub: 'Everyone signs in with their own files and settings', ctl: '<button class="btn btn-primary" data-act="add-user">Add account</button>' })) +
        h('Guest') +
        rows(row({ icon: 'settings.user', title: 'Guest account', sub: 'Anyone can sign in from the sign-in screen without a password. Their files stay in the browser they use.',
            ctl: x ? sw(!!x.guestEnabled, ' data-guest="guestEnabled"', 'Guest account') : '' }),
          x && x.guestEnabled ? row({ icon: 'app.browser', title: 'Web access for guests', sub: 'The Browser, downloads and web content in apps. Turn it off if this LiteOS can be reached from the internet.',
            ctl: sw(!!x.guestWeb, ' data-guest="guestWeb"', 'Web access for guests') }) : '',
          x && x.guestEnabled ? row({ icon: 'settings.apps', title: 'Apps guests can open', sub: plural((Array.isArray(x.guestApps) ? x.guestApps : x.localApps || []).length, 'app'),
            ctl: '<button class="btn" data-act="guest-apps">Choose</button>' }) : '') +
        h('Storage') +
        rows(row({ icon: 'settings.storage', title: 'Storage for each new user', sub: 'Users without their own limit get this much space',
          ctl: x ? '<form data-form="quota" class="st-inline"><input class="input st-num-in" name="quota" type="number" min="10" value="' + esc(x.defaultQuotaMB) + '" aria-label="Storage per user in MB"><span class="hint">MB</span><button class="btn">Save</button></form>' : '' }),
          row({ icon: 'settings.storage', title: 'Storage for each new Local account', sub: 'Local accounts without their own limit get this much space',
            ctl: x ? '<form data-form="localQuota" class="st-inline"><input class="input st-num-in" name="quota" type="number" min="10" value="' + esc(x.defaultLocalQuotaMB) + '" aria-label="Storage per Local account in MB"><span class="hint">MB</span><button class="btn">Save</button></form>' : '' })) +
        // the people who sign in here, last on the page
        h('Other users') +
        (!others ? rows(row({ title: 'Loading…' }))
          : others.length ? rows(...others.map((p) => '<div class="st-row' + (p.disabled ? ' dim' : '') + '">' + avatar(p, 36) + '<span class="st-tx"><b>' + esc(p.name) + (p.disabled ? ' <span class="st-tag">Disabled</span>' : '') + '</b><small>' + about(p) + '</small></span>' +
            '<span class="st-ctl"><button class="icon-btn" data-user="' + esc(p.username) + '" aria-label="More for ' + esc(p.name) + '">' + G('more') + '</button></span></div>'))
            : rows(row({ title: 'No other users yet', sub: 'Add an account so someone else can sign in to this computer.' })));
    },

    // ---------------------------------------------------------------- Time & language
    time() {
      const now = new Date();
      return '<div class="st-clock"><b data-clock>' + clock(now) + '</b><span>' + esc(now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</span></div>' +
        rows(goRow('time/datetime', Object.assign({ ctl: esc(zone()) }, can('settingsDevice') ? {} : { sub: 'Clock format' })), goRow('time/language', { ctl: esc(langName()) }), goRow('time/typing', { ctl: data.input ? esc(layoutName()) : '' }));
    },

    'time/datetime'() {
      const off = why('time');
      const t = data.time;
      const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [zone()];
      const cur = t ? t.timezone : zone();
      const list = zones.includes(cur) ? zones : [cur].concat(zones);
      const now = new Date();
      return (can('settingsDevice') ? bridgeInfo(['time']) : '') +
        '<div class="st-clock"><b data-clock>' + clock(now) + '</b><span>' + esc(now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</span></div>' +
        rows(row({ icon: 'settings.time', title: 'Set the time automatically', off, dev: true, sub: t ? (t.synced ? 'Synchronised with a time server' : 'Not synchronised yet') : '', ctl: t ? '<span class="hint">' + (t.ntp ? 'On' : 'Off') + '</span>' : '' }),
          row({ icon: 'settings.language', title: 'Time zone', off, dev: true, sub: off ? '' : 'Changing it needs the LiteLink admin password',
            ctl: sel(' data-dev="zone" aria-label="Time zone"', list.map((z) => [z, z.replace(/_/g, ' ')]), cur, !!off || !t) }),
          tog('clock24', 'Show time in 24-hour format', 'Show 13:00 instead of 1:00 PM', { icon: 'settings.time' }));
    },

    'time/language'() {
      return rows(row({ icon: 'settings.language', title: 'LiteOS display language', sub: 'Menus, settings and messages appear in this language', ctl: sel(' aria-label="Display language"', [['en', 'English']], 'en', true) }),
        row({ icon: 'settings.language', title: 'Regional format', sub: 'Dates and numbers follow your browser’s language', ctl: '<span class="hint">' + esc(langName()) + '</span>' }));
    },

    'time/typing'() {
      const off = why('input');
      const i = data.input;
      const layouts = i ? i.layouts.map((l) => [l.id, l.name]) : [['', '—']];
      return bridgeInfo(['input']) +
        rows(row({ icon: 'settings.keyboard', title: 'Keyboard layout', sub: off ? '' : 'For this session; LiteLink’s own layout comes back when the session ends', off,
            ctl: sel(' data-dev="layout" aria-label="Keyboard layout"', layouts, i ? i.layout : '', !!off || !i) }),
          row({ icon: 'settings.keyboard', title: 'More keyboard settings', sub: 'Keyboard layouts in LiteLink’s Settings', act: 'll-settings', attrs: ' data-page="keyboard"', off: why('session') }));
    },

    // ---------------------------------------------------------------- Accessibility
    accessibility() {
      const na = (icon, title, subText) => row({ icon, title, off: subText });
      return h('Vision') +
        rows(goRow('accessibility/text'), goRow('accessibility/effects'), goRow('accessibility/pointer'), goRow('accessibility/caret'),
          na('settings.display', 'Magnifier', 'Not available in LiteOS: use your browser’s zoom (Ctrl and +)'),
          goRow('accessibility/filters'), goRow('accessibility/contrast'),
          na('settings.sound', 'Narrator', 'Use your device’s screen reader; LiteOS apps support it')) +
        h('Hearing') +
        rows(goRow('accessibility/audio'), goRow('accessibility/captions')) +
        h('Interaction') +
        rows(na('device.headphones', 'Speech', 'Not available in LiteOS'), goRow('accessibility/keyboard'),
          na('settings.mouse', 'Mouse keys', 'Not available in LiteOS'), na('device.camera', 'Eye control', 'Not available in LiteOS'));
    },
    'accessibility/text'() {
      const size = { default: 13, large: 15, larger: 17 }[st().textSize] || 13;
      return '<div class="st-sample" style="font-size:' + size + 'px">Text size preview: the quick brown fox jumps over the lazy dog.</div>' +
        rows(choose('textSize', 'Text size', 'Size of text and controls inside apps', [['default', 'Default'], ['large', 'Large'], ['larger', 'Larger']], { icon: 'settings.font' }));
    },
    'accessibility/effects'() {
      return rows(tog('transparency', 'Transparency effects', 'Frosted glass on the dock, menus and top bar', { icon: 'settings.personalisation' }),
        tog('reduceMotion', 'Animation effects', 'Turn off to stop windows and menus from animating', { icon: 'settings.display', invert: true }),
        choose('notifyTimeout', 'Dismiss notifications after this amount of time', '', [['5', '5 seconds'], ['10', '10 seconds'], ['20', '20 seconds'], ['30', '30 seconds']], { icon: 'settings.notifications' }));
    },
    'accessibility/pointer'() {
      return rows(choose('cursorSize', 'Mouse pointer size', '', [['default', 'Default'], ['large', 'Large'], ['larger', 'Larger']], { icon: 'settings.mouse' }));
    },
    'accessibility/caret'() {
      const carets = [['auto', 'Default', 'var(--text)'], ['accent', 'Accent', 'var(--accent)'], ['red', 'Red', '#E5484D'], ['green', 'Green', '#1F9D61'], ['purple', 'Purple', '#8E4EC6']];
      const v = st().caretColor || 'auto';
      return rows(row({ icon: 'settings.keyboard', title: 'Text cursor colour', sub: 'The blinking cursor where you type',
          ctl: '<span class="st-swatches small">' + carets.map(([val, n, c]) => '<button class="st-swatch' + (v === val ? ' on' : '') + '" data-set="caretColor" data-val="' + val + '" title="' + n + '" aria-label="' + n + '" style="background:' + c + '"></button>').join('') + '</span>' }),
        row({ icon: 'settings.keyboard', title: 'Text cursor thickness', off: 'Not available in LiteOS' }));
    },
    'accessibility/filters'() {
      return rows(choose('colorFilter', 'Colour filter', 'Makes the screen easier to see', [['none', 'Off'], ['grayscale', 'Greyscale'], ['invert', 'Inverted'], ['grayscale-invert', 'Greyscale inverted']], { icon: 'settings.colour' }),
        row({ icon: 'settings.colour', title: 'Colour-blindness filters', off: 'Not available in LiteOS yet' }));
    },
    'accessibility/contrast'() {
      return rows(choose('contrast', 'Contrast theme', 'Distinct, high-contrast colours', [['off', 'None'], ['dark', 'Dark'], ['light', 'Light']], { icon: 'settings.personalisation' }));
    },
    'accessibility/audio'() {
      return rows(tog('notifySound', 'Notification sounds', 'Play a short chime when a notification arrives', { icon: 'settings.sound' }),
        tog('flashOnNotify', 'Flash the screen during notifications', 'Useful when sound is off or hard to hear', { icon: 'settings.display' }),
        row({ icon: 'settings.sound', title: 'Mono audio', off: 'Not available in LiteOS' }));
    },
    'accessibility/captions'() {
      return rows(choose('captionSize', 'Caption size', 'Captions in videos played in Media', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], { icon: 'settings.accessibility' }),
        row({ icon: 'settings.accessibility', title: 'Live captions', off: 'Not available in LiteOS yet' }));
    },
    'accessibility/keyboard'() {
      return rows(tog('focusRing', 'Stronger focus outline', 'A thick outline around whatever has keyboard focus', { icon: 'settings.keyboard' }),
          row({ icon: 'settings.keyboard', title: 'On-screen keyboard and sticky keys', off: 'Not available in LiteOS yet' })) +
        h('Keyboard shortcuts') +
        '<div class="st-panel">' + kv([['Alt + Space', 'Open the launcher'], ['Esc', 'Close menus and dialogs'], ['Ctrl + S', 'Save in apps']]) + '</div>';
    },
  };

  function usbRow(d) {
    return row({ icon: 'settings.usb', title: esc(d.name), sub: esc([d.model, util.formatSize(d.size), (d.fstype || '').toUpperCase()].filter(Boolean).join(' · ')),
      ctl: '<button class="btn" data-launch="files" data-args="device">Open in Files</button><button class="btn" data-eject="' + esc(d.id) + '">Eject</button>' });
  }
  const btIcon = (d) => ({ audio: 'device.headphones', headset: 'device.headphones', headphones: 'device.headphones', keyboard: 'device.keyboard', mouse: 'device.mouse', phone: 'device.phone' })[d.kind] || 'settings.bluetooth';
  const clock = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !st().clock24 });
  const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } };
  function langName() {
    const l = navigator.language || 'en';
    try { return new Intl.DisplayNames([l], { type: 'language' }).of(l) || l; } catch (e) { return l; }
  }
  function layoutName() {
    const i = data.input;
    const l = i && i.layouts.find((x) => x.id === i.layout);
    return l ? l.name : (i && i.layout) || '';
  }

  // the desktop in miniature (Personalisation)
  function preview() {
    const s = st();
    const classic = s.taskbar === 'classic';
    return '<div class="st-preview" style="background:' + esc(wallCss(s.wallpaper)) + '">' +
      (classic ? '' : '<span class="pv-bar"></span>') +
      '<span class="pv-win"><span class="h"></span><i class="l" style="width:60%"></i><i class="l"></i><i class="l" style="width:85%"></i><i class="a"></i></span>' +
      (classic ? '<span class="pv-task"><i style="background:var(--accent);width:16px"></i>' + window.LOS_APPS.slice(0, 6).map((a) => '<i style="background:' + a.c[1] + '"></i>').join('') + '</span>'
        : '<span class="pv-dock"><i style="background:var(--accent)"></i>' + window.LOS_APPS.slice(0, 7).map((a) => '<i style="background:' + a.c[1] + '"></i>').join('') + '</span>') +
      '</div>';
  }

  // ------------------------------------------------------------------ navigation pane and search
  function renderNav() {
    const u = OS.user;
    const top = page.split('/')[0];
    $('#nav').innerHTML = '<button class="st-me" data-go="accounts">' + avatar(u, 56) + '<span class="st-me-tx"><b>' + esc(u.name) + '</b><small>' + esc(u.username) + ' · ' + roleName(u.role) + '</small></span></button>' +
      '<div class="st-search"><span class="ico-wrap">' + G('search', 15) + '</span><input class="input" id="find" placeholder="Find a setting" autocomplete="off" aria-label="Find a setting" aria-controls="found"><div class="st-found" id="found" role="listbox" hidden></div></div>' +
      '<div class="st-navlist" role="list">' + NAV.filter(allowed).map((id) => '<button class="st-navi' + (top === id ? ' active' : '') + '" data-go="' + id + '" role="listitem"' + (top === id ? ' aria-current="page"' : '') + '>' + ico(PAGES[id].icon, 20) + '<span>' + esc(PAGES[id].title) + '</span></button>').join('') + '</div>';
  }

  // everything Find a setting looks through: each page, and the rows on the pages that have no page of their own
  const EXTRA = [
    ['Dark mode', 'personalisation/colours'], ['Light mode', 'personalisation/colours'], ['Theme', 'personalisation'], ['Accent colour', 'personalisation/colours'],
    ['Transparency effects', 'personalisation/colours'], ['Wallpaper', 'personalisation/background'], ['Night light', 'system/display'], ['Brightness', 'system/display'],
    ['Resolution', 'system/display'], ['Volume', 'system/sound'], ['Microphone', 'system/sound'], ['Do not disturb', 'system/notifications'],
    ['Lock', 'system/power'], ['Sign out', 'system/power'], ['Restart', 'system/power'], ['Shut down', 'system/power'], ['Trash', 'system/storage'],
    ['Rename this computer', 'system/about'], ['Version', 'system/about'], ['Password', 'accounts/signin'], ['Display name', 'accounts/info'],
    ['Add user', 'accounts/users'], ['Time zone', 'time/datetime'], ['24-hour clock', 'time/datetime'], ['Keyboard layout', 'time/typing'],
    ['Pinned apps', 'personalisation/taskbar'], ['Auto-hide taskbar', 'personalisation/taskbar'], ['Home page', 'apps/browser'], ['Pointer size', 'accessibility/pointer'],
    ['High contrast', 'accessibility/contrast'], ['Greyscale', 'accessibility/filters'], ['Animations', 'accessibility/effects'], ['Pair a device', 'bluetooth/devices'],
    ['IP address', 'network/ethernet'], ['Eject USB drive', 'bluetooth/usb'],
  ];
  // rows Find a setting shouldn't offer to an account that can't change the device (the page itself stays)
  const DEVICE_EXTRA = ['Resolution', 'Restart', 'Shut down', 'Time zone'];
  function findSettings(q) {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const all = PAGE_LIST.filter(([id]) => id !== 'home' && allowed(id)).map(([id, title, icon, subText]) => ({ title, page: id, icon, text: (title + ' ' + (subText || '')).toLowerCase() }))
      .concat(EXTRA.filter(([title, p]) => allowed(p) && (can('settingsDevice') || !DEVICE_EXTRA.includes(title))).map(([title, p]) => ({ title, page: p, icon: PAGES[p].icon, text: title.toLowerCase() })));
    const hits = all.filter((x) => x.text.includes(t));
    hits.sort((a, b) => (a.title.toLowerCase().startsWith(t) ? 0 : 1) - (b.title.toLowerCase().startsWith(t) ? 0 : 1));
    const seen = new Set();
    return hits.filter((x) => { const k = x.title + x.page; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
  }
  let found = [];
  let foundAt = 0;
  function showFound() {
    const box = $('#found');
    const q = $('#find').value;
    found = findSettings(q);
    foundAt = 0;
    if (!q.trim()) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = found.length ? found.map((x, i) => '<button class="st-hit' + (i === foundAt ? ' on' : '') + '" data-hit="' + i + '" role="option">' + ico(x.icon, 16) + '<span>' + esc(x.title) + '</span>' +
      (parentOf(x.page) || x.title !== PAGES[x.page].title ? '<small>' + esc(PAGES[x.page.split('/')[0]].title) + '</small>' : '') + '</button>').join('')
      : '<div class="st-nohit">No results</div>';
  }
  function pickFound(i) {
    const x = found[i];
    if (!x) return;
    $('#find').value = '';
    $('#found').hidden = true;
    go(x.page);
  }

  // ------------------------------------------------------------------ loading and drawing
  async function load(id) {
    const want = (area) => has(area);
    const jobs = [];
    const top = id.split('/')[0];
    const set = (key, p) => jobs.push(p.then((v) => { data[key] = v; }, (e) => { dev.err[key] = e.message; }));
    if (can('files') && (id === 'home' || id === 'system' || id === 'system/storage')) set('usage', OS.fs.usage());
    if (can('files') && id === 'system/storage') set('trash', OS.fs.trash.list());
    if ((id === 'accounts' || id === 'accounts/users') && isAdmin()) set('users', OS.api('users.list', undefined, {}));
    if ((id === 'system/about' || id === 'accounts/users') && isAdmin()) set('system', OS.api('system.get', undefined, {}));
    if (want('system') && data.info === undefined && ['home', 'system', 'system/about', 'bluetooth'].includes(id)) set('info', LL.system.info());
    if (want('network') && (id === 'home' || top === 'network' || id === 'system')) set('net', LL.network.state());
    if (want('network') && id === 'network/wifi') set('wifi', LL.network.wifi());
    if (want('bluetooth') && (id === 'home' || top === 'bluetooth')) set('bt', LL.bluetooth.state());
    if (want('storage') && (id === 'bluetooth/usb' || id === 'system/storage')) set('drives', LL.storage.list());
    if (want('print') && id === 'bluetooth/printers') { set('printers', LL.print.printers()); set('printJobs', OS.printJobs()); }
    if (want('audio') && id === 'system/sound') set('audio', LL.audio.state());
    if (want('display') && id === 'system/display') set('disp', LL.display.state());
    if (want('input') && (top === 'time')) set('input', LL.input.state());
    if (want('time') && id === 'time/datetime') set('time', LL.time.state());
    await Promise.all(jobs);
  }

  function render() {
    renderNav();
    const el = $('#page');
    const scroll = el.scrollTop;
    const view = views[page] || views.home;
    el.innerHTML = '<div class="st-inner">' + header(page) + view() + '</div>';
    el.scrollTop = scroll;
    OS.win.setTitle('Settings'); // the window is always "Settings", whichever page is open
  }
  // redraw the page, keeping the search box as it was
  function redraw() {
    const f = $('#find');
    const q = f ? f.value : '';
    const focused = document.activeElement === f;
    render();
    if (q) { $('#find').value = q; showFound(); }
    if (focused) $('#find').focus();
  }

  async function go(id, fromBack) {
    if (!PAGES[id] || !allowed(id)) return;
    if (!fromBack && id !== page) history.push(page);
    page = id;
    render();
    $('#page').scrollTop = 0;
    try { await load(id); } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t load settings' }); }
    if (page === id) render();
  }

  // ------------------------------------------------------------------ dialogs
  // A form dialog in the system style (docs/ui-dialogs.md): <dialog class="dlg">, Escape cancels, focus returns.
  function dialog(title, bodyHtml, okLabel, onOk, danger) {
    const d = $('#dlg');
    const prev = document.activeElement;
    d.innerHTML = '<form autocomplete="off"><h2 class="dlg-title" id="dlg-title">' + esc(title) + '</h2><div class="dlg-body">' + bodyHtml + '<div class="err"></div></div>' +
      '<div class="dlg-actions"><button type="button" class="btn" data-x>Cancel</button>' + (okLabel ? '<button class="btn ' + (danger ? 'btn-danger' : 'is-default') + '">' + esc(okLabel) + '</button>' : '') + '</div></form>';
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
    const first = f.querySelector('input:not([disabled]), select') || f.querySelector('.dlg-actions button:last-child');
    if (first) first.focus();
    return { el: d, form: f, close };
  }

  function userForm(x) {
    const editing = !!x;
    return (editing ? '' : '<label class="field"><span>Username</span><input class="input" name="username" required maxlength="32" pattern="[a-z0-9][a-z0-9_.\\-]{1,31}" title="Lowercase letters, numbers, dot, dash or underscore"></label>') +
      '<label class="field"><span>Display name</span><input class="input" name="name" required maxlength="60" value="' + esc(x ? x.name : '') + '"></label>' +
      (editing ? '' : '<label class="field"><span>Password</span><input class="input" type="password" name="password" required minlength="6" autocomplete="new-password"></label>') +
      '<div class="row" style="gap:14px;align-items:flex-end"><div class="field grow"><span>Account type</span>' +
      sel(' data-name="role" aria-label="Account type"', [['user', 'Standard user'], ['local', 'Local account'], ['admin', 'Administrator']], x ? x.role : 'user') + '</div>' +
      '<label class="field grow"><span>Storage limit (MB)</span><input class="input" type="number" min="10" name="quotaMB" placeholder="Default" value="' + esc(x && x.quotaMB != null ? x.quotaMB : '') + '"></label></div>';
  }

  // Switches inside a dialog (they're buttons in a form, so type="button") and the list of apps to tick: Settings is
  // always there (it's where anyone locks or signs out) and the Browser needs web access.
  const dsw = (on, attrs, label, dis) => sw(on, attrs, label, dis).replace('<button class="switch"', '<button type="button" class="switch"');
  const dlgLine = (title, subText, ctl, img) => '<div class="st-row">' + (img ? '<span class="st-ic"><img src="' + esc(img) + '" alt="" width="24" height="24"></span>' : '') +
    '<span class="st-tx"><b>' + title + '</b>' + (subText ? '<small>' + subText + '</small>' : '') + '</span><span class="st-ctl">' + ctl + '</span></div>';
  const isOn = (b) => b.getAttribute('aria-checked') === 'true';
  function appSwitches(chosen, web) {
    return '<div class="st-rows st-dlg-list">' + window.LOS_APPS.map((a) => {
      const always = a.id === 'settings';
      return dlgLine(esc(a.name), always ? 'Always available' : a.id === 'browser' ? 'Needs web access' : '',
        dsw(always || chosen.includes(a.id), ' data-app="' + a.id + '"', a.name, always || (a.id === 'browser' && !web)), a.img);
    }).join('') + '</div>';
  }
  const chosenApps = (f) => [...f.querySelectorAll('[data-app]')].filter(isOn).map((b) => b.dataset.app);
  // flips a dialog's switches; turning web access off locks the Browser's switch
  function wireSwitches(form) {
    form.addEventListener('click', (e) => {
      const b = e.target.closest('.switch[data-perm], .switch[data-app]');
      if (!b || b.disabled) return;
      const now = !isOn(b);
      b.setAttribute('aria-checked', now ? 'true' : 'false');
      b.previousElementSibling.textContent = now ? 'On' : 'Off';
      if (b.dataset.perm === 'web') {
        const browser = form.querySelector('[data-app="browser"]');
        if (browser) browser.disabled = !now;
      }
    });
  }

  // What a Local account may do (App\Support\Capabilities): web access, changing its own name and password, and the
  // apps it can open.
  function accessDialog(x) {
    const p = x.permissions || {};
    const chosen = Array.isArray(p.apps) ? p.apps : ((x.can && x.can.apps) || []);
    const perm = (key, title, subText) => dlgLine(title, subText, dsw(p[key] !== false, ' data-perm="' + key + '"', title));
    const body = '<p class="st-note">' + esc(x.name) + ' can change their own look and basic settings. Choose what else they can do.</p>' +
      '<div class="st-rows">' + perm('web', 'Web access', 'The Browser, downloads and web content in apps') +
      perm('changeName', 'Change their display name', '') + perm('changePassword', 'Change their password', '') + '</div>' +
      '<h3 class="st-h">Apps they can open</h3>' + appSwitches(chosen, p.web !== false);
    const d = dialog('Access for ' + x.name, body, 'Save', async (f) => {
      const value = (key) => isOn(f.querySelector('[data-perm="' + key + '"]'));
      await OS.api('users.update', { username: x.username, changes: { permissions: { web: value('web'), changeName: value('changeName'), changePassword: value('changePassword'), apps: chosenApps(f) } } });
      OS.notify('Changes to what ' + x.name + ' can do were saved. They apply the next time a page or app opens.', { type: 'success', title: 'Access updated' });
      await refreshUsers();
    });
    wireSwitches(d.form);
  }

  // The apps guests can open (system setting guestApps; until an administrator picks, the Local accounts' defaults)
  function guestAppsDialog() {
    const x = data.system;
    const chosen = Array.isArray(x.guestApps) ? x.guestApps : (x.localApps || []);
    const d = dialog('Apps guests can open', '<p class="st-note">Guests see only these apps in the launcher.</p>' + appSwitches(chosen, x.guestWeb), 'Save', async (f) => {
      data.system = Object.assign(data.system, await OS.api('system.save', { system: { guestApps: chosenApps(f) } }));
      OS.notify('Guests see the new list the next time they sign in.', { type: 'success', title: 'Guest apps saved' });
      render();
    });
    wireSwitches(d.form);
  }

  function userMenu(username, at) {
    const x = (data.users || []).find((p) => p.username === username);
    if (!x) return;
    const me = x.username === OS.user.username;
    const items = [
      { label: 'Edit', icon: 'rename', action: () => dialog('Edit ' + x.name, userForm(x), 'Save', async (f) => {
        await OS.api('users.update', { username: x.username, changes: { name: f.name.value, role: f.role.value, quotaMB: f.quotaMB.value === '' ? null : +f.quotaMB.value } });
        OS.notify('Changes to ' + x.name + ' were saved.', { type: 'success', title: 'User updated' }); await refreshUsers();
      }) },
      ...(x.role === 'local' ? [{ label: 'Change access', icon: 'settings', action: () => accessDialog(x) }] : []),
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
  // the Guest section's switches (system settings guestEnabled, guestWeb)
  async function setGuest(key, value) {
    try {
      data.system = Object.assign(data.system, await OS.api('system.save', { system: { [key]: value } }));
      if (key === 'guestEnabled') OS.notify(value ? 'The sign-in screen now offers “Sign in as guest”.' : 'Guests can no longer sign in, and anyone signed in as a guest is signed out.', { type: 'success', title: value ? 'Guest account on' : 'Guest account off' });
    } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t change the guest account' }); }
    render();
  }
  async function refreshUsers() { data.users = await OS.api('users.list', undefined, {}); render(); }

  // Bluetooth › Add device: scan, then pair the one picked
  async function addBluetooth() {
    const dlg = dialog('Add a device', '<p class="hint">Make sure the device is on and in pairing mode.</p><div class="st-scan">' + ico('settings.bluetooth', 20) + '<span>Looking for devices…</span></div>', '', () => {});
    try {
      const found = await LL.bluetooth.scan();
      if (!dlg.el.open) return;
      $('.st-scan', dlg.el).outerHTML = found.length
        ? '<div class="st-scanlist">' + found.map((d) => '<button type="button" class="st-scanrow" data-mac="' + esc(d.mac) + '" data-name="' + esc(d.name || d.mac) + '">' + ico('settings.bluetooth', 20) + '<span>' + esc(d.name || d.mac) + '</span></button>').join('') + '</div>'
        : '<div class="st-scan"><span>No devices found. Put the device in pairing mode and try again.</span></div>';
      dlg.el.querySelectorAll('[data-mac]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        b.querySelector('span').textContent = 'Pairing…';
        try {
          await LL.bluetooth.pair(b.dataset.mac);
          dlg.close();
          OS.notify((b.dataset.name || 'The device') + ' is ready to use.', { type: 'success', title: 'Device paired' });
          data.bt = await LL.bluetooth.state(); render();
        } catch (e) { $('.err', dlg.el).textContent = e.message; b.disabled = false; b.querySelector('span').textContent = 'Try again'; }
      }));
    } catch (e) { if (dlg.el.open) $('.err', dlg.el).textContent = e.message; }
  }

  // A test page: a one-page PDF made here (LiteOS's name, the printer's, the time), sent to the printer as it is.
  function testPagePdf(printerName) {
    // PDF text: plain ASCII, with \ ( ) escaped
    const asc = (t) => String(t).replace(/[^\x20-\x7E]/g, '?').replace(/[\\()]/g, (c) => '\\' + c);
    const lines = [['LiteOS test page', 24, 760], ['Printer: ' + printerName, 13, 720], ['Printed from LiteOS on ' + new Date().toLocaleString(), 13, 700],
      ['If you can read this, the printer works.', 13, 660]];
    const text = 'BT ' + lines.map(([t, size, y]) => '/F1 ' + size + ' Tf 1 0 0 1 72 ' + y + ' Tm (' + asc(t) + ') Tj').join(' ') + ' ET' +
      ' 0.18 0.44 0.84 RG 2 w 72 640 m 523 640 l S';
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length ' + text.length + ' >>\nstream\n' + text + '\nendstream'];
    let out = '%PDF-1.4\n';
    const at = objs.map((o, i) => { const off = out.length; out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; return off; });
    const xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + at.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
      'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    return new Blob([out], { type: 'application/pdf' });
  }
  async function printTestPage(p) {
    try {
      await LL.print.print(p.id, testPagePdf(p.name), { title: 'Test page' }).done;
      OS.notify('A test page was sent to ' + p.name + '.', { type: 'success', title: 'Test page' });
    } catch (e) { if (!e.cancelled) OS.notify(e.message, { type: 'error', title: 'Couldn’t print a test page' }); }
  }
  function printerDetails(p) {
    const STATE = { idle: 'Ready', printing: 'Printing', stopped: 'Stopped' };
    OS.dialog.alert({ title: p.name, message: [
      'Connection: ' + (p.kind === 'usb' ? 'USB' : 'Network'),
      'Status: ' + (STATE[p.state] || p.state) + (p.message ? ' (' + p.message + ')' : ''),
      'Two-sided: ' + (p.duplex ? 'Yes' : 'No'),
      'Colour: ' + (p.color ? 'Yes' : 'No, black and white'),
      'Paper: ' + ((p.media || []).join(', ') || 'Printer default') + (p.mediaDefault ? ' (default ' + p.mediaDefault + ')' : ''),
      p.default ? 'Used last on this device' : '',
    ].filter(Boolean).join('\n') });
  }

  // Add a printer, as LiteLink's Settings does: the printers it can see now (USB and network), or one by its address.
  // Setting one up changes the device for everyone: LiteLink asks for its admin password in its own dialog.
  async function addPrinter() {
    const added = async (name) => {
      OS.notify(name + ' is ready to use.', { type: 'success', title: 'Printer added' });
      data.printers = await LL.print.printers().catch(() => data.printers); render();
    };
    const dlg = dialog('Add a printer', '<p class="hint">Printers plugged into this device or on its network show here.</p>' +
      '<div class="st-scan">' + ico('device.printer', 20) + '<span>Looking for printers…</span></div>' +
      '<label class="field"><span>Or its address</span><input class="input" name="addr" spellcheck="false" placeholder="ipp://office-printer.local or 192.168.1.50"></label>',
    'Add', async (f) => {
      const addr = f.addr.value.trim();
      if (!addr) throw new Error('Choose a printer above, or type its address.');
      const r = await LL.print.add(addr);
      await added(r.name || addr);
    });
    try {
      const found = await LL.print.find();
      if (!dlg.el.open) return;
      $('.st-scan', dlg.el).outerHTML = found.length
        ? '<div class="st-scanlist">' + found.map((p) => {
          const note = p.added ? 'Added' : !p.driverless ? 'Needs a driver LiteLink doesn’t include' : '';
          return '<button type="button" class="st-scanrow" data-uri="' + esc(p.uri) + '" data-name="' + esc(p.name) + '"' + (note ? ' disabled' : '') + '>' +
            ico('device.printer', 20) + '<span>' + esc(p.name) + '</span>' + (note ? '<small class="hint">' + esc(note) + '</small>' : '') + '</button>';
        }).join('') + '</div>'
        : '<div class="st-scan"><span>No printers found. Check that the printer is on and connected, or type its address.</span></div>';
      dlg.el.querySelectorAll('[data-uri]:not([disabled])').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        const label = b.querySelector('span');
        label.textContent = 'Adding…';
        try {
          const r = await LL.print.add(b.dataset.uri, b.dataset.name);
          dlg.close();
          await added(r.name || b.dataset.name);
        } catch (e) { $('.err', dlg.el).textContent = e.message; b.disabled = false; label.textContent = b.dataset.name; }
      }));
    } catch (e) { if (dlg.el.open) $('.err', dlg.el).textContent = e.message; }
  }

  // ------------------------------------------------------------------ device settings (window.LiteLink)
  async function devCall(fn, failTitle) {
    try { return await fn(); } catch (e) { OS.notify(e.message, { type: 'error', title: failTitle }); return null; }
  }
  const setVolume = util.debounce((key, v) => devCall(() => LL.audio.set({ [key]: v }).then((a) => { data.audio = a; }), 'Couldn’t change the volume'), 150);
  const saveRange = util.debounce((key, v) => save({ [key]: v }), 200);

  async function onDevChange(kind, v) {
    if (kind === 'output') { const a = await devCall(() => LL.audio.set({ output: v }), 'Couldn’t change the output'); if (a) data.audio = a; render(); }
    if (kind === 'input') { const a = await devCall(() => LL.audio.set({ input: v }), 'Couldn’t change the microphone'); if (a) data.audio = a; render(); }
    if (kind === 'layout') {
      await devCall(() => LL.input.setLayout(v), 'Couldn’t change the keyboard layout');
      data.input = await devCall(() => LL.input.state(), 'Couldn’t read the keyboard layout') || data.input; render();
    }
    if (kind === 'zone') {
      const ok = await devCall(() => LL.time.setZone(v), 'Couldn’t change the time zone');
      if (ok !== null) OS.notify('The time zone is now ' + v.replace(/_/g, ' ') + '.', { type: 'success', title: 'Time zone changed' });
      data.time = await devCall(() => LL.time.state(), 'Couldn’t read the time') || data.time; render();
    }
    if (kind === 'resolution') {
      const out = data.disp && data.disp[0];
      if (!out) return;
      const r = await devCall(() => LL.display.set(out.output, v), 'Couldn’t change the resolution');
      if (r) OS.notify(r.kept ? 'The screen is now ' + v.replace('x', ' × ') + '.' : 'The previous resolution is back.', { type: r.kept ? 'success' : 'info', title: r.kept ? 'Resolution changed' : 'Resolution kept as it was' });
      data.disp = await devCall(() => LL.display.state(), 'Couldn’t read the screens') || data.disp; render();
    }
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('click', async (e) => {
    if (e.target.closest('#found .st-hit')) { pickFound(+e.target.closest('.st-hit').dataset.hit); return; }
    const goRowEl = e.target.closest('[data-go-row]');
    const b = e.target.closest('button');
    if (!b && goRowEl && !goRowEl.classList.contains('off')) { go(goRowEl.dataset.goRow); return; }
    if (!b || b.disabled) return;
    if (b.classList.contains('st-combo')) { if (flyout && flyout.btn === b) closeCombo(); else openCombo(b); return; }
    if (b.dataset.go) { go(b.dataset.go); return; }
    if (b.dataset.exp) { const id = b.dataset.exp; if (openExp.has(id)) openExp.delete(id); else openExp.add(id); render(); return; }
    if (b.dataset.set && b.dataset.val) { save({ [b.dataset.set]: b.dataset.val }); return; }
    if (b.dataset.toggle) { save({ [b.dataset.toggle]: !st()[b.dataset.toggle] }); return; }
    if (b.dataset.guest) { setGuest(b.dataset.guest, !data.system[b.dataset.guest]); return; }
    if (b.dataset.wall) { save({ wallpaper: b.dataset.wall }); return; }
    if (b.dataset.accent) { save({ accent: b.dataset.accent }); return; }
    if (b.dataset.launch) { OS.open(b.dataset.launch, b.dataset.args === 'device' ? { path: 'device:' } : undefined); return; }
    if (b.dataset.user) { const r = b.getBoundingClientRect(); userMenu(b.dataset.user, { x: r.right - 210, y: r.bottom + 4 }); return; }
    if (b.dataset.desk) {
      const d = (st().desktopIcons || []).slice();
      save({ desktopIcons: d.includes(b.dataset.desk) ? d.filter((x) => x !== b.dataset.desk) : d.concat(b.dataset.desk) });
      return;
    }
    if (b.dataset.pin) {
      const p = (st().pinned || []).slice();
      save({ pinned: p.includes(b.dataset.pin) ? p.filter((x) => x !== b.dataset.pin) : p.concat(b.dataset.pin) });
      return;
    }
    if (b.dataset.move) {
      const p = (st().pinned || []).slice();
      const i = p.indexOf(b.dataset.move);
      const j = i + +b.dataset.dir;
      if (i < 0 || j < 0 || j >= p.length) return;
      [p[i], p[j]] = [p[j], p[i]];
      save({ pinned: p });
      return;
    }
    if (b.dataset.appMore) {
      const a = window.LOS_app(b.dataset.appMore);
      const pinned = (st().pinned || []).includes(a.id);
      const r = b.getBoundingClientRect();
      OS.menu([{ label: 'Open', icon: 'open', action: () => OS.open(a.id) },
        { label: pinned ? 'Unpin from taskbar' : 'Pin to taskbar', icon: pinned ? 'unpin' : 'pin', action: () => save({ pinned: pinned ? st().pinned.filter((x) => x !== a.id) : (st().pinned || []).concat(a.id) }) }], { x: r.right - 210, y: r.bottom + 4 });
      return;
    }
    if (b.dataset.eject) {
      const id = b.dataset.eject;
      b.disabled = true;
      const ok = await devCall(() => LL.storage.eject(id), 'Couldn’t eject the drive');
      if (ok !== null) OS.notify('It’s safe to remove the drive.', { type: 'success', title: 'Drive ejected' });
      data.drives = await devCall(() => LL.storage.list(), 'Couldn’t list the drives') || []; render();
      return;
    }
    if (b.dataset.printMore) {
      const p = (data.printers || []).find((x) => x.id === b.dataset.printMore);
      if (!p) return;
      const r = b.getBoundingClientRect();
      OS.menu([
        { label: 'Print a test page', icon: 'device.printer', action: () => printTestPage(p) },
        { label: 'Details', icon: 'info', action: () => printerDetails(p) },
        'sep',
        // it changes the device for everyone: asked first here, then LiteLink asks for its admin password
        { label: 'Remove printer', icon: 'trash', danger: true, action: async () => {
          const ok = await OS.dialog.confirm({ title: 'Remove ' + p.name + '?', message: 'It won’t be offered for printing on this device any more, to anyone.', okLabel: 'Remove', danger: true });
          if (!ok) return;
          const done = await devCall(() => LL.print.remove(p.id), 'Couldn’t remove the printer');
          if (done !== null) OS.notify(p.name + ' was removed.', { type: 'success', title: 'Printer removed' });
          data.printers = await devCall(() => LL.print.printers(), 'Couldn’t list the printers') || data.printers; render();
        } },
      ], { x: r.right - 210, y: r.bottom + 4 });
      return;
    }
    if (b.dataset.printCancel) {
      b.disabled = true;
      await devCall(() => OS.cancelPrintJob(b.dataset.printCancel), 'Couldn’t cancel the document');
      data.printJobs = await OS.printJobs().catch(() => data.printJobs); render();
      return;
    }
    if (b.dataset.btConnect) {
      b.disabled = true;
      await devCall(() => LL.bluetooth.connect(b.dataset.btConnect, b.dataset.on === '1'), b.dataset.on === '1' ? 'Couldn’t connect' : 'Couldn’t disconnect');
      data.bt = await devCall(() => LL.bluetooth.state(), 'Couldn’t read Bluetooth') || data.bt; render();
      return;
    }
    if (b.dataset.btMore) {
      const mac = b.dataset.btMore;
      const d = (data.bt && data.bt.devices || []).find((x) => x.mac === mac);
      const r = b.getBoundingClientRect();
      OS.menu([{ label: 'Remove device', icon: 'trash', danger: true, action: async () => {
        const ok = await OS.dialog.confirm({ title: 'Remove ' + (d ? d.name : 'this device') + '?', message: 'You’ll need to pair it again to use it.', okLabel: 'Remove', danger: true });
        if (!ok) return;
        await devCall(() => LL.bluetooth.remove(mac), 'Couldn’t remove the device');
        data.bt = await devCall(() => LL.bluetooth.state(), 'Couldn’t read Bluetooth') || data.bt; render();
      } }], { x: r.right - 210, y: r.bottom + 4 });
      return;
    }
    if (b.dataset.dev === 'bt-power') {
      const on = !(data.bt && data.bt.powered);
      await devCall(() => LL.bluetooth.setPower(on), on ? 'Couldn’t turn Bluetooth on' : 'Couldn’t turn Bluetooth off');
      data.bt = await devCall(() => LL.bluetooth.state(), 'Couldn’t read Bluetooth') || data.bt; render();
      return;
    }
    if (b.dataset.dev === 'mute') {
      const a = await devCall(() => LL.audio.set({ muted: !(data.audio && data.audio.muted) }), 'Couldn’t change the sound');
      if (a) data.audio = a; render();
      return;
    }
    switch (b.dataset.act) {
      case 'browse-wall': {
        let p = await OS.dialog.open({ title: 'Choose a background', accept: window.LOS_KINDS.image, startIn: '/Pictures' });
        // a picture on a USB stick (LiteLink device) is copied into Pictures first: the stick won't always be there
        if (p && OS.fs.isUsb(p)) {
          try {
            const name = p.split('/').pop();
            const [made] = await OS.fs.upload('/Pictures', [new File([await OS.fs.readBlob(p)], name)]);
            p = (made && made.path) || '/Pictures/' + name;
          } catch (e) { OS.notify(e.message, { type: 'error', title: 'Couldn’t use that picture' }); break; }
        }
        if (p) save({ wallpaper: 'file:' + p });
        break;
      }
      case 'test-notify': OS.notify('This is how notifications look.', { type: 'success', title: 'Test notification' }); break;
      case 'open-trash': OS.open('files', { path: 'trash:' }); break;
      case 'empty-trash': {
        const ok = await OS.dialog.confirm({ title: 'Empty the Trash?', message: 'Everything in the Trash will be deleted. This can’t be undone.', okLabel: 'Empty Trash', danger: true });
        if (!ok) return;
        try { await OS.fs.trash.purge(); await load(page); render(); OS.notify('Everything in the Trash was permanently deleted.', { type: 'success', title: 'Trash emptied' }); } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t empty Trash' }); }
        break;
      }
      case 'back': if (history.length) go(history.pop(), true); break;
      case 'lock': OS.session.lock(); break;
      case 'sign-out': OS.session.signOut(); break;
      case 'restart':
      case 'shutdown': {
        const restart = b.dataset.act === 'restart';
        const ok = await OS.dialog.confirm({ title: restart ? 'Restart this device?' : 'Shut down this device?', message: 'Save your work first: open windows in LiteOS stay open, but the device ' + (restart ? 'restarts' : 'turns off') + ' straight away.', okLabel: restart ? 'Restart' : 'Shut down', danger: true });
        if (ok) await devCall(() => (restart ? LL.power.restart() : LL.power.shutdown()), restart ? 'Couldn’t restart' : 'Couldn’t shut down');
        break;
      }
      case 'end-session': {
        const ok = await OS.dialog.confirm({ title: 'End this session?', message: 'LiteOS closes on this device and LiteLink comes back.', okLabel: 'End session' });
        if (ok) await devCall(() => LL.session.end(), 'Couldn’t end the session');
        break;
      }
      case 'll-settings': await devCall(() => LL.session.openSettings(b.dataset.page), 'Couldn’t open LiteLink’s Settings'); break;
      case 'bt-add': addBluetooth(); break;
      case 'print-add': addPrinter(); break;
      case 'copy-specs': {
        const text = Array.from(document.querySelectorAll('.st-exp.open .st-kv, .st-exp .st-kv')).map((dl) => Array.from(dl.children).reduce((acc, el) => acc + (el.tagName === 'DT' ? el.textContent + '\t' : el.textContent + '\n'), '')).join('\n');
        try { await navigator.clipboard.writeText(text || (OS.system.instanceName || 'LiteOS')); OS.notify('The device specifications were copied.', { type: 'success', title: 'Copied' }); } catch (x) { OS.notify('The clipboard isn’t available here.', { type: 'error', title: 'Couldn’t copy' }); }
        break;
      }
      case 'rename':
        dialog('Rename this computer', '<label class="field"><span>Computer name</span><input class="input" name="name" maxlength="40" required value="' + esc(OS.system.instanceName || '') + '"></label><span class="hint">Shown on the sign-in screen and in About.</span>', 'Rename', async (f) => {
          const sys = data.system || await OS.api('system.get', undefined, {});
          data.system = Object.assign(sys, await OS.api('system.save', { system: { instanceName: f.name.value, defaultQuotaMB: +sys.defaultQuotaMB } }));
          try { window.parent.LiteOSHost.refreshSystem({ instanceName: data.system.instanceName }); } catch (x) { /* standalone */ }
          OS.system.instanceName = data.system.instanceName;
          OS.notify('This computer is now called ' + data.system.instanceName + '.', { type: 'success', title: 'Computer renamed' });
          render();
        });
        break;
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
      case 'guest-apps':
        guestAppsDialog();
        break;
      case 'add-user':
        dialog('Add account', userForm(null), 'Add account', async (f) => {
          await OS.api('users.create', { username: f.username.value, name: f.name.value, password: f.password.value, role: f.role.value, quotaMB: f.quotaMB.value });
          OS.notify('They can now sign in with the username ' + f.username.value + '.', { type: 'success', title: 'User added' }); await refreshUsers();
        });
        break;
      default: break;
    }
  });

  // ------------------------------------------------------------------ combo box flyout
  // Opens over its button with the current choice where the button's text is (as Windows does), kept inside the
  // window. Arrow keys, Home / End and typing a letter move; Enter or Space picks; Escape or a click outside closes.
  let flyout = null;
  function openCombo(btn) {
    closeCombo();
    const opts = JSON.parse(btn.dataset.options || '[]');
    if (!opts.length) return;
    let at = Math.max(0, opts.findIndex(([v]) => String(v) === btn.dataset.value));
    const el = document.createElement('div');
    el.className = 'st-flyout';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', btn.getAttribute('aria-label') || '');
    el.innerHTML = opts.map(([v, l], i) => '<button type="button" class="st-opt' + (i === at ? ' on' : '') + '" role="option" data-i="' + i + '" aria-selected="' + (i === at) + '">' + esc(l) + '</button>').join('');
    document.body.appendChild(el);
    const r = btn.getBoundingClientRect();
    el.style.minWidth = r.width + 'px';
    const item = el.children[at];
    // below the field; above it when the list doesn't fit underneath and there's more room above
    const gap = 4;
    const edge = 8;
    const below = window.innerHeight - r.bottom - gap - edge;
    const above = r.top - gap - edge;
    const up = el.offsetHeight > below && above > below;
    el.style.maxHeight = Math.min(340, up ? above : below) + 'px';
    el.style.top = (up ? r.top - gap - el.offsetHeight : r.bottom + gap) + 'px';
    el.classList.toggle('up', up);
    el.style.left = Math.max(edge, Math.min(r.left, window.innerWidth - el.offsetWidth - edge)) + 'px';
    if (el.scrollHeight > el.clientHeight) el.scrollTop = item.offsetTop - el.clientHeight / 2;
    btn.setAttribute('aria-expanded', 'true');
    const mark = (i) => {
      at = (i + opts.length) % opts.length;
      Array.from(el.children).forEach((c, j) => { c.classList.toggle('on', j === at); c.setAttribute('aria-selected', j === at); });
      el.children[at].focus();
    };
    const pick = (i) => { const v = opts[i][0]; closeCombo(); btn.focus(); comboPicked(btn, v, opts[i][1]); };
    el.addEventListener('click', (e) => { const o = e.target.closest('.st-opt'); if (o) pick(+o.dataset.i); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); mark(at + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mark(at - 1); }
      else if (e.key === 'Home') { e.preventDefault(); mark(0); }
      else if (e.key === 'End') { e.preventDefault(); mark(opts.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(at); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeCombo(); btn.focus(); }
      else if (e.key.length === 1) {
        const k = e.key.toLowerCase();
        const n = opts.findIndex(([, l], i) => i > at && String(l).toLowerCase().startsWith(k));
        const m = n >= 0 ? n : opts.findIndex(([, l]) => String(l).toLowerCase().startsWith(k));
        if (m >= 0) mark(m);
      }
    });
    flyout = { el, btn };
    item.focus();
  }
  function closeCombo() {
    if (!flyout) return;
    flyout.btn.setAttribute('aria-expanded', 'false');
    flyout.el.remove();
    flyout = null;
  }
  function comboPicked(btn, v, label) {
    if (btn.dataset.value === String(v)) return;
    btn.dataset.value = v;
    btn.querySelector('span').textContent = label;
    const hidden = btn.dataset.name && btn.parentNode.querySelector('input[type=hidden][name="' + btn.dataset.name + '"]');
    if (hidden) hidden.value = v;
    if (btn.dataset.set) save({ [btn.dataset.set]: v });
    else if (btn.dataset.dev) onDevChange(btn.dataset.dev, v);
  }
  document.addEventListener('mousedown', (e) => { if (flyout && !flyout.el.contains(e.target) && e.target.closest('.st-combo') !== flyout.btn) closeCombo(); }, true);
  window.addEventListener('resize', closeCombo);
  document.addEventListener('scroll', (e) => { if (flyout && !flyout.el.contains(e.target)) closeCombo(); }, true);
  document.addEventListener('keydown', (e) => {
    const b = e.target.closest && e.target.closest('.st-combo');
    if (b && !b.disabled && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (e.altKey && e.key === 'ArrowDown'))) { e.preventDefault(); openCombo(b); }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'find') { showFound(); return; }
    if (el.classList.contains('st-color')) { debouncedAccent(el.value); return; }
    if (el.matches('[data-app-search]')) { data.appQuery = el.value; render(); const f = $('[data-app-search]'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); return; }
    if (el.matches('.st-range')) {
      const v = +el.value;
      const num = el.parentNode.querySelector('.st-num');
      if (num) num.textContent = v;
      if (el.dataset.range) saveRange(el.dataset.range, v);
      if (el.dataset.devRange) setVolume(el.dataset.devRange, v);
    }
  });
  const debouncedAccent = util.debounce((v) => save({ accent: v }), 250);

  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'find') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!found.length) return;
        foundAt = (foundAt + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length;
        document.querySelectorAll('#found .st-hit').forEach((x, i) => x.classList.toggle('on', i === foundAt));
      } else if (e.key === 'Enter') { e.preventDefault(); pickFound(foundAt); } else if (e.key === 'Escape') { e.target.value = ''; $('#found').hidden = true; }
      return;
    }
    // Alt + Left, or Backspace outside a field: back to the previous page
    if ((e.altKey && e.key === 'ArrowLeft') || (e.key === 'Backspace' && !e.target.closest('input, textarea, select'))) {
      if (history.length) { e.preventDefault(); go(history.pop(), true); }
    }
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.id === 'find') setTimeout(() => { const box = $('#found'); if (box && !box.contains(document.activeElement)) box.hidden = true; }, 150);
  });

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    try {
      if (f.dataset.form === 'homepage') {
        await save({ homepage: f.homepage.value });
        OS.notify('The Browser opens this page when it starts.', { type: 'success', title: 'Home page saved' });
      } else if (f.dataset.form === 'quota') {
        const sys = data.system;
        data.system = Object.assign(sys, await OS.api('system.save', { system: { instanceName: sys.instanceName, defaultQuotaMB: +f.quota.value } }));
        OS.notify('New users get ' + f.quota.value + ' MB unless you give them their own limit.', { type: 'success', title: 'Storage saved' });
        render();
      } else if (f.dataset.form === 'localQuota') {
        data.system = Object.assign(data.system, await OS.api('system.save', { system: { defaultLocalQuotaMB: +f.quota.value } }));
        OS.notify('New Local accounts get ' + f.quota.value + ' MB unless you give them their own limit.', { type: 'success', title: 'Storage saved' });
        render();
      }
    } catch (ex) { OS.notify(ex.message, { type: 'error', title: 'Couldn’t save changes' }); }
  });

  // Re-render when settings change (from here, Quick settings or another window), but not while typing in a field.
  OS.onSettings(() => {
    const a = document.activeElement;
    if (a && a.matches && a.matches('input:not([type=range]):not([type=color]), textarea')) return;
    redraw();
  });

  // the clock on Time & language
  setInterval(() => { const c = $('[data-clock]'); if (c) c.textContent = clock(new Date()); }, 15000);

  // ------------------------------------------------------------------ the device bridge
  if (LL) {
    LL.ready.then((caps) => {
      dev.ready = true;
      dev.caps = caps;
      if (!caps) { redraw(); return; }
      if (caps.audio) LL.on('audio', (a) => { data.audio = a; if (page === 'system/sound' && !document.activeElement.matches('.st-range')) redraw(); });
      if (caps.network) LL.on('network', (n) => { data.net = n; if (page === 'home' || page.startsWith('network')) redraw(); });
      if (caps.storage) {
        const drives = async () => { data.drives = await LL.storage.list().catch(() => data.drives); if (page === 'bluetooth/usb' || page === 'system/storage') redraw(); };
        ['device-added', 'device-removed', 'device-ejected'].forEach((n) => LL.on(n, drives));
      }
      if (caps.print) { // the Printers page follows the printers and this user's documents
        LL.on('printers', (list) => { data.printers = list; if (page === 'bluetooth/printers') redraw(); });
        LL.on('print-job', async () => { if (page !== 'bluetooth/printers') return; data.printJobs = await OS.printJobs().catch(() => data.printJobs); redraw(); });
      }
      go(page, true);
    });
  }

  go(page, true);
});
