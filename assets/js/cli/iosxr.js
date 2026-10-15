// Cisco IOS XR on a pretend ASR 9000 PE router. Config mode edits a target config; nothing changes
// until commit, which saves it (with a commit ID you can look back at and roll back). end or exit
// with uncommitted changes asks first, abort throws them away. The world: two core PEs over OSPF and
// LDP, an eBGP customer edge, and pseudowires (l2vpn xconnects) to the other PEs.
import { Device } from './device.js';
import {
  pad, lpad, clone, same, clock, ago, longUptime, isIp, isPrefix, maskLen, lenMask, net, inNet,
  tnode, childLine, childKey, setLine, delKey, insert, parseIndented,
} from './engine.js';

const K = (k, h, more) => ({ k, h, ...more });
const P = (p, h, t, more) => ({ p, h, t, ...more });
const ipT = (s) => (isIp(s) ? [s, 1] : null);
const numT = (lo, hi) => (s) => (/^\d+$/.test(s) && +s >= lo && +s <= hi ? [+s, 1] : null);
const wordT = (s) => [s, 1];
const nameT = (s) => (/^[A-Za-z][\w-]{0,62}$/.test(s) ? [s, 1] : null);
const pfxT = (s) => (isPrefix(s) ? [s, 1] : null);

const TYPES = [
  { name: 'Loopback', abbr: 'Lo', h: 'Loopback interface(s)', re: /^\d{1,4}$/, virtual: true, order: 0 },
  { name: 'MgmtEth', abbr: 'Mg', h: 'Ethernet/IEEE 802.3 interface(s)', re: /^0\/RSP0\/CPU0\/0$/, order: 1 },
  { name: 'TenGigE', abbr: 'Te', h: 'TenGigabitEthernet/IEEE 802.3 interface(s)', re: /^0\/0\/0\/[0-3](\.\d{1,4})?$/, order: 2, bw: 10000000 },
  { name: 'GigabitEthernet', abbr: 'Gi', h: 'GigabitEthernet/IEEE 802.3 interface(s)', re: /^0\/1\/0\/[0-7](\.\d{1,4})?$/, order: 3, bw: 1000000 },
];
const TE = (n) => `TenGigE0/0/0/${n}`;
const GE = (n) => `GigabitEthernet0/1/0/${n}`;
const PORTS = ['MgmtEth0/RSP0/CPU0/0', ...[0, 1, 2, 3].map(TE), ...[0, 1, 2, 3, 4, 5, 6, 7].map(GE)];
const AS = 64500;
// the core: two PEs that know each other, so either link reaches both loopbacks
const CORE = {
  [TE(0)]: { peer: 'lab-pe2', rid: '10.255.1.2', ip: '10.1.12.2', me: '10.1.12.1', len: 30, mtu: 9216 },
  [TE(1)]: { peer: 'lab-pe3', rid: '10.255.1.3', ip: '10.1.13.2', me: '10.1.13.1', len: 30, mtu: 9216 },
};
const PES = { '10.255.1.2': { name: 'lab-pe2', routes: ['10.20.0.0/16'] }, '10.255.1.3': { name: 'lab-pe3', routes: ['10.30.0.0/16'] } };
const CE = { if: GE(0), ip: '192.0.2.1', me: '192.0.2.2', len: 30, as: AS - 4, routes: ['198.51.100.0/24', '203.0.113.0/24'] };
// attachment circuits: who's on the customer ports, what they tag, and where their pseudowire lands
export const XR_ACS = {
  [GE(1)]: { cust: 'CUST-B', vlan: 100, pe: '10.255.1.2', pwid: 100 },
  [GE(2)]: { cust: 'CUST-E', vlan: 200, pe: '10.255.1.3', pwid: 200 },
};
const CABLED = new Set(['MgmtEth0/RSP0/CPU0/0', TE(0), TE(1), GE(0), GE(1), GE(2)]);

const FACTORY = `hostname lab-asr9k
clock timezone CST6CDT America/Chicago
logging console informational
domain name lab.example
interface Loopback0
 ipv4 address 10.255.1.1 255.255.255.255
interface MgmtEth0/RSP0/CPU0/0
 ipv4 address 172.16.0.21 255.255.255.0
interface ${TE(0)}
 description to lab-pe2 Te0/0/0/0
 mtu 9216
 ipv4 address 10.1.12.1 255.255.255.252
interface ${TE(1)}
 description to lab-pe3 Te0/0/0/0
 mtu 9216
 ipv4 address 10.1.13.1 255.255.255.252
interface ${TE(2)}
 shutdown
interface ${TE(3)}
 shutdown
interface ${GE(0)}
 description lab-ce1 (AS 64496)
 ipv4 address 192.0.2.2 255.255.255.252
interface ${GE(1)}
 description CUST-B UNI
interface ${GE(1)}.100 l2transport
 description CUST-B EVPL vlan 100
 encapsulation dot1q 100
 rewrite ingress tag pop 1 symmetric
${[2, 3, 4, 5, 6, 7].map((n) => `interface ${GE(n)}\n shutdown\n`).join('')}route-policy PASS
 pass
router static
 address-family ipv4 unicast
  172.16.100.0/24 172.16.0.1
router ospf CORE
 router-id 10.255.1.1
 area 0
  interface Loopback0
   passive enable
  interface ${TE(0)}
   network point-to-point
  interface ${TE(1)}
   network point-to-point
router bgp ${AS}
 bgp router-id 10.255.1.1
 address-family ipv4 unicast
 neighbor 10.255.1.2
  remote-as ${AS}
  description lab-pe2
  update-source Loopback0
  address-family ipv4 unicast
 neighbor 10.255.1.3
  remote-as ${AS}
  description lab-pe3
  update-source Loopback0
  address-family ipv4 unicast
 neighbor 192.0.2.1
  remote-as 64496
  description lab-ce1
  address-family ipv4 unicast
   route-policy PASS in
   route-policy PASS out
mpls ldp
 router-id 10.255.1.1
 interface ${TE(0)}
 interface ${TE(1)}
l2vpn
 xconnect group EVPL
  p2p CUST-B-100
   interface ${GE(1)}.100
   neighbor ipv4 10.255.1.2 pw-id 100
`;
// a leaf line's identity: setting it again replaces the old one
const LEAVES = ['ipv4 address', 'bgp router-id', 'router-id', 'description', 'mtu', 'remote-as', 'update-source', 'encapsulation', 'rewrite ingress tag',
  'network', 'cost', 'passive', 'hostname', 'domain name', 'clock timezone', 'logging console', 'shutdown', 'next-hop-self'];
export function xrKey(line) {
  const m = line.match(/^route-policy \S+ (in|out)$/);
  if (m) return `route-policy * ${m[1]}`;
  let best = null;
  for (const k of LEAVES) if ((line === k || line.startsWith(k + ' ')) && (!best || k.length > best.length)) best = k;
  return best || line;
}
// lines that open a submode, and so close with a ! even when empty (an attachment circuit inside p2p doesn't)
const isBlock = (l, parent = '') => (/^p2p /.test(parent) && /^interface /.test(l) ? false
  : /^(interface |router |address-family |neighbor |area |mpls ldp|l2vpn|xconnect group |p2p )/.test(l) || /^route-policy \S+$/.test(l));

export class IosXr extends Device {
  constructor() {
    super();
    this.style = 'xr';
    this.user = 'lab';
    this.running = this.factory();
    this.target = null;
    this.failed = null;
    this.commits = this.firstCommits();
    this.mode = 'exec';
    this.ctx = [];
    this.logBuf = [];
    this.G = this.grammar();
    this.snap = this.opSnap();
  }
  get id() { return 'iosxr'; }
  label() { return 'ASR 9000 · IOS XR'; }
  factory() { return parseIndented(FACTORY); }
  firstCommits() {
    return [{ id: 1000000001, user: this.user, time: this.boot - 2 * 86400000, changes: ['!! initial lab build (simulated)'] }];
  }
  motd() {
    return [
      'Simulated practice CLI: a pretend ASR 9000 running IOS XR. Not a real device; nothing here touches a network.',
      'Type ? for help, Tab to complete. In config mode nothing takes effect until you commit; commit saves to this browser.',
      '',
      `User Access Verification`,
      '',
      `Username: ${this.user}`,
      'Password: (simulated)',
      '',
    ].join('\n');
  }

  // ---------------------------------------------------------------- saving
  persist() { return { running: this.running, commits: this.commits.slice(-12) }; }
  restore(d) {
    if (!d || !d.running || !Array.isArray(d.running.k)) return;
    this.running = d.running;
    if (Array.isArray(d.commits) && d.commits.length) this.commits = d.commits;
    this.snap = this.opSnap();
  }
  resetFactory() {
    this.stopTimers();
    this.running = this.factory();
    this.target = null;
    this.commits = this.firstCommits();
    this.mode = 'exec';
    this.ctx = [];
    this.logBuf = [];
    this.boot = Date.now() - this.bootAge() * 1000;
    this.snap = this.opSnap();
  }
  configText() { return this.render(this.running).join('\n') + '\n'; }
  // Paste a config back in: it lands in the target config, to check and commit
  importConfig(text) {
    const tree = parseIndented(text.replace(/^!!.*$/gm, ''));
    tree.k = tree.k.filter((c) => c.l !== 'end-policy' && !/^(Building configuration|RP\/|[A-Z][a-z]{2} [A-Z][a-z]{2} +\d)/.test(c.l));
    if (!tree.k.some((c) => c.l.startsWith('hostname ') || c.l.startsWith('interface '))) return { ok: false, msg: "That doesn't look like an IOS XR config: there are no hostname or interface lines." };
    this.target = tree;
    return { ok: true, msg: 'Loaded into the target config, not committed. Type configure, check it with show configuration, then commit.' };
  }
  dirty() { return !!this.target && !same(this.target, this.running); }

  // ---------------------------------------------------------------- prompt and modes
  host(tree = this.running) { const h = childKey(tree, 'hostname'); return h ? h.l.split(' ')[1] : 'ios'; }
  prompt() {
    const base = `RP/0/RSP0/CPU0:${this.host()}`;
    if (this.mode === 'exec') return base + '#';
    const t = this.ctx[this.ctx.length - 1];
    return `${base}(${t ? t.label : 'config'})#`;
  }
  inConfig() { return this.mode !== 'exec'; }
  root() { return this.mode === 'exec' ? this.G.exec : this.G[this.mode] || this.G.config; }
  at(path, tree = this.target) {
    let n = tree;
    for (const l of path) {
      const parent = n;
      n = childLine(parent, l) || insert(parent, tnode(l), (x) => this.order(x, parent.l));
    }
    return n;
  }
  here() { const t = this.ctx[this.ctx.length - 1]; return this.at(t ? t.path : []); }
  path() { const t = this.ctx[this.ctx.length - 1]; return t ? t.path : []; }
  enter(m, label, line) {
    const path = [...this.path(), line];
    this.at(path);
    this.ctx.push({ m, label, path });
    this.mode = m;
    return '';
  }
  set(line) { setLine(this.here(), xrKey(line), line, (x) => this.order(x, this.here().l)); return ''; }
  unset(key) { delKey(this.here(), key); return ''; }
  order(line, parent = '') {
    const lists = {
      '': ['hostname', 'clock', 'logging', 'domain', 'interface', 'route-policy', 'router static', 'router ospf', 'router bgp', 'mpls ldp', 'l2vpn'],
      interface: ['description', 'mtu', 'ipv4 address', 'encapsulation', 'rewrite', 'shutdown'],
      neighbor: ['remote-as', 'description', 'update-source', 'shutdown', 'address-family'],
      bgp: ['bgp router-id', 'address-family', 'neighbor'],
      ospf: ['router-id', 'area'],
      ldp: ['router-id', 'interface'],
      p2p: ['interface', 'neighbor'],
    };
    const kind = !parent ? '' : /^interface /.test(parent) ? 'interface' : /^neighbor \d/.test(parent) ? 'neighbor' : /^router bgp/.test(parent) ? 'bgp'
      : /^router ospf/.test(parent) ? 'ospf' : /^mpls ldp/.test(parent) ? 'ldp' : /^p2p /.test(parent) ? 'p2p' : null;
    const list = lists[kind];
    if (!list) return 0;
    let best = list.length, len = -1;
    list.forEach((p, i) => { if ((line === p || line.startsWith(p + ' ')) && p.length > len) { best = i; len = p.length; } });
    if (kind === '' && line.startsWith('interface ')) return best + this.ifOrder(line.split(' ')[1]) / 1e12;
    return best;
  }

  // Type a line in a submode that belongs to an enclosing mode, and XR takes it there too
  exec(line) {
    if (this.inConfig() && this.ctx.length && line.trim()) {
      const ok = (r) => !r.err && r.node && typeof (this.negated(r) ? r.node.no : r.node.run) === 'function';
      if (!ok(this.parse(line))) {
        const saved = this.ctx.slice(), mode = this.mode;
        for (let d = saved.length - 1; d >= 0; d--) {
          this.ctx = saved.slice(0, d);
          this.mode = d ? this.ctx[d - 1].m : 'config';
          if (ok(this.parse(line))) return super.exec(line);
        }
        this.ctx = saved;
        this.mode = mode;
      }
    }
    return super.exec(line);
  }
  emit(text, ms) {
    if (text && text.includes('%')) { this.logBuf.push(text); if (this.logBuf.length > 60) this.logBuf.shift(); }
    super.emit(text, ms);
  }
  stamp() { return clock().xr; }

  // ---------------------------------------------------------------- interfaces
  parseIf(toks, i) {
    const tok = toks[i].t;
    let m = tok.match(/^([a-zA-Z-]+)(\d[\w/.]*)$/), typ, num, used = 1;
    if (m) { typ = m[1]; num = m[2]; }
    else if (/^[a-zA-Z-]+$/.test(tok) && toks[i + 1] && /^\d[\w/.]*$/.test(toks[i + 1].t)) { typ = tok; num = toks[i + 1].t; used = 2; }
    else return null;
    const low = typ.toLowerCase();
    const alias = { te: 'TenGigE', tengigabitethernet: 'TenGigE', gi: 'GigabitEthernet', gig: 'GigabitEthernet', lo: 'Loopback', mg: 'MgmtEth' }[low];
    const types = TYPES.filter((x) => x.name.toLowerCase().startsWith(low));
    const T = alias ? TYPES.find((x) => x.name === alias) : types.find((x) => x.name.toLowerCase() === low) || (types.length === 1 ? types[0] : null);
    if (!T) return null;
    num = num.replace(/rsp0/i, 'RSP0').replace(/cpu0/i, 'CPU0');
    if (!T.re.test(num)) return null;
    return [T.name + num, used];
  }
  typeOf(name) { return TYPES.find((x) => name.startsWith(x.name) && /^\d/.test(name.slice(x.name.length))); }
  short(name) { const T = this.typeOf(name); return T ? T.abbr + name.slice(T.name.length) : name; }
  ifOrder(name) {
    const T = this.typeOf(name);
    const nums = (name.slice(T ? T.name.length : 0).match(/\d+/g) || []).map(Number);
    return (T ? T.order : 9) * 1e9 + nums.reduce((a, v) => a * 100 + v, 0);
  }
  ifP(as = 'if', more = {}) {
    return P('IFACE', 'Interface name', (tok, dev, toks, i) => dev.parseIf(toks, i), { as, hints: () => TYPES.map((x) => [x.name, x.h]), full: (v) => v, ...more });
  }
  ifNode(name, tree = this.running) { return tree.k.find((c) => c.l === `interface ${name}` || c.l.startsWith(`interface ${name} `)); }
  ifLines(name, tree = this.running) { const n = this.ifNode(name, tree); return n ? n.k.map((c) => c.l) : []; }
  allIfs(tree = this.running) {
    const names = tree.k.filter((c) => c.l.startsWith('interface ')).map((c) => c.l.split(' ')[1]);
    for (const p of PORTS) if (!names.includes(p)) names.push(p);
    return names.sort((a, b) => this.ifOrder(a) - this.ifOrder(b));
  }
  ifUp(name, tree = this.running) {
    const node = this.ifNode(name, tree);
    if (/^Loopback/.test(name)) return !!node && !this.ifLines(name, tree).includes('shutdown');
    const base = name.split('.')[0];
    const shut = (n) => !this.ifNode(n, tree) && PORTS.includes(n) ? true : this.ifLines(n, tree).includes('shutdown');
    if (name.includes('.')) return !!node && !shut(name) && !shut(base) && CABLED.has(base);
    return !shut(name) && CABLED.has(name);
  }
  ifShut(name, tree = this.running) { return !this.ifNode(name, tree) ? PORTS.includes(name) : this.ifLines(name, tree).includes('shutdown'); }
  ipOf(name, tree = this.running) {
    const l = this.ifLines(name, tree).find((x) => x.startsWith('ipv4 address '));
    if (!l) return null;
    const [, , ip, mask] = l.split(' ');
    return { ip, mask, len: maskLen(mask) };
  }

  // ---------------------------------------------------------------- the world, from the running config
  blk(tree, ...path) {
    let n = tree;
    for (const p of path) { n = n && n.k.find((c) => c.l === p || (p.endsWith('*') && c.l.startsWith(p.slice(0, -1)))); }
    return n;
  }
  ospf(tree = this.running) { return tree.k.find((c) => c.l.startsWith('router ospf ')); }
  ospfIf(name, tree = this.running) {
    const o = this.ospf(tree);
    if (!o) return null;
    for (const a of o.k.filter((c) => c.l.startsWith('area '))) {
      const n = a.k.find((c) => c.l === `interface ${name}`);
      if (n) return { area: a.l.split(' ')[1], lines: n.k.map((c) => c.l) };
    }
    return null;
  }
  mtuOf(name, tree = this.running) { const l = this.ifLines(name, tree).find((x) => x.startsWith('mtu ')); return l ? +l.split(' ')[1] : 1514; }
  // OSPF adjacency on a core link: FULL, EXSTART (MTU mismatch) or null
  adj(link, tree = this.running) {
    const c = CORE[link], o = this.ospfIf(link, tree);
    if (!o || !this.ifUp(link, tree) || !['0', '0.0.0.0'].includes(o.area) || o.lines.some((l) => l === 'passive enable' || l === 'passive')) return null;
    const ip = this.ipOf(link, tree);
    if (!ip || ip.ip !== c.me || ip.len !== c.len) return null;
    if (this.mtuOf(link, tree) !== c.mtu) return 'EXSTART';
    return 'FULL';
  }
  loopReach(rid, tree = this.running) { return Object.keys(CORE).some((l) => this.adj(l, tree) === 'FULL') && !!PES[rid]; }
  bestLink(rid, tree = this.running) {
    const direct = Object.keys(CORE).find((l) => CORE[l].rid === rid && this.adj(l, tree) === 'FULL');
    return direct || Object.keys(CORE).find((l) => this.adj(l, tree) === 'FULL');
  }
  ldpOn(link, tree = this.running) { const m = this.blk(tree, 'mpls ldp'); return !!m && m.k.some((c) => c.l === `interface ${link}`); }
  ldpUp(rid, tree = this.running) {
    if (!this.blk(tree, 'mpls ldp') || !this.loopReach(rid, tree)) return false;
    const link = Object.keys(CORE).find((l) => CORE[l].rid === rid);
    const viaLink = this.ldpOn(link, tree) && this.adj(link, tree) === 'FULL';
    const targeted = this.pws(tree).some((p) => p.peer === rid);
    return viaLink || (targeted && Object.keys(CORE).some((l) => this.ldpOn(l, tree) && this.adj(l, tree) === 'FULL'));
  }
  bgp(tree = this.running) { return tree.k.find((c) => c.l.startsWith('router bgp ')); }
  localAs(tree = this.running) { const b = this.bgp(tree); return b ? +b.l.split(' ')[2] : null; }
  nbrs(tree = this.running) {
    const b = this.bgp(tree);
    if (!b) return [];
    return b.k.filter((c) => /^neighbor \d/.test(c.l)).map((n) => {
      const get = (k) => n.k.find((c) => c.l === k || c.l.startsWith(k + ' '));
      const af = n.k.find((c) => c.l === 'address-family ipv4 unicast');
      const pol = (dir) => { const l = af && af.k.find((c) => c.l.startsWith('route-policy ') && c.l.endsWith(` ${dir}`)); return l ? l.l.split(' ')[1] : null; };
      return {
        ip: n.l.split(' ')[1], node: n, ras: get('remote-as') ? +get('remote-as').l.split(' ')[1] : null,
        desc: get('description') ? get('description').l.slice(12) : '', src: get('update-source') ? get('update-source').l.split(' ')[1] : null,
        shut: !!get('shutdown'), af: !!af, pin: pol('in'), pout: pol('out'),
      };
    });
  }
  policy(name, tree = this.running) { return tree.k.find((c) => c.l === `route-policy ${name}`); }
  passes(name, tree = this.running) { const p = name && this.policy(name, tree); return !!p && p.k.some((c) => /^pass$|^done$/.test(c.l)); }
  // BGP session state and the prefixes it brings
  session(n, tree = this.running) {
    const las = this.localAs(tree);
    let up = false;
    if (n.shut) return { state: 'Idle (Admin)', up: false, pfx: 0 };
    if (PES[n.ip]) up = n.ras === las && las === AS && n.src === 'Loopback0' && this.loopReach(n.ip, tree) && this.ifUp('Loopback0', tree);
    else if (n.ip === CE.ip) { const ip = this.ipOf(CE.if, tree); up = n.ras === CE.as && las === AS && this.ifUp(CE.if, tree) && !!ip && ip.ip === CE.me && ip.len === CE.len; }
    if (!up) return { state: PES[n.ip] || n.ip === CE.ip ? 'Active' : 'Idle', up: false, pfx: 0 };
    const routes = PES[n.ip] ? PES[n.ip].routes : this.passes(n.pin, tree) ? CE.routes : [];
    return { state: 'Established', up: true, pfx: n.af ? routes.length : 0, routes: n.af ? routes : [] };
  }
  pws(tree = this.running) {
    const l = this.blk(tree, 'l2vpn');
    if (!l) return [];
    const out = [];
    for (const g of l.k.filter((c) => c.l.startsWith('xconnect group '))) {
      for (const p of g.k.filter((c) => c.l.startsWith('p2p '))) {
        const ac = p.k.find((c) => c.l.startsWith('interface '));
        const nb = p.k.find((c) => c.l.startsWith('neighbor ipv4 '));
        const w = nb ? nb.l.split(' ') : [];
        out.push({ group: g.l.split(' ')[2], name: p.l.split(' ')[1], ac: ac ? ac.l.split(' ')[1] : null, peer: w[2] || null, pwid: w[4] ? +w[4] : null });
      }
    }
    return out;
  }
  acState(name, tree = this.running) {
    if (!name) return { up: false, why: 'no attachment circuit' };
    const node = this.ifNode(name, tree);
    if (!node || !/ l2transport$/.test(node.l)) return { up: false, why: `${name} is not an l2transport interface` };
    if (!this.ifUp(name, tree)) return { up: false, why: `${name} is down` };
    const w = XR_ACS[name.split('.')[0]];
    const enc = this.ifLines(name, tree).find((l) => l.startsWith('encapsulation dot1q '));
    if (!w || !enc || +enc.split(' ')[2] !== w.vlan) return { up: false, why: `${name} doesn't match the customer's VLAN` };
    return { up: true, w };
  }
  xc(p, tree = this.running) {
    const ac = this.acState(p.ac, tree);
    const w = p.ac ? XR_ACS[p.ac.split('.')[0]] : null;
    const pwUp = !!p.peer && !!w && p.peer === w.pe && p.pwid === w.pwid && this.ldpUp(p.peer, tree);
    return { ac: ac.up, pw: pwUp, up: ac.up && pwUp, why: !ac.up ? ac.why : !pwUp ? (!w || p.peer !== w.pe ? 'the pseudowire points at the wrong PE' : p.pwid !== w.pwid ? 'the pw-id does not match the far end' : 'no LDP session to the far end') : '' };
  }
  opSnap(tree = this.running) {
    const links = {}, adj = {}, bgp = {}, ldp = {}, pw = {};
    for (const n of this.allIfs(tree)) links[n] = this.ifUp(n, tree);
    for (const l of Object.keys(CORE)) adj[l] = this.adj(l, tree);
    for (const n of this.nbrs(tree)) bgp[n.ip] = this.session(n, tree).up;
    for (const rid of Object.keys(PES)) ldp[rid] = this.ldpUp(rid, tree);
    for (const p of this.pws(tree)) pw[`${p.peer}:${p.pwid}`] = this.xc(p, tree).up;
    return { links, adj, bgp, ldp, pw };
  }
  logChanges() {
    const was = this.snap, now = (this.snap = this.opSnap());
    const t = () => clock().log;
    const say = (who, text, ms) => this.emit(`${who}:${t()}: ${text}`, ms);
    for (const [n, up] of Object.entries(now.links)) {
      if (was.links[n] === undefined || was.links[n] === up || /^Loopback/.test(n)) continue;
      say('LC/0/0/CPU0', `ifmgr[215]: %PKT_INFRA-LINK-3-UPDOWN : Interface ${n}, changed state to ${up ? 'Up' : 'Down'}`, 900);
      say('LC/0/0/CPU0', `ifmgr[215]: %PKT_INFRA-LINEPROTO-5-UPDOWN : Line protocol on Interface ${n}, changed state to ${up ? 'Up' : 'Down'}`, 1200);
    }
    for (const [l, st] of Object.entries(now.adj)) {
      if (was.adj[l] === st) continue;
      const rid = CORE[l].rid, name = (this.ospf() || { l: 'router ospf CORE' }).l.split(' ')[2];
      if (st === 'FULL') say('RP/0/RSP0/CPU0', `ospf[1018]: %ROUTING-OSPF-5-ADJCHG : Process ${name}, Nbr ${rid} on ${l} in area 0 from LOADING to FULL, Loading Done, vrf default vrfid 0x60000000`, 2600);
      else if (was.adj[l] === 'FULL') say('RP/0/RSP0/CPU0', `ospf[1018]: %ROUTING-OSPF-5-ADJCHG : Process ${name}, Nbr ${rid} on ${l} in area 0 from FULL to DOWN, Neighbor Down: ${st === 'EXSTART' ? 'too many retransmissions' : 'interface down or detached'},vrf default vrfid 0x60000000`, 1500);
    }
    for (const [rid, up] of Object.entries(now.ldp)) {
      if (was.ldp[rid] === up) continue;
      say('RP/0/RSP0/CPU0', `mpls_ldp[1180]: %ROUTING-LDP-5-NBR_CHANGE : Neighbor ${rid}:0, ${up ? 'UP' : 'DOWN'} (IPv4, VRF: default)`, 3000);
    }
    for (const [ip, up] of Object.entries(now.bgp)) {
      if (was.bgp[ip] === up || (was.bgp[ip] === undefined && !up)) continue;
      const n = this.nbrs().find((x) => x.ip === ip);
      const as = n ? n.ras : '';
      say('RP/0/RSP0/CPU0', `bgp[1060]: %ROUTING-BGP-5-ADJCHANGE : neighbor ${ip} ${up ? 'Up' : n && n.shut ? 'Down - Admin. shutdown (CEASE notification sent - administrative shutdown)' : 'Down - Peer closing down the session'} (VRF: default) (AS: ${as})`, up ? 4200 : 1800);
    }
    for (const [k, up] of Object.entries(now.pw)) {
      if (was.pw[k] === up) continue;
      const [peer, id] = k.split(':');
      say('RP/0/RSP0/CPU0', `l2vpn_mgr[1205]: %L2-L2VPN_PW-3-UPDOWN : Pseudowire with address ${peer}, id ${id}, state is ${up ? 'Up' : 'Down'}`, up ? 4800 : 2000);
    }
  }

  // ---------------------------------------------------------------- rendering
  render(tree) {
    const out = [];
    const walkN = (n, d) => {
      for (const c of n.k) {
        out.push(' '.repeat(d) + c.l);
        if (d === 0 && c.l.startsWith('route-policy ')) {
          for (const k of c.k) out.push('  ' + k.l);
          out.push('end-policy', '!');
          continue;
        }
        if (c.k.length || isBlock(c.l, n.l)) { walkN(c, d + 1); out.push(' '.repeat(d) + '!'); }
      }
    };
    walkN(tree, 0);
    return out;
  }
  // what changed between two trees, the way XR prints a target config: new lines, and no-lines for removals
  diff(a, b) {
    const out = [];
    const rec = (x, y, d) => {
      const ind = ' '.repeat(d);
      const yKeys = new Set(y.k.filter((c) => !c.k.length && !isBlock(c.l, y.l)).map((c) => xrKey(c.l)));
      for (const cb of y.k) {
        const ca = x.k.find((c) => c.l === cb.l);
        if (!ca) {
          out.push(ind + cb.l);
          if (cb.l.startsWith('route-policy ') && d === 0) { for (const k of cb.k) out.push('  ' + k.l); out.push('end-policy'); continue; }
          const sub = (n, dd) => { for (const k of n.k) { out.push(' '.repeat(dd) + k.l); if (k.k.length || isBlock(k.l, n.l)) { sub(k, dd + 1); out.push(' '.repeat(dd) + '!'); } } };
          if (cb.k.length || isBlock(cb.l, y.l)) { sub(cb, d + 1); out.push(ind + '!'); }
        } else if (cb.k.length || ca.k.length || isBlock(cb.l, y.l)) {
          if (cb.l.startsWith('route-policy ') && d === 0) {
            if (!same(ca.k, cb.k)) { out.push(ind + cb.l, ...cb.k.map((k) => '  ' + k.l), 'end-policy'); }
            continue;
          }
          const mark = out.length;
          rec(ca, cb, d + 1);
          if (out.length > mark) { out.splice(mark, 0, ind + cb.l); out.push(ind + '!'); }
        }
      }
      for (const ca of x.k) {
        if (y.k.some((c) => c.l === ca.l)) continue;
        if (!ca.k.length && !isBlock(ca.l, x.l) && yKeys.has(xrKey(ca.l))) continue;
        out.push(ind + 'no ' + ca.l);
      }
    };
    rec(a, b, 0);
    return out;
  }

  // ---------------------------------------------------------------- the grammar
  grammar() {
    const dev = this;
    const show = K('show', 'Show commands', { pipe: true, c: (d) => d.showTree() });
    const exec = [
      K('configure', 'Enter configuration mode', {
        run() { return this.confT(); },
        c: [K('exclusive', 'Configure exclusively from this terminal', { run() { return this.confT(); } }), K('terminal', 'Configure from the terminal', { run() { return this.confT(); } })],
      }),
      K('exit', 'Exit from the EXEC', { run() { return { out: '', relogin: true }; } }),
      K('ping', 'Send echo messages', { c: [P('WORD', 'Ping destination address or hostname', wordT, { as: 'dst', run(a) { return this.ping(a.dst); } })] }),
      K('reload', 'Reload the node', { run() { return { ask: { q: 'Proceed with reload? [confirm]', then: (ans) => (/^n/i.test(ans.trim()) ? '' : this.reboot()) } }; } }),
      K('rollback', 'Roll back to a previous configuration', { c: [K('configuration', 'Rollback configuration changes', { c: [
        K('last', 'Rollback the last <n> commits made', { c: [P('<1-100>', 'Number of commits to rollback', numT(1, 100), { as: 'n', run(a) { return this.rollback(a.n); } })] }),
        K('to', 'Rollback up to (and including) a specific commit', { c: [P('<1000000000-2000000000>', 'Commit ID', numT(1000000000, 2000000000), { as: 'id', run(a) { return this.rollbackTo(a.id); } })] }),
      ] })] }),
      show,
      K('terminal', 'Set terminal line parameters', { c: [K('length', 'Set number of lines on a screen', { c: [P('<0-512>', 'Number of lines on screen (0 for no pausing)', numT(0, 512), { run() { return ''; } })] })] }),
    ];
    const common = [
      K('abort', 'Discard all uncommitted changes and exit from configuration mode', { run() { this.target = null; this.ctx = []; this.mode = 'exec'; return ''; } }),
      K('commit', 'Commit the configuration changes to running', {
        run() { return this.commit(); },
        c: [K('comment', 'Assign a comment to this commit', { c: [P('LINE', 'Up to 60 characters of comment', null, { rest: true, as: 'cmt', run(a) { return this.commit(a.cmt); } })] })],
      }),
      K('do', 'Run an exec command', { c: () => dev.G.exec }),
      K('end', 'Exit from configure mode', { run() { return this.leave(); } }),
      K('exit', 'Exit from this submode', { run() {
        if (!this.ctx.length) return this.leave();
        this.ctx.pop();
        this.mode = this.ctx.length ? this.ctx[this.ctx.length - 1].m : 'config';
        return '';
      } }),
      K('root', 'Exit to the global configuration mode', { run() { this.ctx = []; this.mode = 'config'; return ''; } }),
      K('show', 'Show contents of configuration', { pipe: true, c: (d) => d.cfgShow() }),
    ];
    const withNo = (list) => {
      const negs = list.filter((n) => n.no || n.c);
      return [...list, K('no', 'Negate a command or set its defaults', { c: negs }), ...common].sort((a, b) => a.k.localeCompare(b.k));
    };
    const desc = (h = 'Set description for this interface') => K('description', h, {
      c: [P('LINE', 'Description for this interface', null, { rest: true, as: 'text', run(a) { return this.set(`description ${a.text}`); } })],
      no() { return this.unset('description'); },
    });
    const shut = (h = 'shutdown the given interface') => K('shutdown', h, { run() { return this.set('shutdown'); }, no() { return this.unset('shutdown'); } });
    const G = { exec };
    G.config = withNo([
      K('hostname', 'Set system\'s network name', { c: [P('WORD', 'Host name of this router', nameT, { as: 'h', run(a) { return this.set(`hostname ${a.h}`); } })], no() { return this.unset('hostname'); } }),
      K('interface', 'Select an interface to configure', { c: (d) => [d.ifP('if', {
        run(a) { return this.goIf(a.if, false); },
        no(a) { return this.noIf(a.if); },
        c: [K('l2transport', 'Treat as an L2 transport interface', { run(a) { return this.goIf(a.if, true); }, no(a) { return this.noIf(a.if); } })],
      })] }),
      K('l2vpn', 'Configure l2vpn feature', { run() { return this.enter('l2vpn', 'config-l2vpn', 'l2vpn'); }, no() { return this.drop('l2vpn'); } }),
      K('mpls', 'Global MPLS configuration subcommands', { c: [K('ldp', 'Label Distribution Protocol', { run() { return this.enter('ldp', 'config-ldp', 'mpls ldp'); }, no() { return this.drop('mpls ldp'); } })] }),
      K('route-policy', 'Define a route policy', { c: [P('WORD', 'Route policy name', nameT, { as: 'name', run(a) {
        const n = this.at([`route-policy ${a.name}`]);
        n.k = [];
        this.ctx.push({ m: 'rpl', label: 'config-rpl', path: [`route-policy ${a.name}`] });
        this.mode = 'rpl';
        return '';
      }, no(a) { return this.drop(`route-policy ${a.name}`); } })] }),
      K('router', 'Enable a routing process', { c: [
        K('bgp', 'BGP configuration commands', { c: [P('<1-65535>', 'bgp as-number', numT(1, 65535), { as: 'asn', run(a) {
          const b = this.bgp(this.target);
          if (b && b.l !== `router bgp ${a.asn}`) return `% BGP instance 'default' is already running with AS ${b.l.split(' ')[2]}\n`;
          return this.enter('bgp', 'config-bgp', `router bgp ${a.asn}`);
        }, no(a) { return this.drop(`router bgp ${a.asn}`); } })] }),
        K('ospf', 'OSPF configuration subcommands', { c: [P('WORD', 'Name for this OSPF process', nameT, { as: 'p', run(a) { return this.enter('ospf', 'config-ospf', `router ospf ${a.p}`); }, no(a) { return this.drop(`router ospf ${a.p}`); } })] }),
        K('static', 'Static route configuration subcommands', { run() { return this.enter('static', 'config-static', 'router static'); }, no() { return this.drop('router static'); } }),
      ] }),
    ]);
    G.if = withNo([
      desc(),
      K('encapsulation', 'Specify encapsulation type', { c: [K('dot1q', 'IEEE 802.1Q VLAN-tagged packets', { c: [P('<1-4094>', 'Configure first (outer) VLAN ID on the subinterface', numT(1, 4094), { as: 'v', run(a) { return this.set(`encapsulation dot1q ${a.v}`); } })] })], no() { return this.unset('encapsulation'); } }),
      K('ipv4', 'Interface IPv4 config commands', { c: [K('address', 'Set the IPv4 address of an interface', {
        c: [P('A.B.C.D', 'IPv4 address', ipT, { as: 'ip', c: [
          P('A.B.C.D', 'IPv4 subnet mask', (s) => (maskLen(s) >= 0 ? [s, 1] : null), { as: 'mask', run(a) { return this.setIp(a.ip, a.mask); } }),
          P('/prefix-length', 'Prefix length, for example /30', (s) => (/^\/\d{1,2}$/.test(s) && +s.slice(1) <= 32 ? [s, 1] : null), { as: 'len', run(a) { return this.setIp(a.ip, lenMask(+a.len.slice(1))); } }),
        ] }), P('A.B.C.D/prefix', 'IPv4 address and prefix length', pfxT, { as: 'pfx', run(a) { const [ip, l] = a.pfx.split('/'); return this.setIp(ip, lenMask(+l)); } })],
        no() { return this.unset('ipv4 address'); },
      })] }),
      K('mtu', 'Set the MTU on an interface', { c: [P('<64-65535>', 'MTU size in bytes', numT(64, 65535), { as: 'mtu', run(a) { return this.set(`mtu ${a.mtu}`); } })], no() { return this.unset('mtu'); } }),
      shut(),
    ]);
    G.subif = withNo([
      desc(),
      K('encapsulation', 'Specify encapsulation type', { c: [K('dot1q', 'IEEE 802.1Q VLAN-tagged packets', { c: [P('<1-4094>', 'Configure first (outer) VLAN ID on the subinterface', numT(1, 4094), { as: 'v', run(a) { return this.set(`encapsulation dot1q ${a.v}`); } })] })], no() { return this.unset('encapsulation'); } }),
      K('rewrite', 'Set up rewrite of the packet headers', { c: [K('ingress', 'Set the ingress rewrite', { c: [K('tag', 'Rewrite the VLAN tags', { c: [K('pop', 'Remove one or more tags', { c: [P('<1-2>', 'Number of tags to pop', numT(1, 2), { as: 'n', c: [K('symmetric', 'All rewrites must be symmetric', { run(a) { return this.set(`rewrite ingress tag pop ${a.n} symmetric`); } })] })] })] })] })], no() { return this.unset('rewrite ingress tag'); } }),
      shut(),
    ]);
    G.static = withNo([K('address-family', 'Enter an address family', { c: [K('ipv4', 'IPv4 address family', { c: [K('unicast', 'Unicast topology', { run() { return this.enter('static-afi', 'config-static-afi', 'address-family ipv4 unicast'); } })] })] })]);
    G['static-afi'] = withNo([P('A.B.C.D/length', 'Destination prefix', pfxT, { as: 'pfx', c: [P('A.B.C.D', 'Forwarding router\'s address', ipT, { as: 'nh',
      run(a) { const l = `${a.pfx} ${a.nh}`; if (!childLine(this.here(), l)) this.here().k.push(tnode(l)); return ''; },
      no(a) { const n = this.here(); n.k = n.k.filter((c) => c.l !== `${a.pfx} ${a.nh}`); return ''; },
    })], no(a) { const n = this.here(); n.k = n.k.filter((c) => !c.l.startsWith(a.pfx + ' ')); return ''; } })]);
    G.ospf = withNo([
      K('area', 'Enter the OSPF area configuration submode', { c: [P('<0-4294967295>', 'OSPF area ID as a decimal value, or A.B.C.D', (s) => (/^\d+$/.test(s) || isIp(s) ? [s, 1] : null), { as: 'area', run(a) { return this.enter('ospf-ar', 'config-ospf-ar', `area ${a.area}`); }, no(a) { const n = this.here(); n.k = n.k.filter((c) => c.l !== `area ${a.area}`); return ''; } })] }),
      K('router-id', 'configure this node', { c: [P('A.B.C.D', 'OSPF router-id in IP address format', ipT, { as: 'rid', run(a) { return this.set(`router-id ${a.rid}`); } })], no() { return this.unset('router-id'); } }),
    ]);
    G['ospf-ar'] = withNo([K('interface', 'Enable routing on an interface ', { c: (d) => [d.ifP('if', { run(a) { return this.enter('ospf-ar-if', 'config-ospf-ar-if', `interface ${a.if}`); }, no(a) { const n = this.here(); n.k = n.k.filter((c) => c.l !== `interface ${a.if}`); return ''; } })] })]);
    G['ospf-ar-if'] = withNo([
      K('cost', 'Interface cost', { c: [P('<1-65535>', 'Cost', numT(1, 65535), { as: 'c', run(a) { return this.set(`cost ${a.c}`); } })], no() { return this.unset('cost'); } }),
      K('network', 'Network type', { c: [
        K('broadcast', 'Specify OSPF broadcast multi-access network', { run() { return this.set('network broadcast'); } }),
        K('point-to-point', 'Specify OSPF point-to-point network', { run() { return this.set('network point-to-point'); } }),
      ], no() { return this.unset('network'); } }),
      K('passive', 'Enable/disable passive', { run() { return this.set('passive enable'); }, no() { return this.unset('passive'); }, c: [
        K('disable', 'Disable passive', { run() { return this.set('passive disable'); } }),
        K('enable', 'Enable passive', { run() { return this.set('passive enable'); } }),
      ] }),
    ]);
    G.bgp = withNo([
      K('address-family', 'Enter Address Family command mode', { c: [K('ipv4', 'Address Family modifier', { c: [K('unicast', 'Address Family modifier', { run() { return this.enter('bgp-af', 'config-bgp-af', 'address-family ipv4 unicast'); }, no() { const n = this.here(); n.k = n.k.filter((c) => c.l !== 'address-family ipv4 unicast'); return ''; } })] })] }),
      K('bgp', 'BGP commands', { c: [K('router-id', 'Configure Router-id', { c: [P('A.B.C.D', 'Manually configured router identifier', ipT, { as: 'rid', run(a) { return this.set(`bgp router-id ${a.rid}`); } })], no() { return this.unset('bgp router-id'); } })] }),
      K('neighbor', 'Specify a neighbor router', { c: [P('A.B.C.D', 'IPv4 neighbor address', ipT, { as: 'ip', run(a) { return this.enter('bgp-nbr', 'config-bgp-nbr', `neighbor ${a.ip}`); }, no(a) { const n = this.here(); n.k = n.k.filter((c) => c.l !== `neighbor ${a.ip}`); return ''; } })] }),
    ]);
    G['bgp-af'] = withNo([K('network', 'Specify a network to announce via BGP', { c: [P('A.B.C.D/length', 'IPv4 network and mask or masklength', pfxT, { as: 'pfx', run(a) { if (!childLine(this.here(), `network ${a.pfx}`)) this.here().k.push(tnode(`network ${a.pfx}`)); return ''; }, no(a) { const n = this.here(); n.k = n.k.filter((c) => c.l !== `network ${a.pfx}`); return ''; } })] })]);
    G['bgp-nbr'] = withNo([
      K('address-family', 'Enter Address Family command mode', { c: [K('ipv4', 'Address Family modifier', { c: [K('unicast', 'Address Family modifier', { run() { return this.enter('bgp-nbr-af', 'config-bgp-nbr-af', 'address-family ipv4 unicast'); }, no() { const n = this.here(); n.k = n.k.filter((c) => c.l !== 'address-family ipv4 unicast'); return ''; } })] })] }),
      desc('Neighbor specific description'),
      K('remote-as', 'Set remote AS', { c: [P('<1-65535>', 'AS number', numT(1, 65535), { as: 'ras', run(a) { return this.set(`remote-as ${a.ras}`); } })], no() { return this.unset('remote-as'); } }),
      shut('Administratively shut down this neighbor'),
      K('update-source', 'Source of routing updates', { c: [this.ifP('if', { run(a) { return this.set(`update-source ${a.if}`); } })], no() { return this.unset('update-source'); } }),
    ]);
    G['bgp-nbr-af'] = withNo([
      K('next-hop-self', 'Disable the next hop calculation for this neighbor', { run() { return this.set('next-hop-self'); }, no() { return this.unset('next-hop-self'); } }),
      K('route-policy', 'Apply route policy to neighbor', { c: [P('WORD', 'Name of route policy', nameT, { as: 'pol', c: [
        K('in', 'Apply route policy to inbound routes', { run(a) { return this.set(`route-policy ${a.pol} in`); }, no(a) { return this.unset(`route-policy ${a.pol} in`); } }),
        K('out', 'Apply route policy to outbound routes', { run(a) { return this.set(`route-policy ${a.pol} out`); }, no(a) { return this.unset(`route-policy ${a.pol} out`); } }),
      ] })] }),
    ]);
    G.ldp = withNo([
      K('interface', 'Enable LDP on an interface and enter interface submode', { c: [this.ifP('if', { run(a) { return this.enter('ldp-if', 'config-ldp-if', `interface ${a.if}`); }, no(a) { const n = this.here(); n.k = n.k.filter((c) => c.l !== `interface ${a.if}`); return ''; } })] }),
      K('router-id', 'Configure router Id', { c: [P('A.B.C.D', 'LDP Router Id (IP address)', ipT, { as: 'rid', run(a) { return this.set(`router-id ${a.rid}`); } })], no() { return this.unset('router-id'); } }),
    ]);
    G['ldp-if'] = withNo([]);
    G.l2vpn = withNo([K('xconnect', 'Configure a cross connect', { c: [K('group', 'Specify the group the cross connects belong to', { c: [P('WORD', 'Cross connect group name', nameT, { as: 'g', run(a) { return this.enter('xc', 'config-l2vpn-xc', `xconnect group ${a.g}`); }, no(a) { const n = this.here(); n.k = n.k.filter((c) => c.l !== `xconnect group ${a.g}`); return ''; } })] })] })]);
    G.xc = withNo([K('p2p', 'Configure point to point cross connect commands', { c: [P('WORD', 'Name of the point to point xconnect', nameT, { as: 'x', run(a) { return this.enter('p2p', 'config-l2vpn-xc-p2p', `p2p ${a.x}`); }, no(a) { const n = this.here(); n.k = n.k.filter((c) => c.l !== `p2p ${a.x}`); return ''; } })] })]);
    G.p2p = withNo([
      K('interface', 'Specify (sub-)interface name to cross connect', { c: [this.ifP('if', {
        run(a) { const n = this.here(); n.k = n.k.filter((c) => !c.l.startsWith('interface ')); insert(n, tnode(`interface ${a.if}`), (x) => this.order(x, n.l)); return ''; },
        no(a) { const n = this.here(); n.k = n.k.filter((c) => c.l !== `interface ${a.if}`); return ''; },
      })] }),
      K('neighbor', 'Specify the peer to cross connect', { c: [K('ipv4', 'Specify the IPv4 address of the peer', { c: [P('A.B.C.D', 'IPv4 address of the peer', ipT, { as: 'peer', c: [K('pw-id', 'Specify the pseudowire id', { c: [P('<1-4294967295>', 'Pseudowire ID', numT(1, 4294967295), { as: 'id',
        run(a) { const n = this.here(); n.k = n.k.filter((c) => !c.l.startsWith('neighbor ')); return this.enter('pw', 'config-l2vpn-xc-p2p-pw', `neighbor ipv4 ${a.peer} pw-id ${a.id}`); },
        no(a) { const n = this.here(); n.k = n.k.filter((c) => c.l !== `neighbor ipv4 ${a.peer} pw-id ${a.id}`); return ''; },
      })] })] })] })] }),
    ]);
    G.pw = withNo([]);
    G.rpl = [
      K('done', 'Accept this route and stop', { run() { this.here().k.push(tnode('done')); return ''; } }),
      K('drop', 'Reject this route', { run() { this.here().k.push(tnode('drop')); return ''; } }),
      K('end-policy', 'End of route-policy definition', { run() { this.ctx.pop(); this.mode = this.ctx.length ? this.ctx[this.ctx.length - 1].m : 'config'; return ''; } }),
      K('pass', 'Pass this route for further processing', { run() { this.here().k.push(tnode('pass')); return ''; } }),
    ];
    return G;
  }

  confT() {
    this.mode = 'config';
    this.ctx = [];
    if (!this.target) this.target = clone(this.running);
    return this.stamp();
  }
  ctrlZ() { return this.inConfig() ? this.leave() : null; }
  leave() {
    if (!this.dirty()) { this.target = null; this.ctx = []; this.mode = 'exec'; return ''; }
    return { ask: { q: 'Uncommitted changes found, commit them before exiting(yes/no/cancel)? [cancel]:', then: (ans) => {
      const a = ans.trim().toLowerCase();
      if (a.startsWith('y')) { const r = this.commit(); if (this.failed) return r; this.ctx = []; this.mode = 'exec'; return r; }
      if (a.startsWith('n')) { this.target = null; this.ctx = []; this.mode = 'exec'; return ''; }
      return '';
    } } };
  }
  goIf(name, l2) {
    const sub = name.includes('.');
    const T = this.typeOf(name);
    if (!sub && T && !T.virtual && !PORTS.includes(name)) return "% Invalid input detected at '^' marker.\n";
    const line = l2 ? `interface ${name} l2transport` : `interface ${name}`;
    const existing = this.ifNode(name, this.target);
    if (existing && existing.l !== line && sub) return `% ${name} is already configured as ${/l2transport/.test(existing.l) ? 'an l2transport' : 'a layer 3'} subinterface\n`;
    this.at([existing ? existing.l : line]);
    this.ctx = [{ m: sub && (l2 || /l2transport/.test((existing || {}).l || '')) ? 'subif' : 'if', label: sub ? 'config-subif' : 'config-if', path: [existing ? existing.l : line] }];
    this.mode = this.ctx[0].m;
    return '';
  }
  noIf(name) {
    const n = this.ifNode(name, this.target);
    if (!n) return '';
    if (PORTS.includes(name)) { n.k = [tnode('shutdown')]; return ''; }
    this.target.k = this.target.k.filter((c) => c !== n);
    return '';
  }
  drop(line) { const n = this.ctx.length ? this.here() : this.target; n.k = n.k.filter((c) => c.l !== line); return ''; }
  setIp(ip, mask) {
    const len = maskLen(mask);
    const me = this.path()[0].split(' ')[1];
    for (const other of this.allIfs(this.target)) {
      const o = this.ipOf(other, this.target);
      if (other !== me && o && inNet(ip, o.ip, Math.min(o.len, len))) return `!!% ${ip} overlaps with ${other} (${o.ip}/${o.len}) (the commit would fail)\n`;
    }
    return this.set(`ipv4 address ${ip} ${mask}`);
  }

  // ---------------------------------------------------------------- commit, rollback
  validate(tree) {
    const errs = [];
    for (const n of this.nbrs(tree)) {
      if (n.ras == null) errs.push({ ctx: [`router bgp ${this.localAs(tree)}`, ` neighbor ${n.ip}`], msg: `!!% Neighbor ${n.ip}: remote-as must be configured` });
      for (const p of [n.pin, n.pout]) if (p && !this.policy(p, tree)) errs.push({ ctx: [`router bgp ${this.localAs(tree)}`, ` neighbor ${n.ip}`, '  address-family ipv4 unicast'], msg: `!!% Policy [${p}] is not defined` });
    }
    return errs;
  }
  commit(comment) {
    if (!this.target || same(this.target, this.running)) return `${this.stamp()}\n% No configuration changes to commit.`;
    const errs = this.validate(this.target);
    if (errs.length) {
      this.failed = errs;
      return `${this.stamp()}\n\n% Failed to commit one or more configuration items during a pseudo-atomic operation. All changes made have been reverted. Please issue 'show configuration failed [inheritance]' from this session to view the errors\n`;
    }
    this.failed = null;
    const changes = this.diff(this.running, this.target);
    const id = this.commits[this.commits.length - 1].id + 1;
    this.commits.push({ id, user: this.user, time: Date.now(), comment, changes, before: clone(this.running) });
    for (const c of this.commits.slice(0, -5)) delete c.before;
    this.running = clone(this.target);
    if (this.onSave) this.onSave();
    this.emit(`RP/0/RSP0/CPU0:${clock().log}: config[67216]: %MGBL-CONFIG-6-DB_COMMIT : Configuration committed by user '${this.user}'. Use 'show configuration commit changes ${id}' to view the changes. `, 500);
    this.logChanges();
    return this.stamp();
  }
  rollback(n) {
    const list = this.commits.slice(-n);
    if (n >= this.commits.length || !list[0].before) return `${this.stamp()}\n% Rollback to that point is not available in this lab (only commits made here can be rolled back)\n`;
    return this.applyRollback(list[0].before, n);
  }
  rollbackTo(id) {
    const i = this.commits.findIndex((c) => c.id === id);
    if (i < 0) return `${this.stamp()}\n% Commit ID ${id} not found\n`;
    if (!this.commits[i].before) return `${this.stamp()}\n% Rollback to that point is not available in this lab (only commits made here can be rolled back)\n`;
    return this.applyRollback(this.commits[i].before, this.commits.length - i);
  }
  applyRollback(tree, n) {
    if (this.inConfig()) return '% Please exit configuration mode before rolling back\n';
    const changes = this.diff(this.running, tree);
    const id = this.commits[this.commits.length - 1].id + 1;
    this.commits.push({ id, user: this.user, time: Date.now(), comment: `rollback of ${n} commit${n === 1 ? '' : 's'}`, changes, before: clone(this.running) });
    this.running = clone(tree);
    if (this.onSave) this.onSave();
    this.logChanges();
    return { steps: [{ t: this.stamp() }, { t: '', ms: 0 }, { t: 'Loading Rollback Changes.', ms: 200 }, { t: 'Loaded Rollback Changes in 1 sec ', ms: 500 }, { t: 'Committing.', ms: 200 },
      { t: `${Math.max(1, changes.length)} items committed in 1 sec (${Math.max(1, changes.length)})items/sec`, ms: 500 }, { t: 'Updating.', ms: 200 }, { t: 'Updated Commit database in 1 sec ', ms: 400 },
      { t: `Configuration successfully rolled back ${n} commit${n === 1 ? '' : 's'}.`, ms: 200 }] };
  }
  reboot() {
    this.stopTimers();
    this.boot = Date.now();
    this.mode = 'exec';
    this.ctx = [];
    this.target = null;
    this.snap = this.opSnap();
    return { steps: [{ t: '' }, { t: `RP/0/RSP0/CPU0:${clock().log}: reboot[247]: %OS-REBOOT-1-INFO : Reload request by ${this.user}`, ms: 300 },
      { t: 'Preparing system for backup. This may take a few minutes especially for large configurations.', ms: 600 }, { t: '\tStatus report: node0_RSP0_CPU0: START TO BACKUP ', ms: 400 },
      { t: '\tStatus report: node0_RSP0_CPU0: BACKUP HAS COMPLETED SUCCESSFULLY', ms: 600 }, { t: '[Done]', ms: 300 }, { t: '', ms: 300 },
      { t: '(simulated reload: the committed config stays; XR saves every commit)', ms: 400 }, { t: '' }], relogin: true };
  }
  ping(dst) {
    if (!isIp(dst)) return `${this.stamp()}\n% Unrecognized host or address.\n`;
    const own = this.allIfs().some((n) => this.ipOf(n) && this.ipOf(n).ip === dst && this.ifUp(n));
    let ok = own;
    for (const [l, c] of Object.entries(CORE)) if (dst === c.ip && this.ifUp(l) && this.ipOf(l) && this.ipOf(l).ip === c.me) ok = true;
    if (PES[dst] && this.loopReach(dst)) ok = true;
    if (dst === CE.ip && this.ifUp(CE.if) && this.ipOf(CE.if) && this.ipOf(CE.if).ip === CE.me) ok = true;
    if (dst === '172.16.0.1' && this.ipOf('MgmtEth0/RSP0/CPU0/0')) ok = true;
    return { steps: [{ t: this.stamp() }, { t: 'Type escape sequence to abort.' }, { t: `Sending 5, 100-byte ICMP Echos to ${dst}, timeout is 2 seconds:` },
      { t: ok ? '!!!!!' : '.....', ms: ok ? 500 : 2000 }, { t: ok ? 'Success rate is 100 percent (5/5), round-trip min/avg/max = 1/2/4 ms' : 'Success rate is 0 percent (0/5)', ms: 100 }] };
  }

  // ---------------------------------------------------------------- show
  cfgShow() {
    return [
      K('configuration', 'Contents of the non-committed configuration', {
        run() { return this.showTarget(); },
        c: [
          K('failed', 'Display the configuration that failed during the last commit', { run() { return this.showFailed(); } }),
          K('merge', 'Show the merge of running and uncommitted configuration', { run() { return [this.stamp(), 'Building configuration...', '!! IOS XR Configuration 7.9.2', ...this.render(this.target), 'end', ''].join('\n'); } }),
          K('running', 'Show the running configuration', { run() { return [this.stamp(), 'Building configuration...', '!! IOS XR Configuration 7.9.2', ...this.render(this.running), 'end', ''].join('\n'); } }),
        ],
      }),
      K('running-config', 'Current operating configuration', { run(a, x) { return this.showRun(); }, c: this.runSections() }),
    ];
  }
  showTarget() {
    const d = this.diff(this.running, this.target);
    return [this.stamp(), 'Building configuration...', '!! IOS XR Configuration 7.9.2', ...d, 'end', ''].join('\n');
  }
  showFailed() {
    if (!this.failed) return this.stamp();
    return [this.stamp(), '!! SEMANTIC ERRORS: This configuration was rejected by ', '!! the system due to semantic errors. The individual ',
      '!! errors with each failed configuration command can be ', '!! found below.', '', ...this.failed.flatMap((e) => [...e.ctx, e.msg, '!']), 'end', ''].join('\n');
  }
  runSections() {
    const sect = (k, h, match) => K(k, h, { run() { return this.showRun(match); } });
    return [
      K('interface', 'Interface configuration', { run() { return this.showRun((l) => l.startsWith('interface ')); }, c: [this.ifP('if', { run(a) { return this.showRun((l) => l === `interface ${a.if}` || l.startsWith(`interface ${a.if} `)); } })] }),
      sect('l2vpn', 'L2VPN configuration', (l) => l === 'l2vpn'),
      K('mpls', 'MPLS configuration', { c: [sect('ldp', 'LDP configuration', (l) => l === 'mpls ldp')] }),
      sect('route-policy', 'Route policy configuration', (l) => l.startsWith('route-policy ')),
      K('router', 'Routing configuration', { c: [
        sect('bgp', 'BGP configuration', (l) => l.startsWith('router bgp ')),
        sect('ospf', 'OSPF configuration', (l) => l.startsWith('router ospf ')),
        sect('static', 'Static routes', (l) => l === 'router static'),
      ] }),
    ];
  }
  showRun(match) {
    const tree = match ? { l: '', k: this.running.k.filter((c) => match(c.l)) } : this.running;
    const last = this.commits[this.commits.length - 1];
    const head = match ? [this.stamp()] : [this.stamp(), 'Building configuration...', '!! IOS XR Configuration 7.9.2', `!! Last configuration change at ${clock(last.time).long} by ${last.user}`, '!'];
    return [...head, ...this.render(tree), ...(match ? [] : ['end']), ''].join('\n');
  }
  showTree() {
    const dev = this;
    const ifs = () => this.ifP('if');
    return [
      K('bgp', 'BGP information', {
        run() { return this.showBgpTable(); },
        c: [
          K('ipv4', 'Address family', { c: [K('unicast', 'Address Family modifier', { run() { return this.showBgpTable(); }, c: [K('summary', 'Summary of BGP neighbor status', { run() { return this.showBgpSum(); } })] })] }),
          K('neighbor', 'Details about a neighbor', { c: [P('A.B.C.D', 'IPv4 neighbor address', ipT, { as: 'ip', run(a) { return this.showBgpNbr(a.ip); } })] }),
          K('summary', 'Summary of BGP neighbor status', { run() { return this.showBgpSum(); } }),
        ],
      }),
      K('clock', 'Display the system clock', { run() { return `${this.stamp()}\n${clock().hms}.${clock().ms} ${clock().tz} ${clock().p.weekday} ${clock().p.month} ${clock().p.day} ${clock().p.year}`; } }),
      K('configuration', 'Contents of commit database', { c: [K('commit', 'Show commit information', { c: [
        K('changes', 'Display the configuration changes for a commit', { c: [
          K('last', 'Changes made in the most recent <n> commits', { c: [P('<1-100>', 'Number of commits', numT(1, 100), { as: 'n', run(a) { return this.showChanges(this.commits.slice(-a.n)); } })] }),
          P('<1000000000-2000000000>', 'Commit ID', numT(1000000000, 2000000000), { as: 'id', run(a) { return this.showChanges(this.commits.filter((c) => c.id === a.id)); } }),
        ] }),
        K('list', 'List the commit IDs available for rollback', { run() { return this.showCommitList(); } }),
      ] })] }),
      K('history', 'Display the session command history', { run() { return this.stamp() + '\n' + this.history.slice(-20).join('\n'); } }),
      K('interfaces', 'Interface status and configuration', {
        run() { return this.allIfs().map((n) => this.showIfDetail(n)).join('\n'); },
        c: [
          K('brief', 'Brief information of interfaces', { run() { return this.showIfBrief(); } }),
          K('description', 'Interface description', { run() { return this.showIfDesc(); } }),
          ifs(),
        ].map((n) => (n.p ? { ...n, run(a) { return this.showIfDetail(a.if); } } : n)),
      }),
      K('ip', 'IP information', { c: [K('interface', 'IP interface status and configuration', { c: [K('brief', 'Brief summary of IP status and configuration', { run() { return this.showIpBrief(); } })] })] }),
      K('ipv4', 'IPv4 information', { c: [K('interface', 'IPv4 interface status and configuration', { c: [K('brief', 'Brief summary of IPv4 status and configuration', { run() { return this.showIpBrief(); } })] })] }),
      K('l2vpn', 'L2VPN show commands', { c: [K('xconnect', 'Show cross connect information', {
        run() { return this.showXc(false); },
        c: [K('detail', 'Detailed information', { run() { return this.showXc(true); } }), K('group', 'Display all cross connects in a specified group', { c: [P('WORD', 'Group name', wordT, { as: 'g', run(a) { return this.showXc(false, a.g); } })] })],
      })] }),
      K('logging', 'Show the contents of logging buffers', { run() { return [this.stamp(), 'Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)', '    Console logging: level informational', '', 'Log Buffer (2097152 bytes):', '', ...this.logBuf].join('\n'); } }),
      K('mpls', 'Show MPLS information', { c: [K('ldp', 'Show LDP information', { c: [K('neighbor', 'Neighbor information', { run() { return this.showLdp(false); }, c: [K('brief', 'Brief information', { run() { return this.showLdp(true); } })] })] })] }),
      K('ospf', 'OSPF information', { c: [K('neighbor', 'Neighbor list', { run() { return this.showOspfNbr(); } })] }),
      K('platform', 'Show platform information', { run() { return this.showPlatform(); } }),
      K('route', 'IP routing information', {
        run() { return this.showRoute(); },
        c: [
          K('ipv4', 'IPv4 Address Family', { run() { return this.showRoute(); }, c: [
            ...['bgp', 'connected', 'local', 'ospf', 'static'].map((p) => K(p, `${p} routes`, { run() { return this.showRoute(p); } })),
            K('summary', 'Summary of routes', { run() { return this.showRouteSum(); } }),
          ] }),
          ...['bgp', 'connected', 'local', 'ospf', 'static'].map((p) => K(p, `${p} routes`, { run() { return this.showRoute(p); } })),
          K('summary', 'Summary of routes', { run() { return this.showRouteSum(); } }),
          P('A.B.C.D', 'Network to display information about', ipT, { as: 'ip', run(a) { return this.showRoute(null, a.ip); } }),
          P('A.B.C.D/length', 'Prefix to display information about', pfxT, { as: 'pfx', run(a) { return this.showRoute(null, a.pfx); } }),
        ],
      }),
      K('running-config', 'Current operating configuration', { run() { return this.showRun(); }, c: this.runSections() }),
      K('version', 'Software (/hardware) information', { run() { return this.showVersion(); } }),
    ];
  }
  showChanges(list) {
    if (!list.length) return `${this.stamp()}\n% No such configuration commit`;
    return [this.stamp(), 'Building configuration...', '!! IOS XR Configuration 7.9.2', ...list.flatMap((c) => c.changes), 'end', ''].join('\n');
  }
  showCommitList() {
    const rows = [...this.commits].reverse().map((c, i) => `${pad(i + 1, 5)}${pad(c.id, 22)}${pad(c.user, 10)}${pad('vty0:node0_RSP0_CPU0', 21)}${pad('CLI', 12)}${clock(c.time).long}`);
    return [this.stamp(), 'SNo. Label/ID              User      Line                Client      Time Stamp', '~~~~ ~~~~~~~~              ~~~~      ~~~~                ~~~~~~      ~~~~~~~~~~', ...rows].join('\n');
  }
  ifStatus(n) { return this.ifShut(n) ? 'Shutdown' : this.ifUp(n) ? 'Up' : 'Down'; }
  showIpBrief() {
    const rows = [this.stamp(), '', pad('Interface', 31) + pad('IP-Address', 16) + pad('Status', 16) + pad('Protocol', 9) + 'Vrf-Name'];
    for (const n of this.allIfs()) {
      const ip = this.ipOf(n), st = this.ifStatus(n);
      rows.push(pad(n, 31) + pad(ip ? ip.ip : 'unassigned', 16) + pad(st, 16) + pad(this.ifUp(n) ? 'Up' : 'Down', 9) + 'default ');
    }
    return rows.join('\n');
  }
  showIfBrief() {
    const rows = [this.stamp(), '', '               Intf       Intf        LineP              Encap  MTU        BW', '               Name       State       State               Type (byte)    (Kbps)', '-'.repeat(80)];
    for (const n of this.allIfs()) {
      const T = this.typeOf(n), st = this.ifShut(n) ? 'admin-down' : this.ifUp(n) ? 'up' : 'down';
      const encap = /^Loopback/.test(n) ? 'Loopback' : n.includes('.') ? '802.1Q' : 'ARPA';
      rows.push(lpad(this.short(n), 20) + lpad(st, 13) + lpad(this.ifUp(n) ? 'up' : 'down', 12) + lpad(encap, 19) + lpad(/^Loopback/.test(n) ? 1500 : this.mtuOf(n), 6) + lpad(/^Loopback/.test(n) || !this.ifUp(n) ? 0 : (T && T.bw) || 1000000, 11));
    }
    return rows.join('\n');
  }
  showIfDesc() {
    const rows = [this.stamp(), '', 'Interface          Status      Protocol    Description', '-'.repeat(80)];
    for (const n of this.allIfs()) {
      const d = this.ifLines(n).find((l) => l.startsWith('description '));
      rows.push(pad(this.short(n), 19) + pad(this.ifShut(n) ? 'admin-down' : this.ifUp(n) ? 'up' : 'down', 12) + pad(this.ifUp(n) ? 'up' : 'down', 12) + (d ? d.slice(12) : ''));
    }
    return rows.join('\n');
  }
  showIfDetail(n) {
    const up = this.ifUp(n), shut = this.ifShut(n), ip = this.ipOf(n), d = this.ifLines(n).find((l) => l.startsWith('description '));
    const T = this.typeOf(n), mtu = /^Loopback/.test(n) ? 1500 : this.mtuOf(n);
    const out = [this.stamp(), `${n} is ${shut ? 'administratively down' : up ? 'up' : 'down'}, line protocol is ${up ? 'up' : shut ? 'administratively down' : 'down'} `,
      `  Interface state transitions: ${up ? 1 : 0}`, `  Hardware is ${/^Loopback/.test(n) ? 'Loopback interface(s)' : n.includes('.') ? 'VLAN sub-interface(s)' : T && T.name === 'TenGigE' ? 'TenGigE, address is 0000.5e00.53c1 (bia 0000.5e00.53c1)' : 'GigabitEthernet, address is 0000.5e00.53d1 (bia 0000.5e00.53d1)'}`];
    if (d) out.push(`  Description: ${d.slice(12)}`);
    if (ip) out.push(`  Internet address is ${ip.ip}/${ip.len}`);
    out.push(`  MTU ${mtu} bytes, BW ${/^Loopback/.test(n) ? 0 : (T && T.bw) || 1000000} Kbit (Max: ${(T && T.bw) || 1000000} Kbit)`, '     reliability 255/255, txload 0/255, rxload 0/255',
      `  Encapsulation ${/^Loopback/.test(n) ? 'Loopback' : n.includes('.') ? '802.1Q Virtual LAN' : 'ARPA'},`, '  Last input 00:00:00, output 00:00:00', '  Last clearing of "show interface" counters never',
      `  5 minute input rate ${up ? 182000 : 0} bits/sec, ${up ? 61 : 0} packets/sec`, `  5 minute output rate ${up ? 171000 : 0} bits/sec, ${up ? 58 : 0} packets/sec`);
    return out.join('\n');
  }
  showBgpSum() {
    const b = this.bgp();
    if (!b) return `${this.stamp()}\n% BGP instance 0: 'default' not active`;
    const rid = (b.k.find((c) => c.l.startsWith('bgp router-id ')) || { l: 'x x 10.255.1.1' }).l.split(' ')[2];
    const rows = [this.stamp(), `BGP router identifier ${rid}, local AS number ${this.localAs()}`, 'BGP generic scan interval 60 secs', 'Non-stop routing is enabled', 'BGP table state: Active',
      'Table ID: 0xe0000000   RD version: 42', 'BGP main routing table version 42', 'BGP NSR Initial initsync version 4 (Reached)', 'BGP NSR/ISSU Sync-Group versions 0/0', 'BGP scan interval 60 secs', '',
      'BGP is operating in STANDALONE mode.', '', '',
      'Process       RcvTblVer   bRIB/RIB   LabelVer  ImportVer  SendTblVer  StandbyVer', 'Speaker              42         42         42         42          42           0', '',
      'Neighbor        Spk    AS MsgRcvd MsgSent   TblVer  InQ OutQ  Up/Down  St/PfxRcd'];
    const t = this.uptime();
    for (const n of this.nbrs()) {
      const s = this.session(n);
      const msgs = s.up ? Math.floor(t / 60) + 120 : 0;
      rows.push(pad(n.ip, 16) + lpad(0, 3) + lpad(n.ras || '', 6) + lpad(msgs, 8) + lpad(s.up ? msgs - 2 : 0, 8) + lpad(s.up ? 42 : 0, 9) + lpad(0, 5) + lpad(0, 5) + ' ' + lpad(s.up ? ago(t) : '00:00:00', 8) + ' ' + (s.up ? lpad(s.pfx, 12) : s.state));
    }
    return rows.join('\n');
  }
  bgpRoutes() {
    const out = [];
    for (const n of this.nbrs()) {
      const s = this.session(n);
      if (!s.up) continue;
      for (const r of s.routes || []) out.push({ pfx: r, nh: n.ip, ibgp: !!PES[n.ip], as: n.ras });
    }
    const af = this.bgp() && this.bgp().k.find((c) => c.l === 'address-family ipv4 unicast');
    if (af) for (const c of af.k.filter((x) => x.l.startsWith('network '))) out.push({ pfx: c.l.split(' ')[1], nh: '0.0.0.0', local: true });
    return out.sort((a, b) => a.pfx.localeCompare(b.pfx, undefined, { numeric: true }));
  }
  showBgpTable() {
    const b = this.bgp();
    if (!b) return `${this.stamp()}\n% BGP instance 0: 'default' not active`;
    const rows = this.bgpRoutes();
    return [this.stamp(), `BGP router identifier 10.255.1.1, local AS number ${this.localAs()}`, 'BGP generic scan interval 60 secs', 'Non-stop routing is enabled', 'BGP table state: Active',
      'Table ID: 0xe0000000   RD version: 42', 'BGP main routing table version 42', 'BGP NSR Initial initsync version 4 (Reached)', 'BGP NSR/ISSU Sync-Group versions 0/0', 'BGP scan interval 60 secs', '',
      'Status codes: s suppressed, d damped, h history, * valid, > best', '              i - internal, r RIB-failure, S stale, N Nexthop-discard', 'Origin codes: i - IGP, e - EGP, ? - incomplete',
      '   Network            Next Hop            Metric LocPrf Weight Path',
      ...rows.map((r) => `*>${r.ibgp ? 'i' : ' '}${pad(r.pfx, 19)}${pad(r.nh, 20)}${lpad(0, 6)}${lpad(r.ibgp ? 100 : '', 7)}${lpad(r.local ? 32768 : 0, 7)} ${r.ibgp || r.local ? 'i' : `${r.as} i`}`),
      '', `Processed ${rows.length} prefixes, ${rows.length} paths`].join('\n');
  }
  showBgpNbr(ip) {
    const n = this.nbrs().find((x) => x.ip === ip);
    if (!n) return `${this.stamp()}\n\n% No such neighbor\n`;
    const s = this.session(n), ext = n.ras !== this.localAs();
    const out = [this.stamp(), '', `BGP neighbor is ${ip}`, ` Remote AS ${n.ras}, local AS ${this.localAs()}, ${ext ? 'external' : 'internal'} link`];
    if (n.desc) out.push(` Description: ${n.desc}`);
    out.push(` Remote router ID ${s.up ? (PES[ip] ? ip : '192.0.2.1') : '0.0.0.0'}`, `  BGP state = ${s.state}${s.up ? `, up for ${ago(this.uptime())}` : ''}`);
    if (n.src) out.push(`  Update source: ${n.src}`);
    out.push('', ' For Address Family: IPv4 Unicast');
    if (ext) {
      out.push(n.pin ? `  Policy for incoming advertisements is ${n.pin}` : "  EBGP neighbor with no inbound policy; defaulted to 'drop'");
      out.push(n.pout ? `  Policy for outgoing advertisements is ${n.pout}` : "  EBGP neighbor with no outbound policy; defaulted to 'drop'");
    }
    out.push(`  ${s.pfx} accepted prefixes, ${s.pfx} are bestpaths`);
    return out.join('\n');
  }
  routes() {
    const out = [];
    const t = ago(this.uptime());
    for (const n of this.allIfs()) {
      const ip = this.ipOf(n);
      if (!ip || !this.ifUp(n)) continue;
      if (ip.len < 32) out.push({ c: 'C', pfx: `${net(ip.ip, ip.len)}/${ip.len}`, text: `is directly connected, ${t}, ${n}` });
      out.push({ c: 'L', pfx: `${ip.ip}/32`, text: `is directly connected, ${t}, ${n}` });
    }
    const st = this.blk(this.running, 'router static', 'address-family ipv4 unicast');
    if (st) for (const c of st.k) { const [pfx, nh] = c.l.split(' '); out.push({ c: 'S', pfx, text: `[1/0] via ${nh}, ${t}` }); }
    if (Object.keys(CORE).some((l) => this.adj(l) === 'FULL')) {
      for (const rid of Object.keys(PES)) {
        const link = this.bestLink(rid), direct = CORE[link].rid === rid;
        out.push({ c: 'O', pfx: `${rid}/32`, text: `[110/${direct ? 2 : 3}] via ${CORE[link].ip}, ${t}, ${link}` });
      }
      const link = this.bestLink('10.255.1.2');
      out.push({ c: 'O', pfx: '10.1.23.0/30', text: `[110/2] via ${CORE[link].ip}, ${t}, ${link}` });
    }
    for (const r of this.bgpRoutes()) if (!r.local) out.push({ c: 'B', pfx: r.pfx, text: `[${r.ibgp ? 200 : 20}/0] via ${r.nh}, ${t}` });
    const key = (p) => p.split(/[./]/).map((x) => x.padStart(3, '0')).join('.');
    return out.sort((a, b) => key(a.pfx).localeCompare(key(b.pfx)));
  }
  showRoute(proto, want) {
    const map = { connected: 'C', local: 'L', static: 'S', ospf: 'O', bgp: 'B' };
    let rows = this.routes();
    if (proto) rows = rows.filter((r) => r.c === map[proto]);
    if (want) {
      const ip = want.split('/')[0];
      const hit = rows.filter((r) => { const [base, len] = r.pfx.split('/'); return want.includes('/') ? r.pfx === want : inNet(ip, base, +len); }).sort((a, b) => +b.pfx.split('/')[1] - +a.pfx.split('/')[1])[0];
      if (!hit) return `${this.stamp()}\n\n% Network not in table`;
      return [this.stamp(), '', `Routing entry for ${hit.pfx}`, `  Known via "${{ C: 'connected', L: 'local', S: 'static', O: 'ospf CORE', B: 'bgp ' + this.localAs() }[hit.c]}", distance ${{ C: 0, L: 0, S: 1, O: 110, B: hit.text.startsWith('[200') ? 200 : 20 }[hit.c]}`, `  ${hit.text.replace(/^\[\d+\/\d+\] /, '')}`].join('\n');
    }
    return [this.stamp(), '', 'Codes: C - connected, S - static, R - RIP, B - BGP, (>) - Diversion path', '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area',
      '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2', '       E1 - OSPF external type 1, E2 - OSPF external type 2, E - EGP',
      '       i - ISIS, L1 - IS-IS level-1, L2 - IS-IS level-2', '       ia - IS-IS inter area, su - IS-IS summary null, * - candidate default',
      '       U - per-user static route, o - ODR, L - local, G  - DAGR, l - LISP', '       A - access/subscriber, a - Application route',
      '       M - mobile route, r - RPL, t - Traffic Engineering, (!) - FRR Backup path', '', 'Gateway of last resort is not set', '',
      ...rows.map((r) => `${pad(r.c, 5)}${r.pfx} ${r.text}`)].join('\n');
  }
  showRouteSum() {
    const rows = this.routes(), count = (c) => rows.filter((r) => r.c === c).length;
    return [this.stamp(), 'Route Source                     Routes     Backup     Deleted     Memory(bytes)',
      ...[['connected', 'C'], ['local', 'L'], ['static', 'S'], ['ospf CORE', 'O'], [`bgp ${this.localAs() || AS}`, 'B']].map(([n, c]) => `${pad(n, 33)}${pad(count(c), 11)}${pad(0, 11)}${pad(0, 12)}${count(c) * 288}`),
      `${pad('Total', 33)}${pad(rows.length, 11)}${pad(0, 11)}${pad(0, 12)}${rows.length * 288}`].join('\n');
  }
  showOspfNbr() {
    const o = this.ospf();
    if (!o) return this.stamp();
    const rows = Object.keys(CORE).filter((l) => this.adj(l)).map((l) => [`${pad(CORE[l].rid, 16)}${pad(1, 6)}${pad(`${this.adj(l)}/  -`, 16)}${pad('00:00:3' + (l.endsWith('0') ? 7 : 1), 12)}${pad(CORE[l].ip, 16)}${l}`, `    Neighbor is up for ${ago(this.uptime())}`]);
    return [this.stamp(), '', '* Indicates MADJ interface', '# Indicates Neighbor awaiting BFD session up', '', `Neighbors for OSPF ${o.l.split(' ')[2]}`, '',
      'Neighbor ID     Pri   State           Dead Time   Address         Interface', ...rows.flat(), '', `Total neighbor count: ${rows.length}`].join('\n');
  }
  showLdp(brief) {
    const ups = Object.keys(PES).filter((rid) => this.ldpUp(rid));
    const t = ago(this.uptime());
    if (brief) {
      return [this.stamp(), '', 'Peer               GR  NSR  Up Time     Discovery   Addresses     Labels    ', '                                        ipv4  ipv6  ipv4  ipv6  ipv4   ipv6 ',
        '-----------------  --  ---  ----------  ----------  ----------  ------------', ...ups.map((rid) => `${pad(rid + ':0', 19)}N   N    ${pad(t, 12)}${pad(1, 6)}${pad(0, 6)}${pad(3, 6)}${pad(0, 6)}${pad(12, 7)}0    `)].join('\n');
    }
    return [this.stamp(), '', ...ups.flatMap((rid) => {
      const link = Object.keys(CORE).find((l) => CORE[l].rid === rid);
      const src = this.ldpOn(link) && this.adj(link) === 'FULL' ? [`      ${link}`] : ['      Targeted Hello (10.255.1.1 -> ' + rid + ', active)'];
      return [`Peer LDP Identifier: ${rid}:0`, `  TCP connection: ${rid}:646 - 10.255.1.1:${57104 + +rid.slice(-1)}`, '  Graceful Restart: No', '  Session Holdtime: 180 sec',
        `  State: Oper; Msgs sent/rcvd: ${1502 + Math.floor(this.uptime() / 60)}/${1498 + Math.floor(this.uptime() / 60)}; Downstream-Unsolicited`, `  Up time: ${t}`, '  LDP Discovery Sources:', '    IPv4: (1)', ...src, '    IPv6: (0)',
        '  Addresses bound to this peer:', '    IPv4: (3)', `      ${pad(CORE[link].ip, 15)}${pad(rid === '10.255.1.2' ? '10.1.23.1' : '10.1.23.2', 15)}${rid}`, '    IPv6: (0)', ''];
    })].join('\n');
  }
  showXc(detail, group) {
    const list = this.pws().filter((p) => !group || p.group === group);
    if (detail) {
      return [this.stamp(), '', ...list.flatMap((p) => {
        const s = this.xc(p);
        return [`Group ${p.group}, XC ${p.name}, state is ${s.up ? 'up' : 'down'}; Interworking none`, `  AC: ${p.ac || '(none)'}, state is ${s.ac ? 'up' : 'down'}`, `    Type VLAN; Num Ranges: 1`,
          `    VLAN ranges: [${(XR_ACS[(p.ac || '').split('.')[0]] || { vlan: '?' }).vlan}, ${(XR_ACS[(p.ac || '').split('.')[0]] || { vlan: '?' }).vlan}]`, '    MTU 1504; XC ID 0x1; interworking none',
          `  PW: neighbor ${p.peer || '(none)'}, PW ID ${p.pwid || '-'}, state is ${s.pw ? 'up ( established )' : 'down ( not established )'}`, '    PW class not set, XC ID 0xa0000001', '    Encapsulation MPLS, protocol LDP',
          ...(s.up ? [] : [`    (lab note: ${s.why})`]), ''];
      })].join('\n');
    }
    const rows = list.map((p) => {
      const s = this.xc(p);
      return `${pad(p.group, 11)}${pad(p.name.slice(0, 10), 11)}${pad(s.up ? 'UP' : 'DN', 5)}${pad(p.ac ? this.short(p.ac) : '', 23)}${pad(s.ac ? 'UP' : 'DN', 9)}${pad(p.peer || '', 15)}${pad(p.pwid || '', 8)}${s.pw ? 'UP' : 'DN'}    `;
    });
    return [this.stamp(), 'Legend: ST = State, UP = Up, DN = Down, AD = Admin Down, UR = Unresolved,', '        SB = Standby, SR = Standby Ready, (PP) = Partially Programmed,',
      '        LU = Local Up, RU = Remote Up, CO = Connected, (SI) = Seamless Inactive', '',
      'XConnect                   Segment 1                       Segment 2                ', 'Group      Name       ST   Description            ST       Description            ST    ',
      '------------------------   -----------------------------   -----------------------------', ...rows, '-'.repeat(88)].join('\n');
  }
  showPlatform() {
    return [this.stamp(), 'Node              Type                     State            Config state', '-'.repeat(80), '0/RSP0/CPU0       A9K-RSP880-SE(Active)    IOS XR RUN       NSHUT',
      '0/RSP1/CPU0       A9K-RSP880-SE(Standby)   IOS XR RUN       NSHUT', '0/0/CPU0          A9K-4X10GE-SE            IOS XR RUN       NSHUT', '0/1/CPU0          A9K-8X1GE-SE             IOS XR RUN       NSHUT',
      '0/FT0             ASR-9906-FAN             OPERATIONAL      NSHUT', '0/PT0             A9K-AC-PEM-V3            OPERATIONAL      NSHUT'].join('\n');
  }
  showVersion() {
    return [this.stamp(), '', 'Cisco IOS XR Software, Version 7.9.2 (simulated)', '', 'This is a practice simulation, not a real device.', '',
      `${this.host()} uptime is ${longUptime(this.uptime())}`, 'System image file is "bootflash:disk0/asr9k-os-mbi-7.9.2/0x100305/mbiasr9k-rsp3.vm"', '',
      'cisco ASR9K Series (Intel 686 F6M14S4) processor with 33554432K bytes of memory.', 'Intel 686 F6M14S4 processor at 2134MHz, Revision 2.174', 'ASR 9906 4 Line Card Slot Chassis with V3 AC PEM', '',
      '1 Management Ethernet', '4 TenGigE', '8 GigabitEthernet', '32768M bytes of physical memory.', 'Configuration register on node 0/RSP0/CPU0 is 0x1922'].join('\n');
  }
}
