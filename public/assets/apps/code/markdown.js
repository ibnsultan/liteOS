/* Markdown → HTML for Code's preview. Everything is escaped: raw HTML in the source is shown as text, never run. */
(function () {
  'use strict';

  function escAttr(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ------------------------------------------------------------------ Markdown → HTML
  function safeUrl(u) {
    const raw = String(u).trim();
    const t = raw.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
    return /^(https?:|mailto:)/.test(t) ? raw : null; // links and images only to the web or mail
  }
  function decodeEntities(s) {
    return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  function inline(text) {
    const codes = [];
    let s = String(text).replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = escAttr(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*?&quot;)?\)/g, (m, alt, u) => {
      const url = safeUrl(decodeEntities(u));
      return url && /^https?:/i.test(url) ? '<img src="' + escAttr(url) + '" alt="' + alt + '">' : alt;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*?&quot;)?\)/g, (m, t, u) => {
      const url = safeUrl(decodeEntities(u));
      return url ? '<a href="' + escAttr(url) + '" target="_blank" rel="noopener noreferrer">' + t + '</a>' : t;
    });
    s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (m, u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');
    s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+?)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+?)~~/g, '<del>$1</del>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + escAttr(codes[+i]) + '</code>');
  }
  function markdown(src) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null;
    const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join('\n')).replace(/ {2,}\n/g, '<br>\n') + '</p>'); para = []; } };
    const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      let m;
      if (/^ {0,3}```/.test(l)) {
        flushPara(); closeList();
        const buf = [];
        i++;
        while (i < lines.length && !/^ {0,3}```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push('<pre><code>' + escAttr(buf.join('\n')) + '</code></pre>');
        continue;
      }
      if (/^\s*$/.test(l)) { flushPara(); closeList(); i++; continue; }
      if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) {
        flushPara(); closeList();
        const n = m[1].length;
        out.push('<h' + n + '>' + inline(m[2]) + '</h' + n + '>');
        i++; continue;
      }
      if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { flushPara(); closeList(); out.push('<hr>'); i++; continue; }
      if (/^ {0,3}>/.test(l)) {
        flushPara(); closeList();
        const buf = [];
        while (i < lines.length && (m = /^ {0,3}> ?(.*)$/.exec(lines[i]))) { buf.push(m[1]); i++; }
        out.push('<blockquote>' + markdown(buf.join('\n')) + '</blockquote>');
        continue;
      }
      if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l))) {
        flushPara();
        const type = /\d/.test(m[1]) ? 'ol' : 'ul';
        if (list !== type) { closeList(); out.push('<' + type + '>'); list = type; }
        let item = m[2];
        const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
        if (task) item = (task[1] === ' ' ? '☐ ' : '☑ ') + task[2];
        out.push('<li>' + inline(item) + '</li>');
        i++; continue;
      }
      closeList();
      para.push(l.trim() === l ? l : l.replace(/^\s+/, ''));
      i++;
    }
    flushPara(); closeList();
    return out.join('\n');
  }

  window.CodeMarkdown = { markdown, escAttr };
})();
