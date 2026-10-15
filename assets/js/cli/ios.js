// Cisco IOS, the part the Catalyst and the ME 3600X share: user and privileged EXEC, configure
// terminal and its submodes, the running config (changed the moment you type) against the startup
// config (what survives a reload: write memory or copy running-config startup-config), reload,
// erase, and the show commands both boxes have. Each box adds its own ports, world and commands.
import { Device } from './device.js';
import {
  pad, lpad, clone, same, clock, ago, longUptime, isIp, maskLen, lenMask, net, inNet, vlanList, vlanText,
  tnode, childKey, childLine, childrenKey, setLine, delKey, delLine, ensure, insert, parseIndented,
} from './engine.js';

export const ipT = (s) => (isIp(s) ? [s, 1] : null);
export const numT = (lo, hi) => (s) => (/^\d+$/.test(s) && +s >= lo && +s <= hi ? [+s, 1] : null);
export const wordT = (s) => [s, 1];
const K = (k, h, more) => ({ k, h, ...more });
const P = (p, h, t, more) => ({ p, h, t, ...more });

export class Ios extends Device {
  constructor() {
    super();
    this.style = 'ios';
    this.user = 'lab';
    this.startup = this.factory();
    this.running = clone(this.startup);
    this.savedAt = this.boot;
    this.changedAt = this.boot;
    this.mode = 'user';
    this.ctx = [];
    this.logBuf = [];
    this.G = this.grammar();
    this.snap = this.opSnap();
  }

  // ---------------------------------------------------------------- saving
  persist() { return { startup: this.startup, savedAt: this.savedAt }; }
  restore(d) {
    if (!d || !d.startup || !Array.isArray(d.startup.k)) return;
    this.startup = d.startup;
    this.savedAt = d.savedAt || this.boot;
    this.running = clone(this.startup);
    this.snap = this.opSnap();
  }
  resetFactory() {
    this.stopTimers();
    this.startup = this.factory();
    this.running = clone(this.startup);
    this.savedAt = this.changedAt = Date.now();
    this.mode = 'user';
    this.ctx = [];
    this.logBuf = [];
    this.boot = Date.now() - this.bootAge() * 1000;
    this.snap = this.opSnap();
  }
  dirty() { return !same(this.running, this.startup); }
  save() {
    this.startup = clone(this.running);
    this.savedAt = Date.now();
    if (this.onSave) this.onSave();
  }
  configText() { return this.renderConfig(this.running).join('\n') + '\n'; }
  // Paste a config back in: it becomes the running config (not saved until write memory)
  importConfig(text) {
    const tree = parseIndented(text);
    if (!tree.k.some((c) => c.l.startsWith('hostname ') || c.l.startsWith('interface '))) return { ok: false, msg: "That doesn't look like an IOS config: there are no hostname or interface lines." };
    const bad = [];
    tree.k = tree.k.filter((c) => {
      if (!c.l.startsWith('interface ')) return true;
      const name = c.l.slice(10).trim().replace(/\s+/g, '');
      const r = this.parseIf([{ t: name }], 0);
      if (!r) { bad.push(name); return false; }
      c.l = `interface ${r[0]}`;
      return true;
    });
    for (const p of this.ports) if (!tree.k.some((c) => c.l === `interface ${p}`)) tree.k.push(tnode(`interface ${p}`));
    tree.k.sort((a, b) => this.rank(a.l) - this.rank(b.l));
    this.running = tree;
    this.touched();
    this.after('');
    return { ok: true, msg: `Loaded into the running-config${bad.length ? ` (skipped interfaces this box doesn't have: ${bad.join(', ')})` : ''}. It isn't saved yet: write memory keeps it.` };
  }

  // ---------------------------------------------------------------- prompt and modes
  host() { const h = childKey(this.running, 'hostname'); return h ? h.l.split(' ')[1] : this.defaultHost; }
  inConfig() { return !['user', 'priv'].includes(this.mode); }
  // An unknown word at the EXEC prompt is taken for a host to telnet to (no ip domain lookup is set)
  fail(r) {
    if (!this.inConfig() && r.err === 'invalid' && r.at === 0 && !r.off && r.toks && r.toks[0]) {
      return `Translating "${r.toks[0].t}"\n% Unknown command or computer name, or unable to find computer address\n`;
    }
    return super.fail(r);
  }
  top() { return this.ctx[this.ctx.length - 1]; }
  prompt() {
    if (this.mode === 'user') return this.host() + '>';
    if (this.mode === 'priv') return this.host() + '#';
    const t = this.top();
    return `${this.host()}(${t ? t.label : 'config'})#`;
  }
  enter(m, label, paths) {
    this.mode = m;
    this.ctx.push({ m, label, paths });
  }
  toConfig() { this.ctx = []; this.mode = 'config'; }
  endConfig() {
    this.ctx = [];
    this.mode = 'priv';
    this.emit(`${clock().log}: %SYS-5-CONFIG_I: Configured from console by ${this.user} on vty0`, 400);
  }
  root() {
    if (this.mode === 'user') return this.G.user;
    if (this.mode === 'priv') return this.G.priv;
    return this.G[this.mode] || this.G.config;
  }
  // the config node(s) the current submode edits
  at(path) {
    let n = this.running;
    for (const l of path) {
      const parent = n;
      n = childLine(parent, l) || insert(parent, tnode(l), parent === this.running ? (x) => this.rank(x) : (x) => this.subRank(x, parent.l));
    }
    return n;
  }
  nodes() { const t = this.top(); return t ? t.paths.map((p) => this.at(p)) : [this.running]; }
  setHere(key, line) { for (const n of this.nodes()) setLine(n, key, line, (x) => this.subRank(x, n.l)); this.touched(); }
  delHere(key) { let hit = false; for (const n of this.nodes()) hit = delKey(n, key) || hit; this.touched(); return hit; }
  touched() { this.changedAt = Date.now(); }

  // Type a line in a submode that belongs to an enclosing mode, and IOS takes it there
  exec(line) {
    if (this.inConfig() && this.ctx.length && line.trim()) {
      const ok = (r) => !r.err && r.node && typeof (this.negated(r) ? r.node.no : r.node.run) === 'function';
      if (!ok(this.parse(line))) {
        const saved = this.ctx.slice(), mode = this.mode;
        for (let d = saved.length - 1; d >= 0; d--) {
          this.ctx = saved.slice(0, d);
          this.mode = d ? this.ctx[d - 1].m : 'config';
          if (ok(this.parse(line))) return this.after(super.exec(line));
        }
        this.ctx = saved;
        this.mode = mode;
      }
    }
    return this.after(super.exec(line));
  }
  // console messages for what a change just did (links, SVIs, STP)
  after(out) {
    const was = this.snap, now = (this.snap = this.opSnap());
    const t = () => clock().log;
    for (const [name, st] of Object.entries(now.links)) {
      const old = was.links[name];
      if (!old || old === st) continue;
      const phys = !/^(Vlan|Loopback)/.test(name);
      if (st === 'admin') {
        if (phys) this.emit(`${t()}: %LINK-5-CHANGED: Interface ${name}, changed state to administratively down`, 300);
        this.emit(`${t()}: %LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to down`, phys ? 900 : 300);
      } else if (st === 'up') {
        if (phys) this.emit(`${t()}: %LINK-3-UPDOWN: Interface ${name}, changed state to up`, 1500);
        this.emit(`${t()}: %LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to up`, phys ? 2400 : 900);
      } else if (st === 'down' && old === 'up') {
        this.emit(`${t()}: %LINEPROTO-5-UPDOWN: Line protocol on Interface ${name}, changed state to down`, 600);
      } else if (st === 'down' && old === 'admin' && phys) {
        this.emit(`${t()}: %LINK-3-UPDOWN: Interface ${name}, changed state to down`, 1500);
      }
    }
    for (const m of this.extraLogs(was, now)) this.emit(m.text.replace('{t}', t()), m.ms || 2000);
    return out;
  }
  extraLogs() { return []; }
  emit(text, ms) {
    if (text && text.includes('%')) {
      this.logBuf.push(text);
      if (this.logBuf.length > 60) this.logBuf.shift();
    }
    super.emit(text, ms);
  }

  // ---------------------------------------------------------------- interfaces
  // types: [{ name, abbr (show tables), cdp, h (help), re (number), virtual, order }]
  parseIf(toks, i, { virtualOk = true } = {}) {
    const tok = toks[i].t;
    let m = tok.match(/^([a-zA-Z-]+)(\d[\d/.]*)$/), typ, num, used = 1;
    if (m) { typ = m[1]; num = m[2]; }
    else if (/^[a-zA-Z-]+$/.test(tok) && toks[i + 1] && /^\d[\d/.]*$/.test(toks[i + 1].t)) { typ = tok; num = toks[i + 1].t; used = 2; }
    else return null;
    const low = typ.toLowerCase();
    const types = this.types.filter((x) => x.name.toLowerCase().startsWith(low));
    const T = types.find((x) => x.name.toLowerCase() === low) || (types.length === 1 ? types[0] : null);
    if (!T || !T.re.test(num) || (T.virtual && !virtualOk)) return null;
    return [T.name + num, used];
  }
  typeOf(name) { return this.types.find((x) => name.startsWith(x.name) && /^\d/.test(name.slice(x.name.length))); }
  short(name) { const T = this.typeOf(name); return T ? T.abbr + name.slice(T.name.length) : name; }
  ifP(as = 'if', opts = {}) {
    return P('IFACE', 'Interface name', (tok, dev, toks, i) => {
      const r = dev.parseIf(toks, i, opts);
      if (r && opts.exists && !dev.ifExists(r[0])) return null;
      return r;
    }, { as, hints: (dev) => dev.types.filter((x) => !opts.physical || !x.virtual).map((x) => [x.name, x.h]), full: (v) => v, ...opts.more });
  }
  ifNode(name, tree = this.running) { return childLine(tree, `interface ${name}`); }
  ifLines(name, tree = this.running) { const n = this.ifNode(name, tree); return n ? n.k.map((c) => c.l) : []; }
  ifExists(name) { const T = this.typeOf(name); return T && (!T.virtual || !!this.ifNode(name)); }
  physical() { return this.ports; }
  allIfs() {
    const names = this.running.k.filter((c) => c.l.startsWith('interface ')).map((c) => c.l.slice(10));
    for (const p of this.ports) if (!names.includes(p)) names.push(p);
    return names.sort((a, b) => this.ifOrder(a) - this.ifOrder(b));
  }
  ifOrder(name) {
    const T = this.typeOf(name);
    const nums = name.slice(T ? T.name.length : 0).split(/[/.]/).map(Number);
    return (T ? T.order : 9) * 1e9 + nums.reduce((a, v) => a * 100 + v, 0) * (10 ** (4 - nums.length * 1));
  }
  isShut(name, tree = this.running) { return this.ifLines(name, tree).includes('shutdown'); }
  cable(name) { return this.world[name]; }
  // admin / link / protocol for any interface
  ifState(name) {
    const lines = this.ifLines(name);
    if (lines.includes('shutdown')) return { admin: false, link: false, proto: false };
    if (/^Vlan/.test(name)) {
      const up = this.sviUp(+name.slice(4));
      return { admin: true, link: up, proto: up };
    }
    if (/^Loopback/.test(name)) return { admin: true, link: true, proto: true };
    const c = this.cable(name);
    return { admin: true, link: !!c, proto: !!c };
  }
  ipOf(name, tree = this.running) {
    const l = this.ifLines(name, tree).find((x) => x.startsWith('ip address ') && !x.endsWith(' secondary'));
    if (!l) return null;
    const [, , ip, mask] = l.split(' ');
    return { ip, mask, len: maskLen(mask) };
  }
  sviUp() { return false; }

  // ---------------------------------------------------------------- world snapshot (for console messages)
  opSnap() {
    const links = {};
    for (const n of this.allIfs()) {
      const s = this.ifState(n);
      links[n] = !s.admin ? 'admin' : s.proto ? 'up' : 'down';
    }
    return { links, ...this.extraSnap() };
  }
  extraSnap() { return {}; }

  // ---------------------------------------------------------------- config rendering
  renderConfig(tree) {
    const out = [];
    let lastGroup = null;
    for (const c of tree.k) {
      const g = Math.floor(this.rank(c.l));
      const block = c.k.length || /^(interface|vlan |line |router |vrf )/.test(c.l);
      if (out.length && (block || g !== lastGroup) && out[out.length - 1] !== '!') out.push('!');
      out.push(c.l);
      const sub = (n, d) => {
        for (const k of n.k) {
          out.push(' '.repeat(d) + k.l);
          if (k.k.length) { sub(k, d + 1); out.push(' '.repeat(d) + '!'); }
        }
      };
      sub(c, 1);
      if (block) out.push('!');
      lastGroup = g;
    }
    out.push('end');
    return out;
  }
  showRun(tree, which) {
    const body = this.renderConfig(tree);
    const bytes = body.join('\n').length + 1;
    const ch = clock(this.changedAt), sv = clock(this.savedAt);
    const stamp = (c) => `${c.hms} ${c.tz} ${c.p.weekday} ${c.p.month} ${c.p.day} ${c.p.year}`;
    const head = which === 'startup'
      ? [`Using ${bytes} out of 2097152 bytes`, '!', `! Last configuration change at ${stamp(sv)} by ${this.user}`, `! NVRAM config last updated at ${stamp(sv)} by ${this.user}`, '!']
      : ['Building configuration...', '', `Current configuration : ${bytes} bytes`, '!', `! Last configuration change at ${stamp(ch)} by ${this.user}`, `! NVRAM config last updated at ${stamp(sv)} by ${this.user}`, '!'];
    return [...head, ...body, ''].join('\n');
  }
  showRunIf(name) {
    const n = this.ifNode(name);
    if (!n) return "                         ^\n% Invalid input detected at '^' marker.\n";
    const body = [`interface ${name}`];
    const sub = (x, d) => { for (const k of x.k) { body.push(' '.repeat(d) + k.l); if (k.k.length) { sub(k, d + 1); body.push(' '.repeat(d) + '!'); } } };
    sub(n, 1);
    body.push('end');
    return ['Building configuration...', '', `Current configuration : ${body.join('\n').length} bytes`, '!', ...body, ''].join('\n');
  }

  // ---------------------------------------------------------------- ordering in show run
  // Top-level lines print in the platform's order; interfaces by type then number; VLANs by id.
  rank(line) {
    const order = this.topOrder;
    if (line.startsWith('interface ')) return order.indexOf('interface') + this.ifOrder(line.slice(10)) / 1e12;
    if (/^vlan \d+$/.test(line)) return order.indexOf('vlan') + +line.slice(5) / 1e5;
    let best = -1, len = -1;
    order.forEach((p, i) => { if ((line === p || line.startsWith(p + ' ')) && p.length > len) { best = i; len = p.length; } });
    return best < 0 ? order.indexOf('ip route') : best;
  }
  subRank(line, parent = '') {
    const order = /^service instance/.test(parent) ? this.srvOrder : /^interface/.test(parent) ? this.ifOrderLines : [];
    if (!order.length) return 0;
    let best = order.length, len = -1;
    order.forEach((p, i) => { if ((line === p || line.startsWith(p + ' ')) && p.length > len) { best = i; len = p.length; } });
    return best;
  }

  // ---------------------------------------------------------------- the grammar
  grammar() {
    const dev = this;
    const show = (priv) => K('show', 'Show running system information', { pipe: true, c: (d) => d.showTree(priv) });
    const term = K('terminal', 'Set terminal line parameters', { c: [
      K('length', 'Set number of lines on a screen', { c: [P('<0-512>', 'Number of lines on screen (0 for no pausing)', numT(0, 512), { run() { return ''; } })] }),
      K('monitor', 'Copy debug output to the current terminal line', { run() { return ''; } }),
    ] });
    const ping = K('ping', 'Send echo messages', { c: [P('WORD', 'Ping destination address or hostname', wordT, { as: 'dst', run(a) { return this.ping(a.dst); } })] });
    const leave = function () { return this.logout(); };
    const user = [
      K('enable', 'Turn on privileged commands', { run() { this.mode = 'priv'; return ''; } }),
      K('exit', 'Exit from the EXEC', { run: leave }),
      K('help', 'Description of the interactive help system', { run() { return this.helpText(); } }),
      K('logout', 'Exit from the EXEC', { run: leave }),
      ping,
      show(false),
      term,
    ];
    const priv = [
      K('clear', 'Reset functions', { c: [
        K('counters', 'Clear counters on one or all interfaces', { run() { return { ask: { q: 'Clear "show interface" counters on all interfaces [confirm]', then: () => '' } }; } }),
        K('mac', 'MAC forwarding table', { c: [K('address-table', 'MAC forwarding table', { c: [K('dynamic', 'dynamic entry type', { run() { return ''; } })] })] }),
      ] }),
      K('configure', 'Enter configuration mode', {
        run() { return { ask: { q: 'Configuring from terminal, memory, or network [terminal]? ', then: (ans) => (/^(t|te|ter|term|termi|termin|termina|terminal)?$/i.test(ans.trim()) ? this.confT() : "?Must be 'terminal', 'memory' or 'network'") } }; },
        c: [K('terminal', 'Configure from the terminal', { run() { return this.confT(); } })],
      }),
      K('copy', 'Copy from one file to another', { c: [
        K('running-config', 'Copy from current system configuration', { c: [K('startup-config', 'Copy to startup configuration', { run() {
          return { ask: { q: 'Destination filename [startup-config]? ', then: () => this.writeMem() } };
        } })] }),
        K('startup-config', 'Copy from startup configuration', { c: [K('running-config', 'Update (merge with) current system configuration', { run() {
          return { ask: { q: 'Destination filename [running-config]? ', then: () => this.mergeStartup() } };
        } })] }),
      ] }),
      K('disable', 'Turn off privileged commands', { run() { this.mode = 'user'; return ''; } }),
      K('enable', 'Turn on privileged commands', { run() { return ''; } }),
      K('erase', 'Erase a filesystem', { c: [
        K('nvram:', 'Erase nvram: filesystem', { run() { return this.erase(); } }),
        K('startup-config', 'Erase contents of configuration memory', { run() { return this.erase(); } }),
      ] }),
      K('exit', 'Exit from the EXEC', { run: leave }),
      K('help', 'Description of the interactive help system', { run() { return this.helpText(); } }),
      K('logout', 'Exit from the EXEC', { run: leave }),
      ping,
      K('reload', 'Halt and perform a cold restart', { run() { return this.reload(); } }),
      show(true),
      term,
      K('write', 'Write running configuration to memory, network, or terminal', {
        run() { return this.writeMem(); },
        c: [
          K('erase', 'Erase NV memory', { run() { return this.erase(); } }),
          K('memory', 'Write to NV memory', { run() { return this.writeMem(); } }),
          K('terminal', 'Write to terminal', { run() { return this.showRun(this.running); } }),
        ],
      }),
    ];
    // every config mode has these
    const common = (label) => [
      K('do', 'To run exec commands in config mode', { c: () => dev.G.priv }),
      K('end', 'Exit from configure mode', { run() { this.endConfig(); return ''; } }),
      K('exit', label === 'config' ? 'Exit from configure mode' : `Exit from ${label} configuration mode`, { run() {
        if (!this.ctx.length) { this.endConfig(); return ''; }
        this.ctx.pop();
        this.mode = this.ctx.length ? this.top().m : 'config';
        return '';
      } }),
    ];
    const withNo = (list, label) => {
      const negs = list.filter((n) => n.no || (n.c && !n.noOff));
      return [...list, K('no', 'Negate a command or set its defaults', { c: negs }), ...common(label)].sort((a, b) => a.k.localeCompare(b.k));
    };
    const G = { user, priv };
    G.config = withNo(this.configTree(), 'config');
    G.if = withNo(this.ifTree(), 'interface');
    G.range = G.if;
    G.vlan = withNo(this.vlanTree(), 'vlan');
    G.line = withNo(this.lineTree(), 'line');
    G.srv = withNo(this.srvTree(), 'service instance');
    return G;
  }

  confT() {
    this.toConfig();
    return 'Enter configuration commands, one per line.  End with CNTL/Z.';
  }
  ctrlZ() { if (!this.inConfig()) return null; this.endConfig(); return ''; }
  logout() {
    this.mode = 'user';
    this.ctx = [];
    return { out: '', relogin: true };
  }
  helpText() {
    return [
      'Help may be requested at any point in a command by entering',
      "a question mark '?'.  If nothing matches, the help list will",
      "be empty and you must backup until entering a '?' shows the",
      'available options.',
      'Two styles of help are provided:',
      '1. Full help is available when you are ready to enter a',
      "   command argument (e.g. 'show ?') and describes each possible",
      '   argument.',
      '2. Partial help is provided when an abbreviated argument is entered',
      "   and you want to know what arguments match the input",
      "   (e.g. 'show pr?'.)",
      '',
    ].join('\n');
  }

  // ---------------------------------------------------------------- saving and reloading
  writeMem() {
    this.save();
    return { steps: [{ t: 'Building configuration...' }, { t: '[OK]', ms: 700 }] };
  }
  mergeStartup() {
    // copy startup-config running-config merges: every startup line is applied over the running config
    const merge = (from, to, top) => {
      for (const c of from.k) {
        const n = ensure(to, c.l, top ? (x) => this.rank(x) : (x) => this.subRank(x, to.l));
        merge(c, n, false);
      }
    };
    merge(this.startup, this.running, true);
    this.touched();
    return { steps: [{ t: `${this.configText().length} bytes copied in 0.214 secs` }] };
  }
  erase() {
    return { ask: { q: 'Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]', then: (ans) => {
      if (/^n/i.test(ans.trim())) return '';
      this.startup = this.blankConfig();
      this.savedAt = Date.now();
      if (this.onSave) this.onSave();
      return { steps: [{ t: '[OK]', ms: 400 }, { t: 'Erase of nvram: complete', ms: 300 }, { t: `${clock().log}: %SYS-7-NV_BLOCK_INIT: Initialized the geometry of nvram`, ms: 200 }] };
    } } };
  }
  reload() {
    const go = () => ({ ask: { q: 'Proceed with reload? [confirm]', then: (ans) => (/^n/i.test(ans.trim()) ? '' : this.reboot()) } });
    if (!this.dirty()) return go();
    return { ask: { q: '\nSystem configuration has been modified. Save? [yes/no]: ', then: (ans) => {
      const a = ans.trim().toLowerCase();
      if (a.startsWith('y')) {
        this.save();
        const next = go();
        return { steps: [{ t: 'Building configuration...' }, { t: '[OK]', ms: 600 }], ask: next.ask };
      }
      if (a.startsWith('n')) return go();
      return '% Please answer \'yes\' or \'no\'.';
    } } };
  }
  reboot() {
    this.stopTimers();
    this.running = clone(this.startup);
    this.changedAt = this.savedAt;
    this.mode = 'user';
    this.ctx = [];
    this.boot = Date.now();
    this.snap = this.opSnap();
    const t = clock().log;
    return {
      steps: [
        { t: '' },
        { t: `${t}: %SYS-5-RELOAD: Reload requested by ${this.user} on console. Reload Reason: Reload Command.`, ms: 300 },
        ...this.bootLines().map((l, i) => ({ t: l, ms: i ? 220 : 700 })),
        { t: '', ms: 300 },
        { t: `${clock().log}: %SYS-5-RESTART: System restarted --`, ms: 500 },
        { t: '(simulated reload: the startup-config is now the running config; unsaved changes are gone)', ms: 200 },
        { t: '' },
        { t: 'Press RETURN to get started!', ms: 300 },
      ],
      relogin: true,
    };
  }

  // ---------------------------------------------------------------- show commands both boxes have
  showTree(priv) {
    const dev = this;
    const ifs = (cmd) => dev.ifP('if', { exists: true, more: cmd });
    const list = [
      K('clock', 'Display the system clock', { run() { return `*${clock().ios}`; } }),
      K('history', 'Display the session command history', { run() { return this.history.slice(-20).map((h) => `  ${h}`).join('\n'); } }),
      K('interfaces', 'Interface status and configuration', {
        run() { return this.allIfs().map((n) => this.showIfDetail(n)).join('\n'); },
        c: (d) => [
          ifs({ run(a) { return this.showIfDetail(a.if); }, c: d.ifShowSubs(true) }),
          ...d.ifShowSubs(false),
        ],
      }),
      K('ip', 'IP information', { c: [
        K('interface', 'IP interface status and configuration', { c: [K('brief', 'Brief summary of IP status and configuration', { run() { return this.showIpIntBrief(); } })] }),
      ] }),
      K('logging', 'Show the contents of logging buffers', { run() { return this.showLogging(); } }),
      K('spanning-tree', 'Spanning tree topology', {
        run() { return this.showStp(); },
        c: [K('vlan', 'VLAN Switch Spanning Trees', { c: [P('<1-4094>', 'VLAN Switch Spanning Tree List', numT(1, 4094), { as: 'vlan', run(a) { return this.showStp(a.vlan); } })] })],
      }),
      K('version', 'System hardware and software status', { run() { return this.showVersion(); } }),
      K('vlan', 'VTP VLAN status', {
        run() { return this.showVlan(false); },
        c: [
          K('brief', 'VTP all VLAN status in brief', { run() { return this.showVlan(true); } }),
          K('id', 'VTP VLAN status by VLAN id', { c: [P('<1-4094>', 'ISL VLAN IDs 1-1005, 802.1Q VLAN IDs 1-4094', numT(1, 4094), { as: 'vlan', run(a) { return this.showVlan(false, (v) => v === a.vlan); } })] }),
          K('name', 'VTP VLAN status by VLAN name', { c: [P('WORD', 'A VLAN name', wordT, { as: 'name', run(a) { return this.showVlan(false, (v, nm) => nm === a.name); } })] }),
        ],
      }),
      ...this.extraShow(),
    ];
    if (priv) {
      list.push(
        K('running-config', 'Current operating configuration', {
          run() { return this.showRun(this.running); },
          c: [K('interface', 'Show interface configuration', { c: [ifs({ run(a) { return this.showRunIf(a.if); } })] })],
        }),
        K('startup-config', 'Contents of startup configuration', { run() { return this.showRun(this.startup, 'startup'); } }),
      );
    }
    return list.sort((a, b) => a.k.localeCompare(b.k));
  }
  extraShow() { return []; }
  ifShowSubs() { return []; }

  showIpIntBrief() {
    const rows = [pad('Interface', 23) + pad('IP-Address', 16) + 'OK? Method Status                Protocol'];
    for (const n of this.allIfs()) {
      const ip = this.ipOf(n), st = this.ifState(n);
      const saved = ip && this.ipOf(n, this.startup);
      const method = !ip ? 'unset ' : saved && saved.ip === ip.ip ? 'NVRAM ' : 'manual';
      const status = !st.admin ? 'administratively down' : st.link ? 'up' : 'down';
      rows.push((n.length >= 23 ? n + ' ' : pad(n, 23)) + pad(ip ? ip.ip : 'unassigned', 16) + 'YES ' + method + ' ' + pad(status, 22) + (st.proto ? 'up' : 'down'));
    }
    return rows.join('\n');
  }
  showIfDetail(n) {
    const st = this.ifState(n), lines = this.ifLines(n);
    const desc = lines.find((l) => l.startsWith('description '));
    const ip = this.ipOf(n);
    const T = this.typeOf(n);
    const status = !st.admin ? 'administratively down' : st.link ? 'up' : 'down';
    const conn = /^Vlan|^Loopback/.test(n) ? '' : !st.admin ? ' (disabled)' : st.link ? ' (connected)' : ' (notconnect)';
    const mac = this.ifMac(n);
    const sec = Math.floor(this.uptime());
    const pk = st.proto ? 1200 + (sec * 37) % 900000 : 0;
    const out = [
      `${n} is ${status}, line protocol is ${st.proto ? 'up' : 'down'}${conn} `,
      `  Hardware is ${T ? T.hw : 'Ethernet'}, address is ${mac} (bia ${mac})`,
    ];
    if (desc) out.push(`  Description: ${desc.slice(12)}`);
    if (ip) out.push(`  Internet address is ${ip.ip}/${ip.len}`);
    out.push(
      `  MTU 1500 bytes, BW ${T ? T.bw : 1000000} Kbit/sec, DLY 10 usec, `,
      '     reliability 255/255, txload 1/255, rxload 1/255',
      '  Encapsulation ARPA, loopback not set',
      '  Keepalive set (10 sec)',
    );
    if (T && !T.virtual) out.push(st.link ? `  Full-duplex, ${T.speed}, media type is ${T.media}` : `  Auto-duplex, Auto-speed, media type is ${T.media}`);
    out.push(
      '  Last clearing of "show interface" counters never',
      '  Input queue: 0/2000/0/0 (size/max/drops/flushes); Total output drops: 0',
      `  5 minute input rate ${st.proto ? 12000 : 0} bits/sec, ${st.proto ? 15 : 0} packets/sec`,
      `  5 minute output rate ${st.proto ? 48000 : 0} bits/sec, ${st.proto ? 40 : 0} packets/sec`,
      `     ${pk} packets input, ${pk * 412} bytes, 0 no buffer`,
      '     0 input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored',
      `     ${Math.floor(pk * 1.3)} packets output, ${Math.floor(pk * 1.3) * 386} bytes, 0 underruns`,
      '     0 output errors, 0 collisions, 0 interface resets',
    );
    return out.join('\n');
  }
  ifMac(n) {
    const i = this.allIfs().indexOf(n);
    return `0000.5e00.53${(0x80 + Math.max(0, i)).toString(16).padStart(2, '0').slice(-2)}`;
  }
  showLogging() {
    return [
      'Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)',
      '    Console logging: level debugging, ' + (this.logBuf.length + 41) + ' messages logged',
      '    Buffer logging:  level debugging, ' + (this.logBuf.length + 41) + ' messages logged',
      '',
      `Log Buffer (16384 bytes):`,
      ...this.logBuf,
    ].join('\n');
  }

  // ---------------------------------------------------------------- the reachability check behind ping
  ping(dst) {
    if (!isIp(dst)) return `Translating "${dst}"\n% Unrecognized host or address, or protocol not running.\n`;
    const ok = this.reach(dst);
    const head = ['Type escape sequence to abort.', `Sending 5, 100-byte ICMP Echos to ${dst}, timeout is 2 seconds:`];
    const steps = head.map((t) => ({ t }));
    const marks = ok ? '!!!!!' : '.....';
    steps.push({ t: marks, ms: ok ? 500 : 2000 });
    steps.push({ t: ok ? 'Success rate is 100 percent (5/5), round-trip min/avg/max = 1/1/2 ms' : 'Success rate is 0 percent (0/5)', ms: 100 });
    return { steps };
  }
  reach() { return false; }
}

export { K, P };
