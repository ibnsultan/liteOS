/*
 * Calculator's numbers: exact decimals on BigInt, so 0.1 + 0.2 is 0.3. A value is m × 10^e (m a BigInt, e an integer).
 * Adding, subtracting and multiplying are exact; dividing and square roots are worked to PREC significant digits and
 * rounded half to even. The functions JavaScript only has for doubles (sin, log, ...) go through Number and come back
 * rounded to 15 significant digits, the most a double holds for certain.
 */
(function () {
  'use strict';

  const PREC = 40; // significant digits kept by division, roots and the rounding after every operation
  const TEN = 10n;
  const pow10 = (n) => TEN ** BigInt(n);
  const digits = (m) => (m < 0n ? -m : m).toString().length;

  class Dec {
    constructor(m, e) { this.m = m; this.e = e; }

    static of(m, e) { return norm(new Dec(BigInt(m), e | 0)); }

    /** "12.5", "-0.003", "1.2e+5", "1e-7"; null when it isn't a number. */
    static parse(s) {
      const t = String(s).trim().replace(/[\s_]/g, '');
      const r = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(t);
      if (!r || (!r[2] && !r[3])) return null;
      const frac = r[3] || '';
      let m = BigInt((r[2] || '0') + frac);
      if (r[1] === '-') m = -m;
      return norm(new Dec(m, (r[4] ? parseInt(r[4], 10) : 0) - frac.length));
    }

    /** A double, kept to 15 significant digits. Infinity and NaN give null. */
    static fromNumber(x) {
      if (!Number.isFinite(x)) return null;
      if (x === 0) return ZERO;
      return Dec.parse(x.toPrecision(15));
    }

    isZero() { return this.m === 0n; }
    isNeg() { return this.m < 0n; }
    isInt() { return this.e >= 0; }
    neg() { return new Dec(-this.m, this.e); }
    abs() { return this.m < 0n ? this.neg() : this; }
    sign() { return this.m > 0n ? 1 : this.m < 0n ? -1 : 0; }

    toNumber() { return Number(this.m.toString() + 'e' + this.e); }
    /** The integer part as a BigInt (towards zero). */
    toBigInt() { return this.e >= 0 ? this.m * pow10(this.e) : this.m / pow10(-this.e); }

    cmp(b) {
      const [x, y] = align(this, b);
      return x < y ? -1 : x > y ? 1 : 0;
    }
    eq(b) { return this.cmp(b) === 0; }

    add(b) { const [x, y, e] = align(this, b); return norm(new Dec(x + y, e)); }
    sub(b) { return this.add(b.neg()); }
    mul(b) { return norm(new Dec(this.m * b.m, this.e + b.e)); }
    /** null when b is zero. */
    div(b) {
      if (b.isZero()) return null;
      if (this.isZero()) return ZERO;
      // scale the numerator so the quotient has a few guard digits past PREC, then round to PREC
      const shift = Math.max(0, PREC + 5 - digits(this.m) + digits(b.m));
      return norm(new Dec((this.m * pow10(shift)) / b.m, this.e - b.e - shift)).toSig(PREC);
    }
    /** Remainder with the sign of the dividend, as % does; null when b is zero. */
    mod(b) {
      if (b.isZero()) return null;
      const [x, y, e] = align(this, b);
      return norm(new Dec(x % y, e));
    }
    /** Integer powers exactly (within reason), anything else through doubles. null when undefined. */
    pow(b) {
      if (b.isInt() && b.abs().cmp(Dec.of(4096, 0)) <= 0) {
        const n = Number(b.toBigInt());
        if (n === 0) return ONE;
        if (this.isZero()) return n < 0 ? null : ZERO;
        if (digits(this.m) * Math.abs(n) <= 4000) {
          const p = norm(new Dec(this.m ** BigInt(Math.abs(n)), this.e * Math.abs(n)));
          return n < 0 ? ONE.div(p) : p;
        }
      }
      const x = this.toNumber();
      const y = b.toNumber();
      // a negative number to a fractional power: only odd roots (x^(1/3)) are real
      if (x < 0 && !b.isInt()) {
        const inv = 1 / y;
        if (Math.abs(inv - Math.round(inv)) < 1e-9 && Math.round(inv) % 2 !== 0) return Dec.fromNumber(-Math.pow(-x, y));
        return null;
      }
      return Dec.fromNumber(Math.pow(x, y));
    }
    /** Square root to PREC digits; null for negatives. */
    sqrt() {
      if (this.isNeg()) return null;
      if (this.isZero()) return ZERO;
      // make the exponent even and the mantissa long enough for PREC digits of root
      let m = this.m;
      let e = this.e;
      const want = 2 * (PREC + 2);
      const pad = Math.max(0, want - digits(m));
      m *= pow10(pad); e -= pad;
      if (e % 2 !== 0) { m *= TEN; e -= 1; }
      let x = BigInt('1' + '0'.repeat(Math.ceil(digits(m) / 2)));
      for (;;) {
        const y = (x + m / x) / 2n;
        if (y >= x) break;
        x = y;
      }
      return norm(new Dec(x, e / 2)).toSig(PREC);
    }
    /** Rounded to n significant digits (half to even). */
    toSig(n) {
      const d = digits(this.m);
      if (d <= n) return this;
      return norm(new Dec(roundDiv(this.m, pow10(d - n)), this.e + d - n));
    }
    /** Rounded to n places after the point. */
    toPlaces(n) {
      if (-this.e <= n) return this;
      return norm(new Dec(roundDiv(this.m, pow10(-this.e - n)), -n));
    }
    floor() {
      if (this.e >= 0) return this;
      const p = pow10(-this.e);
      let q = this.m / p;
      if (this.m < 0n && q * p !== this.m) q -= 1n;
      return norm(new Dec(q, 0));
    }
    ceil() { return this.neg().floor().neg(); }

    /**
     * The digits for showing, at most `sig` significant ones: { neg, int, frac, exp } where exp is null for plain
     * notation. Plain while the number fits in sig digits (and isn't smaller than 1e-(sig-?)), else scientific;
     * sci forces scientific.
     */
    parts(sig, sci) {
      const v = this.toSig(sig);
      const neg = v.m < 0n;
      const ds = (neg ? -v.m : v.m).toString();
      if (v.m === 0n) return { neg: false, int: '0', frac: '', exp: sci ? 0 : null };
      const mag = ds.length + v.e - 1; // exponent of the leading digit
      if (!sci && mag < sig && mag >= -5) {
        if (v.e >= 0) return { neg, int: ds + '0'.repeat(v.e), frac: '', exp: null };
        const point = ds.length + v.e;
        if (point > 0) return { neg, int: ds.slice(0, point), frac: ds.slice(point), exp: null };
        return { neg, int: '0', frac: '0'.repeat(-point) + ds, exp: null };
      }
      return { neg, int: ds[0], frac: ds.slice(1), exp: mag };
    }

    /** Plain text: "-12.5", "1.5e+20" (no grouping; for copying and the history). */
    toString(sig) {
      const p = this.parts(sig || 32);
      return (p.neg ? '-' : '') + p.int + (p.frac ? '.' + p.frac : '') + (p.exp === null ? '' : 'e' + (p.exp < 0 ? '-' : '+') + Math.abs(p.exp));
    }
  }

  function roundDiv(m, p) {
    let q = m / p;
    const r = m % p;
    const twice = (r < 0n ? -r : r) * 2n;
    if (twice > p || (twice === p && q % 2n !== 0n)) q += m < 0n ? -1n : 1n;
    return q;
  }
  function align(a, b) {
    if (a.e === b.e) return [a.m, b.m, a.e];
    if (a.e > b.e) return [a.m * pow10(a.e - b.e), b.m, b.e];
    return [a.m, b.m * pow10(b.e - a.e), a.e];
  }
  /** Trailing zeros moved into the exponent, and at most PREC + 8 digits kept (sums of tiny and huge numbers). */
  function norm(d) {
    let { m, e } = d;
    if (m === 0n) return new Dec(0n, 0);
    const n = digits(m);
    if (n > PREC + 8) { m = roundDiv(m, pow10(n - PREC - 8)); e += n - PREC - 8; }
    while (m % TEN === 0n) { m /= TEN; e += 1; }
    return new Dec(m, e);
  }

  const ZERO = new Dec(0n, 0);
  const ONE = new Dec(1n, 0);
  Dec.ZERO = ZERO;
  Dec.ONE = ONE;
  Dec.PI = Dec.parse('3.141592653589793238462643383279502884197');
  Dec.E = Dec.parse('2.718281828459045235360287471352662497757');

  window.CalcDec = Dec;
})();
