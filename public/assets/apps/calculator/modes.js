/*
 * Calculator's number systems for the engine (engine.js): decimal (Standard and Scientific, exact decimals from
 * decimal.js) and programmer (whole numbers of a word size, in hex, decimal, octal or binary, on BigInt). Also the
 * scientific functions.
 */
(function () {
  'use strict';

  const D = window.CalcDec;
  const DIV0 = 'Cannot divide by zero';
  const BAD = 'Invalid input';
  const BIG = 'Overflow';

  // ------------------------------------------------------------------ decimal
  /** Results past this are an overflow, as on a desktop calculator. */
  const LIMIT = D.parse('1e10000');
  const checked = (v) => (v == null ? null : v.abs().cmp(LIMIT) >= 0 ? false : v);

  function decimalSystem(fmt) {
    return {
      zero: D.ZERO,
      invalid: BAD,
      maxDigits: 16,
      digitOk: (ch) => /^[0-9]$/.test(ch),
      parse: (s) => D.parse(s.replace(/e[+-]?$/i, '')),
      neg: (x) => x.neg(),
      text: (v) => fmt(v, true),
      percent: (acc, x, op) => {
        const hundredth = x.div(D.of(100, 0));
        return acc && (op === 'add' || op === 'sub') ? acc.mul(hundredth) : hundredth;
      },
      ops: {
        add: { sym: '+', prec: 1, fn: (a, b) => checked(a.add(b)) },
        sub: { sym: '−', prec: 1, fn: (a, b) => checked(a.sub(b)) },
        mul: { sym: '×', prec: 2, fn: (a, b) => checked(a.mul(b)) },
        div: { sym: '÷', prec: 2, fn: (a, b) => checked(a.div(b)), error: DIV0 },
        mod: { sym: 'mod', prec: 2, fn: (a, b) => a.mod(b), error: DIV0 },
        pow: { sym: '^', prec: 3, right: true, fn: (a, b) => checked(a.pow(b)) },
        root: { sym: 'yroot', prec: 3, right: true, fn: (a, b) => (b.isZero() ? null : checked(a.pow(D.ONE.div(b)))) },
        logy: { sym: 'log base', prec: 3, fn: (a, b) => logBase(a, b) },
      },
    };
  }

  function logBase(x, base) {
    if (x.sign() <= 0 || base.sign() <= 0 || base.eq(D.ONE)) return null;
    return clean(Math.log(x.toNumber()) / Math.log(base.toNumber()));
  }
  /** A double result, with what's left of rounding (1e-17 for sin π) taken as zero. */
  function clean(x) {
    if (!Number.isFinite(x)) return null;
    return D.fromNumber(Math.abs(x) < 1e-15 ? 0 : x);
  }

  // ------------------------------------------------------------------ scientific functions
  const RIGHT = { deg: D.of(90, 0), grad: D.of(100, 0) };
  const FULL = { deg: D.of(360, 0), grad: D.of(400, 0) };
  function toRadians(x, unit) {
    if (unit === 'rad') return x.toNumber();
    return x.toNumber() * Math.PI / (unit === 'deg' ? 180 : 200);
  }
  function fromRadians(r, unit) {
    if (unit === 'rad') return clean(r);
    return clean(r * (unit === 'deg' ? 180 : 200) / Math.PI);
  }
  /** Quarter turns of an angle in degrees or gradians, when it is a whole number of them (exact sin/cos/tan). */
  function quarters(x, unit) {
    if (unit === 'rad') return null;
    const q = x.mod(FULL[unit]).div(RIGHT[unit]);
    if (!q.isInt()) return null;
    return ((Number(q.toBigInt()) % 4) + 4) % 4;
  }
  const trig = {
    sin: (x, u) => { const q = quarters(x, u); return q != null ? D.of([0, 1, 0, -1][q], 0) : clean(Math.sin(toRadians(x, u))); },
    cos: (x, u) => { const q = quarters(x, u); return q != null ? D.of([1, 0, -1, 0][q], 0) : clean(Math.cos(toRadians(x, u))); },
    tan: (x, u) => { const q = quarters(x, u); return q != null ? (q % 2 ? null : D.ZERO) : clean(Math.tan(toRadians(x, u))); },
    sec: (x, u) => { const c = trig.cos(x, u); return c == null || c.isZero() ? null : D.ONE.div(c); },
    csc: (x, u) => { const s = trig.sin(x, u); return s == null || s.isZero() ? null : D.ONE.div(s); },
    cot: (x, u) => { const q = quarters(x, u); if (q != null) return q % 2 ? D.ZERO : null; const t = Math.tan(toRadians(x, u)); return t === 0 ? null : clean(1 / t); },
    asin: (x, u) => (x.abs().cmp(D.ONE) > 0 ? null : fromRadians(Math.asin(x.toNumber()), u)),
    acos: (x, u) => (x.abs().cmp(D.ONE) > 0 ? null : fromRadians(Math.acos(x.toNumber()), u)),
    atan: (x, u) => fromRadians(Math.atan(x.toNumber()), u),
    sinh: (x) => clean(Math.sinh(x.toNumber())),
    cosh: (x) => clean(Math.cosh(x.toNumber())),
    tanh: (x) => clean(Math.tanh(x.toNumber())),
    asinh: (x) => clean(Math.asinh(x.toNumber())),
    acosh: (x) => (x.cmp(D.ONE) < 0 ? null : clean(Math.acosh(x.toNumber()))),
    atanh: (x) => (x.abs().cmp(D.ONE) >= 0 ? null : clean(Math.atanh(x.toNumber()))),
  };

  /** n! exactly for whole numbers up to 3000, Γ(n+1) for fractions; null for negative whole numbers. */
  function factorial(x) {
    if (x.isInt()) {
      if (x.isNeg()) return null;
      const n = Number(x.toBigInt());
      if (n > 3000) return false;
      let r = 1n;
      for (let i = 2n; i <= BigInt(n); i++) r *= i;
      return D.of(r, 0);
    }
    const g = gamma(x.toNumber() + 1);
    return Number.isFinite(g) ? D.fromNumber(g) : null;
  }
  // Lanczos approximation (g = 7, n = 9)
  const LZ = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function gamma(z) {
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    let a = LZ[0];
    const t = z + 7.5;
    for (let i = 1; i < 9; i++) a += LZ[i] / (z + i);
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
  }

  /** Degrees as degrees, minutes and seconds (12.5 → 12.30) and back, as Windows' dms and deg. */
  function toDms(x) {
    const neg = x.isNeg();
    const a = x.abs();
    const d = a.floor();
    const m60 = a.sub(d).mul(D.of(60, 0));
    const m = m60.floor();
    const s = m60.sub(m).mul(D.of(60, 0));
    const v = d.add(m.div(D.of(100, 0))).add(s.div(D.of(10000, 0)));
    return neg ? v.neg() : v;
  }
  function fromDms(x) {
    const neg = x.isNeg();
    const a = x.abs();
    const d = a.floor();
    const mm = a.sub(d).mul(D.of(100, 0));
    const m = mm.floor();
    const s = mm.sub(m).mul(D.of(100, 0));
    const v = d.add(m.div(D.of(60, 0))).add(s.div(D.of(3600, 0)));
    return neg ? v.neg() : v;
  }

  const fns = {
    sqr: (x) => checked(x.mul(x)),
    cube: (x) => checked(x.mul(x).mul(x)),
    sqrt: (x) => x.sqrt(),
    cuberoot: (x) => x.pow(D.ONE.div(D.of(3, 0))),
    recip: (x) => D.ONE.div(x),
    abs: (x) => x.abs(),
    floor: (x) => x.floor(),
    ceil: (x) => x.ceil(),
    fact: factorial,
    pow10: (x) => checked(D.of(10, 0).pow(x)),
    pow2: (x) => checked(D.of(2, 0).pow(x)),
    exp: (x) => (x.isZero() ? D.ONE : clean(Math.exp(x.toNumber()))),
    log: (x) => {
      if (x.sign() <= 0) return null;
      // exact for powers of ten
      const s = x.toString(40);
      if (/^1(e[+-]\d+)?$/.test(s) || /^10*$/.test(s) || /^0\.0*1$/.test(s)) return D.of(Math.round(Math.log10(x.toNumber())), 0);
      return clean(Math.log10(x.toNumber()));
    },
    ln: (x) => (x.sign() <= 0 ? null : x.eq(D.ONE) ? D.ZERO : clean(Math.log(x.toNumber()))),
    dms: toDms,
    deg: fromDms,
  };

  // ------------------------------------------------------------------ programmer
  const RADIX = { hex: 16, dec: 10, oct: 8, bin: 2 };
  const PREFIX = { hex: '0x', oct: '0o', bin: '0b', dec: '' };
  const DIGITS = { hex: /^[0-9A-F]$/i, dec: /^[0-9]$/, oct: /^[0-7]$/, bin: /^[01]$/ };
  const MAXDIG = { 64: { hex: 16, dec: 19, oct: 22, bin: 64 }, 32: { hex: 8, dec: 10, oct: 11, bin: 32 }, 16: { hex: 4, dec: 5, oct: 6, bin: 16 }, 8: { hex: 2, dec: 3, oct: 3, bin: 8 } };

  /** cfg: { bits, radix } (changed in place by the app). */
  function programmerSystem(cfg) {
    const wrap = (v) => BigInt.asIntN(cfg.bits, v);
    const unsigned = (v) => BigInt.asUintN(cfg.bits, v);
    const sys = {
      zero: 0n,
      invalid: BAD,
      get maxDigits() { return MAXDIG[cfg.bits][cfg.radix]; },
      digitOk: (ch) => DIGITS[cfg.radix].test(ch),
      parse(s) {
        let t = String(s).replace(/\.$/, '');
        const neg = t.startsWith('-');
        if (neg) t = t.slice(1);
        if (t === '' || !Array.from(t).every((c) => DIGITS[cfg.radix].test(c))) return null;
        let v = BigInt(PREFIX[cfg.radix] + t || '0');
        if (cfg.radix === 'dec') {
          // a decimal entry must fit the signed range
          const max = (1n << BigInt(cfg.bits - 1)) - 1n;
          if (v > max + (neg ? 1n : 0n)) return null;
          return neg ? -v : v;
        }
        if (v >> BigInt(cfg.bits)) return null;
        v = wrap(v);
        return neg ? wrap(-v) : v;
      },
      neg: (x) => wrap(-x),
      text: (v) => show(v, cfg.radix, cfg.bits),
      ops: {
        mul: { sym: '×', prec: 5, fn: (a, b) => wrap(a * b) },
        div: { sym: '÷', prec: 5, fn: (a, b) => (b === 0n ? null : wrap(a / b)), error: DIV0 },
        mod: { sym: '%', prec: 5, fn: (a, b) => (b === 0n ? null : a % b), error: DIV0 },
        add: { sym: '+', prec: 4, fn: (a, b) => wrap(a + b) },
        sub: { sym: '−', prec: 4, fn: (a, b) => wrap(a - b) },
        lsh: { sym: '<<', prec: 3, fn: (a, b) => (b < 0n ? null : wrap(a << (b > 128n ? 128n : b))) },
        rsh: { sym: '>>', prec: 3, fn: (a, b) => (b < 0n ? null : a >> (b > 128n ? 128n : b)) },
        rol: { sym: 'RoL', prec: 3, fn: (a, b) => rotate(a, b, true) },
        ror: { sym: 'RoR', prec: 3, fn: (a, b) => rotate(a, b, false) },
        and: { sym: 'AND', prec: 2, fn: (a, b) => wrap(a & b) },
        nand: { sym: 'NAND', prec: 2, fn: (a, b) => wrap(~(a & b)) },
        xor: { sym: 'XOR', prec: 1.5, fn: (a, b) => wrap(a ^ b) },
        or: { sym: 'OR', prec: 1, fn: (a, b) => wrap(a | b) },
        nor: { sym: 'NOR', prec: 1, fn: (a, b) => wrap(~(a | b)) },
      },
      not: (x) => wrap(~x),
      wrap,
      unsigned,
    };
    function rotate(a, b, left) {
      const n = BigInt(cfg.bits);
      if (b < 0n) return null;
      const k = b % n;
      const u = unsigned(a);
      const r = left ? (u << k) | (u >> ((n - k) % n)) : (u >> k) | (u << ((n - k) % n));
      return wrap(k === 0n ? u : r);
    }
    return sys;
  }

  /** A whole number in a radix: decimal signed, the others as the word's bits (two's complement), upper case. */
  function show(v, radix, bits) {
    if (radix === 'dec') return v.toString(10);
    return BigInt.asUintN(bits, v).toString(RADIX[radix]).toUpperCase();
  }

  window.CalcModes = { decimalSystem, programmerSystem, trig, fns, show, RADIX, DIV0, BAD, BIG };
})();
