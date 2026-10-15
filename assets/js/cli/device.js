// What every practice device shares: running a line (with abbreviations and output pipes), ? help,
// Tab completion, each platform's own error messages, and console messages that arrive a moment
// after a change (a link coming up, a BGP session dropping). Devices supply the grammar for the
// mode they're in (root), the prompt, and what each command prints.
import { tokenize, splitPipes, walk, offers, FILTERS, applyFilters, pad } from './engine.js';

export class Device {
  constructor() {
    this.style = 'ios';         // 'ios' | 'xr' | 'junos': error and help formats
    this.quotes = false;        // Junos takes "quoted strings"
    this.onLog = null;          // the terminal listens here for console messages
    this.timers = [];
    this.history = [];
    this.boot = Date.now() - this.bootAge() * 1000;
  }
  bootAge() { return 3 * 86400 + 4 * 3600 + 17 * 60; }   // up 3 days, 4 hours when you arrive
  uptime() { return (Date.now() - this.boot) / 1000; }
  root() { return []; }
  prompt() { return '# '; }
  pre() { return []; }          // lines printed just above the prompt (Junos [edit])
  get filterStyle() { return this.style === 'junos' ? 'junos' : this.style === 'xr' ? 'xr' : 'ios'; }

  // ---------------------------------------------------------------- console messages
  emit(text, ms = 0) {
    const fire = () => { if (this.onLog && text) this.onLog(text); };
    if (!ms) fire();
    else this.timers.push(setTimeout(fire, ms));
  }
  stopTimers() { this.timers.forEach(clearTimeout); this.timers = []; }

  // ---------------------------------------------------------------- run a line
  parse(line, root = this.root()) {
    const parts = splitPipes(line);
    const toks = tokenize(parts[0].text, this.quotes);
    const r = walk(root, toks, this, parts[0].text);
    return Object.assign(r, { toks, parts, text: parts[0].text, line });
  }
  negated(r) { return this.style !== 'junos' && r.path[0] === 'no'; }

  exec(line) {
    if (!line.trim()) return '';
    const r = this.parse(line);
    if (r.err) return this.fail(r);
    const fn = this.negated(r) ? r.node.no : r.node.run;
    if (typeof fn !== 'function') return this.incomplete(r);
    const pipes = [];
    for (let j = 1; j < r.parts.length; j++) {
      const seg = r.parts[j];
      if (!r.pipe) return this.fail({ err: 'invalid', at: -1, col: seg.at - 1, line, path: [] });
      const ft = tokenize(seg.text, this.quotes);
      const fr = walk(FILTERS[this.filterStyle], ft, this, seg.text);
      if (fr.err) return this.fail(Object.assign(fr, { toks: ft, off: seg.at, line, text: seg.text }));
      if (!fr.node || !fr.node.run) return this.incomplete(Object.assign(fr, { toks: ft, off: seg.at, line, text: seg.text, filter: true }));
      const k = fr.path[0] === 'display' ? 'display set' : fr.path[0];
      pipes.push({ k, arg: fr.a.LINE ?? fr.a['<pattern>'] ?? fr.a['<lines>'] ?? fr.a['<number>'] });
    }
    let out = fn.call(this, r.a, { pipes, path: r.path, line, r });
    const left = pipes.filter((p) => !p.used);
    if (left.length) {
      if (typeof out === 'string') out = applyFilters(out, left, this.filterStyle);
      else if (out && typeof out.out === 'string') out.out = applyFilters(out.out, left, this.filterStyle);
    }
    return out;
  }

  // The words a line resolves to, spelled out in full: "sh ip int br" -> "show ip interface brief".
  // The quiz grades with this, so any abbreviation the real CLI takes counts.
  canon(line) {
    if (!line.trim()) return null;
    const r = this.parse(line);
    if (r.err || !r.node) return null;
    const fn = this.negated(r) ? r.node.no : r.node.run;
    if (typeof fn !== 'function') return null;
    let s = r.path.join(' ');
    for (let j = 1; j < r.parts.length; j++) {
      const ft = tokenize(r.parts[j].text, this.quotes);
      const fr = walk(FILTERS[this.filterStyle], ft, this, r.parts[j].text);
      if (fr.err || !fr.node) return null;
      s += ' | ' + fr.path.join(' ');
    }
    return s;
  }

  // ---------------------------------------------------------------- errors, the platform's way
  caret(col) { return ' '.repeat(this.prompt().length + col) + '^'; }
  colOf(r) {
    if (r.col != null) return r.col;
    const tok = r.at >= 0 && r.toks ? r.toks[r.at] : null;
    return (r.off || 0) + (tok ? tok.s : (r.text || '').length);
  }
  fail(r) {
    const col = this.colOf(r);
    if (this.style === 'junos') {
      if (r.err === 'ambiguous') {
        const tok = r.toks[r.at].t;
        return [this.caret(col), `'${tok}' is ambiguous.`, 'Possible completions:', ...this.junosRows(offers(r.matches, this))].join('\n');
      }
      if (r.err === 'value') return [this.caret(col), r.msg].join('\n');
      const first = (r.at === 0 && !r.off && !this.inConfig());
      return [this.caret(col), first ? 'unknown command.' : this.inConfig() ? 'syntax error.' : 'syntax error, expecting <command>.'].join('\n');
    }
    if (r.err === 'ambiguous') return `% Ambiguous command:  "${r.line.trim()}"\n`;
    if (r.err === 'value') return [this.caret(col), r.msg, ''].join('\n');
    return [this.caret(col), "% Invalid input detected at '^' marker.", ''].join('\n');
  }
  incomplete(r) {
    if (this.style === 'junos') {
      const col = (r.off || 0) + (r.text || '').trimEnd().length + 1;
      const wantsValue = r.list && r.list.some((n) => n.p);
      return [this.caret(col), this.inConfig() && wantsValue ? 'missing argument.' : 'syntax error, expecting <command>.'].join('\n');
    }
    return '% Incomplete command.\n';
  }
  inConfig() { return false; }

  // ---------------------------------------------------------------- ? help
  help(line) {
    const parts = splitPipes(line);
    let root = this.root(), seg = parts[0];
    if (parts.length > 1) {
      const head = this.parse(parts.slice(0, -1).map((p) => p.text).join('|'));
      if (head.err) return this.fail(head);
      if (!head.pipe) return this.fail({ err: 'invalid', at: -1, col: parts[1].at - 1, line, path: [] });
      root = FILTERS[this.filterStyle];
      seg = parts[parts.length - 1];
    }
    const text = seg.text;
    const toks = tokenize(text, this.quotes);
    const partial = text.length && !/\s$/.test(text) && toks.length ? toks.pop() : null;
    const r = walk(root, toks, this, text);
    if (r.err) return this.fail(Object.assign(r, { toks, off: seg.at, line, text }));
    let rows = offers(r.list, this);
    const neg = this.style !== 'junos' && r.path[0] === 'no';
    const end = !!r.node && (neg ? typeof r.node.no === 'function' : !!r.node.run) && !partial;
    const pipe = parts.length === 1 && r.pipe && end;
    if (partial) {
      const low = partial.t.toLowerCase();
      const words = rows.filter((x) => !x.param && x.name.toLowerCase().startsWith(low));
      if (words.length) rows = words;
      else {
        const ok = r.list.filter((n) => n.p && !n.hints && (n.rest || !n.t || n.t(partial.t, this, [partial], 0, r.a)));
        rows = offers(ok, this);
      }
    }
    if (this.style === 'junos') {
      if (!rows.length && !end) return 'No valid completions';
      const out = ['Possible completions:'];
      if (end) out.push(`  ${pad('<[Enter]>', 21)}Execute this command`);
      out.push(...this.junosRows(rows));
      if (pipe) out.push(`  ${pad('|', 21)}Pipe through a command`);
      return out.join('\n');
    }
    if (partial) {
      if (!rows.length) return '% Unrecognized command';
      return rows.map((x) => x.name).join('  ') + '  ';
    }
    const w = Math.max(10, ...rows.map((x) => x.name.length)) + 2;
    const out = rows.map((x) => `  ${pad(x.name, w)}${x.h}`);
    if (pipe) out.push(`  ${pad('|', w)}Output modifiers`);
    if (end) out.push('  <cr>');
    return out.join('\n');
  }
  junosRows(rows) {
    return rows.map((x) => `${x.kind ? x.kind + ' ' : '  '}${pad(x.name, 21)}${x.h}`);
  }

  // ---------------------------------------------------------------- Tab completion
  complete(line) {
    const parts = splitPipes(line);
    let root = this.root(), seg = parts[0];
    if (parts.length > 1) { root = FILTERS[this.filterStyle]; seg = parts[parts.length - 1]; }
    const text = seg.text;
    if (!text.length || /\s$/.test(text)) return null;
    const toks = tokenize(text, this.quotes);
    const partial = toks.pop();
    if (partial.q) return null;
    const r = walk(root, toks, this, text);
    if (r.err) return null;
    const low = partial.t.toLowerCase();
    const names = [...new Set(offers(r.list, this).filter((x) => !x.param && x.name.toLowerCase().startsWith(low)).map((x) => x.name))];
    const head = line.slice(0, seg.at + partial.s);
    if (names.length === 1) return { line: head + names[0] + ' ' };
    if (!names.length) {
      // a whole value a parameter knows how to spell out (gi1/0/1 -> GigabitEthernet1/0/1)
      for (const n of r.list) {
        if (n.p && n.full) {
          const v = n.t && n.t(partial.t, this, [partial], 0, r.a);
          if (v && v[1] === 1) return { line: head + n.full(v[0]) + ' ' };
        }
      }
      return null;
    }
    let pre = names[0];
    for (const nm of names) while (!nm.toLowerCase().startsWith(pre.toLowerCase())) pre = pre.slice(0, -1);
    if (pre.length > partial.t.length) return { line: head + pre };
    if (this.style === 'junos') {
      return { line, show: ['Possible completions:', ...this.junosRows(offers(r.list, this).filter((x) => names.includes(x.name)))].join('\n') };
    }
    return { line, bell: true };
  }
}
