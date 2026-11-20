/*
 * Code's terminal: a fixed set of file commands written in JavaScript. Every command goes through the same SDK calls
 * as the explorer and stays inside the project folder. There is no server shell: nothing typed here runs on the host,
 * and there are no pipes, redirection, chaining, variables, network commands or scripts.
 */
(function () {
  'use strict';

  const MAX_LINES = 1000; // per command
  const MAX_LOG = 3000; // lines kept in the panel
  const MAX_GREP_FILE = 2 * 1024 * 1024;
  const MAX_WALK = 5000; // entries visited by find, grep and tree
  const BINARY = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'mp4', 'webm', 'ogv', 'mov', 'm4v', 'mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac',
    'pdf', 'zip', 'rar', '7z', 'gz', 'ldoc', 'lsheet', 'lslides', 'exe', 'woff', 'woff2', 'ttf', 'otf'];

  const HELP = [
    ['help', 'List the commands'],
    ['pwd', 'Show the current folder'],
    ['ls [path]', 'List a folder'],
    ['cd [path]', 'Change folder (no path: the project folder)'],
    ['tree [path]', 'Show a folder and everything in it'],
    ['cat <file>', 'Show a file'],
    ['head [-n N] <file>', 'Show the first lines of a file (10)'],
    ['tail [-n N] <file>', 'Show the last lines of a file (10)'],
    ['find [path] [-name pattern]', 'Find files by name (* and ? wildcards)'],
    ['grep [-i] <pattern> [path]', 'Search file contents (a regular expression)'],
    ['mkdir [-p] <folder>', 'Create a folder (-p: and its parents)'],
    ['touch <file>', 'Create an empty file'],
    ['cp [-r] <from> <to>', 'Copy (-r for folders)'],
    ['mv <from> <to>', 'Move or rename'],
    ['rm [-r] <path…>', 'Move to the Trash (-r for folders)'],
    ['open <file>', 'Open a file in a tab'],
    ['run', 'Refresh the live preview'],
    ['clear', 'Clear the terminal'],
  ];

  function normalize(path) {
    const out = [];
    String(path).split('/').forEach((s) => {
      if (!s || s === '.') return;
      if (s === '..') out.pop(); else out.push(s);
    });
    return '/' + out.join('/');
  }
  const under = (p, base) => p === base || p.startsWith(base === '/' ? '/' : base + '/');
  const dirname = (p) => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
  const basename = (p) => p.split('/').pop() || '/';
  const ext = (n) => (n.includes('.') ? n.split('.').pop().toLowerCase() : '');

  /** Split a command line into words; quotes group, backslash escapes. Returns null for unsupported shell syntax. */
  function parse(line) {
    const words = [];
    let cur = '';
    let has = false;
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (c === quote) quote = null;
        else if (c === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i];
        else cur += c;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; has = true; continue; }
      if (c === '\\' && i + 1 < line.length) { cur += line[++i]; has = true; continue; }
      if (/\s/.test(c)) { if (has) { words.push(cur); cur = ''; has = false; } continue; }
      if ('|<>;&`'.includes(c) || (c === '$' && /[({A-Za-z_]/.test(line[i + 1] || ''))) return null;
      cur += c; has = true;
    }
    if (quote) throw new Error('Missing closing quote.');
    if (has) words.push(cur);
    return words;
  }
  function flags(args, allowed) {
    const f = {};
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--') { rest.push(...args.slice(i + 1)); break; }
      if (/^-[A-Za-z]+$/.test(a)) {
        for (const ch of a.slice(1)) {
          if (!allowed.includes(ch)) throw new Error('Unknown option -' + ch);
          if (ch === 'n') { const v = args[++i]; if (!/^\d+$/.test(v || '')) throw new Error('-n needs a number'); f.n = +v; } else f[ch] = true;
        }
      } else if (a === '-name' && allowed.includes('name')) {
        f.name = args[++i];
        if (f.name == null) throw new Error('-name needs a pattern');
      } else rest.push(a);
    }
    return { f, rest };
  }
  function globRe(pattern) {
    return new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  }

  function create(o) {
    const OS = o.OS;
    const out = o.out;
    const input = o.input;
    let cwd = null;
    let lastRoot = null;
    let busy = false;
    let cancelled = false;
    let printed = 0;
    const history = [];
    let histAt = 0;

    function root() {
      const r = o.root();
      if (r !== lastRoot) { lastRoot = r; cwd = r; renderPrompt(); }
      return r;
    }
    function renderPrompt() {
      const r = lastRoot;
      if (!r) { o.prompt.textContent = '$'; return; }
      const rel = cwd === r ? '' : cwd.slice(r === '/' ? 1 : r.length + 1);
      o.prompt.textContent = (r === '/' ? 'My Drive' : basename(r)) + (rel ? '/' + rel : '') + ' $';
    }

    function print(text, cls) {
      if (printed === MAX_LINES) {
        printed++;
        const d = document.createElement('div');
        d.className = 'term-line sys';
        d.textContent = '… output cut at ' + MAX_LINES.toLocaleString() + ' lines';
        out.appendChild(d);
        return;
      }
      if (printed > MAX_LINES) return;
      printed++;
      const d = document.createElement('div');
      d.className = 'term-line' + (cls ? ' ' + cls : '');
      d.textContent = text;
      out.appendChild(d);
      while (out.childNodes.length > MAX_LOG) out.firstChild.remove();
    }
    function scroll() { out.scrollTop = out.scrollHeight; }

    function resolve(arg) {
      const r = root();
      const p = normalize(String(arg).startsWith('/') ? r + '/' + arg : cwd + '/' + arg);
      if (!under(p, r)) throw new Error('That’s outside the project folder: ' + arg);
      return p;
    }
    function shown(p) {
      const r = lastRoot;
      if (p === cwd) return '.';
      if (under(p, cwd) && cwd !== '/') return p.slice(cwd.length + 1);
      if (cwd === '/') return p.slice(1);
      return p === r ? '/' : p.slice(r === '/' ? 0 : r.length);
    }
    async function stat(p) { try { return await OS.fs.stat(p); } catch (e) { return null; } }
    async function need(p, type) {
      const s = await stat(p);
      if (!s) throw new Error('No such file or folder: ' + shown(p));
      if (type && s.type !== type) throw new Error(type === 'dir' ? 'Not a folder: ' + shown(p) : 'Is a folder: ' + shown(p));
      return s;
    }
    async function readText(p) {
      const e = await need(p, 'file');
      if (BINARY.includes(ext(e.name))) throw new Error('Not a text file: ' + shown(p));
      const r = await OS.fs.read(p, { track: false });
      return String(r.content == null ? '' : r.content);
    }
    async function walk(dir, fn) {
      let seen = 0;
      async function go(d, depth) {
        let list;
        try { list = await OS.fs.list(d); } catch (e) { return; }
        for (const e of list) {
          if (cancelled || ++seen > MAX_WALK) return;
          if ((await fn(e, depth)) === false) return;
          if (e.type === 'dir') await go(e.path, depth + 1);
        }
      }
      await go(dir, 0);
      if (seen > MAX_WALK) print('… stopped after ' + MAX_WALK.toLocaleString() + ' items', 'sys');
    }
    function lines(text) { const l = text.split(/\r?\n/); if (l.length && l[l.length - 1] === '') l.pop(); return l; }

    const commands = {
      help() { HELP.forEach(([c, d]) => print(c.padEnd(30) + d)); },
      pwd() { print(cwd); },
      clear() { out.innerHTML = ''; printed = 0; },
      async ls(args) {
        const { rest } = flags(args, 'la');
        const targets = rest.length ? rest : ['.'];
        for (const t of targets) {
          const p = resolve(t);
          const s = await need(p);
          if (s.type !== 'dir') { print(shown(p)); continue; }
          if (targets.length > 1) print(shown(p) + ':', 'sys');
          const list = await OS.fs.list(p);
          if (!list.length) print('(empty)', 'sys');
          list.forEach((e) => print(e.type === 'dir' ? e.name + '/' : e.name, e.type === 'dir' ? 'dir' : ''));
        }
      },
      async cd(args) {
        if (args.length > 1) throw new Error('cd takes one folder');
        const p = args.length ? resolve(args[0]) : root();
        await need(p, 'dir');
        cwd = p;
        renderPrompt();
      },
      async tree(args) {
        const p = resolve(args[0] || '.');
        await need(p, 'dir');
        print(shown(p));
        await walk(p, (e, depth) => { print('  '.repeat(depth + 1) + (e.type === 'dir' ? e.name + '/' : e.name), e.type === 'dir' ? 'dir' : ''); });
      },
      async cat(args) {
        if (!args.length) throw new Error('cat needs a file');
        for (const a of args) lines(await readText(resolve(a))).forEach((l) => print(l));
      },
      async head(args) {
        const { f, rest } = flags(args, 'n');
        if (rest.length !== 1) throw new Error('head needs one file');
        lines(await readText(resolve(rest[0]))).slice(0, f.n || 10).forEach((l) => print(l));
      },
      async tail(args) {
        const { f, rest } = flags(args, 'n');
        if (rest.length !== 1) throw new Error('tail needs one file');
        lines(await readText(resolve(rest[0]))).slice(-(f.n || 10)).forEach((l) => print(l));
      },
      async find(args) {
        const { f, rest } = flags(args, ['name']);
        let start = '.';
        let pattern = f.name;
        if (rest.length > 2) throw new Error('find takes a folder and a name pattern');
        if (rest.length === 2) { start = rest[0]; pattern = rest[1]; } else if (rest.length === 1) {
          if (pattern || /[*?]/.test(rest[0])) { if (pattern) start = rest[0]; else pattern = rest[0]; } else start = rest[0];
        }
        const p = resolve(start);
        await need(p, 'dir');
        const re = pattern ? globRe(pattern) : null;
        let n = 0;
        await walk(p, (e) => { if (!re || re.test(e.name)) { n++; print(shown(e.path) + (e.type === 'dir' ? '/' : ''), e.type === 'dir' ? 'dir' : ''); } });
        if (!n) print('Nothing found.', 'sys');
      },
      async grep(args) {
        const { f, rest } = flags(args, 'inr');
        if (!rest.length || rest.length > 2) throw new Error('grep needs a pattern and, optionally, a path');
        let re;
        try { re = new RegExp(rest[0], f.i ? 'i' : ''); } catch (e) { throw new Error('Not a valid pattern: ' + e.message); }
        const p = resolve(rest[1] || '.');
        const s = await need(p);
        let hits = 0;
        const scan = async (entry) => {
          if (entry.type !== 'file' || BINARY.includes(ext(entry.name)) || (entry.size || 0) > MAX_GREP_FILE) return;
          let text;
          try { text = String((await OS.fs.read(entry.path, { track: false })).content || ''); } catch (e) { return; }
          lines(text).forEach((l, i) => {
            if (re.test(l)) { hits++; print(shown(entry.path) + ':' + (i + 1) + ': ' + (l.length > 400 ? l.slice(0, 400) + '…' : l)); }
          });
        };
        if (s.type === 'dir') await walk(p, scan); else await scan(s);
        if (!hits) print('No matches.', 'sys');
      },
      async mkdir(args) {
        const { f, rest } = flags(args, 'p');
        if (!rest.length) throw new Error('mkdir needs a folder name');
        for (const a of rest) {
          const p = resolve(a);
          if (f.p) {
            const r = root();
            const parts = p.slice(r === '/' ? 1 : r.length + 1).split('/').filter(Boolean);
            let cur = r;
            for (const part of parts) {
              cur = cur === '/' ? '/' + part : cur + '/' + part;
              const s = await stat(cur);
              if (!s) { await OS.fs.mkdir(cur); o.changed(dirname(cur)); }
              else if (s.type !== 'dir') throw new Error('Not a folder: ' + shown(cur));
            }
          } else {
            if (await stat(p)) throw new Error('Already exists: ' + shown(p));
            await need(dirname(p), 'dir');
            await OS.fs.mkdir(p);
          }
          o.changed(dirname(p));
        }
      },
      async touch(args) {
        if (!args.length) throw new Error('touch needs a file name');
        for (const a of args) {
          const p = resolve(a);
          if (await stat(p)) continue;
          await need(dirname(p), 'dir');
          await OS.fs.write(p, '', { overwrite: false });
          o.changed(dirname(p));
        }
      },
      cp(args) { return transfer(true, args); },
      mv(args) { return transfer(false, args); },
      async rm(args) {
        const { f, rest } = flags(args, 'rf');
        if (!rest.length) throw new Error('rm needs a path');
        const paths = rest.map(resolve);
        const r = root();
        let hasDir = false;
        for (const p of paths) {
          if (p === r) throw new Error('You can’t remove the project folder.');
          const s = await need(p);
          if (s.type === 'dir') { if (!f.r) throw new Error('Is a folder (use rm -r): ' + shown(p)); hasDir = true; }
        }
        if (hasDir || paths.length > 1) {
          const ok = await o.confirm({
            title: 'Move to Trash?',
            message: (paths.length === 1 ? '“' + basename(paths[0]) + '” and everything in it' : paths.length + ' items') + ' will be moved to the Trash.',
            okLabel: 'Move to Trash', danger: true,
          });
          if (!ok) { print('Cancelled.', 'sys'); return; }
        }
        await OS.fs.remove(paths);
        o.removed(paths);
        [...new Set(paths.map(dirname))].forEach(o.changed);
        print('Moved ' + (paths.length === 1 ? shown(paths[0]) : paths.length + ' items') + ' to the Trash.', 'sys');
      },
      async open(args) {
        if (args.length !== 1) throw new Error('open needs one file');
        const p = resolve(args[0]);
        await need(p, 'file');
        await o.open(p);
      },
      run() { o.run(); print('Preview refreshed.', 'sys'); },
    };

    async function transfer(copy, args) {
      const { f, rest } = flags(args, copy ? 'r' : '');
      if (rest.length < 2) throw new Error((copy ? 'cp' : 'mv') + ' needs a source and a destination');
      const r = root();
      const srcs = rest.slice(0, -1).map(resolve);
      const dest = resolve(rest[rest.length - 1]);
      for (const s of srcs) {
        if (s === r) throw new Error('You can’t ' + (copy ? 'copy' : 'move') + ' the project folder.');
        const st = await need(s);
        if (copy && st.type === 'dir' && !f.r) throw new Error('Is a folder (use cp -r): ' + shown(s));
      }
      const ds = await stat(dest);
      const act = copy ? OS.fs.copy : OS.fs.move;
      if (ds && ds.type === 'dir') {
        await act(srcs, dest);
      } else if (ds) {
        throw new Error('Already exists: ' + shown(dest));
      } else {
        if (srcs.length > 1) throw new Error('Not a folder: ' + shown(dest));
        const src = srcs[0];
        const parent = dirname(dest);
        await need(parent, 'dir');
        const name = basename(dest);
        if (!copy && dirname(src) === parent) await OS.fs.rename(src, name);
        else {
          const res = await act([src], parent);
          const entry = Array.isArray(res) ? res[0] : null;
          const landed = entry && entry.path ? entry.path : parent === '/' ? '/' + basename(src) : parent + '/' + basename(src);
          if (basename(landed) !== name) await OS.fs.rename(landed, name);
        }
      }
      if (!copy) o.moved(srcs, ds && ds.type === 'dir' ? dest : null, ds ? null : dest);
      [...new Set(srcs.map(dirname).concat(ds && ds.type === 'dir' ? dest : dirname(dest)))].forEach(o.changed);
    }

    async function exec(line) {
      const r = root();
      print((o.prompt.textContent || '$') + ' ' + line, 'cmd');
      printed = 0;
      if (!r) { print('Open a folder or a saved file to use the terminal.', 'err'); return; }
      let words;
      try { words = parse(line); } catch (e) { print(e.message, 'err'); return; }
      if (words === null) { print('Pipes, redirection, chaining and variables aren’t supported here.', 'err'); return; }
      if (!words.length) return;
      const [name, ...args] = words;
      const fn = Object.prototype.hasOwnProperty.call(commands, name) ? commands[name] : null;
      if (!fn) { print(name + ': command not found. Type help for the list.', 'err'); return; }
      busy = true;
      cancelled = false;
      try { await fn(args); } catch (e) { print(name + ': ' + (e && e.message ? e.message : String(e)), 'err'); }
      busy = false;
    }
    // Commands typed while one is still running wait their turn instead of being lost.
    let queue = Promise.resolve();
    function enqueue(line) { queue = queue.then(() => exec(line)).then(scroll, scroll); }

    async function complete() {
      if (!root()) return;
      const v = input.value.slice(0, input.selectionStart);
      const m = /(?:^|\s)((?:[^\s"'\\]|\\.)*)$/.exec(v);
      const word = m ? m[1] : '';
      const slash = word.lastIndexOf('/');
      const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
      const base = slash >= 0 ? word.slice(slash + 1) : word;
      let dir;
      try { dir = resolve(dirPart || '.'); } catch (e) { return; }
      let list;
      try { list = await OS.fs.list(dir); } catch (e) { return; }
      const hits = list.filter((e) => e.name.toLowerCase().startsWith(base.toLowerCase()));
      if (!hits.length) return;
      let fill;
      if (hits.length === 1) fill = hits[0].name + (hits[0].type === 'dir' ? '/' : ' ');
      else {
        fill = hits.reduce((acc, e) => { let i = 0; while (i < acc.length && i < e.name.length && acc[i].toLowerCase() === e.name[i].toLowerCase()) i++; return acc.slice(0, i); }, hits[0].name);
        if (fill.length <= base.length) {
          printed = 0;
          print(hits.map((e) => e.name + (e.type === 'dir' ? '/' : '')).join('   '), 'sys');
          scroll();
          return;
        }
      }
      const esc = fill.replace(/([\s"'\\])/g, '\\$1').replace(/\\ $/, ' ');
      const before = v.slice(0, v.length - base.length);
      input.value = before + esc + input.value.slice(input.selectionStart);
      const c = before.length + esc.length;
      input.setSelectionRange(c, c);
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const line = input.value;
        input.value = '';
        if (line.trim()) { history.push(line); if (history.length > 200) history.shift(); }
        histAt = history.length;
        enqueue(line);
      } else if (e.key === 'ArrowUp' && history.length) {
        e.preventDefault();
        histAt = Math.max(0, histAt - 1);
        input.value = history[histAt] || '';
      } else if (e.key === 'ArrowDown' && history.length) {
        e.preventDefault();
        histAt = Math.min(history.length, histAt + 1);
        input.value = history[histAt] || '';
      } else if (e.key === 'Tab') {
        e.preventDefault();
        complete();
      } else if (e.key === 'c' && e.ctrlKey && busy) {
        cancelled = true;
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        commands.clear();
      }
    });

    return {
      get name() { return o.name; },
      el: o.el,
      refresh() { root(); renderPrompt(); },
      focus() { root(); input.focus(); },
      clear: () => commands.clear(),
      /** Run a command as if it was typed. */
      run(line) { enqueue(line); },
      /** Keep the current folder valid after the project changes (folder renamed or removed). */
      fix(from, to) {
        if (cwd && under(cwd, from)) { cwd = to ? to + cwd.slice(from.length) : lastRoot; renderPrompt(); }
      },
    };
  }

  window.CodeTerminal = { create, parse, normalize };
})();
