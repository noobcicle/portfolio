// Juniper Junos on a pretend QFX/MX-style box. configure edits a candidate config built from a schema
// (set / delete / edit / up / top); commit makes it the active config and saves it, with rollback
// versions, commit check, commit confirmed and show | compare. Operational show commands read only
// the committed config, as on the real thing. The world: two core routers over OSPF and iBGP, a
// transit provider over eBGP, and hosts on access ports in VLANs.
import { Device } from './device.js';
import { pad, lpad, clone, same, clock, ago, isIp, isPrefix, inNet, net, ipNum, numIp } from './engine.js';

const VERSION = '23.4R2-S3';
const AS = 64500;
const PORTS = [...Array.from({ length: 12 }, (_, i) => `xe-0/0/${i}`), 'et-0/0/48', 'et-0/0/49', 'et-0/0/50', 'et-0/0/51'];
const OTHER = ['em0', 'irb', 'lo0'];
const MAC = (n) => `00:00:5e:00:53:${n.toString(16).padStart(2, '0')}`;
// who is on the other end of each cable
const CORE = {
  'xe-0/0/0': { name: 'lab-mx2', rid: '10.255.0.2', ip: '10.0.12.2', me: '10.0.12.1', len: 30, mtu: 9192, port: 'xe-0/0/0', mac: MAC(0x02), routes: ['10.20.0.0/16'] },
  'xe-0/0/1': { name: 'lab-mx3', rid: '10.255.0.3', ip: '10.0.13.2', me: '10.0.13.1', len: 30, mtu: 9192, port: 'xe-0/0/0', mac: MAC(0x03), routes: ['10.30.0.0/16'] },
};
const TRANSIT = { if: 'xe-0/0/2', ip: '198.51.100.2', me: '198.51.100.1', len: 30, as: 64511, name: 'transit-a', port: 'et-0/0/7', mac: MAC(0x10), routes: ['0.0.0.0/0', '192.0.2.0/24', '203.0.113.0/24'] };
export const HOSTS = {
  'xe-0/0/4': { vlan: 100, mac: MAC(0x44), name: 'host-a' },
  'xe-0/0/5': { vlan: 100, mac: MAC(0x45), name: 'host-b' },
  'xe-0/0/6': { vlan: 200, mac: MAC(0x46), name: 'host-c' },
  'xe-0/0/8': { vlan: 300, mac: MAC(0x48), name: 'host-d' },
};
const CABLED = new Set(['xe-0/0/0', 'xe-0/0/1', 'xe-0/0/2', 'xe-0/0/4', 'xe-0/0/5', 'xe-0/0/6', 'xe-0/0/8', 'em0']);

const FACTORY = `set version ${VERSION}
set system host-name lab-qfx1
set system time-zone America/Chicago
set system services ssh
set system services netconf ssh
set interfaces xe-0/0/0 description "to lab-mx2 xe-0/0/0"
set interfaces xe-0/0/0 mtu 9192
set interfaces xe-0/0/0 unit 0 family inet address 10.0.12.1/30
set interfaces xe-0/0/1 description "to lab-mx3 xe-0/0/0"
set interfaces xe-0/0/1 mtu 9192
set interfaces xe-0/0/1 unit 0 family inet address 10.0.13.1/30
set interfaces xe-0/0/2 description "transit-a (AS 64511)"
set interfaces xe-0/0/2 unit 0 family inet address 198.51.100.1/30
set interfaces xe-0/0/4 description host-a
set interfaces xe-0/0/4 unit 0 family ethernet-switching interface-mode access
set interfaces xe-0/0/4 unit 0 family ethernet-switching vlan members v100
set interfaces xe-0/0/5 description host-b
set interfaces xe-0/0/5 unit 0 family ethernet-switching interface-mode access
set interfaces xe-0/0/5 unit 0 family ethernet-switching vlan members v100
set interfaces xe-0/0/6 description host-c
set interfaces xe-0/0/6 unit 0 family ethernet-switching interface-mode access
set interfaces xe-0/0/6 unit 0 family ethernet-switching vlan members v200
set interfaces xe-0/0/7 unit 0 family ethernet-switching interface-mode access
set interfaces xe-0/0/7 unit 0 family ethernet-switching vlan members v200
set interfaces em0 unit 0 family inet address 172.16.0.11/24
set interfaces irb unit 100 family inet address 10.1.100.1/24
set interfaces irb unit 200 family inet address 10.1.200.1/24
set interfaces lo0 unit 0 family inet address 10.255.0.1/32
set routing-options router-id 10.255.0.1
set routing-options autonomous-system ${AS}
set routing-options static route 172.16.100.0/24 next-hop 172.16.0.1
set protocols ospf area 0.0.0.0 interface xe-0/0/0.0 interface-type p2p
set protocols ospf area 0.0.0.0 interface xe-0/0/1.0 interface-type p2p
set protocols ospf area 0.0.0.0 interface lo0.0 passive
set protocols ospf area 0.0.0.0 interface irb.100 passive
set protocols ospf area 0.0.0.0 interface irb.200 passive
set protocols bgp group IBGP type internal
set protocols bgp group IBGP local-address 10.255.0.1
set protocols bgp group IBGP neighbor 10.255.0.2 description lab-mx2
set protocols bgp group IBGP neighbor 10.255.0.3 description lab-mx3
set protocols bgp group TRANSIT type external
set protocols bgp group TRANSIT peer-as 64511
set protocols bgp group TRANSIT neighbor 198.51.100.2 description transit-a
set protocols lldp interface all
set vlans default vlan-id 1
set vlans v100 vlan-id 100
set vlans v100 l3-interface irb.100
set vlans v200 vlan-id 200
set vlans v200 l3-interface irb.200`;

// ------------------------------------------------------------------ the config schema
// c: container, n: keyword + name, names: a list of named things (interfaces, vlans), l: leaf with a
// value, f: flag, ll: leaf-list. Values are checked by arg.t, which returns the stored form or null.
const any = { p: '<value>', h: 'Value', t: (s) => s };
const text = { p: '<description>', h: 'Text description', t: (s) => (s.length <= 900 ? s : null) };
const ip = { p: '<address>', h: 'IP address', t: (s) => (isIp(s) ? s : null) };
const ifAddr = { p: '<address>', h: 'Interface address/destination prefix', t: (s) => (isPrefix(s) ? s : null) };
const route = { p: '<prefix>', h: 'Destination prefix', t: (s) => { if (!isPrefix(s)) return null; const [a, l] = s.split('/'); return `${net(a, +l)}/${l}`; } };
const num = (lo, hi, p = '<number>', h = 'Number') => ({ p, h: `${h} (${lo}..${hi})`, t: (s) => (/^\d+$/.test(s) && +s >= lo && +s <= hi ? s : null), range: [lo, hi] });
const asn = num(1, 4294967295, '<as-number>', 'Autonomous system number');
const area = { p: '<area_id>', h: 'Area ID', t: (s) => (isIp(s) ? s : /^\d+$/.test(s) && +s <= 4294967295 ? numIp(+s) : null) };
const word = (p, h) => ({ p, h, t: (s) => (/^[A-Za-z0-9][\w.-]{0,63}$/.test(s) ? s : null) });
const ifd = { p: '<interface-name>', h: 'Interface name', t: (s) => (/^((xe|et|ge)-0\/0\/\d{1,2}|ae\d{1,2}|irb|lo0|em0|vme)$/.test(s) ? s : null) };
const ifl = { p: '<interface_name>', h: 'Interface name', t: (s) => (/^((xe|et|ge)-0\/0\/\d{1,2}|ae\d{1,2}|irb|lo0|em0)\.\d{1,5}$/.test(s) ? s : null) };
const lldpIf = { p: '<interface_name>', h: 'Interface name (or all)', t: (s) => (s === 'all' || ifd.t(s) ? s : null) };
const member = { p: '<vlan-name>', h: 'VLAN name or VLAN ID', t: (s) => (/^[A-Za-z0-9][\w.-]{0,63}$/.test(s) ? s : null) };
const C = (name, h, kids) => ({ name, h, kind: 'c', kids });
// a keyword whose choice is part of the name: "family inet" is one statement, printed "family inet {"
const NK = (name, h, opts) => ({ name, h, kind: 'nk', opts });
const N = (name, h, arg, kids = []) => ({ name, h, kind: 'n', arg, kids });
const NAMES = (arg, kids, list) => ({ kind: 'names', arg, kids, list });
const L = (name, h, arg, values) => ({ name, h, kind: 'l', arg, values });
const F = (name, h) => ({ name, h, kind: 'f' });
const LL = (name, h, arg) => ({ name, h, kind: 'll', arg });
const IF_KIDS = [
  L('description', 'Text description of interface', text),
  F('disable', 'Disable this interface'),
  L('mtu', 'Maximum transmit packet size', num(256, 9216, '<mtu>', 'Maximum transmit packet size')),
  N('unit', 'Logical interface', num(0, 16385, '<interface_unit_number>', 'Interface unit number'), [
    L('description', 'Text description of interface', text),
    F('disable', 'Disable this logical interface'),
    NK('family', 'Protocol family', [
      C('ethernet-switching', 'Ethernet switching parameters', [
        L('interface-mode', 'Interface mode', any, [['access', 'Access mode'], ['trunk', 'Trunk mode']]),
        C('vlan', 'Virtual LAN', [LL('members', 'VLAN membership', member)]),
      ]),
      C('inet', 'IPv4 parameters', [N('address', 'Interface address/destination prefix', ifAddr)]),
      C('mpls', 'MPLS parameters', []),
    ]),
    L('vlan-id', 'Virtual LAN identifier value for 802.1q VLAN tags', num(1, 4094, '<vlan-id>', 'VLAN ID')),
  ]),
  F('vlan-tagging', '802.1q VLAN tagging support'),
];
const SCHEMA = [
  C('interfaces', 'Interface configuration', [NAMES(ifd, IF_KIDS, (d) => [...PORTS, ...OTHER])]),
  C('protocols', 'Routing protocol configuration', [
    C('bgp', 'BGP options', [N('group', 'Define a peer group', word('<group_name>', 'Group name'), [
      L('description', 'Text description', text),
      L('local-address', 'Address of local end of BGP session', ip),
      N('neighbor', 'Configure a neighbor', ip, [
        L('description', 'Text description', text),
        L('local-address', 'Address of local end of BGP session', ip),
        L('peer-as', 'Autonomous system number in plain number format', asn),
        F('shutdown', 'Shut down the neighbor (simulated)'),
      ]),
      L('peer-as', 'Autonomous system number in plain number format', asn),
      L('type', 'Type of peer group', any, [['external', 'EBGP group'], ['internal', 'IBGP group']]),
    ])]),
    C('ldp', 'Label Distribution Protocol', [N('interface', 'Enable LDP on interface', ifl)]),
    C('lldp', 'Link Layer Discovery Protocol', [N('interface', 'Interface configuration', lldpIf, [F('disable', 'Disable LLDP on the interface')])]),
    C('mpls', 'Multiprotocol Label Switching', [N('interface', 'Enable MPLS on interface', ifl)]),
    C('ospf', 'OSPF configuration', [N('area', 'Configure an OSPF area', area, [N('interface', 'Include an interface in this area', ifl, [
      F('disable', 'Disable OSPF on this interface'),
      L('interface-type', 'Type of interface', any, [['nbma', 'Nonbroadcast multiaccess'], ['p2mp', 'Point-to-multipoint NBMA'], ['p2p', 'Point-to-point']]),
      L('metric', 'Interface metric', num(1, 65535, '<metric>', 'Interface metric')),
      F('passive', 'Do not run OSPF, but advertise it'),
    ])])]),
  ]),
  C('routing-options', 'Protocol-independent routing option configuration', [
    L('autonomous-system', 'Autonomous system number', asn),
    L('router-id', 'Router identifier', ip),
    C('static', 'Static routing information', [N('route', 'Static route', route, [
      F('discard', 'Drop packets to destination; send no ICMP unreachables'),
      LL('next-hop', 'Next hop to destination', ip),
    ])]),
  ]),
  C('system', 'System parameters', [
    L('domain-name', 'Domain name for this router', word('<domain-name>', 'Domain name')),
    L('host-name', 'Hostname for this router', word('<host-name>', 'Hostname')),
    C('ntp', 'Network Time Protocol services', [N('server', 'NTP server to query', ip)]),
    C('services', 'System services', [C('netconf', 'Allow NETCONF connections', [F('ssh', 'Allow NETCONF connections over SSH')]), F('ssh', 'Allow ssh access')]),
    L('time-zone', 'Time zone name or POSIX-compliant time zone string', any),
  ]),
  L('version', 'Software version information', any),
  C('vlans', 'VLAN configuration', [NAMES(word('<name>', 'VLAN name'), [
    L('description', 'Text description of VLANs', text),
    L('l3-interface', 'Layer 3 interface for this VLAN', { p: '<interface>', h: 'Interface name', t: (s) => (/^irb\.\d+$/.test(s) ? s : null) }),
    L('vlan-id', 'IEEE 802.1q VLAN identifier for VLAN', num(1, 4094, '<vlan-id>', 'VLAN ID')),
  ], (d) => d.cand().k.find((c) => c.n === 'vlans')?.k.map((c) => c.n) || [])]),
];

// ------------------------------------------------------------------ the config tree
// { n: 'interfaces', k: [...] } container, { n: 'description', v: '"to core"' } leaf,
// { n: 'disable' } flag, { n: 'members', l: ['v100'] } leaf-list
const quote = (v) => (/[\s;{}#"'[\]]/.test(v) || v === '' ? `"${v.replace(/"/g, '\\"')}"` : v);
const unquote = (v) => (v && v.startsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v);
const kid = (n, name) => n.k && n.k.find((c) => c.n === name);
function get(tree, path) {
  let n = tree;
  for (const p of path) { n = n && kid(n, p); if (!n) return null; }
  return n;
}
function render(node, depth = 0) {
  const out = [], ind = '    '.repeat(depth);
  for (const c of node.k || []) out.push(...renderOne(c, depth));
  return out;
  function renderOne(c, d) {
    const i = '    '.repeat(d);
    if (c.k) return c.k.length ? [`${i}${c.n} {`, ...render(c, d + 1), `${i}}`] : [`${i}${c.n};`];
    if (c.l) return [c.l.length > 1 ? `${i}${c.n} [ ${c.l.join(' ')} ];` : `${i}${c.n} ${c.l[0]};`];
    if (c.v !== undefined) return [`${i}${c.n} ${c.v};`];
    return [`${i}${c.n};`];
  }
}
function renderNode(c, d) { const holder = { k: [c] }; return render(holder, d); }
function renderSet(node, prefix = []) {
  const out = [];
  for (const c of node.k || []) {
    const p = [...prefix, c.n];
    if (c.k) { if (c.k.length) out.push(...renderSet(c, p)); else out.push(`set ${p.join(' ')}`); }
    else if (c.l) for (const v of c.l) out.push(`set ${p.join(' ')} ${v}`);
    else if (c.v !== undefined) out.push(`set ${p.join(' ')} ${c.v}`);
    else out.push(`set ${p.join(' ')}`);
  }
  return out;
}
// show | compare: [edit path] headers with + and - lines
function compare(a, b) {
  const out = [];
  const isBox = (n) => !!n.k;
  const signed = (sign, lines) => lines.map((l) => sign + l.slice(1));
  const rec = (x, y, path) => {
    const local = [], deeper = [];
    for (const c of y.k) {
      const o = kid(x, c.n);
      if (!o) local.push(...signed('+', renderNode(c, 1)));
      else if (isBox(c) && isBox(o)) deeper.push([o, c]);
      else if (!same(o, c)) local.push(...signed('-', renderNode(o, 1)), ...signed('+', renderNode(c, 1)));
    }
    for (const o of x.k) if (!kid(y, o.n)) local.push(...signed('-', renderNode(o, 1)));
    if (local.length) out.push(`[edit${path.length ? ' ' + path.join(' ') : ''}]`, ...local);
    for (const [o, c] of deeper) rec(o, c, [...path, c.n]);
  };
  rec(a, b, []);
  return out;
}

export class Junos extends Device {
  constructor() {
    super();
    this.style = 'junos';
    this.quotes = true;
    this.user = 'lab';
    const first = this.factory();
    this.committed = first;
    this.candidate = null;
    this.rollbacks = [{ tree: clone(first), time: this.boot - 2 * 86400000, user: this.user }];
    this.mode = 'op';
    this.edit = [];
    this.confirmTimer = 0;
    this.G = this.grammar();
  }
  get id() { return 'junos'; }
  label() { return 'QFX/MX style · Junos'; }
  factory() {
    const t = { k: [] };
    for (const line of FACTORY.split('\n')) this.applyWords(t, 'set', this.wordsOf(line.slice(4)));
    return t;
  }
  motd() {
    return [
      'Simulated practice CLI: a pretend Juniper switch/router running Junos. Not a real device; nothing here touches a network.',
      'Type ? for help, Tab to complete. configure, then set / delete; commit saves to this browser.',
      '',
      `--- JUNOS ${VERSION} (simulated)`,
    ].join('\n');
  }

  // ---------------------------------------------------------------- saving
  persist() { return { committed: this.committed, rollbacks: this.rollbacks.slice(0, 6) }; }
  restore(d) {
    if (!d || !d.committed || !Array.isArray(d.committed.k)) return;
    this.committed = d.committed;
    if (Array.isArray(d.rollbacks) && d.rollbacks.length) this.rollbacks = d.rollbacks;
  }
  resetFactory() {
    this.stopTimers();
    clearTimeout(this.confirmTimer);
    const first = this.factory();
    this.committed = first;
    this.candidate = null;
    this.rollbacks = [{ tree: clone(first), time: Date.now(), user: this.user }];
    this.mode = 'op';
    this.edit = [];
    this.boot = Date.now() - this.bootAge() * 1000;
  }
  // Paste a config back in, as set commands or in braces: it lands in the candidate, to check and commit
  importConfig(text) {
    const t = { k: [] };
    let bad = 0;
    const apply = (words) => { if (words.length && this.applyWords(t, 'set', words).err) bad++; };
    const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (lines.length && lines.every((l) => l.startsWith('set '))) {
      for (const l of lines) apply(this.wordsOf(l.slice(4)));
    } else {
      const toks = text.replace(/^\s*#.*$/gm, '').match(/"(?:[^"\\]|\\.)*"|[{};[\]]|[^\s{};[\]"]+/g) || [];
      const path = [];
      let words = [];
      for (const tk of toks) {
        if (tk === '{') { path.push(words); words = []; }
        else if (tk === '}') { if (words.length) apply([...path.flat(), ...words]); words = []; path.pop(); }
        else if (tk === ';') { apply([...path.flat(), ...words]); words = []; }
        else words.push(tk.startsWith('"') ? tk.slice(1, -1).replace(/\\"/g, '"') : tk);
      }
    }
    if (!t.k.length) return { ok: false, msg: "That doesn't look like a Junos config (set commands, or the curly-brace format)." };
    this.candidate = t;
    return { ok: true, msg: `Loaded into the candidate config, not committed${bad ? ` (${bad} statement${bad === 1 ? '' : 's'} this lab doesn't know were skipped)` : ''}. Type configure, check it with show | compare, then commit.` };
  }
  configText() { return [`## Last commit: ${clock(this.rollbacks[0].time).junos} by ${this.rollbacks[0].user}`, ...render(this.committed)].join('\n') + '\n'; }
  cand() { return this.candidate || this.committed; }
  dirty() { return !!this.candidate && !same(this.candidate, this.committed); }

  // ---------------------------------------------------------------- prompt
  host(tree = this.committed) { const h = get(tree, ['system', 'host-name']); return h ? unquote(h.v) : 'lab-qfx1'; }
  prompt() { return `${this.user}@${this.host()}${this.mode === 'op' ? '>' : '#'} `; }
  pre() { return this.mode === 'op' ? [] : ['', `[edit${this.edit.length ? ' ' + this.edit.join(' ') : ''}]`]; }
  inConfig() { return this.mode === 'config'; }
  root() { return this.mode === 'op' ? this.G.op : this.G.config; }

  // ---------------------------------------------------------------- schema <-> words
  wordsOf(text) {
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
    let m;
    while ((m = re.exec(text))) out.push(m[1] !== undefined ? m[1] : m[2]);
    return out;
  }
  // Follow words through the schema: [{ s (schema node), key, value(s) }], or { err }
  resolve(words) {
    const steps = [];
    let list = SCHEMA, i = 0;
    while (i < words.length) {
      const w = words[i];
      const s = list.find((x) => x.kind !== 'names' && x.name === w) || list.find((x) => x.kind === 'names');
      if (!s) return { err: i, steps };
      if (s.kind === 'c') { steps.push({ s, key: s.name }); list = s.kids; i++; }
      else if (s.kind === 'nk') {
        if (i + 1 >= words.length) { steps.push({ s, key: null }); return { steps, open: true }; }
        const o = s.opts.find((x) => x.name === words[i + 1]);
        if (!o) return { err: i + 1, steps };
        steps.push({ s: o, key: `${s.name} ${o.name}` });
        list = o.kids;
        i += 2;
      }
      else if (s.kind === 'names') {
        const v = s.arg.t(w);
        if (v == null) return { err: i, steps };
        steps.push({ s, key: v });
        list = s.kids;
        i++;
      } else if (s.kind === 'n') {
        if (i + 1 >= words.length) { steps.push({ s, key: null }); return { steps, open: true }; }
        const v = s.arg.t(words[i + 1]);
        if (v == null) return { err: i + 1, steps };
        steps.push({ s, key: `${s.name} ${v}` });
        list = s.kids;
        i += 2;
      } else if (s.kind === 'l') {
        const v = words[i + 1];
        steps.push({ s, key: s.name, value: v === undefined ? undefined : s.arg.t(v), raw: v });
        return { steps, end: i + 2 };
      } else if (s.kind === 'f') { steps.push({ s, key: s.name }); return { steps, end: i + 1 }; }
      else if (s.kind === 'll') {
        const vals = words.slice(i + 1).filter((x) => x !== '[' && x !== ']').map((x) => s.arg.t(x));
        steps.push({ s, key: s.name, values: vals });
        return { steps, end: words.length };
      }
    }
    return { steps };
  }
  applyWords(tree, verb, words) {
    const r = this.resolve(words);
    if (r.err !== undefined) return { err: 'syntax error.' };
    const steps = r.steps;
    if (verb === 'set') {
      let n = tree;
      for (const st of steps) {
        if (!st.key) return { err: 'missing argument.' };
        const kind = st.s.kind;
        let c = kid(n, st.key);
        if (kind === 'c' || kind === 'n' || kind === 'names') {
          if (!c) { c = { n: st.key, k: [] }; n.k.push(c); }
          n = c;
        } else if (kind === 'l') {
          if (st.value === undefined) return { err: 'missing argument.' };
          if (st.value === null) return { err: st.s.arg.range ? `error: value ${st.raw} is not within range (${st.s.arg.range[0]}..${st.s.arg.range[1]})` : 'invalid value.' };
          const v = st.s.arg === text || st.s.arg === any ? quote(st.value) : st.value;
          if (c) c.v = v; else n.k.push({ n: st.key, v });
        } else if (kind === 'f') {
          if (!c) n.k.push({ n: st.key });
        } else if (kind === 'll') {
          if (!st.values.length) return { err: 'missing argument.' };
          if (st.values.includes(null)) return { err: 'invalid value.' };
          if (!c) { c = { n: st.key, l: [] }; n.k.push(c); }
          for (const v of st.values) if (!c.l.includes(v)) c.l.push(v);
        }
      }
      return {};
    }
    if (verb === 'delete') {
      const trail = [tree];
      let n = tree;
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        if (!st.key) return { warn: 'warning: statement not found' };
        const c = kid(n, st.key);
        if (!c) return { warn: 'warning: statement not found' };
        if (i === steps.length - 1) {
          if (st.s.kind === 'll' && st.values && st.values.length) {
            c.l = c.l.filter((v) => !st.values.includes(v));
            if (!c.l.length) n.k = n.k.filter((x) => x !== c);
          } else n.k = n.k.filter((x) => x !== c);
          // drop containers this left empty, like Junos does
          for (let j = trail.length - 1; j > 0; j--) {
            const box = trail[j];
            if (box.k && !box.k.length && !['f'].includes(box.kind)) { trail[j - 1].k = trail[j - 1].k.filter((x) => x !== box); } else break;
          }
          return {};
        }
        n = c;
        trail.push(c);
      }
      return {};
    }
    return {};
  }

  // the grammar for set/delete/edit/show at the current edit level, generated from the schema
  schemaAt(words) {
    let list = SCHEMA;
    const r = this.resolve(words);
    if (r.err !== undefined || r.open || r.end !== undefined) return null;
    for (const st of r.steps) list = st.s.kids;
    return list;
  }
  toGrammar(list, verb) {
    const dev = this;
    const end = (fn) => function (a, x) { return dev.cfgVerb(verb, x); };
    const out = [];
    for (const s of list) {
      const box = (more = {}) => ({ kind: '>', run: verb === 'set' ? undefined : end(), ...more });
      if (s.kind === 'c') {
        out.push({ k: s.name, h: s.h, kind: '>', run: verb === 'set' && s.kids.length ? undefined : end(), c: () => dev.toGrammar(s.kids, verb) });
      } else if (s.kind === 'nk') {
        out.push({ k: s.name, h: s.h, kind: '>', run: verb === 'delete' || verb === 'show' || verb === 'showop' ? end() : undefined, c: s.opts.map((o) => ({ k: o.name, h: o.h, kind: '>', run: end(), c: () => dev.toGrammar(o.kids, verb) })) });
      } else if (s.kind === 'names') {
        out.push({ p: s.arg.p, h: s.arg.h, t: (v) => (s.arg.t(v) != null ? [s.arg.t(v), 1] : null), run: end(), c: () => dev.toGrammar(s.kids, verb), hints: (d) => s.list(d).map((n) => [n, '']), alsoParam: true });
      } else if (s.kind === 'n') {
        out.push({ k: s.name, h: s.h, kind: '>', run: verb === 'delete' || verb === 'show' ? end() : undefined, c: [{ p: s.arg.p, h: s.arg.h, t: (v) => (s.arg.t(v) != null ? [s.arg.t(v), 1] : null), run: end(), c: () => dev.toGrammar(s.kids, verb) }] });
      } else if (s.kind === 'l') {
        if (verb === 'edit') continue;
        // numbers outside the range still parse, so set can say which range it wanted
        const ok = (v) => (s.arg.range ? /^\d+$/.test(v) : s.arg.t(v) != null);
        const valNodes = s.values ? s.values.map(([v, h]) => ({ k: v, h, run: end() })) : [{ p: s.arg.p, h: s.arg.h, t: (v) => (ok(v) ? [v, 1] : null), run: end() }];
        out.push({ k: s.name, h: s.h, run: verb === 'set' ? undefined : end(), c: verb === 'set' || verb === 'delete' ? valNodes : [] });
      } else if (s.kind === 'f') {
        if (verb === 'edit') continue;
        out.push({ k: s.name, h: s.h, run: end() });
      } else if (s.kind === 'll') {
        if (verb === 'edit') continue;
        const item = { p: s.arg.p, h: s.arg.h, t: (v) => (s.arg.t(v) != null && v !== '[' && v !== ']' ? [v, 1] : null), run: end() };
        const more = { p: s.arg.p, h: s.arg.h, t: item.t, c: () => [more, { k: ']', h: 'Close a set of values', run: end() }] };
        out.push({ k: s.name, h: s.h, kind: '+', run: verb === 'set' ? undefined : end(), c: [{ k: '[', h: 'Open a set of values', c: [more] }, item] });
      }
    }
    return out.sort((a, b) => (a.k || '~').localeCompare(b.k || '~'));
  }
  cfgVerb(verb, x) {
    if (verb === 'showop') return this.showCfg(x.path.slice(x.path.indexOf('configuration') + 1), x);
    const words = x.path.slice(x.path.indexOf(verb) + 1);
    if (verb === 'show') return this.showCand([...this.edit, ...words], x);
    if (verb === 'edit') {
      const r = this.resolve([...this.edit, ...words]);
      if (r.err !== undefined) return 'syntax error.';
      this.edit = [...this.edit, ...words];
      return '';
    }
    const res = this.applyWords(this.cand(), verb, [...this.edit, ...words]);
    if (res.err) return res.err;
    if (res.warn) return res.warn;
    return '';
  }
  editBase() { return this.schemaAt(this.edit) || SCHEMA; }

  // ---------------------------------------------------------------- the grammar
  grammar() {
    const dev = this;
    const op = [
      { k: 'configure', h: 'Manipulate software configuration information', run() { return this.configure(); }, c: [
        { k: 'exclusive', h: 'Obtain exclusive lock (other users cannot make changes)', run() { return this.configure(); } },
        { k: 'private', h: 'Work in private database (uncommitted changes discarded on exit)', run() { return this.configure('private'); } },
      ] },
      { k: 'exit', h: 'Exit the management session', run() { return { out: '', relogin: true }; } },
      { k: 'help', h: 'Provide help information', run() { return this.helpText(); } },
      { k: 'ping', h: 'Ping remote target', c: [{ p: '<host>', h: 'Hostname or IP address of remote host', t: (s) => [s, 1], as: 'dst', run(a) { return this.ping(a.dst, a); }, c: (d, a) => d.pingOpts(a) }] },
      { k: 'quit', h: 'Exit the management session', run() { return { out: '', relogin: true }; } },
      { k: 'request', h: 'Make system-level requests', c: [{ k: 'system', h: 'Perform system-level operations', c: [{ k: 'reboot', h: 'Reboot the system', run() { return this.reboot(); } }] }] },
      { k: 'show', h: 'Show system information', pipe: true, c: () => dev.showTree() },
    ];
    const cfgWords = (verb) => () => dev.toGrammar(dev.editBase(), verb);
    const config = [
      { k: 'commit', h: 'Commit current set of changes', run() { return this.commit(); }, c: [
        { k: 'and-quit', h: 'Quit configuration mode if commit succeeds', run() { return this.commit({ quit: true }); } },
        { k: 'check', h: 'Check correctness of syntax; do not apply changes', run() { return this.commit({ check: true }); } },
        { k: 'comment', h: 'Message to write to commit log', c: [{ p: '<comment-string>', h: 'Message to write to commit log', t: (s) => [s, 1], as: 'msg', run(a) { return this.commit({ comment: a.msg }); } }] },
        { k: 'confirmed', h: 'Automatically rollback if not confirmed', run() { return this.commit({ confirmed: 10 }); }, c: [{ p: '<timeout>', h: 'Number of minutes until automatic rollback (1..65535)', t: (s) => (/^\d+$/.test(s) && +s >= 1 ? [+s, 1] : null), as: 'min', run(a) { return this.commit({ confirmed: a.min }); } }] },
      ] },
      { k: 'delete', h: 'Delete a data element', c: cfgWords('delete') },
      { k: 'edit', h: 'Edit a sub-element', c: cfgWords('edit') },
      { k: 'exit', h: 'Exit from this level', run() { return this.exitLevel(); }, c: [{ k: 'configuration-mode', h: 'Exit from configuration mode', run() { return this.leave(); } }] },
      { k: 'quit', h: 'Quit from this level', run() { return this.exitLevel(); }, c: [{ k: 'configuration-mode', h: 'Exit from configuration mode', run() { return this.leave(); } }] },
      { k: 'rollback', h: 'Roll back to previous committed configuration', run() { return this.rollback(0); }, c: [{ p: '<number>', h: 'Index of rollback version (0..5)', t: (s) => (/^\d$/.test(s) ? [+s, 1] : null), as: 'n', run(a) { return this.rollback(a.n); } }] },
      { k: 'run', h: 'Run an operational-mode command', c: () => dev.G.op },
      { k: 'set', h: 'Set a parameter', c: cfgWords('set') },
      { k: 'show', h: 'Show a parameter', pipe: true, run() { return this.showCand([...this.edit], arguments[1]); }, c: cfgWords('show') },
      { k: 'top', h: 'Exit to top level of configuration', run() { this.edit = []; return ''; } },
      { k: 'up', h: 'Exit one level of configuration', run() { return this.up(1); }, c: [{ p: '<number>', h: 'Number of levels to move up', t: (s) => (/^\d+$/.test(s) && +s > 0 ? [+s, 1] : null), as: 'n', run(a) { return this.up(a.n); } }] },
    ];
    return { op, config };
  }
  pingOpts(a) {
    return [
      { k: 'count', h: 'Number of ping requests to send (1..2000000000 packets)', c: [{ p: '<count>', h: 'Number of ping requests', t: (s) => (/^\d+$/.test(s) && +s > 0 && +s <= 100 ? [+s, 1] : null), as: 'count', run(x) { return this.ping(x.dst, x); }, c: (d, x) => d.pingOpts(x) }] },
      { k: 'rapid', h: 'Send requests rapidly (default count of 5)', as: 'rapid', run(x) { return this.ping(x.dst, x); }, c: (d, x) => d.pingOpts(x) },
    ].filter((n) => !a[n.k] && !(n.k === 'count' && a.count));
  }
  helpText() {
    return ['Help is everywhere: type ? after any word, for example  show ?  or  show interfaces ?',
      'Tab completes a word. Abbreviations work: sh int ter = show interfaces terse.',
      'configure enters configuration mode; set and delete edit the candidate; commit applies and saves it.'].join('\n');
  }

  // ---------------------------------------------------------------- modes
  configure(kind) {
    this.mode = 'config';
    this.edit = [];
    this.private = kind === 'private';
    const msgs = [this.private ? 'warning: uncommitted changes will be discarded on exit' : null, 'Entering configuration mode'];
    if (this.dirty() && !this.private) msgs.push('The configuration has been changed but not committed');
    if (!this.candidate || this.private) this.candidate = clone(this.committed);
    return msgs.filter(Boolean).join('\n');
  }
  exitLevel() {
    if (this.edit.length) { this.up(1); return ''; }
    return this.leave();
  }
  up(n) {
    // one level is one statement: "unit 0" is one, "interfaces" is one
    const r = this.resolve(this.edit);
    const keep = Math.max(0, r.steps.length - n);
    const words = [];
    for (const st of r.steps.slice(0, keep)) words.push(...st.key.split(' '));
    this.edit = words;
    return '';
  }
  leave() {
    const out = () => {
      this.mode = 'op';
      this.edit = [];
      if (this.private || !this.dirty()) this.candidate = null;
      return 'Exiting configuration mode';
    };
    if (!this.dirty()) return out();
    if (this.private) return { ask: { q: 'Discard uncommitted changes? [yes,no] (yes) ', then: (a) => (/^n/i.test(a.trim()) ? '' : (this.candidate = null, out())) } };
    return { out: 'The configuration has been changed but not committed', ask: { q: 'Exit with uncommitted changes? [yes,no] (yes) ', then: (a) => (/^n/i.test(a.trim()) ? '' : out()) } };
  }

  // ---------------------------------------------------------------- commit, rollback
  validate(tree) {
    const errs = [];
    const groups = get(tree, ['protocols', 'bgp'])?.k.filter((c) => c.n.startsWith('group ')) || [];
    for (const g of groups) {
      const type = kid(g, 'type');
      const gas = kid(g, 'peer-as');
      for (const nb of g.k.filter((c) => c.n.startsWith('neighbor '))) {
        const external = type ? type.v === 'external' : !!gas;
        if (external && !gas && !kid(nb, 'peer-as')) errs.push(`[edit protocols bgp ${g.n}]`, `  '${nb.n}'`, '    Peer AS must be configured for an external peer');
      }
    }
    const vlans = get(tree, ['vlans']);
    const known = new Set((vlans?.k || []).flatMap((v) => [v.n, kid(v, 'vlan-id')?.v].filter(Boolean)));
    for (const i of get(tree, ['interfaces'])?.k || []) {
      for (const u of (i.k || []).filter((c) => c.n.startsWith('unit '))) {
        const m = get(u, ['family ethernet-switching', 'vlan', 'members']);
        for (const v of m?.l || []) if (!known.has(v)) errs.push(`[edit interfaces ${i.n} ${u.n} family ethernet-switching vlan]`, `  'members ${v}'`, `    VLAN ${v} is not defined (configure it under [edit vlans])`);
        if (get(u, ['family inet']) && get(u, ['family ethernet-switching'])) errs.push(`[edit interfaces ${i.n} ${u.n}]`, "  'family ethernet-switching'", '    family ethernet-switching and family inet can not be configured on the same unit');
      }
    }
    return errs;
  }
  commit({ check, quit, comment, confirmed } = {}) {
    const tree = this.cand();
    const errs = this.validate(tree);
    if (errs.length) return [...errs, 'error: configuration check-out failed'].join('\n');
    if (check) return 'configuration check succeeds';
    clearTimeout(this.confirmTimer);
    const lines = [];
    if (confirmed) {
      lines.push(`commit confirmed will be automatically rolled back in ${confirmed} minutes unless confirmed`);
      this.confirmTimer = setTimeout(() => this.autoRollback(), confirmed * 60000);
    }
    if (!confirmed) this.confirmTimer = 0;
    if (!same(tree, this.committed) || confirmed) {
      this.committed = clone(tree);
      this.rollbacks.unshift({ tree: clone(tree), time: Date.now(), user: this.user, comment });
      this.rollbacks = this.rollbacks.slice(0, 6);
      if (this.onSave) this.onSave();
    }
    this.candidate = clone(this.committed);
    lines.push('commit complete');
    if (quit) { this.mode = 'op'; this.edit = []; this.candidate = null; lines.push('Exiting configuration mode'); }
    return lines.join('\n');
  }
  stopTimers() { super.stopTimers(); clearTimeout(this.confirmTimer); this.confirmTimer = 0; }
  autoRollback() {
    this.confirmTimer = 0;
    if (this.rollbacks.length < 2) return;
    this.committed = clone(this.rollbacks[1].tree);
    this.rollbacks.unshift({ tree: clone(this.committed), time: Date.now(), user: 'root', comment: 'automatic rollback' });
    this.rollbacks = this.rollbacks.slice(0, 6);
    if (!this.dirty()) this.candidate = this.mode === 'config' ? clone(this.committed) : null;
    if (this.onSave) this.onSave();
    this.emit(`\nBroadcast Message from root@${this.host()}\n        (no tty) at ${clock().hms} ${clock().tz}...\n\nCommit was not confirmed; automatic rollback complete.\n`);
  }
  rollback(n) {
    const r = this.rollbacks[n];
    if (!r) return `error: Cannot get rollback ${n}: there are ${this.rollbacks.length} saved versions in this lab`;
    this.candidate = clone(r.tree);
    return 'load complete';
  }
  reboot() {
    return { ask: { q: 'Reboot the system ? [yes,no] (no) ', then: (a) => {
      if (!/^y/i.test(a.trim())) return '';
      // a commit confirmed that nobody confirmed doesn't survive a reboot
      const unconfirmed = !!this.confirmTimer;
      this.stopTimers();
      if (unconfirmed) { const say = this.onLog; this.onLog = null; this.autoRollback(); this.onLog = say; }
      this.mode = 'op';
      this.edit = [];
      this.candidate = null;
      this.boot = Date.now();
      return { steps: [{ t: '' }, { t: 'Shutdown NOW!', ms: 300 }, { t: `[pid ${30000 + Math.floor(Math.random() * 9999)}]`, ms: 300 }, { t: '' },
        { t: `*** FINAL System shutdown message from ${this.user}@${this.host()} ***`, ms: 500 }, { t: '' }, { t: 'System going down IMMEDIATELY', ms: 400 }, { t: '', ms: 900 },
        { t: '(simulated reboot: the committed config is back; uncommitted changes are gone)', ms: 300 }, { t: '' }], relogin: true };
    } } };
  }

  // ---------------------------------------------------------------- config-mode show
  showCand(words, x) {
    const pipes = (x && x.pipes) || [];
    const cmp = pipes.find((p) => p.k === 'compare');
    const set = pipes.find((p) => p.k === 'display set');
    if (cmp) {
      cmp.used = true;
      const base = cmp.arg != null ? this.rollbacks[cmp.arg] && this.rollbacks[cmp.arg].tree : this.committed;
      if (!base) return `error: rollback ${cmp.arg} does not exist`;
      return compare(base, this.cand()).join('\n');
    }
    const tree = this.cand();
    const n = words.length ? get(tree, this.keysOf(words)) : tree;
    if (set) {
      set.used = true;
      if (!n) return '';
      const prefix = this.keysOf(words).flatMap((k) => k.split(' '));
      return (n.k ? renderSet(n, prefix) : renderSet({ k: [n] }, prefix.slice(0, -1))).join('\n');
    }
    if (!n) return '';
    if (!words.length) return [`## Last changed: ${clock().junos}`, ...render(tree)].join('\n');
    return (n.k ? render(n) : renderNode(n, 0)).join('\n');
  }
  keysOf(words) {
    const r = this.resolve(words);
    return r.steps.filter((st) => st.key).map((st) => st.key);
  }

  // ---------------------------------------------------------------- the world, from the committed config
  c(path) { return get(this.committed, path); }
  unit(ifn, u = 0) { return this.c(['interfaces', ifn, `unit ${u}`]); }
  ifDisabled(ifn) { return !!this.c(['interfaces', ifn, 'disable']); }
  physUp(ifn) { return CABLED.has(ifn) && !this.ifDisabled(ifn); }
  addrOf(ifl) {
    const [ifn, u] = ifl.split('.');
    const a = get(this.committed, ['interfaces', ifn, `unit ${u}`, 'family inet']);
    const addr = a && a.k.find((c) => c.n.startsWith('address '));
    return addr ? addr.n.slice(8) : null;
  }
  mtu(ifn) { const m = this.c(['interfaces', ifn, 'mtu']); return m ? +m.v : 1514; }
  vlanList() {
    return (this.c(['vlans'])?.k || []).map((v) => ({ name: v.n, id: kid(v, 'vlan-id') ? +kid(v, 'vlan-id').v : null, l3: kid(v, 'l3-interface')?.v || null }));
  }
  memberships() {
    const out = [];
    for (const i of this.c(['interfaces'])?.k || []) {
      for (const u of (i.k || []).filter((x) => x.n.startsWith('unit '))) {
        const es = get(u, ['family ethernet-switching']);
        if (!es) continue;
        const m = get(es, ['vlan', 'members']);
        const mode = kid(es, 'interface-mode')?.v || 'access';
        for (const v of m?.l || []) {
          const vl = this.vlanList().find((x) => x.name === v || String(x.id) === v);
          if (vl) out.push({ ifl: `${i.n}.${u.n.slice(5)}`, ifd: i.n, vlan: vl, mode });
        }
      }
    }
    return out;
  }
  logicalUp(ifl) {
    const [ifn, u] = ifl.split('.');
    if (!this.unit(ifn, u) || this.c(['interfaces', ifn, `unit ${u}`, 'disable'])) return false;
    if (ifn === 'lo0') return !this.ifDisabled('lo0');
    if (ifn === 'irb') return this.irbUp(+u);
    return this.physUp(ifn);
  }
  irbUp(u) {
    const v = this.vlanList().find((x) => x.l3 === `irb.${u}`);
    return !!v && this.memberships().some((m) => m.vlan.name === v.name && this.physUp(m.ifd));
  }
  ospfIfs() {
    const out = [];
    for (const a of this.c(['protocols', 'ospf'])?.k || []) {
      if (!a.n.startsWith('area ')) continue;
      for (const i of a.k.filter((x) => x.n.startsWith('interface '))) out.push({ area: a.n.slice(5), ifl: i.n.slice(10), passive: !!kid(i, 'passive'), disabled: !!kid(i, 'disable'), type: kid(i, 'interface-type')?.v || 'broadcast' });
    }
    return out;
  }
  adj(ifn) {
    const n = CORE[ifn];
    const o = this.ospfIfs().find((x) => x.ifl === `${ifn}.0`);
    if (!o || o.passive || o.disabled || o.area !== '0.0.0.0' || !this.logicalUp(`${ifn}.0`)) return null;
    if (this.addrOf(`${ifn}.0`) !== `${n.me}/${n.len}`) return null;
    return this.mtu(ifn) === n.mtu ? 'Full' : 'ExStart';
  }
  ospfUp() { return Object.keys(CORE).some((i) => this.adj(i) === 'Full'); }
  localAs() { const a = this.c(['routing-options', 'autonomous-system']); return a ? +a.v : null; }
  peers() {
    const out = [];
    for (const g of this.c(['protocols', 'bgp'])?.k || []) {
      if (!g.n.startsWith('group ')) continue;
      const gt = kid(g, 'type')?.v, gas = kid(g, 'peer-as')?.v, gla = kid(g, 'local-address')?.v;
      for (const nb of g.k.filter((x) => x.n.startsWith('neighbor '))) {
        const ip = nb.n.slice(9);
        const type = gt || (gas || kid(nb, 'peer-as') ? 'external' : 'internal');
        const pas = kid(nb, 'peer-as')?.v || gas || (type === 'internal' ? String(this.localAs()) : null);
        out.push({ ip, group: g.n.slice(6), type, peerAs: pas ? +pas : null, local: kid(nb, 'local-address')?.v || gla || null, desc: unquote(kid(nb, 'description')?.v || ''), shut: !!kid(nb, 'shutdown') });
      }
    }
    return out;
  }
  peerState(p) {
    if (p.shut) return { state: 'Idle', up: false, why: 'shut down' };
    const ibgp = Object.values(CORE).find((c) => c.rid === p.ip);
    let up = false, why = 'no route to the peer';
    if (ibgp) {
      const lo = this.addrOf('lo0.0');
      up = p.type === 'internal' && this.localAs() === AS && p.peerAs === AS && p.local === '10.255.0.1' && lo === '10.255.0.1/32' && this.ospfUp();
      why = !this.ospfUp() ? 'no OSPF route to its loopback' : p.local !== '10.255.0.1' ? 'local-address is not lo0' : 'AS mismatch';
    } else if (p.ip === TRANSIT.ip) {
      up = p.type === 'external' && p.peerAs === TRANSIT.as && this.localAs() === AS && this.logicalUp(`${TRANSIT.if}.0`) && this.addrOf(`${TRANSIT.if}.0`) === `${TRANSIT.me}/${TRANSIT.len}`;
      why = p.peerAs !== TRANSIT.as ? 'Open Message Error' : 'Connect';
    }
    if (!up) return { state: ibgp || p.ip === TRANSIT.ip ? 'Active' : 'Idle', up: false, why };
    const routes = ibgp ? ibgp.routes : TRANSIT.routes;
    return { state: 'Establ', up: true, routes };
  }
  hostOk(ifn) {
    const h = HOSTS[ifn];
    if (!h || !this.physUp(ifn)) return false;
    const m = this.memberships().find((x) => x.ifd === ifn && x.mode === 'access');
    return !!m && m.vlan.id === h.vlan && !!m.vlan.l3 && this.irbUp(+m.vlan.l3.split('.')[1]) && !!this.addrOf(m.vlan.l3);
  }

  // ---------------------------------------------------------------- operational show commands
  showTree() {
    const dev = this;
    return [
      { k: 'bgp', h: 'Show Border Gateway Protocol information', c: [
        { k: 'neighbor', h: 'Show BGP neighbors', run() { return this.showBgpNbr(); }, c: [{ p: '<address>', h: 'IP address of neighbor', t: (s) => (isIp(s) ? [s, 1] : null), as: 'ip', run(a) { return this.showBgpNbr(a.ip); } }] },
        { k: 'summary', h: 'Show overview of BGP information', run() { return this.showBgpSum(); } },
      ] },
      { k: 'configuration', h: 'Show current configuration', run(a, x) { return this.showCfg([], x); }, c: () => dev.toGrammar(SCHEMA, 'showop') },
      { k: 'ethernet-switching', h: 'Show Ethernet-switching information', c: [{ k: 'table', h: 'Show media access control table', run() { return this.showMacs(); } }] },
      { k: 'interfaces', h: 'Show interface information', run() { return this.showIfs(); }, c: [
        { k: 'descriptions', h: 'Show interface description string', run() { return this.showIfDesc(); } },
        { k: 'terse', h: 'Display terse output', run() { return this.showTerse(); }, c: [{ p: '<interface-name>', h: 'Name of physical or logical interface', t: (s) => (dev.knownIf(s) ? [s, 1] : null), as: 'if', hints: () => [...PORTS, ...OTHER].map((n) => [n, '']), alsoParam: true, run(a) { return this.showTerse(a.if); } }] },
        { p: '<interface-name>', h: 'Name of physical or logical interface', t: (s) => (dev.knownIf(s) ? [s, 1] : null), as: 'if', hints: () => [...PORTS, ...OTHER].map((n) => [n, '']), alsoParam: true, run(a) { return this.showIfs(a.if); },
          c: [{ k: 'terse', h: 'Display terse output', run(a) { return this.showTerse(a.if); } }, { k: 'extensive', h: 'Display extensive output', run(a) { return this.showIfs(a.if); } }] },
      ] },
      { k: 'lldp', h: 'Show Link Layer Discovery Protocol information', c: [{ k: 'neighbors', h: 'Show LLDP neighbors', run() { return this.showLldp(); } }] },
      { k: 'ospf', h: 'Show Open Shortest Path First information', c: [
        { k: 'interface', h: 'Show OSPF interface information', run() { return this.showOspfIf(); } },
        { k: 'neighbor', h: 'Show OSPF neighbor information', run() { return this.showOspfNbr(); } },
      ] },
      { k: 'route', h: 'Show routing table information', run() { return this.showRoute(); }, c: [
        { k: 'protocol', h: 'Name of protocol', c: ['bgp', 'direct', 'local', 'ospf', 'static'].map((p) => ({ k: p, h: `${p[0].toUpperCase()}${p.slice(1)} routes`, run() { return this.showRoute({ proto: p }); } })) },
        { k: 'summary', h: 'Show route summary information', run() { return this.showRouteSum(); } },
        { p: '<destination>', h: 'IP address and optional prefix length of destination', t: (s) => (isIp(s) || isPrefix(s) ? [s, 1] : null), as: 'dst', run(a) { return this.showRoute({ dst: a.dst }); } },
      ] },
      { k: 'system', h: 'Show system information', c: [
        { k: 'commit', h: 'Show pending commit operation and commit history', run() { return this.showCommits(); } },
        { k: 'uptime', h: 'Show time since system and processes started', run() { return this.showUptime(); } },
      ] },
      { k: 'version', h: 'Show software process revision levels', run() { return this.showVersion(); } },
      { k: 'vlans', h: 'Show VLAN information', run() { return this.showVlans(); }, c: [{ p: '<vlan-name>', h: 'VLAN name', t: (s) => (dev.vlanList().some((v) => v.name === s) ? [s, 1] : null), as: 'v', hints: () => dev.vlanList().map((v) => [v.name, '']), run(a) { return this.showVlans(a.v); } }] },
    ];
  }
  knownIf(s) { const [d, u] = s.split('.'); return ([...PORTS, ...OTHER].includes(d) && (u === undefined || !!this.unit(d, u))); }
  showCfg(words, x) {
    const pipes = (x && x.pipes) || [];
    const set = pipes.find((p) => p.k === 'display set');
    const cmp = pipes.find((p) => p.k === 'compare');
    if (cmp) {
      cmp.used = true;
      const base = this.rollbacks[cmp.arg == null ? 1 : cmp.arg];
      return base ? compare(base.tree, this.committed).join('\n') : `error: rollback ${cmp.arg} does not exist`;
    }
    const keys = this.keysOf(words);
    const n = keys.length ? get(this.committed, keys) : this.committed;
    if (!n) return '';
    if (set) { set.used = true; return (n.k ? renderSet(n, keys.flatMap((k) => k.split(' '))) : renderSet({ k: [n] }, keys.slice(0, -1).flatMap((k) => k.split(' ')))).join('\n'); }
    if (!keys.length) return [`## Last commit: ${clock(this.rollbacks[0].time).junos} by ${this.rollbacks[0].user}`, ...render(this.committed)].join('\n');
    return (n.k ? render(n) : renderNode(n, 0)).join('\n');
  }
  cfgVerbOp(x) { return this.showCfg(x.path.slice(2), x); }
  units(ifn) { return (this.c(['interfaces', ifn])?.k || []).filter((c) => c.n.startsWith('unit ')).map((c) => c.n.slice(5)); }
  showTerse(only) {
    const rows = ['Interface               Admin Link Proto    Local                 Remote'];
    const list = only ? [only.split('.')[0]] : [...PORTS, ...OTHER];
    for (const ifn of list) {
      const admin = this.ifDisabled(ifn) ? 'down' : 'up';
      const link = ifn === 'irb' || ifn === 'lo0' ? admin : this.physUp(ifn) ? 'up' : 'down';
      if (!only || !only.includes('.')) rows.push(`${pad(ifn, 24)}${pad(admin, 6)}${link}`);
      for (const u of this.units(ifn)) {
        const ifl = `${ifn}.${u}`;
        if (only && only.includes('.') && only !== ifl) continue;
        const ua = this.c(['interfaces', ifn, `unit ${u}`, 'disable']) ? 'down' : 'up';
        const ul = this.logicalUp(ifl) ? 'up' : 'down';
        const fams = (this.unit(ifn, u)?.k || []).filter((f) => f.n.startsWith('family ')).map((f) => f.n.slice(7));
        if (!fams.length) { rows.push(`${pad(ifl, 24)}${pad(ua, 6)}${ul}`); continue; }
        fams.forEach((f, i) => {
          const head = i ? ' '.repeat(35) : `${pad(ifl, 24)}${pad(ua, 6)}${pad(ul, 5)}`;
          if (f === 'inet') {
            const addr = this.addrOf(ifl);
            rows.push(`${head}${pad('inet', 9)}${addr ? (ifn === 'lo0' ? pad(addr.split('/')[0], 22) + '--> 0/0' : addr) : ''}`);
          } else rows.push(`${head}${f === 'ethernet-switching' ? 'eth-switch' : f}`);
        });
      }
    }
    return rows.join('\n');
  }
  showIfDesc() {
    const rows = ['Interface       Admin Link Description'];
    for (const i of this.c(['interfaces'])?.k || []) {
      const d = kid(i, 'description');
      if (!d) continue;
      rows.push(`${pad(i.n, 16)}${pad(this.ifDisabled(i.n) ? 'down' : 'up', 6)}${pad(this.physUp(i.n) ? 'up' : 'down', 5)}${unquote(d.v)}`);
    }
    return rows.join('\n');
  }
  showIfs(only) {
    const ifn = only ? only.split('.')[0] : null;
    const list = ifn ? [ifn] : [...PORTS, ...OTHER];
    return list.map((n) => {
      const up = n === 'irb' || n === 'lo0' ? !this.ifDisabled(n) : this.physUp(n);
      const d = this.c(['interfaces', n, 'description']);
      const out = [`Physical interface: ${n}, ${this.ifDisabled(n) ? 'Administratively down' : 'Enabled'}, Physical link is ${up ? 'Up' : 'Down'}`,
        `  Interface index: ${650 + PORTS.indexOf(n)}, SNMP ifIndex: ${516 + PORTS.indexOf(n)}`];
      if (d) out.push(`  Description: ${unquote(d.v)}`);
      out.push(`  Link-level type: Ethernet, MTU: ${this.mtu(n)}, ${n.startsWith('et') ? 'Speed: 100Gbps' : n.startsWith('xe') ? 'LAN-PHY mode, Speed: 10Gbps' : 'Speed: 1000mbps'}, Loopback: Disabled, Source filtering: Disabled, Flow control: Disabled`,
        '  Device flags   : Present Running', `  Current address: ${MAC(0xa0 + Math.max(0, PORTS.indexOf(n)))}, Hardware address: ${MAC(0xa0 + Math.max(0, PORTS.indexOf(n)))}`,
        `  Last flapped   : ${clock(this.boot).junos} (${ago(this.uptime(), 'junos')} ago)`,
        `  Input rate     : ${up ? 182000 : 0} bps (${up ? 61 : 0} pps)`, `  Output rate    : ${up ? 171000 : 0} bps (${up ? 58 : 0} pps)`);
      for (const u of this.units(n)) {
        const ifl = `${n}.${u}`, addr = this.addrOf(ifl);
        out.push('', `  Logical interface ${ifl} (Index ${555 + +u}) (SNMP ifIndex ${540 + +u})`, `    Flags: ${this.logicalUp(ifl) ? 'Up' : 'Down'} SNMP-Traps 0x4004000 Encapsulation: ENET2`);
        if (addr) out.push(`    Protocol inet, MTU: ${this.mtu(n) - 14}`, '      Addresses, Flags: Is-Preferred Is-Primary', `        Destination: ${net(addr.split('/')[0], +addr.split('/')[1])}/${addr.split('/')[1]}, Local: ${addr.split('/')[0]}`);
        else if (get(this.committed, ['interfaces', n, `unit ${u}`, 'family ethernet-switching'])) out.push('    Protocol eth-switch, MTU: 1514');
      }
      return out.join('\n');
    }).join('\n\n');
  }
  routes() {
    const out = [];
    const t = ago(this.uptime(), 'junos');
    for (const ifn of [...PORTS, ...OTHER]) {
      for (const u of this.units(ifn)) {
        const ifl = `${ifn}.${u}`, addr = this.addrOf(ifl);
        if (!addr || !this.logicalUp(ifl)) continue;
        const [a, l] = addr.split('/');
        if (+l < 32) out.push({ p: `${net(a, +l)}/${l}`, proto: 'Direct', pref: 0, age: t, lines: [`                    >  via ${ifl}`] });
        out.push({ p: `${a}/32`, proto: 'Local', pref: 0, age: t, lines: [`                       Local via ${ifl}`] });
      }
    }
    for (const r of this.c(['routing-options', 'static'])?.k || []) {
      const nh = kid(r, 'next-hop');
      const via = nh && out.find((x) => x.proto === 'Direct' && inNet(nh.l[0], x.p.split('/')[0], +x.p.split('/')[1]));
      if (kid(r, 'discard')) out.push({ p: r.n.slice(6), proto: 'Static', pref: 5, age: t, lines: ['                       Discard'] });
      else if (via) out.push({ p: r.n.slice(6), proto: 'Static', pref: 5, age: t, lines: [`                    >  to ${nh.l[0]} via ${via.lines[0].split('via ')[1]}`] });
    }
    if (this.ospfUp()) {
      const best = (rid) => Object.keys(CORE).find((i) => CORE[i].rid === rid && this.adj(i) === 'Full') || Object.keys(CORE).find((i) => this.adj(i) === 'Full');
      for (const c of Object.values(CORE)) {
        const i = best(c.rid);
        out.push({ p: `${c.rid}/32`, proto: 'OSPF', pref: 10, age: t, extra: `, metric ${CORE[i].rid === c.rid ? 1 : 2}`, lines: [`                    >  to ${CORE[i].ip} via ${i}.0`] });
      }
      const i = best('10.255.0.2');
      out.push({ p: '10.0.23.0/30', proto: 'OSPF', pref: 10, age: t, extra: ', metric 2', lines: [`                    >  to ${CORE[i].ip} via ${i}.0`] });
    }
    for (const p of this.peers()) {
      const s = this.peerState(p);
      if (!s.up) continue;
      const ibgp = Object.values(CORE).find((c) => c.rid === p.ip);
      for (const r of s.routes) {
        const via = ibgp ? Object.keys(CORE).find((i) => CORE[i].rid === p.ip && this.adj(i) === 'Full') || Object.keys(CORE).find((i) => this.adj(i) === 'Full') : TRANSIT.if;
        const nh = ibgp ? CORE[via].ip : TRANSIT.ip;
        out.push({ p: r, proto: 'BGP', pref: 170, age: t, extra: `, localpref 100${ibgp ? `, from ${p.ip}` : ''}`, lines: [`                      AS path: ${ibgp ? 'I' : `${TRANSIT.as} I`}, validation-state: unverified`, `                    >  to ${nh} via ${via}.0`] });
      }
    }
    const key = (p) => p.split(/[./]/).map((x) => x.padStart(3, '0')).join('.');
    return out.sort((a, b) => key(a.p).localeCompare(key(b.p)));
  }
  showRoute({ proto, dst } = {}) {
    let rows = this.routes();
    const total = rows.length;
    if (proto) rows = rows.filter((r) => r.proto.toLowerCase() === proto);
    if (dst) {
      const ip = dst.split('/')[0];
      const hits = rows.filter((r) => { const [b, l] = r.p.split('/'); return dst.includes('/') ? r.p === dst || (+l <= +dst.split('/')[1] && inNet(ip, b, +l)) : inNet(ip, b, +l); });
      const best = hits.sort((a, b) => +b.p.split('/')[1] - +a.p.split('/')[1])[0];
      rows = best ? [best] : [];
    }
    return [`inet.0: ${total} destinations, ${total} routes (${total} active, 0 holddown, 0 hidden)`, '+ = Active Route, - = Last Active, * = Both', '',
      ...rows.flatMap((r) => [`${pad(r.p, 19)}*[${r.proto}/${r.pref}] ${r.age}${r.extra || ''}`, ...r.lines])].join('\n');
  }
  showRouteSum() {
    const rows = this.routes(), n = (p) => rows.filter((r) => r.proto === p).length;
    return [`Autonomous system number: ${this.localAs() || 'none'}`, `Router ID: ${this.c(['routing-options', 'router-id'])?.v || '0.0.0.0'}`, '',
      `inet.0: ${rows.length} destinations, ${rows.length} routes (${rows.length} active, 0 holddown, 0 hidden)`,
      ...['Direct', 'Local', 'OSPF', 'BGP', 'Static'].filter(n).map((p) => `${lpad(p, 20)}: ${lpad(n(p), 6)} routes, ${lpad(n(p), 6)} active`)].join('\n');
  }
  showBgpSum() {
    const peers = this.peers();
    if (!this.c(['protocols', 'bgp'])) return 'BGP is not running';
    const states = peers.map((p) => [p, this.peerState(p)]);
    const routes = states.reduce((a, [, s]) => a + (s.up ? s.routes.length : 0), 0);
    const t = this.uptime();
    const groups = new Set(peers.map((p) => p.group)).size;
    return ['Threading mode: BGP I/O', 'Default eBGP mode: advertise - accept, receive - accept',
      `Groups: ${groups} Peers: ${peers.length} Down peers: ${states.filter(([, s]) => !s.up).length}`,
      'Table          Tot Paths  Act Paths Suppressed    History Damp State    Pending', 'inet.0               ', `${lpad(routes, 24)}${lpad(routes, 11)}          0          0          0          0`,
      'Peer                     AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn State|#Active/Received/Accepted/Damped...',
      ...states.flatMap(([p, s]) => {
        const pk = s.up ? Math.floor(t / 30) + 40 : 0;
        const row = `${pad(p.ip, 25)}${lpad(p.peerAs || 0, 5)}${lpad(pk, 11)}${lpad(s.up ? pk - 2 : 0, 11)}${lpad(0, 8)}${lpad(0, 8)} ${lpad(ago(t, 'junos'), 11)} ${s.up ? 'Establ' : s.state}`;
        return s.up ? [row, `  inet.0: ${s.routes.length}/${s.routes.length}/${s.routes.length}/0`] : [row];
      })].join('\n');
  }
  showBgpNbr(ip) {
    const list = this.peers().filter((p) => !ip || p.ip === ip);
    if (!list.length) return ip ? `error: peer ${ip} not found` : '';
    return list.map((p) => {
      const s = this.peerState(p), ext = p.type === 'external';
      return [`Peer: ${p.ip}+179 AS ${p.peerAs || 0} Local: ${ext ? TRANSIT.me : p.local || '0.0.0.0'}+${51234 + +p.ip.split('.')[3]} AS ${this.localAs() || 0}`,
        ...(p.desc ? [`  Description: ${p.desc}`] : []), `  Group: ${pad(p.group, 22)}Routing-Instance: master`, `  Forwarding routing-instance: master`,
        `  Type: ${ext ? 'External' : 'Internal'}    State: ${s.up ? 'Established' : s.state}    Flags: <${s.up ? 'Sync' : 'ImportEval'}>`,
        `  Last State: ${s.up ? 'OpenConfirm' : 'Idle'}   Last Event: ${s.up ? 'RecvKeepAlive' : 'ConnectRetry'}`, `  Last Error: ${s.up ? 'None' : s.why === 'Open Message Error' ? 'Open Message Error' : 'None'}`,
        `  Options: <Preference${p.local ? ' LocalAddress' : ''}${ext ? ' PeerAS' : ''} Refresh>`, `  Holdtime: 90 Preference: 170`, `  Number of flaps: 0`,
        ...(s.up ? [`  Peer ID: ${ext ? TRANSIT.ip : p.ip}    Local ID: ${this.c(['routing-options', 'router-id'])?.v || '0.0.0.0'}    Active Holdtime: 90`, '  Table inet.0 Bit: 20000',
          `    Active prefixes:              ${s.routes.length}`, `    Received prefixes:            ${s.routes.length}`, `    Accepted prefixes:            ${s.routes.length}`] : [`  (lab note: ${s.why})`])].join('\n');
    }).join('\n\n');
  }
  showOspfNbr() {
    const rows = ['Address          Interface              State           ID               Pri  Dead'];
    for (const i of Object.keys(CORE)) {
      const a = this.adj(i);
      if (a) rows.push(`${pad(CORE[i].ip, 17)}${pad(i + '.0', 23)}${pad(a, 16)}${pad(CORE[i].rid, 17)}${lpad(128, 3)}${lpad(i.endsWith('0') ? 36 : 32, 6)}`);
    }
    return rows.join('\n');
  }
  showOspfIf() {
    const rows = ['Interface           State   Area            DR ID           BDR ID          Nbrs'];
    for (const o of this.ospfIfs()) {
      const ifn = o.ifl.split('.')[0];
      const up = this.logicalUp(o.ifl);
      const p2p = o.type === 'p2p';
      const st = !up || o.disabled ? 'Down' : p2p ? 'PtToPt' : 'DR';
      rows.push(`${pad(o.ifl, 20)}${pad(st, 8)}${pad(o.area, 16)}${pad(p2p || !up ? '0.0.0.0' : this.c(['routing-options', 'router-id'])?.v || '0.0.0.0', 16)}${pad('0.0.0.0', 16)}${lpad(CORE[ifn] && this.adj(ifn) ? 1 : 0, 4)}`);
    }
    return rows.join('\n');
  }
  showVlans(only) {
    const rows = ['', 'Routing instance        VLAN name             Tag          Interfaces'];
    const mem = this.memberships();
    for (const v of this.vlanList()) {
      if (only && v.name !== only) continue;
      rows.push(`default-switch          ${pad(v.name, 22)}${pad(v.id ?? '', 9)}`);
      const list = mem.filter((m) => m.vlan.name === v.name);
      if (!list.length) rows.push(' '.repeat(59));
      for (const m of list) rows.push(' '.repeat(59) + m.ifl + (this.physUp(m.ifd) ? '*' : ''));
    }
    return rows.join('\n');
  }
  showMacs() {
    const rows = [];
    for (const [ifn, h] of Object.entries(HOSTS)) {
      if (!this.physUp(ifn)) continue;
      const m = this.memberships().find((x) => x.ifd === ifn);
      if (m) rows.push(`   ${pad(m.vlan.name, 20)}${pad(h.mac, 20)}D             -   ${pad(m.ifl, 23)}0         0       `);
    }
    return ['MAC flags (S - static MAC, D - dynamic MAC, L - locally learned, P - Persistent static', '           SE - statistics enabled, NM - non configured MAC, R - remote PE MAC, O - ovsdb MAC)', '',
      `Ethernet switching table : ${rows.length} entries, ${rows.length} learned`, 'Routing instance : default-switch',
      '   Vlan                MAC                 MAC         Age    Logical                NH        RTR ', '   name                address             flags              interface              Index     ID', ...rows].join('\n');
  }
  showLldp() {
    const l = this.c(['protocols', 'lldp']);
    if (!l) return '';
    const on = (ifn) => { const all = kid(l, 'interface all'), me = kid(l, `interface ${ifn}`); return (all || me) && !(me && kid(me, 'disable')) && !(all && kid(all, 'disable') && !me); };
    const rows = ['Local Interface    Parent Interface    Chassis Id          Port info          System Name'];
    for (const [ifn, c] of [...Object.entries(CORE), [TRANSIT.if, TRANSIT]]) if (this.physUp(ifn) && on(ifn)) rows.push(`${pad(ifn, 19)}${pad('-', 20)}${pad(c.mac, 20)}${pad(c.port, 19)}${c.name}`);
    return rows.join('\n');
  }
  showCommits() {
    return this.rollbacks.map((r, i) => `${pad(i, 4)}${clock(r.time).junos} by ${r.user} via cli${r.comment ? `\n    ${r.comment}` : ''}`).join('\n');
  }
  showUptime() {
    const c = clock();
    return [`Current time: ${c.junos}`, 'Time Source:  LOCAL CLOCK ', `System booted: ${clock(this.boot).junos} (${ago(this.uptime(), 'junos')} ago)`,
      `Last configured: ${clock(this.rollbacks[0].time).junos} (${ago((Date.now() - this.rollbacks[0].time) / 1000, 'junos')} ago) by ${this.rollbacks[0].user}`].join('\n');
  }
  showVersion() {
    return [`Hostname: ${this.host()}`, 'Model: qfx5110-48s-4c', `Junos: ${VERSION} (simulated)`, '', 'This is a practice simulation, not a real device.'].join('\n');
  }
  ping(dst, a = {}) {
    if (!isIp(dst)) return `ping: cannot resolve ${dst}: Unknown host`;
    const count = a.count || 5;
    const local = this.routes().find((r) => r.proto === 'Local' && r.p === `${dst}/32`);
    let ok = !!local;
    for (const [ifn, c] of Object.entries(CORE)) if (dst === c.ip && this.logicalUp(`${ifn}.0`) && this.addrOf(`${ifn}.0`) === `${c.me}/${c.len}`) ok = true;
    if (Object.values(CORE).some((c) => c.rid === dst) && this.ospfUp()) ok = true;
    if (dst === TRANSIT.ip && this.logicalUp(`${TRANSIT.if}.0`) && this.addrOf(`${TRANSIT.if}.0`) === `${TRANSIT.me}/${TRANSIT.len}`) ok = true;
    if (dst === '172.16.0.1' && this.addrOf('em0.0')) ok = true;
    const steps = [{ t: `PING ${dst} (${dst}): 56 data bytes` }];
    if (a.rapid) steps.push({ t: ok ? '!'.repeat(count) : '.'.repeat(count), ms: ok ? 400 : 1500 });
    else for (let i = 0; i < count; i++) steps.push({ t: ok ? `64 bytes from ${dst}: icmp_seq=${i} ttl=64 time=${(0.8 + ((i * 37) % 10) / 20).toFixed(3)} ms` : `Request timeout for icmp_seq ${i}`, ms: ok ? 300 : 700 });
    steps.push({ t: '' }, { t: `--- ${dst} ping statistics ---` }, { t: `${count} packets transmitted, ${ok ? count : 0} packets received, ${ok ? 0 : 100}% packet loss` });
    if (ok) steps.push({ t: 'round-trip min/avg/max/stddev = 0.781/0.902/1.044/0.093 ms' });
    return { steps };
  }
}
