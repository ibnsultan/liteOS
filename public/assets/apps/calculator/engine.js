/*
 * Calculator's keypad logic, shared by the Standard, Scientific and Programmer modes. A mode hands in its number
 * system (how a typed entry becomes a value, its binary operators with their precedence, how values read in the
 * expression line) and whether operators work immediately (Standard: 2 + 3 × 4 = 20, as on a pocket calculator) or by
 * precedence with brackets (Scientific and Programmer: 14).
 *
 * The expression so far is a list of items: { k: 'num', v, text }, { k: 'op', op }, { k: '(' }, { k: ')' }. The
 * operand being worked on (typed, a result, or a function of either) is `cur`.
 */
(function () {
  'use strict';

  class CalcError extends Error {}

  class Engine {
    /**
     * sys: {
     *   zero, parse(typed) -> value|null, text(value) -> expression-line text,
     *   ops: { key: { sym, prec, right, fn(a, b) -> value|null } },
     *   maxDigits, digitOk(ch) -> bool,
     *   percent?(acc, x, op) -> value
     * }
     * immediate: Standard mode's left-to-right evaluation.
     */
    constructor(sys, immediate) {
      this.sys = sys;
      this.immediate = !!immediate;
      this.onHistory = null; // (exprText, value) after =
      this.clear();
    }

    // ------------------------------------------------------------------ state
    clear() {
      this.items = [];
      this.cur = { v: this.sys.zero, text: null, typed: '0', fresh: true };
      this.error = null;
      this.last = null; // { op, v } for repeating =
      this.shown = null; // a value shown in place of cur (a bracket's or a partial result)
    }
    clearEntry() {
      if (this.error) { this.clear(); return; }
      this.cur = { v: this.sys.zero, text: null, typed: '0', fresh: true };
      this.shown = null;
      // after ")" the entry is the bracket's value: clearing it drops the bracket
      const t = this.items[this.items.length - 1];
      if (t && t.k === ')') this.dropGroup();
    }
    /** Remove the last bracketed group (after its ")"), leaving the operator before it. */
    dropGroup() {
      const open = this.matchOpen(this.items.length - 1);
      this.items.splice(open);
    }
    matchOpen(close) {
      let depth = 0;
      for (let i = close; i >= 0; i--) {
        if (this.items[i].k === ')') depth++;
        else if (this.items[i].k === '(' && --depth === 0) return i;
      }
      return 0;
    }
    openCount() {
      return this.items.reduce((n, t) => n + (t.k === '(' ? 1 : t.k === ')' ? -1 : 0), 0);
    }
    lastItem() { return this.items[this.items.length - 1] || null; }

    /** The value to show in the big display. */
    get value() {
      if (this.cur) return this.cur.v;
      return this.shown != null ? this.shown : this.sys.zero;
    }
    /** What's being typed, as typed (with a trailing point or zeros), or null for a computed value. */
    get typed() { return this.cur && this.cur.text == null && !this.cur.result ? this.cur.typed : null; }

    /** The expression line: "12 + sqr(3) ×". */
    get expression() {
      const parts = this.items.map((t) => (t.k === 'num' ? t.text : t.k === 'op' ? this.sys.ops[t.op].sym : t.k));
      if (this.cur && this.cur.text != null) parts.push(this.cur.text);
      return parts.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')');
    }

    fail(msg) { this.error = msg; throw new CalcError(msg); }
    guard(fn) {
      if (this.error) return false;
      try { fn(); return true; } catch (e) { if (e instanceof CalcError) return false; throw e; }
    }

    // ------------------------------------------------------------------ typing
    /** A new typed entry replaces whatever cur was (a result, a function's value). */
    startTyping() {
      const t = this.lastItem();
      if (t && t.k === ')') return false; // after ")" an operator must come first
      if (!this.cur || this.cur.text != null || this.cur.result) this.cur = { v: this.sys.zero, text: null, typed: '0', fresh: true };
      this.shown = null;
      return true;
    }
    digit(ch) {
      if (this.error) this.clear();
      if (!this.sys.digitOk(ch)) return;
      if (!this.startTyping()) return;
      let s = this.cur.fresh ? '' : this.cur.typed;
      const neg = s.startsWith('-');
      const body = neg ? s.slice(1) : s;
      if (body === '0' && ch !== '.') s = (neg ? '-' : '');
      const next = s + ch;
      const count = next.replace(/[^0-9A-Fa-f]/g, '').length;
      if (!/e/i.test(next) && count > this.sys.maxDigits) return;
      const v = this.sys.parse(next === '' || next === '-' ? '0' : next);
      if (v == null) return;
      this.cur = { v, text: null, typed: next, fresh: false };
    }
    point() {
      if (this.error) this.clear();
      if (!this.startTyping()) return;
      let s = this.cur.fresh ? '0' : this.cur.typed;
      if (s.includes('.') || /e/i.test(s)) return;
      if (s === '-' ) s = '-0';
      this.cur = { v: this.cur.v, text: null, typed: s + '.', fresh: false };
    }
    /** Scientific notation entry (F-E's "exp"): 1.2 exp 5 → 1.2e+5. */
    exp() {
      if (this.error || !this.cur || this.cur.text != null || /e/i.test(this.cur.typed)) return;
      const s = this.cur.fresh ? '1' : this.cur.typed.replace(/\.$/, '');
      this.cur = { v: this.sys.parse(s), text: null, typed: s + 'e+', fresh: false, inExp: true };
    }
    backspace() {
      if (this.error) { this.clear(); return; }
      if (!this.cur || this.cur.text != null || this.cur.fresh || this.cur.result) return;
      let s = this.cur.typed.slice(0, -1);
      if (/e[+-]?$/i.test(s)) s = s.replace(/e[+-]?$/i, '');
      if (s === '' || s === '-') { this.cur = { v: this.sys.zero, text: null, typed: '0', fresh: true }; return; }
      this.cur = { v: this.sys.parse(s.endsWith('.') ? s.slice(0, -1) || '0' : s) || this.sys.zero, text: null, typed: s, fresh: false };
    }
    /** ± : flips the sign of what's typed (or of the exponent while typing it), else applies negate(). */
    negate() {
      if (this.error) return;
      if (this.cur && this.cur.text == null && !this.cur.fresh && !this.cur.result) {
        let s = this.cur.typed;
        if (/e[+-]\d*$/i.test(s)) s = s.replace(/e([+-])(\d*)$/i, (m, sg, d) => 'e' + (sg === '+' ? '-' : '+') + d);
        else s = s.startsWith('-') ? s.slice(1) : '-' + s;
        const v = this.sys.parse(/e[+-]$/i.test(s) ? s.replace(/e[+-]$/i, '') : s.replace(/\.$/, ''));
        this.cur = { v: v == null ? this.sys.zero : v, text: null, typed: s, fresh: false };
        return;
      }
      this.unary('negate', (x) => this.sys.neg(x));
    }

    // ------------------------------------------------------------------ operators
    /** The operand an operator or function works on, as an item; null after ")" (the bracket is the operand). */
    takeCur() {
      const c = this.cur;
      this.cur = null;
      return { k: 'num', v: c.v, text: c.text != null ? c.text : this.sys.text(c.v) };
    }
    binary(op) {
      this.guard(() => {
        const t = this.lastItem();
        if (!this.cur && t && t.k === 'op') { t.op = op; return; } // change the operator just pressed
        if (!this.cur && t && t.k === '(') return;
        if (this.cur) this.items.push(this.takeCur());
        if (this.immediate) {
          const v = this.evaluate(this.items);
          // one operand keeps how it was written (√(9) +); a worked-out sum becomes its value (5 ×)
          const first = this.items.length === 1 ? this.items[0] : { k: 'num', v, text: this.sys.text(v) };
          this.items = [first, { k: 'op', op }];
          this.shown = v;
        } else {
          this.shown = this.evaluate(this.items, op);
          this.items.push({ k: 'op', op });
        }
        this.last = null;
      });
    }
    /** "(" starts a bracket after an operator or another "(", or a new expression (dropping a number typed before it). */
    open() {
      if (this.error) this.clear();
      const t = this.lastItem();
      if (t && (t.k === 'num' || t.k === ')')) return;
      this.items.push({ k: '(' });
      this.cur = { v: this.sys.zero, text: null, typed: '0', fresh: true };
      this.shown = null;
    }
    close() {
      this.guard(() => {
        if (this.openCount() <= 0) return;
        const t = this.lastItem();
        if (!this.cur && t && (t.k === 'op' || t.k === '(')) return;
        if (this.cur) this.items.push(this.takeCur());
        this.items.push({ k: ')' });
        const open = this.matchOpen(this.items.length - 1);
        this.shown = this.evaluate(this.items.slice(open + 1, -1));
      });
    }
    /** A function of the operand: sqr(5), √(9). After ")" it takes the whole bracket. */
    unary(name, fn, label) {
      this.guard(() => {
        const t = this.lastItem();
        let x;
        let text;
        if (!this.cur && t && t.k === ')') {
          const open = this.matchOpen(this.items.length - 1);
          const group = this.items.splice(open);
          x = this.evaluate(group.slice(1, -1));
          text = '(' + group.slice(1, -1).map((g) => (g.k === 'num' ? g.text : g.k === 'op' ? this.sys.ops[g.op].sym : g.k)).join(' ').replace(/\( /g, '(').replace(/ \)/g, ')') + ')';
        } else {
          if (!this.cur) this.cur = { v: this.shown != null ? this.shown : this.sys.zero, text: null, typed: '0', fresh: true };
          x = this.cur.v;
          text = this.cur.text != null ? this.cur.text : this.sys.text(x);
        }
        const v = fn(x);
        if (v === false) this.fail('Overflow');
        if (v == null) this.fail(name === 'recip' ? 'Cannot divide by zero' : this.sys.invalid || 'Invalid input');
        this.cur = { v, text: (label || name) + '(' + text.replace(/^\((.*)\)$/, '$1') + ')', typed: '0', fresh: false };
        this.shown = null;
      });
    }
    /** A value put in as the operand: π, a memory recall, a pasted number, a history result. */
    put(v, text) {
      if (this.error) this.clear();
      const t = this.lastItem();
      if (t && t.k === ')') return;
      this.cur = { v, text: text || null, typed: '0', fresh: false, result: !text };
      this.shown = null;
    }
    /** Standard mode's %: of the value before a + or −, else hundredths. */
    percent() {
      this.guard(() => {
        if (!this.cur) return;
        const t = this.lastItem();
        const acc = this.items.length >= 2 ? this.items[0].v : null;
        const v = this.sys.percent(acc, this.cur.v, t && t.k === 'op' ? t.op : null);
        this.cur = { v, text: this.sys.text(v), typed: '0', fresh: false };
      });
    }

    equals() {
      return this.guard(() => {
        const t = this.lastItem();
        if (this.items.length === 0) {
          if (!this.last || !this.cur) return;
          // = again repeats the last operation on the result
          const a = this.cur;
          const items = [{ k: 'num', v: a.v, text: a.text != null ? a.text : this.sys.text(a.v) }, { k: 'op', op: this.last.op }, { k: 'num', v: this.last.v, text: this.sys.text(this.last.v) }];
          this.finish(items);
          return;
        }
        if (!this.cur && t && t.k === 'op') this.cur = { v: this.shown != null ? this.shown : this.sys.zero, text: null, typed: '0', fresh: true };
        if (this.cur) this.items.push(this.takeCur());
        for (let n = this.openCount(); n > 0; n--) this.items.push({ k: ')' });
        this.finish(this.items);
      });
    }
    finish(items) {
      const exprText = items.map((g) => (g.k === 'num' ? g.text : g.k === 'op' ? this.sys.ops[g.op].sym : g.k)).join(' ').replace(/\( /g, '(').replace(/ \)/g, ')');
      const v = this.evaluate(items);
      const n = items.length;
      if (n >= 3 && items[n - 1].k === 'num' && items[n - 2].k === 'op') this.last = { op: items[n - 2].op, v: items[n - 1].v };
      this.items = [];
      this.cur = { v, text: null, typed: '0', fresh: false, result: true };
      this.shown = null;
      this.lastExpression = exprText + ' =';
      if (this.onHistory) this.onHistory(exprText + ' =', v);
    }

    // ------------------------------------------------------------------ evaluation
    /**
     * The value of a list of items (operators by precedence, unless immediate). With `next`, only the operators
     * that operator would close are worked out: the value of what's on top, as shown while typing.
     */
    evaluate(items, next) {
      const ops = this.sys.ops;
      const out = [];
      const stack = [];
      const apply = (op) => {
        const b = out.pop();
        const a = out.pop();
        if (a == null || b == null) return;
        const r = ops[op].fn(a, b);
        if (r === false) this.fail('Overflow');
        if (r == null) this.fail(ops[op].error || this.sys.invalid || 'Invalid input');
        out.push(r);
      };
      const prec = (op) => (this.immediate ? 1 : ops[op].prec);
      const reduce = (op) => {
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top === '(') break;
          if (prec(top) > prec(op) || (prec(top) === prec(op) && !ops[op].right)) apply(stack.pop());
          else break;
        }
      };
      for (const t of items) {
        if (t.k === 'num') out.push(t.v);
        else if (t.k === '(') stack.push('(');
        else if (t.k === ')') {
          while (stack.length && stack[stack.length - 1] !== '(') apply(stack.pop());
          stack.pop();
        } else { reduce(t.op); stack.push(t.op); }
      }
      if (next) { reduce(next); return out[out.length - 1]; }
      while (stack.length) { const op = stack.pop(); if (op !== '(') apply(op); }
      return out.length ? out[out.length - 1] : this.sys.zero;
    }
  }

  window.CalcEngine = Engine;
})();
