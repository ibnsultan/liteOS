/*
 * LiteOS popup menus, shared by the desktop (os.js) and apps (sdk.js): context menus, the taskbar's jump lists and
 * the toolbar menus. A menu is a list of items:
 *
 *   { label, icon, img, color, key, danger, disabled, title, action }   a command (key: the shortcut shown at the right)
 *   { label, icon, items: [...] }                                     a submenu, opened on hover, click or →
 *   { ..., checked: true | false }                                    the current choice in a group gets a dot
 *   'sep'                                                             a line between groups
 *   { header } / { note }                                             a small heading / a line of text
 *
 * Keyboard: ↑ ↓ move, → opens a submenu, ← closes it, Enter runs, Esc closes.
 */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // a glyph name the system icon set has an icon for is drawn from the set (LOS_sysGlyph), anything else as the glyph
  const icon = (n, s) => (window.LOS_sysGlyph ? window.LOS_sysGlyph(n, s) : window.LOS_icon ? window.LOS_icon(n, s) : '');
  let current = null;
  let lastOutside = null; // { el, at }: the button an outside press closed the menu on

  /**
   * Opens a menu at {x, y} (or a MouseEvent); {above: true} puts it above y. Returns a function that closes it.
   * opts: { onClose, cls, parent (element to add it to; default document.body) }
   */
  function open(items, at, opts) {
    opts = opts || {};
    // the same button pressed again while its menu was open: that press closed it (outside, below), so the click it
    // ends with doesn't open it again. A drop-down toggles.
    const ev = window.event;
    if (lastOutside && ev && ev.type === 'click' && Date.now() - lastOutside.at < 800 && ev.target && lastOutside.el.contains(ev.target)) {
      lastOutside = null;
      if (opts.onClose) opts.onClose();
      return () => {};
    }
    lastOutside = null;
    close();
    const host = opts.parent || document.body;
    const levels = []; // open menus, the root first
    const x = at.clientX != null ? at.clientX : at.x;
    const y = at.clientY != null ? at.clientY : at.y;
    let hoverTimer = null;

    function build(list, level) {
      const el = document.createElement('div');
      el.className = 'menu' + (level ? ' menu-sub' : '') + (opts.cls && !level ? ' ' + opts.cls : '');
      el.setAttribute('role', 'menu');
      const marks = list.some((it) => it && typeof it === 'object' && it.checked !== undefined);
      if (marks) el.classList.add('has-marks');
      list.forEach((it) => {
        if (it === 'sep' || it === '-') {
          if (el.lastChild && !el.lastChild.classList.contains('menu-sep')) el.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>');
          return;
        }
        if (!it) return;
        if (it.header || it.note) { el.insertAdjacentHTML('beforeend', '<div class="' + (it.header ? 'menu-head' : 'menu-note') + '">' + esc(it.header || it.note) + '</div>'); return; }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-item' + (it.danger ? ' danger' : '') + (it.items ? ' has-sub' : '');
        b.setAttribute('role', 'menuitem');
        if (it.items) b.setAttribute('aria-haspopup', 'menu');
        b.disabled = !!it.disabled;
        if (it.title) b.title = it.title;
        const lead = it.img ? '<img class="mi-img" src="' + esc(it.img) + '" alt="">'
          : it.icon ? (it.color ? '<span class="mi-ico" style="color:' + esc(it.color) + '">' + icon(it.icon, 16) + '</span>' : icon(it.icon, 15))
            : '<span class="mi-blank"></span>';
        b.innerHTML = (marks ? '<span class="mi-mark">' + (it.checked ? '<i></i>' : '') + '</span>' : '') + lead +
          '<span class="mi-label">' + esc(it.label) + '</span>' +
          (it.items ? '<span class="mi-more">' + icon('forward', 14) + '</span>' : it.key ? '<span class="key">' + esc(it.key) + '</span>' : '');
        b._item = it;
        el.appendChild(b);
      });
      if (el.lastChild && el.lastChild.classList.contains('menu-sep')) el.lastChild.remove();

      el.addEventListener('click', (e) => {
        const b = e.target.closest('.menu-item');
        if (!b || b.disabled) return;
        e.stopPropagation();
        if (b._item.items) { openSub(b, level); return; }
        run(b._item);
      });
      el.addEventListener('mouseover', (e) => {
        const b = e.target.closest('.menu-item');
        if (!b || b === el._hover) return;
        el._hover = b;
        clearTimeout(hoverTimer);
        // a short pause, so crossing other rows on the way to an open submenu doesn't close it
        hoverTimer = setTimeout(() => { if (b._item.items && !b.disabled) openSub(b, level); else closeFrom(level + 1); }, 160);
      });
      el.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus where it was
      return el;
    }

    function place(el, px, py, above) {
      host.appendChild(el);
      const r = el.getBoundingClientRect();
      el.style.left = Math.max(4, Math.min(px, window.innerWidth - r.width - 4)) + 'px';
      el.style.top = Math.max(4, Math.min(above ? py - r.height : py, window.innerHeight - r.height - 4)) + 'px';
    }

    function openSub(btn, level) {
      if (levels[level + 1] && levels[level + 1]._from === btn) return;
      closeFrom(level + 1);
      const sub = build(btn._item.items, level + 1);
      sub._from = btn;
      btn.classList.add('open');
      host.appendChild(sub);
      const br = btn.getBoundingClientRect();
      const r = sub.getBoundingClientRect();
      const right = br.right + 2;
      const px = right + r.width <= window.innerWidth - 4 ? right : Math.max(4, br.left - r.width - 2); // flip left near the edge
      sub.style.left = px + 'px';
      sub.style.top = Math.max(4, Math.min(br.top - 6, window.innerHeight - r.height - 4)) + 'px';
      levels[level + 1] = sub;
    }

    function closeFrom(level) {
      while (levels.length > level) {
        const m = levels.pop();
        if (m._from) m._from.classList.remove('open');
        m.remove();
      }
    }

    function run(item) {
      close();
      if (item.action) {
        try { item.action(); } catch (e) { if (opts.onError) opts.onError(e); else throw e; }
      }
    }

    function enabled(level) { return [...levels[level].querySelectorAll(':scope > .menu-item:not(:disabled)')]; }

    function onKey(e) {
      const level = levels.length - 1;
      const list = enabled(level);
      const at = list.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (level > 0) { const from = levels[level]._from; closeFrom(level); from.focus(); } else close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!list.length) return;
        const next = at < 0 ? (e.key === 'ArrowDown' ? 0 : list.length - 1) : (at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list[next].focus();
        return;
      }
      if (e.key === 'ArrowRight' && at >= 0 && list[at]._item.items) {
        e.preventDefault(); e.stopImmediatePropagation();
        openSub(list[at], level);
        const first = enabled(level + 1)[0];
        if (first) first.focus();
        return;
      }
      if (e.key === 'ArrowLeft' && level > 0) { e.preventDefault(); e.stopImmediatePropagation(); const from = levels[level]._from; closeFrom(level); from.focus(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && at >= 0) {
        e.preventDefault(); e.stopImmediatePropagation();
        const it = list[at]._item;
        if (it.items) { openSub(list[at], level); const first = enabled(level + 1)[0]; if (first) first.focus(); } else run(it);
      }
    }
    function outside(e) {
      if (levels.some((m) => m.contains(e.target))) return;
      // a press on the button that opened it closes it, and the click that follows mustn't open it again
      const t = e.target && e.target.closest ? e.target.closest('button, [role="button"], [data-act], [aria-haspopup]') : null;
      lastOutside = t ? { el: t, at: Date.now() } : null;
      close();
    }

    const root = build(items, 0);
    levels.push(root);
    place(root, x, y, at.above);

    // Clicks inside a frame (a web page, an app window) never reach this document, and a document that doesn't have
    // focus gets no blur when the user clicks elsewhere. So take focus here: then a click anywhere outside the menu,
    // in a frame, in another window or in the shell, blurs this window and closes the menu.
    const ae = document.activeElement;
    if (ae && ae.tagName === 'IFRAME') { try { ae.blur(); } catch (e) { /* ignore */ } }
    if (!document.hasFocus()) { try { window.focus(); } catch (e) { /* ignore */ } }

    let closed = false; // closed before the listeners below were added (opened and closed in one go)
    setTimeout(() => {
      if (closed) return;
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('mousedown', outside, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('blur', close);
      document.addEventListener('focusin', onFocus, true);
    });
    // Focus moving into a frame (the window keeps focus in some browsers) also counts as leaving the menu.
    function onFocus(e) { if (e.target && e.target.tagName === 'IFRAME') close(); }
    current = () => {
      closed = true;
      clearTimeout(hoverTimer);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      closeFrom(0);
      if (opts.onClose) opts.onClose();
    };
    return close;
  }

  function close() {
    if (current) { const c = current; current = null; c(); }
  }

  window.LOS_menu = { open, close, isOpen: () => !!current };
})();
