/* Lightweight regex highlighters + Markdown renderer for the Code app. */
(function () {
  'use strict';

  function esc(s) { return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;')); }
  function escAttr(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function span(cls, text) { return text ? '<span class="t-' + cls + '">' + esc(text) + '</span>' : ''; }

  /**
   * Build a lexer from [className|null, regexSource] rules. Rule sources must use only
   * non-capturing groups. Unmatched text is escaped and emitted as-is.
   */
  function lexer(rules, flags) {
    const re = new RegExp(rules.map((r) => '(' + r[1] + ')').join('|'), flags || 'g');
    return function (src) {
      let out = '';
      let last = 0;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(src))) {
        if (m[0] === '') { re.lastIndex++; continue; }
        if (m.index > last) out += esc(src.slice(last, m.index));
        let i = 1;
        while (m[i] === undefined) i++;
        const cls = rules[i - 1][0];
        out += cls ? span(cls, m[0]) : esc(m[0]);
        last = re.lastIndex;
      }
      return out + esc(src.slice(last));
    };
  }

  const END = '(?![\\s\\S])'; // end of input (for unterminated tokens while typing)
  const STR = '"(?:[^"\\\\\\n]|\\\\[\\s\\S])*"?|\'(?:[^\'\\\\\\n]|\\\\[\\s\\S])*\'?';
  const BLOCK_COMMENT = '\\/\\*[\\s\\S]*?(?:\\*\\/|' + END + ')';
  const NUM = '\\b(?:0[xX][\\da-fA-F_]+|0[bB][01_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?n?)\\b';

  const JS_KW = 'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|class|extends|super|import|export|from|default|try|catch|finally|throw|async|await|yield|void|static|get|set|with|debugger|enum|interface|type|implements|public|private|protected|readonly';
  const js = lexer([
    ['com', '\\/\\/[^\\n]*|' + BLOCK_COMMENT],
    ['str', STR + '|`(?:[^`\\\\]|\\\\[\\s\\S])*`?'],
    ['kw', '\\b(?:' + JS_KW + ')\\b'],
    ['lit', '\\b(?:true|false|null|undefined|this|NaN|Infinity)\\b'],
    ['num', NUM],
    ['fn', '[A-Za-z_$][\\w$]*(?=\\s*\\()'],
    [null, '[A-Za-z_$][\\w$]*'],
  ]);

  const css = lexer([
    ['com', BLOCK_COMMENT],
    ['str', STR],
    ['kw', '@[\\w-]+|!important\\b'],
    ['attr', '(?<=[{;]\\s*)-{0,2}[A-Za-z][\\w-]*(?=\\s*:)'],
    ['num', '#[\\da-fA-F]{3,8}\\b|-?(?:\\d*\\.)?\\d+(?:px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|turn|fr|ch|ex|pt|pc|cm|mm|in|dpi|x)?\\b'],
    ['fn', '[A-Za-z-]+(?=\\()'],
    ['tag', '[.#][A-Za-z_-][\\w-]*'],
  ]);

  const json = lexer([
    ['attr', '"(?:[^"\\\\\\n]|\\\\.)*"(?=\\s*:)'],
    ['str', '"(?:[^"\\\\\\n]|\\\\.)*"?'],
    ['num', '-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b'],
    ['lit', '\\b(?:true|false|null)\\b'],
  ]);

  const PHP_KW = 'abstract|and|array|as|break|callable|case|catch|class|clone|const|continue|declare|default|do|echo|else|elseif|empty|enddeclare|endfor|endforeach|endif|endswitch|endwhile|extends|final|finally|fn|for|foreach|function|global|goto|if|implements|include|include_once|instanceof|insteadof|interface|isset|list|match|namespace|new|or|print|private|protected|public|readonly|require|require_once|return|static|switch|throw|trait|try|unset|use|var|while|xor|yield|int|float|bool|string|void|mixed|never|object|iterable|self|parent';
  const phpCode = lexer([
    ['com', '\\/\\/[^\\n]*?(?=\\?>|\\n|' + END + ')|#(?!\\[)[^\\n]*?(?=\\?>|\\n|' + END + ')|' + BLOCK_COMMENT],
    ['str', STR],
    ['var', '\\$[A-Za-z_][\\w]*'],
    ['kw', '\\b(?:' + PHP_KW + ')\\b'],
    ['lit', '\\b(?:true|false|null|TRUE|FALSE|NULL)\\b'],
    ['num', NUM],
    ['fn', '[A-Za-z_][\\w]*(?=\\s*\\()'],
    [null, '[A-Za-z_][\\w]*'],
  ]);

  const attrs = lexer([
    ['str', '"[^"]*"?|\'[^\']*\'?'],
    ['attr', '[^\\s=/>"\']+'],
    ['punct', '='],
  ]);
  function tag(t) {
    const m = /^(<\/?)([\w:.-]+)([\s\S]*?)(\/?>)?$/.exec(t);
    if (!m) return esc(t);
    return span('punct', m[1]) + span('tag', m[2]) + attrs(m[3]) + (m[4] ? span('punct', m[4]) : '');
  }
  function phpBlock(t) {
    const m = /^(<\?(?:php|=)?)([\s\S]*?)(\?>)?$/.exec(t);
    if (!m) return esc(t);
    return span('kw', m[1]) + phpCode(m[2]) + (m[3] ? span('kw', m[3]) : '');
  }
  const HTML_RE = new RegExp([
    '(<!--[\\s\\S]*?(?:-->|' + END + '))',
    '(<\\?(?:php|=)?[\\s\\S]*?(?:\\?>|' + END + '))',
    '(<script\\b[^>]*>)([\\s\\S]*?)(<\\/script\\s*>|' + END + ')',
    '(<style\\b[^>]*>)([\\s\\S]*?)(<\\/style\\s*>|' + END + ')',
    '(<\\/?[A-Za-z][^>]*>?)',
    '(&#?\\w+;)',
    '(<!doctype[^>]*>?)',
  ].join('|'), 'gi');
  function html(src) {
    let out = '';
    let last = 0;
    let m;
    HTML_RE.lastIndex = 0;
    while ((m = HTML_RE.exec(src))) {
      if (m[0] === '') { HTML_RE.lastIndex++; continue; }
      if (m.index > last) out += esc(src.slice(last, m.index));
      if (m[1]) out += span('com', m[1]);
      else if (m[2]) out += phpBlock(m[2]);
      else if (m[3]) out += tag(m[3]) + js(m[4]) + (m[5] ? tag(m[5]) : '');
      else if (m[6]) out += tag(m[6]) + css(m[7]) + (m[8] ? tag(m[8]) : '');
      else if (m[9]) out += tag(m[9]);
      else if (m[10]) out += span('lit', m[10]);
      else if (m[11]) out += span('kw', m[11]);
      else out += esc(m[0]);
      last = HTML_RE.lastIndex;
    }
    return out + esc(src.slice(last));
  }

  const mdLex = lexer([
    ['str', '^ {0,3}```[^\\n]*\\n[\\s\\S]*?(?:^ {0,3}```[^\\n]*$|' + END + ')'],
    ['head', '^#{1,6}\\s[^\\n]*'],
    ['com', '^ {0,3}>[^\\n]*'],
    ['num', '^\\s*(?:[-*+]|\\d+[.)])(?=\\s)'],
    ['kw', '^ {0,3}(?:-{3,}|\\*{3,}|_{3,})\\s*$'],
    ['str', '`[^`\\n]+`'],
    ['bold', '\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__'],
    ['it', '\\*[^*\\s][^*\\n]*\\*|\\b_[^_\\n]+_\\b'],
    ['fn', '!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)'],
  ], 'gm');

  const LANGS = {
    html: { name: 'HTML', hl: html },
    css: { name: 'CSS', hl: css },
    js: { name: 'JavaScript', hl: js },
    json: { name: 'JSON', hl: json },
    php: { name: 'PHP', hl: html },
    md: { name: 'Markdown', hl: mdLex },
    plain: { name: 'Plain text', hl: esc },
  };
  const EXT_LANG = {
    html: 'html', htm: 'html', xhtml: 'html', svg: 'html', xml: 'html',
    css: 'css', js: 'js', mjs: 'js', cjs: 'js', ts: 'js', jsx: 'js', tsx: 'js',
    json: 'json', php: 'php', md: 'md', markdown: 'md',
  };
  function langFor(name) {
    const n = String(name);
    const ext = n.includes('.') ? n.split('.').pop().toLowerCase() : '';
    return EXT_LANG[ext] || 'plain';
  }
  function highlight(lang, src) {
    const L = LANGS[lang] || LANGS.plain;
    try { return L.hl(src); } catch (e) { return esc(src); }
  }

  // ------------------------------------------------------------------ Markdown → HTML
  function safeUrl(u) {
    const raw = String(u).trim();
    const t = raw.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
    if (/^(https?:|mailto:)/.test(t)) return raw;
    if (/^[a-z][a-z0-9+.-]*:/.test(t)) return null;
    return raw;
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

  window.CodeHL = { highlight, langFor, LANGS, markdown, escAttr };
})();
