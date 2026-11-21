/*
 * LiteOS Calculator: Standard, Scientific, Programmer, Date and Converter modes in one small window.
 *
 * The numbers are decimal.js's exact decimals (programmer: BigInt words), the keypad logic is engine.js, the number
 * systems and functions are modes.js, units and dates are convert.js. This file draws the modes and wires keys, the
 * keyboard, the history and memory pane and the menus. History, memory and the choices made (mode, angle unit,
 * units) are kept in /.apps/calculator/state.json on the drive.
 */
LiteOS.ready((OS) => {
  'use strict';

  const D = window.CalcDec;
  const M = window.CalcModes;
  const C = window.CalcConvert;
  const U = OS.util;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = U.escape;
  // Mica: inside the desktop with Transparency effects on, the window is frosted glass and the page lets it through
  if (OS.inShell) document.documentElement.classList.add('in-shell');

  const STATE_DIR = '/.apps/calculator';
  const STATE_FILE = STATE_DIR + '/state.json';
  const MAX_HISTORY = 50;
  const WIDE = 620; // the history and memory pane sits beside the keypad from this width

  const MODES = [
    ['standard', 'Standard'], ['scientific', 'Scientific'], ['programmer', 'Programmer'], ['date', 'Date calculation'],
  ];
  // the modes' glyphs (in-app icons, drawn as LiteOS's line icons), under names of Calculator's own
  const P = window.LOS_ICON_PATHS || {};
  const GLYPHS = {
    standard: 'M6 3h12v18H6z M9 6h6v3H9z M9 13h.01 M12 13h.01 M15 13h.01 M9 17h.01 M12 17h.01 M15 17h.01',
    scientific: 'M9 3h6 M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3 M7.5 15h9',
    programmer: P.code || 'M9 8l-4 4 4 4 M15 8l4 4-4 4 M13.5 5.5l-3 13',
    date: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4 M8 14h.01 M12 14h.01 M16 14h.01 M8 17h.01 M12 17h.01',
    length: 'M8 3h8v18H8z M8 7h3 M8 11h4 M8 15h3 M8 18.5h4',
    area: 'M4 4h16v16H4z M4 10l6-6 M4 16L16 4 M10 20L20 10 M16 20l4-4',
    volume: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9',
    mass: 'M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M7 7h10l3 13H4z',
    temperature: 'M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0z M12 9v7',
    speed: 'M3.5 17a9 9 0 1 1 17 0 M12 17l4.5-5.5 M12 17h.01',
    time: P.clock || 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
    data: P.storage || 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
    energy: 'M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-1.5-3C7.5 10 6 12.5 6 15a6 6 0 0 0 6 6z',
    power: 'M13 3L5 13h6l-1 8 8-10h-6z',
    pressure: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 12l4-4 M7 12h.01 M17 12h.01 M12 7h.01',
    angle: 'M4 20h16 M4 20L16 6 M10 20a6 6 0 0 0-2.1-4.6',
    history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6 M3.5 3.5V8H8 M12 7.5V12l3 2',
  };
  Object.keys(GLYPHS).forEach((k) => { P['calc-' + k] = GLYPHS[k]; });
  const glyph = (m) => 'calc-' + m;

  const modeName = (m) => (C.UNITS[m] ? C.UNITS[m].name : (MODES.find((x) => x[0] === m) || MODES[0])[1]);

  // ------------------------------------------------------------------ number formatting
  // the separators of the user's language
  const sep = (() => {
    const parts = new Intl.NumberFormat(navigator.language || undefined).formatToParts(1234567.5);
    return {
      group: (parts.find((p) => p.type === 'group') || { value: ',' }).value,
      decimal: (parts.find((p) => p.type === 'decimal') || { value: '.' }).value,
    };
  })();
  const groupInt = (s, every, ch) => {
    const out = [];
    for (let i = s.length; i > 0; i -= every) out.unshift(s.slice(Math.max(0, i - every), i));
    return out.join(ch);
  };

  /** A decimal for the display: grouped, at most 16 significant digits, scientific when F-E is on or it won't fit. */
  function fmtDec(v) {
    const p = v.parts(16, state.fe);
    return (p.neg ? '−' : '') + (p.exp === null ? groupInt(p.int, 3, sep.group) : p.int) + (p.frac ? sep.decimal + p.frac : (state.fe && p.exp !== null ? sep.decimal : '')) +
      (p.exp === null ? '' : 'e' + (p.exp < 0 ? '−' : '+') + Math.abs(p.exp));
  }
  /** What's being typed, grouped as it's typed ("1,234.50", "1.2e+5"). */
  function fmtTyped(s) {
    const r = /^(-?)(\d*)(\.?)(\d*)(?:e([+-])(\d*))?$/i.exec(s);
    if (!r) return s;
    return (r[1] ? '−' : '') + groupInt(r[2] || '0', 3, sep.group) + (r[3] ? sep.decimal : '') + r[4] + (r[5] ? 'e' + (r[5] === '-' ? '−' : '+') + r[6] : '');
  }
  /** A programmer value in a radix, grouped: hex and binary by 4, octal by 3, decimal by thousands. */
  function fmtProg(v, radix) {
    const s = M.show(v, radix, prog.bits);
    const neg = s.startsWith('-');
    const body = neg ? s.slice(1) : s;
    const g = radix === 'dec' ? groupInt(body, 3, sep.group) : radix === 'oct' ? groupInt(body, 3, ' ') : groupInt(body, 4, ' ');
    return (neg ? '−' : '') + g;
  }
  /** Text a user typed or pasted, as a decimal: their separators, a minus sign, an exponent. */
  function parseLoose(text) {
    let t = String(text).trim().replace(/[−]/g, '-').replace(/\s/g, '');
    if (sep.group) t = t.split(sep.group).join('');
    if (sep.decimal !== '.') t = t.replace(sep.decimal, '.');
    return D.parse(t);
  }

  // ------------------------------------------------------------------ state
  const state = {
    mode: 'standard',
    angle: 'deg',
    fe: false,
    second: false,
    tab: 'history',
    paneOpen: false, // the pane over the keypad (narrow windows)
    paneHidden: false, // the pane beside the keypad put away (wide windows)
    history: [], // [{ expr, v: Dec }]
    memory: [], // [Dec]
  };
  const prog = { bits: 64, radix: 'dec', pad: false };
  const conv = { cat: 'length', from: 'm', to: 'ft', value: '0', side: 'from', picked: {} };
  const date = { kind: 'diff', a: C.dates.today(), b: C.dates.today(), sign: 1, y: 0, m: 0, d: 0 };

  const decFmtText = (v) => fmtDec(v).replace(/−/g, '-');
  const engines = {
    standard: new window.CalcEngine(M.decimalSystem(decFmtText), true),
    scientific: new window.CalcEngine(M.decimalSystem(decFmtText), false),
    programmer: new window.CalcEngine(M.programmerSystem(prog), false),
  };
  ['standard', 'scientific'].forEach((m) => {
    engines[m].onHistory = (expr, v) => {
      state.history.unshift({ expr, v });
      state.history.length = Math.min(state.history.length, MAX_HISTORY);
      if (state.tab === 'history') renderPane();
      saveSoon();
    };
  });
  const engine = () => engines[state.mode] || null;
  const isDecimal = () => state.mode === 'standard' || state.mode === 'scientific';

  // ------------------------------------------------------------------ keeping state
  async function load() {
    try {
      const r = await OS.fs.read(STATE_FILE, { track: false });
      const s = JSON.parse(String(r.content || '{}'));
      if (s.mode && (engines[s.mode] || s.mode === 'date' || C.UNITS[s.mode])) state.mode = s.mode;
      if (['deg', 'rad', 'grad'].includes(s.angle)) state.angle = s.angle;
      state.fe = !!s.fe;
      state.paneHidden = !!s.paneHidden;
      state.history = (s.history || []).map((h) => ({ expr: String(h.expr || ''), v: D.parse(h.v) })).filter((h) => h.v);
      state.memory = (s.memory || []).map((x) => D.parse(x)).filter(Boolean);
      if ([8, 16, 32, 64].includes(s.bits)) prog.bits = s.bits;
      if (M.RADIX[s.radix]) prog.radix = s.radix;
      if (s.units && typeof s.units === 'object') conv.picked = s.units;
    } catch (e) { /* first start, or an unreadable file: start afresh */ }
  }
  let saving = Promise.resolve();
  function save() {
    const data = {
      mode: state.mode, angle: state.angle, fe: state.fe, paneHidden: state.paneHidden, bits: prog.bits, radix: prog.radix, units: conv.picked,
      history: state.history.map((h) => ({ expr: h.expr, v: h.v.toString(40) })),
      memory: state.memory.map((x) => x.toString(40)),
    };
    const text = JSON.stringify(data);
    saving = saving.then(async () => {
      try { await OS.fs.write(STATE_FILE, text); } catch (e) {
        // the folder isn't there yet
        try { await OS.fs.mkdir('/.apps'); } catch (e2) { /* exists */ }
        try { await OS.fs.mkdir(STATE_DIR); } catch (e2) { /* exists */ }
        try { await OS.fs.write(STATE_FILE, text); } catch (e3) { console.warn('Calculator: could not keep its state', e3); }
      }
    });
  }
  const saveSoon = U.debounce(save, 800);
  OS.win.keepState(() => ({ mode: state.mode, paneOpen: state.paneOpen, tab: state.tab }));

  // ------------------------------------------------------------------ keys
  // [key, label, class, aria-label]
  const K = (k, label, cls, aria) => ({ k, label, cls: cls || '', aria });
  const n = (d) => K(d, d, 'num');
  const sup = (base, s) => base + '<sup>' + s + '</sup>';
  const MEM_KEYS = [K('mc', 'MC', '', 'Clear all memory'), K('mr', 'MR', '', 'Memory recall'), K('mplus', 'M+', '', 'Memory add'),
    K('mminus', 'M−', '', 'Memory subtract'), K('ms', 'MS', '', 'Memory store'), K('mlist', 'M' + OS.icon('down', 12), '', 'Memory list')];

  function standardKeys() {
    return [
      K('pct', '%', '', 'Percent'), K('ce', 'CE', '', 'Clear entry'), K('c', 'C', '', 'Clear'), K('back', '⌫', '', 'Backspace'),
      K('recip', '¹⁄ₓ', '', 'Reciprocal'), K('sqr', sup('x', '2'), '', 'Square'), K('sqrt', '²√x', '', 'Square root'), K('div', '÷', 'op', 'Divide by'),
      n('7'), n('8'), n('9'), K('mul', '×', 'op', 'Multiply by'),
      n('4'), n('5'), n('6'), K('sub', '−', 'op', 'Minus'),
      n('1'), n('2'), n('3'), K('add', '+', 'op', 'Plus'),
      K('neg', '+/−', 'num', 'Positive negative'), n('0'), K('.', sep.decimal, 'num', 'Decimal separator'), K('=', '=', 'eq', 'Equals'),
    ];
  }
  function scientificKeys() {
    const s = state.second;
    return [
      K('2nd', '2<sup>nd</sup>', s ? 'toggle on' : 'toggle', 'Second functions'), K('pi', 'π', '', 'Pi'), K('e', 'e', '', 'Euler’s number'), K('c', 'C', '', 'Clear'), K('back', '⌫', '', 'Backspace'),
      s ? K('cube', sup('x', '3'), '', 'Cube') : K('sqr', sup('x', '2'), '', 'Square'), K('recip', '¹⁄ₓ', '', 'Reciprocal'), K('abs', '|x|', '', 'Absolute value'), K('expo', 'exp', '', 'Exponential notation'), K('mod', 'mod', '', 'Modulo'),
      s ? K('cuberoot', '³√x', '', 'Cube root') : K('sqrt', '²√x', '', 'Square root'), K('(', '(', '', 'Left parenthesis'), K(')', ')', '', 'Right parenthesis'), K('fact', 'n!', '', 'Factorial'), K('div', '÷', 'op', 'Divide by'),
      s ? K('root', sup('', 'y') + '√x', '', 'Y root of x') : K('pow', sup('x', 'y'), '', 'X to the power of y'), n('7'), n('8'), n('9'), K('mul', '×', 'op', 'Multiply by'),
      s ? K('pow2', sup('2', 'x'), '', 'Two to the power of x') : K('pow10', sup('10', 'x'), '', 'Ten to the power of x'), n('4'), n('5'), n('6'), K('sub', '−', 'op', 'Minus'),
      s ? K('logy', 'log<sub>y</sub>x', '', 'Log base y of x') : K('log', 'log', '', 'Log'), n('1'), n('2'), n('3'), K('add', '+', 'op', 'Plus'),
      s ? K('exp', sup('e', 'x'), '', 'E to the power of x') : K('ln', 'ln', '', 'Natural log'), K('neg', '+/−', 'num', 'Positive negative'), n('0'), K('.', sep.decimal, 'num', 'Decimal separator'), K('=', '=', 'eq', 'Equals'),
    ];
  }
  function programmerKeys() {
    const hex = prog.radix === 'hex';
    const L = (d) => K(d, d, hex ? 'num' : 'num off');
    const digit = (d) => K(d, d, Number(d) < M.RADIX[prog.radix] ? 'num' : 'num off');
    return [
      L('A'), K('lsh', '«', '', 'Left shift'), K('rsh', '»', '', 'Right shift'), K('c', 'C', '', 'Clear'), K('back', '⌫', '', 'Backspace'),
      L('B'), K('(', '(', '', 'Left parenthesis'), K(')', ')', '', 'Right parenthesis'), K('mod', '%', '', 'Modulo'), K('div', '÷', 'op', 'Divide by'),
      L('C'), digit('7'), digit('8'), digit('9'), K('mul', '×', 'op', 'Multiply by'),
      L('D'), digit('4'), digit('5'), digit('6'), K('sub', '−', 'op', 'Minus'),
      L('E'), digit('1'), digit('2'), digit('3'), K('add', '+', 'op', 'Plus'),
      L('F'), K('neg', '+/−', 'num', 'Positive negative'), digit('0'), K('.', sep.decimal, 'num off', 'Decimal separator'), K('=', '=', 'eq', 'Equals'),
    ];
  }
  const keyHtml = (k) => '<button type="button" class="key ' + k.cls + '" data-k="' + esc(k.k) + '"' + (k.aria ? ' aria-label="' + esc(k.aria) + '"' : '') +
    (/\boff\b/.test(k.cls) ? ' disabled' : '') + '>' + k.label + '</button>';

  // ------------------------------------------------------------------ drawing the modes
  const main = $('#main');

  function render() {
    $('#modeName').textContent = modeName(state.mode);
    document.body.dataset.mode = C.UNITS[state.mode] ? 'converter' : state.mode;
    if (C.UNITS[state.mode]) renderConverter();
    else if (state.mode === 'date') renderDate();
    else renderKeypad();
    layoutPane();
    setMenus();
  }

  function renderKeypad() {
    const m = state.mode;
    const keys = m === 'standard' ? standardKeys() : m === 'scientific' ? scientificKeys() : programmerKeys();
    let extra = '';
    if (m === 'scientific') {
      extra = '<div class="sci-bar">' +
        '<button type="button" class="bar-btn" data-k="angle" title="Angle unit" aria-label="Angle unit">' + state.angle.toUpperCase() + '</button>' +
        '<button type="button" class="bar-btn' + (state.fe ? ' on' : '') + '" data-k="fe" aria-pressed="' + state.fe + '" title="Scientific notation">F-E</button>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="bar-btn menu-btn" data-k="trigmenu" aria-haspopup="menu">Trigonometry ' + OS.icon('down', 12) + '</button>' +
        '<button type="button" class="bar-btn menu-btn" data-k="fnmenu" aria-haspopup="menu">Function ' + OS.icon('down', 12) + '</button>' +
        '</div>';
    }
    if (m === 'programmer') {
      extra = '<div class="radix" role="radiogroup" aria-label="Number base">' + ['hex', 'dec', 'oct', 'bin'].map((r) =>
        '<button type="button" class="radix-row' + (prog.radix === r ? ' on' : '') + '" role="radio" aria-checked="' + (prog.radix === r) + '" data-radix="' + r + '">' +
        '<span class="radix-name">' + r.toUpperCase() + '</span><span class="radix-val" data-val="' + r + '"></span></button>').join('') + '</div>' +
        '<div class="sci-bar">' +
        '<button type="button" class="bar-btn" data-k="pad" aria-pressed="' + prog.pad + '" title="Bit toggling keypad">' + (prog.pad ? 'Keypad' : 'Bits') + '</button>' +
        '<button type="button" class="bar-btn" data-k="word" title="Word size">' + ({ 64: 'QWORD', 32: 'DWORD', 16: 'WORD', 8: 'BYTE' })[prog.bits] + '</button>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="bar-btn menu-btn" data-k="bitmenu" aria-haspopup="menu">Bitwise ' + OS.icon('down', 12) + '</button>' +
        '<button type="button" class="bar-btn menu-btn" data-k="shiftmenu" aria-haspopup="menu">Bit shift ' + OS.icon('down', 12) + '</button>' +
        '</div>';
    }
    const memRow = isDecimal() ? '<div class="mem-row">' + MEM_KEYS.map((k) => '<button type="button" class="mem-key" data-k="' + k.k + '" aria-label="' + esc(k.aria) + '" title="' + esc(k.aria) + '">' + k.label + '</button>').join('') + '</div>' : '';
    const pad = m === 'programmer' && prog.pad ? '<div class="bitpad" id="bitpad"></div>' : '<div class="keypad cols-' + (m === 'standard' ? 4 : 5) + '">' + keys.map(keyHtml).join('') + '</div>';
    main.innerHTML =
      '<div class="display" aria-live="polite">' +
      '<div class="expr" id="expr"></div>' +
      '<div class="value" id="value" tabindex="-1"></div>' +
      '</div>' + extra + memRow + pad;
    updateDisplay();
  }

  function updateDisplay() {
    const e = engine();
    if (!e) return;
    const exprEl = $('#expr');
    const valEl = $('#value');
    if (!valEl) return;
    exprEl.textContent = e.items.length || (e.cur && e.cur.text) ? e.expression : (e.cur && e.cur.result && e.lastExpression ? e.lastExpression : '');
    let text;
    if (e.error) text = e.error;
    else if (state.mode === 'programmer') text = e.typed != null && !e.cur.fresh ? fmtProg(e.value, prog.radix) : fmtProg(e.value, prog.radix);
    else text = e.typed != null && !e.cur.fresh ? fmtTyped(e.typed) : fmtDec(e.value);
    valEl.textContent = text;
    valEl.classList.toggle('error', !!e.error);
    fit(valEl);
    // keys that make no sense after an error
    main.querySelectorAll('.key, .mem-key, .bar-btn').forEach((b) => {
      const k = b.dataset.k;
      const keep = !k || /^[0-9A-F.]$/.test(k) || k === 'c' || k === 'ce' || k === 'back' || k === '=' || /\boff\b/.test(b.className);
      if (!keep) b.disabled = !!e.error;
    });
    const mr = main.querySelectorAll('[data-k="mc"], [data-k="mr"], [data-k="mlist"]');
    mr.forEach((b) => { if (!e.error) b.disabled = !state.memory.length; });
    if (state.mode === 'programmer') {
      ['hex', 'dec', 'oct', 'bin'].forEach((r) => { const el = main.querySelector('[data-val="' + r + '"]'); if (el) el.textContent = fmtProg(e.value, r); });
      renderBits();
    }
  }
  /** Shrink the big number until it fits the width. */
  function fit(el) {
    const max = state.mode === 'standard' ? 46 : 38;
    let size = max;
    el.style.fontSize = size + 'px';
    while (size > 16 && el.scrollWidth > el.clientWidth) { size -= 2; el.style.fontSize = size + 'px'; }
  }
  new ResizeObserver(() => { const v = $('#value'); if (v) fit(v); layoutPane(); }).observe(document.body);

  // programmer's bit pad: 64 bits in rows of 16, the ones beyond the word size greyed
  function renderBits() {
    const el = $('#bitpad');
    if (!el) return;
    const u = BigInt.asUintN(64, engines.programmer.value);
    let html = '';
    for (let row = 3; row >= 0; row--) {
      html += '<div class="bit-row">';
      for (let nib = 3; nib >= 0; nib--) {
        html += '<div class="nibble">';
        for (let b = 3; b >= 0; b--) {
          const i = row * 16 + nib * 4 + b;
          const on = (u >> BigInt(i)) & 1n;
          html += '<button type="button" class="bit' + (on ? ' on' : '') + '" data-bit="' + i + '"' + (i >= prog.bits ? ' disabled' : '') + ' aria-label="Bit ' + i + '" aria-pressed="' + !!on + '">' + on + '</button>';
        }
        html += '<span class="bit-num">' + (row * 16 + nib * 4) + '</span></div>';
      }
      html += '</div>';
    }
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------ keypad actions
  const UNARY_LABEL = {
    sqr: 'sqr', cube: 'cube', sqrt: '√', cuberoot: 'cuberoot', recip: '1/', abs: 'abs', floor: 'floor', ceil: 'ceil', fact: 'fact',
    pow10: '10^', pow2: '2^', exp: 'e^', log: 'log', ln: 'ln', dms: 'dms', deg: 'degrees',
  };
  const BINARY = ['add', 'sub', 'mul', 'div', 'mod', 'pow', 'root', 'logy', 'lsh', 'rsh', 'rol', 'ror', 'and', 'or', 'xor', 'nand', 'nor'];

  function press(k) {
    const e = engine();
    if (!e) return;
    if (/^[0-9A-F]$/.test(k)) e.digit(k);
    else if (k === '.') { if (state.mode !== 'programmer') e.point(); }
    else if (k === 'back') e.backspace();
    else if (k === 'ce') e.clearEntry();
    else if (k === 'c') e.clear();
    else if (k === 'neg') e.negate();
    else if (k === '=') e.equals();
    else if (k === '(') e.open();
    else if (k === ')') e.close();
    else if (k === 'pct') e.percent();
    else if (k === 'expo') e.exp();
    else if (k === 'pi') e.put(D.PI, 'π');
    else if (k === 'e') e.put(D.E, 'e');
    else if (k === 'rand') e.put(D.fromNumber(Math.random()));
    else if (k === 'not') e.unary('NOT', (x) => e.sys.not(x));
    else if (BINARY.includes(k)) { if (e.sys.ops[k]) e.binary(k); }
    else if (M.fns[k]) e.unary(k, M.fns[k], UNARY_LABEL[k]);
    else if (M.trig[k]) e.unary(k, (x) => M.trig[k](x, state.angle), k.replace(/^a(sin|cos|tan)(h?)$/, '$1$2⁻¹').replace(/^(sin|cos|tan)$/, '$1' + (state.angle === 'rad' ? 'ᵣ' : state.angle === 'grad' ? 'ᴳ' : '₀')));
    else if (memory(k)) return;
    else if (k === '2nd') { state.second = !state.second; renderKeypad(); return; }
    else if (k === 'angle') { state.angle = { deg: 'rad', rad: 'grad', grad: 'deg' }[state.angle]; renderKeypad(); saveSoon(); return; }
    else if (k === 'fe') { state.fe = !state.fe; renderKeypad(); saveSoon(); return; }
    else if (k === 'pad') { prog.pad = !prog.pad; renderKeypad(); return; }
    else if (k === 'word') { setBits({ 64: 32, 32: 16, 16: 8, 8: 64 }[prog.bits]); return; }
    else return;
    updateDisplay();
  }

  function memory(k) {
    if (!['mc', 'mr', 'mplus', 'mminus', 'ms', 'mlist'].includes(k) || !isDecimal()) return false;
    if (k === 'mlist') { showPane('memory'); return true; }
    const e = engine();
    const v = e.value;
    if (k === 'ms') state.memory.unshift(v);
    else if (k === 'mc') state.memory = [];
    else if (k === 'mr') { if (state.memory.length) e.put(state.memory[0]); }
    else if (k === 'mplus' || k === 'mminus') {
      if (!state.memory.length) state.memory.unshift(D.ZERO);
      state.memory[0] = k === 'mplus' ? state.memory[0].add(v) : state.memory[0].sub(v);
    }
    // a value stored is a value finished with: the next digit starts a new one
    if (k !== 'mr' && e.cur && !e.cur.text) e.cur.result = true;
    if (state.tab === 'memory' || k === 'ms') renderPane();
    updateDisplay();
    saveSoon();
    return true;
  }

  function setBits(bits) {
    const e = engines.programmer;
    prog.bits = bits;
    // the value is cut to the new word
    const v = e.sys.wrap(e.value);
    e.clear();
    if (v !== 0n) e.put(v);
    renderKeypad();
    saveSoon();
  }
  function setRadix(r) {
    const e = engines.programmer;
    const v = e.value;
    prog.radix = r;
    e.clear();
    if (v !== 0n) e.put(v);
    renderKeypad();
    saveSoon();
  }

  main.addEventListener('click', (ev) => {
    const radix = ev.target.closest('[data-radix]');
    if (radix) { setRadix(radix.dataset.radix); return; }
    const bit = ev.target.closest('[data-bit]');
    if (bit) {
      const e = engines.programmer;
      const v = e.sys.wrap(e.value ^ (1n << BigInt(bit.dataset.bit)));
      e.put(v);
      updateDisplay();
      return;
    }
    const b = ev.target.closest('[data-k]');
    if (!b || b.disabled || !main.contains(b)) return;
    const k = b.dataset.k;
    if (k === 'trigmenu') { openTrigMenu(b); return; }
    if (k === 'fnmenu') { openFnMenu(b); return; }
    if (k === 'bitmenu') { openBitMenu(b); return; }
    if (k === 'shiftmenu') { openShiftMenu(b); return; }
    if (b.closest('.conv') || b.closest('.datec')) return; // their own handlers
    press(k);
  });

  const below = (b) => { const r = b.getBoundingClientRect(); return { x: r.left, y: r.bottom + 2 }; };
  function openTrigMenu(b) {
    const it = (k, label) => ({ label, action: () => { press(k); } });
    OS.menu([
      it('sin', 'sin'), it('cos', 'cos'), it('tan', 'tan'), it('sec', 'sec'), it('csc', 'csc'), it('cot', 'cot'), 'sep',
      it('asin', 'sin⁻¹'), it('acos', 'cos⁻¹'), it('atan', 'tan⁻¹'), 'sep',
      it('sinh', 'sinh'), it('cosh', 'cosh'), it('tanh', 'tanh'), it('asinh', 'sinh⁻¹'), it('acosh', 'cosh⁻¹'), it('atanh', 'tanh⁻¹'),
    ], below(b));
  }
  function openFnMenu(b) {
    const it = (k, label) => ({ label, action: () => press(k) });
    OS.menu([it('abs', 'Absolute value |x|'), it('floor', 'Floor ⌊x⌋'), it('ceil', 'Ceiling ⌈x⌉'), it('rand', 'Random number'), 'sep',
      it('dms', 'Degrees to degrees, minutes, seconds'), it('deg', 'Degrees, minutes, seconds to degrees')], below(b));
  }
  function openBitMenu(b) {
    const it = (k, label) => ({ label, action: () => press(k) });
    OS.menu([it('and', 'AND'), it('or', 'OR'), it('not', 'NOT'), it('nand', 'NAND'), it('nor', 'NOR'), it('xor', 'XOR')], below(b));
  }
  function openShiftMenu(b) {
    const it = (k, label) => ({ label, action: () => press(k) });
    OS.menu([{ header: 'Arithmetic' }, it('lsh', 'Shift left'), it('rsh', 'Shift right'), { header: 'Circular' }, it('rol', 'Rotate left'), it('ror', 'Rotate right')], below(b));
  }

  // ------------------------------------------------------------------ smooth scrolling
  /** Mouse-wheel steps glide to where they'd land instead of jumping (not with reduced motion). */
  function smoothWheel(el) {
    let target = null;
    let raf = 0;
    const step = () => {
      const d = target - el.scrollTop;
      if (Math.abs(d) < 1) { el.scrollTop = target; target = null; raf = 0; return; }
      el.scrollTop += Math.sign(d) * Math.max(1, Math.abs(d) * 0.2);
      raf = requestAnimationFrame(step);
    };
    el.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.shiftKey || document.documentElement.dataset.motion === 'reduce') return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 36 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      target = Math.max(0, Math.min(max, (raf ? target : el.scrollTop) + delta));
      if (!raf) raf = requestAnimationFrame(step);
    }, { passive: false });
  }

  // ------------------------------------------------------------------ the mode drop-down
  // A flyout over the mode's name, the current mode where the name is (as a Windows combo box opens), as tall as
  // the window allows and scrolling past that. Arrow keys, Home and End move; Enter picks; Escape or a click outside
  // closes.
  const modeBtn = $('#modeBtn');
  $('#modeCaret').outerHTML = OS.icon('down', 14);
  let modes = null;
  function modeRow([id, label]) {
    const on = state.mode === id;
    return '<button type="button" class="mode-row' + (on ? ' on' : '') + '" role="option" aria-selected="' + on + '" data-mode="' + id + '">' +
      OS.icon(glyph(id), 18) + '<span>' + esc(label) + '</span></button>';
  }
  function openModes() {
    closeModes();
    closeCombo();
    closePicker();
    const el = document.createElement('div');
    el.className = 'st-flyout mode-fly';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', 'Mode');
    el.innerHTML = '<div class="mode-head" role="presentation">Calculator</div>' + MODES.map(modeRow).join('') +
      '<div class="mode-head" role="presentation">Converter</div>' + Object.keys(C.UNITS).map((id) => modeRow([id, C.UNITS[id].name])).join('');
    document.body.appendChild(el);
    const edge = 6;
    const r = modeBtn.getBoundingClientRect();
    const cur = el.querySelector('.mode-row.on') || el.querySelector('.mode-row');
    el.style.maxHeight = (window.innerHeight - edge * 2) + 'px';
    el.style.left = Math.max(edge, r.left - 4) + 'px';
    // put the current row over the button; what doesn't fit above or below scrolls
    const h = el.offsetHeight;
    const want = r.top + r.height / 2 - (cur.offsetTop + cur.offsetHeight / 2);
    const top = Math.max(edge, Math.min(want, window.innerHeight - edge - h));
    el.style.top = top + 'px';
    if (el.scrollHeight > el.clientHeight) el.scrollTop = Math.max(0, top - want);
    modeBtn.setAttribute('aria-expanded', 'true');
    modes = el;
    smoothWheel(el);
    cur.focus({ preventScroll: true });
    el.addEventListener('click', (e) => {
      const row = e.target.closest('[data-mode]');
      if (!row) return;
      closeModes(true);
      setMode(row.dataset.mode);
    });
    el.addEventListener('keydown', (e) => {
      const rows = Array.from(el.querySelectorAll('.mode-row'));
      const at = rows.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); rows[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); rows[rows.length - 1].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeModes(true); }
      e.stopPropagation();
    });
  }
  function closeModes(refocus) {
    if (!modes) return;
    modes.remove();
    modes = null;
    modeBtn.setAttribute('aria-expanded', 'false');
    if (refocus) modeBtn.focus();
  }
  modeBtn.addEventListener('click', () => { if (modes) closeModes(); else openModes(); });
  modeBtn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || (e.altKey && e.key === 'ArrowDown')) { e.preventDefault(); openModes(); } });
  document.addEventListener('mousedown', (e) => { if (modes && !modes.contains(e.target) && !modeBtn.contains(e.target)) closeModes(); }, true);
  window.addEventListener('resize', () => closeModes());

  function setMode(m) {
    if (state.mode === m) return;
    state.mode = m;
    if (C.UNITS[m]) setCategory(m);
    render();
    saveSoon();
  }

  // ------------------------------------------------------------------ converter
  function setCategory(cat) {
    const u = C.UNITS[cat];
    const p = conv.picked[cat] || {};
    conv.cat = cat;
    conv.from = u.units.some((x) => x[0] === p.from) ? p.from : u.from;
    conv.to = u.units.some((x) => x[0] === p.to) ? p.to : u.to;
    conv.value = '0';
    conv.side = 'from';
  }
  function convResult() {
    const v = D.parse(conv.value.replace(/\.$/, '')) || D.ZERO;
    const [a, b] = conv.side === 'from' ? [conv.from, conv.to] : [conv.to, conv.from];
    return C.convert(conv.cat, v, a, b);
  }
  function renderConverter() {
    const cat = C.UNITS[conv.cat];
    const unit = (id) => C.unitOf(conv.cat, id);
    const side = (s) => {
      const id = conv[s];
      const active = conv.side === s;
      const text = active ? fmtTyped(conv.value) : fmtDec(convResult());
      return '<div class="conv-side' + (active ? ' on' : '') + '">' +
        '<button type="button" class="conv-value" data-side="' + s + '" aria-label="' + esc(unit(id)[1]) + '">' + esc(text) + '</button>' +
        comboHtml('unit-' + s, cat.units.map((u) => [u[0], u[1]]), id, s === 'from' ? 'From unit' : 'To unit') + '</div>';
    };
    main.innerHTML = '<div class="conv">' + side('from') +
      '<div class="conv-swap"><button type="button" class="icon-btn" id="swap" title="Swap units" aria-label="Swap units">' + OS.icon('down', 16) + OS.icon('up', 16) + '</button></div>' +
      side('to') + '</div>' +
      '<div class="keypad cols-3 conv-keys">' + [
        K('blank', '', 'blank'), K('ce', 'CE', '', 'Clear entry'), K('back', '⌫', '', 'Backspace'),
        n('7'), n('8'), n('9'), n('4'), n('5'), n('6'), n('1'), n('2'), n('3'),
        K('neg', '+/−', 'num' + (conv.cat === 'temperature' ? '' : ' off'), 'Positive negative'), n('0'), K('.', sep.decimal, 'num', 'Decimal separator'),
      ].map(keyHtml).join('') + '</div>';
    main.querySelectorAll('.conv-value').forEach(fitConv);
    const blank = main.querySelector('[data-k="blank"]');
    if (blank) { blank.disabled = true; blank.setAttribute('aria-hidden', 'true'); blank.tabIndex = -1; }
  }
  function fitConv(el) {
    let size = 34;
    el.style.fontSize = size + 'px';
    while (size > 14 && el.scrollWidth > el.clientWidth) { size -= 2; el.style.fontSize = size + 'px'; }
  }
  function convPress(k) {
    let s = conv.value;
    if (/^[0-9]$/.test(k)) {
      const body = s.replace('-', '');
      if (body.replace('.', '').length >= 16) return;
      s = (body === '0' ? (s.startsWith('-') ? '-' : '') : s) + k;
    } else if (k === '.') { if (!s.includes('.')) s += '.'; }
    else if (k === 'back') { s = s.slice(0, -1); if (s === '' || s === '-') s = '0'; }
    else if (k === 'ce') s = '0';
    else if (k === 'neg') { if (conv.cat !== 'temperature') return; s = s.startsWith('-') ? s.slice(1) : (s === '0' ? s : '-' + s); }
    else return;
    conv.value = s;
    renderConverter();
  }
  function convPick(side, id) {
    conv[side] = id;
    conv.picked[conv.cat] = { from: conv.from, to: conv.to };
    renderConverter();
    saveSoon();
  }
  main.addEventListener('click', (ev) => {
    if (!main.querySelector('.conv')) return;
    const val = ev.target.closest('.conv-value');
    if (val) {
      if (conv.side !== val.dataset.side) {
        // the other side becomes the one typed into, starting from what it shows
        const shown = convResult().toString(16);
        conv.value = /e/.test(shown) ? '0' : shown;
        conv.side = val.dataset.side;
        renderConverter();
      }
      return;
    }
    if (ev.target.closest('#swap')) {
      [conv.from, conv.to] = [conv.to, conv.from];
      conv.picked[conv.cat] = { from: conv.from, to: conv.to };
      renderConverter();
      saveSoon();
      return;
    }
    const b = ev.target.closest('.conv-keys [data-k]');
    if (b && !b.disabled) convPress(b.dataset.k);
  });

  // ------------------------------------------------------------------ date calculation
  const longDate = (x) => new Date(x.y, x.m, x.d).toLocaleDateString(navigator.language || undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  function renderDate() {
    const kinds = [['diff', 'Difference between dates'], ['add', 'Add or subtract days']];
    let body = '';
    if (date.kind === 'diff') {
      const r = C.dates.difference(date.a, date.b);
      const parts = [];
      if (r.years) parts.push(plural(r.years, 'year', 'years'));
      if (r.months) parts.push(plural(r.months, 'month', 'months'));
      if (r.weeks) parts.push(plural(r.weeks, 'week', 'weeks'));
      if (r.rest) parts.push(plural(r.rest, 'day', 'days'));
      body = dateField('From', 'a') + dateField('To', 'b') +
        '<div class="date-out"><div class="label">Difference</div>' +
        '<div class="date-big">' + esc(r.days === 0 ? 'Same dates' : parts.join(', ')) + '</div>' +
        (r.days && (r.years || r.months || r.weeks) ? '<div class="hint">' + esc(plural(r.days, 'day', 'days')) + '</div>' : '') + '</div>';
    } else {
      const res = C.dates.add(date.a, date.y, date.m, date.d, date.sign);
      const num = (key, label) => '<label class="field date-num"><span>' + label + '</span><input class="input" inputmode="numeric" data-num="' + key + '" value="' + date[key] + '" aria-label="' + label + '"></label>';
      body = dateField('From', 'a') +
        '<div class="seg date-sign" role="radiogroup" aria-label="Add or subtract">' +
        '<button type="button" role="radio" data-sign="1" class="' + (date.sign > 0 ? 'active' : '') + '" aria-checked="' + (date.sign > 0) + '">Add</button>' +
        '<button type="button" role="radio" data-sign="-1" class="' + (date.sign < 0 ? 'active' : '') + '" aria-checked="' + (date.sign < 0) + '">Subtract</button></div>' +
        '<div class="date-nums">' + num('y', 'Years') + num('m', 'Months') + num('d', 'Days') + '</div>' +
        '<div class="date-out"><div class="label">Date</div><div class="date-big">' + esc(longDate(res)) + '</div></div>';
    }
    main.innerHTML = '<div class="datec">' + comboHtml('date-kind', kinds, date.kind, 'Calculation') + body + '</div>';
  }
  const dateField = (label, key) => '<div class="field"><span>' + label + '</span><button type="button" class="date-btn" data-date="' + key + '" aria-haspopup="dialog">' +
    '<span>' + esc(longDate(date[key])) + '</span>' + OS.icon('calendar', 16) + '</button></div>';

  main.addEventListener('click', (ev) => {
    if (!main.querySelector('.datec')) return;
    const db = ev.target.closest('[data-date]');
    if (db) { openDatePicker(db, date[db.dataset.date], (x) => { date[db.dataset.date] = x; renderDate(); }); return; }
    const sg = ev.target.closest('[data-sign]');
    if (sg) { date.sign = +sg.dataset.sign; renderDate(); }
  });
  main.addEventListener('input', (ev) => {
    const el = ev.target.closest('[data-num]');
    if (!el) return;
    const v = el.value.replace(/\D/g, '').slice(0, 4);
    if (v !== el.value) el.value = v;
    date[el.dataset.num] = Math.min(9999, parseInt(v || '0', 10));
    const res = C.dates.add(date.a, date.y, date.m, date.d, date.sign);
    const out = main.querySelector('.date-out .date-big');
    if (out) out.textContent = longDate(res);
  });

  // the date picker: a month of days in a flyout under its button
  let picker = null;
  function closePicker() { if (picker) { picker.el.remove(); picker.btn.setAttribute('aria-expanded', 'false'); picker = null; } }
  function openDatePicker(btn, value, onPick) {
    closePicker();
    closeCombo();
    const el = document.createElement('div');
    el.className = 'st-flyout date-fly';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Choose a date');
    document.body.appendChild(el);
    let view = { y: value.y, m: value.m };
    let focus = { ...value };
    const first = (() => { try { const l = new Intl.Locale(navigator.language || 'en'); const w = (l.getWeekInfo && l.getWeekInfo()) || l.weekInfo; return w ? w.firstDay % 7 : 1; } catch (e) { return 1; } })();
    const t = C.dates.today();
    const same = (a, b) => a.y === b.y && a.m === b.m && a.d === b.d;
    function draw() {
      const title = new Date(view.y, view.m, 1).toLocaleDateString(navigator.language || undefined, { month: 'long', year: 'numeric' });
      const dayNames = [];
      for (let i = 0; i < 7; i++) dayNames.push(new Date(2024, 0, 7 + ((first + i) % 7)).toLocaleDateString(navigator.language || undefined, { weekday: 'narrow' }));
      const start = (new Date(view.y, view.m, 1).getDay() - first + 7) % 7;
      const days = C.dates.daysIn(view.y, view.m);
      let cells = '';
      for (let i = 0; i < start; i++) cells += '<span></span>';
      for (let d = 1; d <= days; d++) {
        const x = { y: view.y, m: view.m, d };
        cells += '<button type="button" class="day' + (same(x, value) ? ' on' : '') + (same(x, t) ? ' today' : '') + '" data-day="' + d + '" tabindex="' + (same(x, focus) ? 0 : -1) + '">' + d + '</button>';
      }
      el.innerHTML = '<div class="cal-head"><button type="button" class="icon-btn" data-nav="-1" aria-label="Previous month">' + OS.icon('up', 16) + '</button>' +
        '<span class="cal-title">' + esc(title) + '</span>' +
        '<button type="button" class="icon-btn" data-nav="1" aria-label="Next month">' + OS.icon('down', 16) + '</button></div>' +
        '<div class="cal-grid">' + dayNames.map((x) => '<span class="dow">' + esc(x) + '</span>').join('') + cells + '</div>' +
        '<div class="cal-foot"><button type="button" class="btn btn-sm btn-ghost" data-today>Today</button></div>';
      const f = el.querySelector('.day[tabindex="0"]');
      if (f) f.focus();
    }
    function moveFocus(days) {
      const x = C.dates.fromUtc(C.dates.utc(focus) + days * 86400000);
      focus = x;
      view = { y: x.y, m: x.m };
      draw();
    }
    el.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { const mm = view.m + +nav.dataset.nav; view = { y: view.y + Math.floor(mm / 12), m: ((mm % 12) + 12) % 12 }; focus = { y: view.y, m: view.m, d: 1 }; draw(); return; }
      const day = e.target.closest('[data-day]');
      if (day) { onPick({ y: view.y, m: view.m, d: +day.dataset.day }); closePicker(); btnRefocus(btn); return; }
      if (e.target.closest('[data-today]')) { onPick(C.dates.today()); closePicker(); btnRefocus(btn); }
    });
    el.addEventListener('keydown', (e) => {
      const map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (map[e.key] && e.target.closest('.day')) { e.preventDefault(); moveFocus(map[e.key]); }
      else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); const x = C.dates.add(focus, 0, 1, 0, e.key === 'PageUp' ? -1 : 1); focus = x; view = { y: x.y, m: x.m }; draw(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePicker(); btn.focus(); }
    });
    draw();
    place(el, btn);
    btn.setAttribute('aria-expanded', 'true');
    picker = { el, btn };
  }
  // the date buttons are drawn again after a pick: focus the new one
  function btnRefocus(btn) { const k = btn.dataset.date; const nb = k && main.querySelector('[data-date="' + k + '"]'); if (nb) nb.focus(); }

  // ------------------------------------------------------------------ combo box
  // As in Settings: a button showing the choice, opening a flyout of choices under it. Arrow keys, Home and End and
  // a letter move; Enter or Space picks; Escape or a click outside closes.
  function comboHtml(id, opts, value, aria) {
    const cur = opts.find((o) => o[0] === value) || opts[0];
    return '<button type="button" class="combo" id="' + id + '" data-value="' + esc(cur[0]) + '" aria-haspopup="listbox" aria-expanded="false" aria-label="' + esc(aria) + '">' +
      '<span>' + esc(cur[1]) + '</span>' + OS.icon('down', 14) + '</button>';
  }
  function comboOptions(btn) {
    if (btn.id === 'date-kind') return [['diff', 'Difference between dates'], ['add', 'Add or subtract days']];
    return C.UNITS[conv.cat].units.map((u) => [u[0], u[1]]);
  }
  function comboPicked(btn, v) {
    if (btn.id === 'date-kind') { date.kind = v; renderDate(); const nb = $('#date-kind'); if (nb) nb.focus(); return; }
    convPick(btn.id === 'unit-from' ? 'from' : 'to', v);
    const nb = $('#' + btn.id);
    if (nb) nb.focus();
  }
  let flyout = null;
  function place(el, btn) {
    const r = btn.getBoundingClientRect();
    const gap = 4;
    const edge = 8;
    const below = window.innerHeight - r.bottom - gap - edge;
    const above = r.top - gap - edge;
    const up = el.offsetHeight > below && above > below;
    el.style.maxHeight = Math.min(340, up ? above : below) + 'px';
    el.style.top = (up ? r.top - gap - Math.min(el.offsetHeight, Math.min(340, above)) : r.bottom + gap) + 'px';
    el.classList.toggle('up', up);
    el.style.left = Math.max(edge, Math.min(r.left, window.innerWidth - el.offsetWidth - edge)) + 'px';
  }
  function openCombo(btn) {
    closeCombo();
    closePicker();
    const opts = comboOptions(btn);
    let at = Math.max(0, opts.findIndex((o) => o[0] === btn.dataset.value));
    const el = document.createElement('div');
    el.className = 'st-flyout';
    el.setAttribute('role', 'listbox');
    el.setAttribute('aria-label', btn.getAttribute('aria-label') || '');
    el.innerHTML = opts.map(([, l], i) => '<button type="button" class="st-opt' + (i === at ? ' on' : '') + '" role="option" data-i="' + i + '" aria-selected="' + (i === at) + '">' + esc(l) + '</button>').join('');
    document.body.appendChild(el);
    el.style.minWidth = btn.getBoundingClientRect().width + 'px';
    place(el, btn);
    const item = el.children[at];
    if (el.scrollHeight > el.clientHeight) el.scrollTop = item.offsetTop - el.clientHeight / 2;
    btn.setAttribute('aria-expanded', 'true');
    const mark = (i) => {
      at = (i + opts.length) % opts.length;
      Array.from(el.children).forEach((c, j) => { c.classList.toggle('on', j === at); c.setAttribute('aria-selected', j === at); });
      el.children[at].focus();
    };
    const pick = (i) => { closeCombo(); comboPicked(btn, opts[i][0]); };
    el.addEventListener('click', (e) => { const o = e.target.closest('.st-opt'); if (o) pick(+o.dataset.i); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); mark(at + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); mark(at - 1); }
      else if (e.key === 'Home') { e.preventDefault(); mark(0); }
      else if (e.key === 'End') { e.preventDefault(); mark(opts.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(at); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeCombo(); btn.focus(); }
      else if (e.key.length === 1) {
        const ch = e.key.toLowerCase();
        const nx = opts.findIndex(([, l], i) => i > at && String(l).toLowerCase().startsWith(ch));
        const m = nx >= 0 ? nx : opts.findIndex(([, l]) => String(l).toLowerCase().startsWith(ch));
        if (m >= 0) mark(m);
      }
      e.stopPropagation();
    });
    flyout = { el, btn };
    smoothWheel(el);
    item.focus();
  }
  function closeCombo() {
    if (!flyout) return;
    flyout.btn.setAttribute('aria-expanded', 'false');
    flyout.el.remove();
    flyout = null;
  }
  main.addEventListener('click', (e) => {
    const b = e.target.closest('.combo');
    if (!b) return;
    if (flyout && flyout.btn === b) closeCombo(); else openCombo(b);
  });
  document.addEventListener('mousedown', (e) => {
    if (flyout && !flyout.el.contains(e.target) && e.target.closest('.combo') !== flyout.btn) closeCombo();
    if (picker && !picker.el.contains(e.target) && e.target.closest('[data-date]') !== picker.btn) closePicker();
  }, true);
  window.addEventListener('resize', () => { closeCombo(); closePicker(); });

  // ------------------------------------------------------------------ history and memory pane
  const pane = $('#pane');
  smoothWheel($('#paneList'));
  const paneBtn = $('#paneBtn');
  paneBtn.innerHTML = OS.icon(glyph('history'), 18);
  $('#paneClear').innerHTML = OS.icon('trash', 16);

  function wide() { return document.body.clientWidth >= WIDE; }
  /** Whether the pane shows: beside the keypad in a wide window (unless put away), over it in a narrow one when opened. */
  function paneShown() { return isDecimal() && (wide() ? !state.paneHidden : state.paneOpen); }
  function layoutPane() {
    const has = isDecimal();
    const docked = has && wide() && !state.paneHidden;
    const show = paneShown();
    document.body.classList.toggle('pane-docked', docked);
    paneBtn.hidden = !has;
    if (pane.hidden === show) { pane.hidden = !show; if (show) renderPane(); }
    pane.classList.toggle('over', show && !docked);
    document.body.classList.toggle('pane-over', show && !docked);
    // over the keypad only, as Windows does: the display and the memory keys stay in sight
    const pad = main.querySelector('.keypad');
    pane.style.top = show && !docked && pad ? pad.offsetTop + 'px' : '';
    paneBtn.setAttribute('aria-expanded', String(show));
    paneBtn.classList.toggle('active', show);
    if (shownBefore !== show) { shownBefore = show; setMenus(); }
  }
  let shownBefore = null;
  function togglePane() {
    if (wide()) { state.paneHidden = !state.paneHidden; saveSoon(); } else {
      // the history button shows history over the keypad (M▾ shows memory)
      state.paneOpen = !state.paneOpen;
      if (state.paneOpen && state.tab !== 'history') { state.tab = 'history'; renderPane(); }
    }
    layoutPane();
  }
  function showPane(tab) {
    state.tab = tab;
    if (wide()) { if (state.paneHidden) { state.paneHidden = false; saveSoon(); } } else state.paneOpen = true;
    layoutPane();
    renderPane();
  }
  function renderPane() {
    pane.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === state.tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    const list = $('#paneList');
    const clear = $('#paneClear');
    if (state.tab === 'history') {
      list.innerHTML = state.history.length ? state.history.map((h, i) =>
        '<button type="button" class="h-row" role="listitem" data-h="' + i + '"><span class="h-expr">' + esc(h.expr) + '</span><span class="h-val">' + esc(fmtDec(h.v)) + '</span></button>').join('')
        : '<div class="pane-empty">There’s no history yet</div>';
      clear.title = 'Clear history';
      clear.setAttribute('aria-label', 'Clear history');
      clear.hidden = !state.history.length;
    } else {
      list.innerHTML = state.memory.length ? state.memory.map((v, i) =>
        '<div class="m-row" role="listitem" data-m="' + i + '"><button type="button" class="m-val" data-mrecall="' + i + '" title="Use this value">' + esc(fmtDec(v)) + '</button>' +
        '<span class="m-acts"><button type="button" class="m-act danger" data-mact="clear" data-i="' + i + '" title="Clear this memory" aria-label="Clear this memory">MC</button>' +
        '<button type="button" class="m-act" data-mact="add" data-i="' + i + '" title="Add to this memory" aria-label="Add to this memory">M+</button>' +
        '<button type="button" class="m-act" data-mact="sub" data-i="' + i + '" title="Subtract from this memory" aria-label="Subtract from this memory">M−</button></span></div>').join('')
        : '<div class="pane-empty">There’s nothing saved in memory</div>';
      clear.title = 'Clear all memory';
      clear.setAttribute('aria-label', 'Clear all memory');
      clear.hidden = !state.memory.length;
    }
  }
  pane.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; renderPane(); return; }
    const h = e.target.closest('[data-h]');
    const en = engine();
    if (h && en) { en.put(state.history[+h.dataset.h].v); updateDisplay(); closeOverPane(); return; }
    const mr = e.target.closest('[data-mrecall]');
    if (mr && en) { en.put(state.memory[+mr.dataset.mrecall]); updateDisplay(); closeOverPane(); return; }
    const act = e.target.closest('[data-mact]');
    if (act && en) {
      const i = +act.dataset.i;
      if (act.dataset.mact === 'clear') state.memory.splice(i, 1);
      else state.memory[i] = act.dataset.mact === 'add' ? state.memory[i].add(en.value) : state.memory[i].sub(en.value);
      renderPane(); updateDisplay(); saveSoon();
      return;
    }
    if (e.target.closest('#paneClear')) {
      if (state.tab === 'history') state.history = []; else state.memory = [];
      renderPane(); updateDisplay(); saveSoon();
    }
  });
  function closeOverPane() { if (!wide() && state.paneOpen) { state.paneOpen = false; layoutPane(); } }
  paneBtn.addEventListener('click', togglePane);
  document.addEventListener('mousedown', (e) => {
    if (state.paneOpen && !wide() && !pane.contains(e.target) && !paneBtn.contains(e.target)) { state.paneOpen = false; layoutPane(); }
  });

  // ------------------------------------------------------------------ clipboard
  async function copy() {
    let text = '';
    const e = engine();
    if (e) text = e.error ? '' : state.mode === 'programmer' ? M.show(e.value, prog.radix, prog.bits) : e.value.toString(32);
    else if (C.UNITS[state.mode]) text = convResult().toString(32);
    else if (state.mode === 'date') { const o = main.querySelector('.date-out .date-big'); text = o ? o.textContent : ''; }
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch (err) { OS.notify('Couldn’t copy to the clipboard.', 'error'); }
  }
  async function paste() {
    let text;
    try { text = await navigator.clipboard.readText(); } catch (err) { OS.notify('Couldn’t read the clipboard.', 'error'); return; }
    pasteText(text);
  }
  function pasteText(text) {
    const e = engine();
    if (e && state.mode === 'programmer') {
      const t = String(text).trim().replace(/\s/g, '').replace(/^0[xob]/i, '');
      const v = e.sys.parse(prog.radix === 'hex' ? t.toUpperCase() : t);
      if (v == null) { OS.notify('That isn’t a number this mode can use.', 'error'); return; }
      e.put(v); updateDisplay(); return;
    }
    const v = parseLoose(text);
    if (!v) { OS.notify('That isn’t a number.', 'error'); return; }
    if (e) { e.put(v); updateDisplay(); }
    else if (C.UNITS[state.mode]) { conv.value = v.toString(16); if (/e/.test(conv.value)) conv.value = '0'; renderConverter(); }
  }
  document.addEventListener('paste', (e) => {
    if (e.target.closest && e.target.closest('input')) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData('text'));
  });

  // ------------------------------------------------------------------ keyboard
  const KEYMAP = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '=': '=', Enter: '=', Backspace: 'back', Escape: 'c', Delete: 'ce', '(': '(', ')': ')', F9: 'neg' };
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, .st-flyout')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    // Alt+1… switches modes
    if (e.altKey && !ctrl && /^[1-4]$/.test(e.key)) { e.preventDefault(); setMode(MODES[+e.key - 1][0]); return; }
    if (ctrl && !e.altKey) {
      const k = e.key.toLowerCase();
      const mem = { m: 'ms', r: 'mr', p: 'mplus', q: 'mminus', l: 'mc' }[k];
      if (mem && isDecimal()) { e.preventDefault(); memory(mem); return; }
      if (k === 'h' && isDecimal()) { e.preventDefault(); togglePane(); return; }
      if (k === 'c' && !String(window.getSelection())) { e.preventDefault(); copy(); return; }
      if (k === 'v') return; // the paste event handles it
      if (k === 'd' && isDecimal()) { e.preventDefault(); state.history = []; renderPane(); saveSoon(); return; }
      return;
    }
    if (e.altKey) return;
    if (C.UNITS[state.mode]) {
      const k = /^[0-9]$/.test(e.key) ? e.key : e.key === '.' || e.key === sep.decimal ? '.' : { Backspace: 'back', Delete: 'ce', Escape: 'ce', F9: 'neg' }[e.key];
      if (k) { e.preventDefault(); convPress(k); }
      return;
    }
    if (!engine()) return;
    let k = null;
    const prg = state.mode === 'programmer';
    if (/^[0-9]$/.test(e.key)) k = e.key;
    else if (prg && /^[a-f]$/i.test(e.key) && prog.radix === 'hex') k = e.key.toUpperCase();
    else if (!prg && (e.key === '.' || e.key === sep.decimal)) k = '.';
    else if (KEYMAP[e.key]) k = KEYMAP[e.key];
    else if (e.key === '%') k = state.mode === 'standard' ? 'pct' : 'mod';
    else if (!prg && e.key === '^') k = 'pow';
    else if (prg) k = { '&': 'and', '|': 'or', '^': 'xor', '~': 'not', '<': 'lsh', '>': 'rsh' }[e.key] || null;
    else k = { r: 'recip', '@': 'sqrt', q: 'sqr', '!': 'fact', p: 'pi', e: 'e', s: 'sin', o: 'cos', t: 'tan', l: 'log', n: 'ln', x: 'exp' }[e.key] || null;
    if (k === 'e' && state.mode === 'scientific' && engine().typed && !engine().cur.fresh) k = 'expo';
    if (!k) return;
    const STANDARD = ['add', 'sub', 'mul', 'div', '=', 'back', 'c', 'ce', 'neg', 'pct', 'recip', 'sqrt', 'sqr'];
    if (state.mode === 'standard' && !/^[0-9.]$/.test(k) && !STANDARD.includes(k)) return;
    e.preventDefault();
    if (/^[0-9]$/.test(k) && prg && Number(k) >= M.RADIX[prog.radix]) return;
    press(k);
    flash(k);
  });
  /** The key pressed on the keyboard shows pressed on the keypad for a moment. */
  function flash(k) {
    const b = main.querySelector('.key[data-k="' + CSS.escape(k) + '"]');
    if (!b) return;
    b.classList.add('down');
    setTimeout(() => b.classList.remove('down'), 120);
  }

  // ------------------------------------------------------------------ menus
  function setMenus() {
    const mode = ([id, label], i) => ({ label, icon: glyph(id), checked: state.mode === id, key: i < 4 ? 'Alt+' + (i + 1) : undefined, action: () => setMode(id) });
    OS.win.setMenus([
      { label: 'Edit', items: [
        { label: 'Copy', key: 'Ctrl+C', icon: 'copy', action: copy },
        { label: 'Paste', key: 'Ctrl+V', icon: 'paste', action: paste },
      ] },
      { label: 'View', items: [
        { header: 'Calculator' }, ...MODES.map(mode),
        { header: 'Converter' }, ...Object.keys(C.UNITS).map((id, i) => mode([id, C.UNITS[id].name], i + 10)),
        'sep',
        { label: 'History and memory', key: 'Ctrl+H', checked: paneShown(), disabled: !isDecimal(), action: togglePane },
      ] },
    ]);
  }

  // ------------------------------------------------------------------ start
  OS.win.setTitle('Calculator');
  const restored = OS.win.restored;
  load().then(() => {
    if (restored && restored.mode && (engines[restored.mode] || restored.mode === 'date' || C.UNITS[restored.mode])) state.mode = restored.mode;
    if (restored) { state.paneOpen = !!restored.paneOpen; if (restored.tab) state.tab = restored.tab; }
    if (C.UNITS[state.mode]) setCategory(state.mode);
    render();
  });
});
