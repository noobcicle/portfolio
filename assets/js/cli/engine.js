// The shared machinery for the practice CLIs on /lab/: a tokenizer, a grammar walker that takes
// abbreviations, ? help and Tab completion, output pipes, a small config tree for the Cisco-style
// devices, the router clock, and saving to this browser. Text in, text out: nothing here touches
// a network.

export const pad = (s, n) => ((s = String(s)).length >= n ? s : s + ' '.repeat(n - s.length));
export const lpad = (s, n) => ((s = String(s)).length >= n ? s : ' '.repeat(n - s.length) + s);
export const clone = (v) => JSON.parse(JSON.stringify(v));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------ saving (this browser only)
export const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private window */ } },
};

// ------------------------------------------------------------------ the clock (the lab lives in Central time)
const TZ = 'America/Chicago';
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, weekday: 'short', month: 'short', day: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
});
export function clock(t = Date.now()) {
  const p = {};
  for (const x of fmt.formatToParts(new Date(t))) p[x.type] = x.value;
  const ms = String(Math.floor(t % 1000)).padStart(3, '0');
  const mon = p.month, d = p.day, tz = p.timeZoneName || 'CDT';
  const num = String(new Date(t).toLocaleString('en-US', { timeZone: TZ, month: 'numeric' })).padStart(2, '0');
  return {
    p, ms, tz,
    hms: `${p.hour}:${p.minute}:${p.second}`,
    // Thu Oct 15 14:02:11.384 CDT (IOS XR, above every show)
    xr: `${p.weekday} ${mon} ${d} ${p.hour}:${p.minute}:${p.second}.${ms} ${tz}`,
    // *14:02:11.384 CDT Thu Oct 15 2026 (IOS show clock)
    ios: `${p.hour}:${p.minute}:${p.second}.${ms} ${tz} ${p.weekday} ${mon} ${d} ${p.year}`,
    // Oct 15 14:02:11.384 CDT (IOS syslog)
    log: `${mon} ${d} ${p.hour}:${p.minute}:${p.second}.${ms} ${tz}`,
    // 2026-10-15 14:02:11 CDT (Junos)
    junos: `${p.year}-${num}-${d} ${p.hour}:${p.minute}:${p.second} ${tz}`,
    // Thu Oct 15 14:02:11 2026 (XR commit list, IOS "last change")
    long: `${p.weekday} ${mon} ${d} ${p.hour}:${p.minute}:${p.second} ${p.year}`,
  };
}
// Uptimes in each platform's own style
export function ago(sec, style = 'ios') {
  sec = Math.max(0, Math.floor(sec));
  const w = Math.floor(sec / 604800), d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600);
  const m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const two = (n) => String(n).padStart(2, '0');
  if (style === 'junos') return d ? `${d}d ${h}:${two(m)}:${two(s)}` : `${two(h)}:${two(m)}:${two(s)}`;
  if (d >= 7) return `${w}w${d % 7}d`;
  if (d) return `${d}d${two(h)}h`;
  return `${two(h)}:${two(m)}:${two(s)}`;
}
export function longUptime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  const part = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return [d && part(d, 'day'), h && part(h, 'hour'), part(m, 'minute')].filter(Boolean).join(', ');
}

// ------------------------------------------------------------------ addresses
export const isIp = (s) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split('.').every((o) => +o <= 255 && String(+o) === o);
export const ipNum = (s) => s.split('.').reduce((a, o) => a * 256 + +o, 0);
export const numIp = (n) => [24, 16, 8, 0].map((b) => Math.floor(n / 2 ** b) % 256).join('.');
export const lenMask = (len) => numIp(len ? (2 ** 32 - 2 ** (32 - len)) : 0);
export function maskLen(m) {
  if (!isIp(m)) return -1;
  const n = ipNum(m);
  for (let len = 0; len <= 32; len++) if (ipNum(lenMask(len)) === n) return len;
  return -1;
}
export function isPrefix(s) {
  const [a, l] = s.split('/');
  return l !== undefined && isIp(a) && /^\d{1,2}$/.test(l) && +l <= 32;
}
export const net = (ip, len) => numIp(len ? ipNum(ip) - ipNum(ip) % 2 ** (32 - len) : 0);
export const inNet = (ip, base, len) => net(ip, len) === net(base, len);

// VLAN lists: "10,20-25" <-> [10, 20, 21, ...]
export function vlanList(s, lo = 1, hi = 4094) {
  if (!/^[\d,-]+$/.test(s)) return null;
  const out = new Set();
  for (const part of s.split(',')) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < lo || b > hi || b < a) return null;
    for (let v = a; v <= b; v++) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}
export function vlanText(list) {
  const v = [...list].sort((x, y) => x - y), out = [];
  for (let i = 0; i < v.length; i++) {
    let j = i;
    while (j + 1 < v.length && v[j + 1] === v[j] + 1) j++;
    out.push(j > i ? `${v[i]}-${v[j]}` : `${v[i]}`);
    i = j;
  }
  return out.join(',');
}

// ------------------------------------------------------------------ tokens
// quotes (Junos): "a quoted string" is one token, and [ ] stand on their own
export function tokenize(line, quotes = false) {
  const out = [], n = line.length;
  let i = 0;
  while (i < n) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    const s = i;
    if (quotes && ch === '"') {
      const j = line.indexOf('"', i + 1);
      out.push({ t: line.slice(i + 1, j < 0 ? n : j), s, e: j < 0 ? n : j + 1, q: true });
      i = j < 0 ? n : j + 1;
      continue;
    }
    if (quotes && (ch === '[' || ch === ']')) { out.push({ t: ch, s, e: i + 1 }); i++; continue; }
    while (i < n && line[i] !== ' ' && line[i] !== '\t' && !(quotes && '[]"'.includes(line[i]))) i++;
    out.push({ t: line.slice(s, i), s, e: i });
  }
  return out;
}

// "show run | include foo | count" -> segments with their offsets (a | inside quotes stays put)
export function splitPipes(line) {
  const parts = [];
  let q = false, start = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') q = !q;
    else if (line[i] === '|' && !q) { parts.push({ text: line.slice(start, i), at: start }); start = i + 1; }
  }
  parts.push({ text: line.slice(start), at: start });
  return parts;
}

// ------------------------------------------------------------------ grammar
// A node is a keyword  { k: 'show', h: 'help', c: [children] | (dev, args) => [...], run(a, x), no(a, x) }
// or a parameter       { p: '<1-4094>', h: 'help', as: 'vlan', t: (tok, dev, toks, i, args) => [value, used] | null }
// `rest: true` takes the rest of the line (IOS descriptions). `hints(dev)` lists the words a parameter
// can complete to (interface types). `pipe: true` on a node lets the command take output filters.
const kidsOf = (c, dev, a) => (!c ? [] : typeof c === 'function' ? c(dev, a) || [] : c);
export { kidsOf };

export function walk(root, toks, dev, line, upto = toks.length) {
  let list = kidsOf(root, dev, {});
  const a = {}, path = [];
  let node = null, i = 0, pipe = false;
  while (i < upto) {
    const tok = toks[i], low = tok.t.toLowerCase();
    let hit = null, v, used = 1;
    if (!tok.q) {
      const kws = list.filter((x) => x.k && x.k.toLowerCase().startsWith(low));
      hit = kws.find((x) => x.k.toLowerCase() === low) || (kws.length === 1 ? kws[0] : null);
      if (!hit && kws.length > 1) {
        // a parameter that takes this token exactly wins over keywords it only abbreviates
        const p = list.find((x) => x.p && x.t && x.t(tok.t, dev, toks, i, a));
        if (!p) return { err: 'ambiguous', at: i, matches: kws, node, a, path, list };
      }
    }
    if (hit) {
      path.push(hit.k);
      if (hit.as) a[hit.as] = hit.k;
    } else {
      for (const x of list) {
        if (!x.p) continue;
        if (x.rest) { v = line.slice(tok.s).trimEnd(); used = upto - i; hit = x; break; }
        const r = x.t ? x.t(tok.t, dev, toks, i, a) : [tok.t, 1];
        if (r) { [v, used] = r; hit = x; break; }
      }
      if (!hit) return { err: 'invalid', at: i, node, a, path, list };
      const key = hit.as || hit.p;
      if (hit.many) (a[key] = a[key] || []).push(v); else a[key] = v;
      path.push(hit.show ? hit.show(v) : String(v));
    }
    if (hit.pipe) pipe = true;
    node = hit;
    i += used;
    list = kidsOf(hit.c, dev, a);
  }
  return { node, a, path, i, list, pipe };
}

// Everything a list offers at this point, as help rows: [{ name, h, kind }]
export function offers(list, dev) {
  const rows = [];
  for (const n of list) {
    if (n.hide) continue;
    if (n.k) rows.push({ name: n.k, h: n.h || '', kind: n.kind });
    else if (n.p) {
      if (n.hints) for (const [name, h] of n.hints(dev)) rows.push({ name, h, word: true });
      if (!n.hints || n.alsoParam) rows.push({ name: n.p, h: n.h || '', param: true });
    }
  }
  return rows;
}

// ------------------------------------------------------------------ output pipes
// Cisco IOS/XR and Junos filter grammars. Junos "display set" and "compare" are the device's job.
const restParam = (p, h) => [{ p, h, rest: true, run: true }];
export const FILTERS = {
  ios: [
    { k: 'begin', h: 'Begin with the line that matches', c: restParam('LINE', 'Regular Expression') },
    { k: 'count', h: 'Count number of lines which match regexp', c: restParam('LINE', 'Regular Expression') },
    { k: 'exclude', h: 'Exclude lines that match', c: restParam('LINE', 'Regular Expression') },
    { k: 'include', h: 'Include lines that match', c: restParam('LINE', 'Regular Expression') },
    { k: 'section', h: 'Filter a section of output', c: restParam('LINE', 'Regular Expression') },
  ],
  xr: [
    { k: 'begin', h: 'Begin with the line that matches', c: restParam('LINE', 'Regular Expression') },
    { k: 'count', h: 'Count number of lines which match regexp', c: restParam('LINE', 'Regular Expression') },
    { k: 'exclude', h: 'Exclude lines that match', c: restParam('LINE', 'Regular Expression') },
    { k: 'include', h: 'Include lines that match', c: restParam('LINE', 'Regular Expression') },
  ],
  junos: [
    { k: 'compare', h: 'Compare configuration changes with prior version', run: true, c: [{ k: 'rollback', h: 'Compare against a rollback version', c: [{ p: '<number>', h: 'Index of rollback version (0..5)', t: (s) => (/^\d$/.test(s) ? [+s, 1] : null), run: true }] }] },
    { k: 'count', h: 'Count occurrences', run: true },
    { k: 'display', h: 'Show additional kinds of information', c: [{ k: 'set', h: 'Show set commands that create configuration', run: true }] },
    { k: 'except', h: 'Show only text that does not match a pattern', c: [{ p: '<pattern>', h: 'Pattern to avoid', t: (s) => [s, 1], run: true }] },
    { k: 'find', h: 'Search for first occurrence of pattern', c: [{ p: '<pattern>', h: 'Pattern to search for', t: (s) => [s, 1], run: true }] },
    { k: 'last', h: 'Display end of output only', run: true, c: [{ p: '<lines>', h: 'Number of lines to display', t: (s) => (/^\d+$/.test(s) ? [+s, 1] : null), run: true }] },
    { k: 'match', h: 'Show only text that matches a pattern', c: [{ p: '<pattern>', h: 'Pattern to match', t: (s) => [s, 1], run: true }] },
    { k: 'no-more', h: "Don't paginate output", run: true },
  ],
};

function rx(src, flags) {
  try { return new RegExp(src, flags); } catch { return { test: (s) => s.includes(src) }; }
}
// Apply text filters; returns the filtered text
export function applyFilters(text, pipes, style) {
  let lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const f of pipes) {
    const arg = f.arg;
    if (style === 'junos') {
      const r = rx(arg ? arg.replace(/^"|"$/g, '') : '', 'i');
      if (f.k === 'match') lines = lines.filter((l) => r.test(l));
      else if (f.k === 'except') lines = lines.filter((l) => !r.test(l));
      else if (f.k === 'find') { const i = lines.findIndex((l) => r.test(l)); lines = i < 0 ? [] : lines.slice(i); }
      else if (f.k === 'last') lines = lines.slice(-(arg || 24));
      else if (f.k === 'count') lines = [`Count: ${lines.length} lines`];
    } else {
      const r = rx(arg || '', '');
      if (f.k === 'include') lines = lines.filter((l) => r.test(l));
      else if (f.k === 'exclude') lines = lines.filter((l) => !r.test(l));
      else if (f.k === 'begin') { const i = lines.findIndex((l) => r.test(l)); lines = i < 0 ? [] : lines.slice(i); }
      else if (f.k === 'count') lines = [`Number of lines which match regexp = ${lines.filter((l) => r.test(l)).length}`];
      else if (f.k === 'section') {
        const out = [];
        for (let i = 0; i < lines.length; i++) {
          if (/^\S/.test(lines[i]) && r.test(lines[i])) {
            out.push(lines[i]);
            while (i + 1 < lines.length && /^\s/.test(lines[i + 1])) out.push(lines[++i]);
          } else if (/^\s/.test(lines[i]) && r.test(lines[i])) out.push(lines[i]);
        }
        lines = out;
      }
    }
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ the Cisco-style config tree
// { l: 'interface GigabitEthernet1/0/1', k: [children] }. `rank(line)` orders children the way the
// platform prints them; lines with equal rank keep the order they were added in.
export const tnode = (l, k = []) => ({ l, k });
export const childLine = (n, l) => n.k.find((c) => c.l === l);
export const childKey = (n, key) => n.k.find((c) => c.l === key || c.l.startsWith(key + ' '));
export const childrenKey = (n, key) => n.k.filter((c) => c.l === key || c.l.startsWith(key + ' '));
export function insert(n, child, rank) {
  if (!rank) { n.k.push(child); return child; }
  const r = rank(child.l);
  let i = n.k.length;
  while (i > 0 && rank(n.k[i - 1].l) > r) i--;
  n.k.splice(i, 0, child);
  return child;
}
// replace the line that starts with key (or add it)
export function setLine(n, key, line, rank) {
  const old = childKey(n, key);
  if (old) { old.l = line; return old; }
  return insert(n, tnode(line), rank);
}
export function delKey(n, key) {
  const before = n.k.length;
  n.k = n.k.filter((c) => !(c.l === key || c.l.startsWith(key + ' ')));
  return before !== n.k.length;
}
export function delLine(n, line) {
  const before = n.k.length;
  n.k = n.k.filter((c) => c.l !== line);
  return before !== n.k.length;
}
export function ensure(n, line, rank) {
  return childLine(n, line) || insert(n, tnode(line), rank);
}
// IOS text -> tree, by indentation (for pasting a config back in)
export function parseIndented(text) {
  const root = tnode(''), stack = [{ d: -1, n: root }];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (raw.trim() === 'end') break;
    if (!raw.trim() || /^\s*!/.test(raw) || /^(Building configuration|Current configuration|Using \d+ out of)/.test(raw.trim())) continue;
    const d = raw.match(/^ */)[0].length;
    while (stack.length > 1 && stack[stack.length - 1].d >= d) stack.pop();
    const n = tnode(raw.trim());
    stack[stack.length - 1].n.k.push(n);
    stack.push({ d, n });
  }
  return root;
}
