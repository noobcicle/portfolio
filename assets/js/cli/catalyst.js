// A Catalyst access switch (IOS XE, C9300 style): 24 copper ports, four 10G uplinks to two
// distribution switches, VLANs in the config (VTP transparent), rapid PVST+, CDP and a MAC table.
// The world: PCs, an IP phone, an AP and a printer on the ports, and the two uplinks. What the show
// commands print comes from the running config plus who's plugged in where.
import { Ios, K, P, numT, wordT, ipT } from './ios.js';
import {
  pad, lpad, clock, longUptime, isIp, maskLen, lenMask, net, inNet, vlanList, vlanText,
  tnode, childKey, childLine, childrenKey, setLine, delKey, parseIndented,
} from './engine.js';

const GI = (n) => `GigabitEthernet1/0/${n}`;
const TE = (n) => `TenGigabitEthernet1/1/${n}`;
const UPLINKS = [TE(1), TE(2)];
const TYPES = [
  { name: 'Loopback', abbr: 'Lo', h: 'Loopback interface', re: /^\d{1,4}$/, virtual: true, order: 0, hw: 'Loopback', bw: 8000000 },
  { name: 'GigabitEthernet', abbr: 'Gi', cdp: 'Gig', h: 'GigabitEthernet IEEE 802.3z', re: /^(0\/0|1\/0\/([1-9]|1\d|2[0-4]))$/, order: 1, hw: 'Gigabit Ethernet', bw: 1000000, speed: '1000Mb/s', media: '10/100/1000BaseTX' },
  { name: 'TenGigabitEthernet', abbr: 'Te', cdp: 'Ten', h: 'Ten Gigabit Ethernet', re: /^1\/1\/[1-4]$/, order: 2, hw: 'Ten Gigabit Ethernet', bw: 10000000, speed: '10Gb/s', media: 'SFP-10GBase-SR' },
  { name: 'Vlan', abbr: 'Vl', h: 'Catalyst Vlans', re: /^([1-9]\d{0,2}|[1-3]\d{3}|40[0-8]\d|409[0-4])$/, virtual: true, order: 3, hw: 'Ethernet SVI', bw: 1000000 },
];
const PORTS = ['GigabitEthernet0/0', ...Array.from({ length: 24 }, (_, i) => GI(i + 1)), ...[1, 2, 3, 4].map(TE)];
// who is plugged in where
const WORLD = {
  'GigabitEthernet0/0': { kind: 'oob' },
  [GI(1)]: { kind: 'pc', vlan: 10, mac: '0000.5e00.5311' },
  [GI(2)]: { kind: 'pc', vlan: 10, mac: '0000.5e00.5312' },
  [GI(3)]: { kind: 'phone', vlan: 10, voice: 20, mac: '0000.5e00.5313', pc: '0000.5e00.5323', cdp: { id: 'SEP00005E005313', cap: 'H P M', plat: 'IP Phone', port: 'Port 1' } },
  [GI(4)]: { kind: 'ap', vlan: 99, mac: '0000.5e00.5314', cdp: { id: 'lab-ap1', cap: 'T B I', plat: 'C9120AXI-', port: 'Gig 0' } },
  [GI(5)]: { kind: 'printer', vlan: 30, mac: '0000.5e00.5315' },
  [GI(6)]: { kind: 'pc', vlan: 10, mac: '0000.5e00.5316' },
  [GI(7)]: { kind: 'pc', vlan: 10, mac: '0000.5e00.5317' },
  [GI(8)]: { kind: 'pc', vlan: 10, mac: '0000.5e00.5318' },
  [GI(9)]: { kind: 'pc', vlan: 10, mac: '0000.5e00.5319' },
  [GI(12)]: { kind: 'pc', vlan: 30, mac: '0000.5e00.531c' },
  [TE(1)]: { kind: 'up', carries: [10, 20, 30, 99], native: 1, prio: 24576, mac: '0000.5e00.5301', cdp: { id: 'lab-dist1', cap: 'R S I', plat: 'C9500-24Y', port: 'Ten 1/0/1' }, peerIf: 'TenGigabitEthernet1/0/1' },
  [TE(2)]: { kind: 'up', carries: [10, 20, 30, 99], native: 1, prio: 28672, mac: '0000.5e00.5302', cdp: { id: 'lab-dist2', cap: 'R S I', plat: 'C9500-24Y', port: 'Ten 1/0/1' }, peerIf: 'TenGigabitEthernet1/0/1' },
};
const ME = '0000.5e00.5380';   // this switch's base MAC (documentation range, RFC 7042)
const access = (n, vlan, desc, more = '') => `interface ${GI(n)}\n description ${desc}\n switchport access vlan ${vlan}\n switchport mode access\n${more} spanning-tree portfast\n`;
const FACTORY = `version 17.9
service timestamps debug datetime msec
service timestamps log datetime msec
hostname lab-sw1
vrf definition Mgmt-vrf
 address-family ipv4
 exit-address-family
no aaa new-model
clock timezone CST -6 0
clock summer-time CDT recurring
switch 1 provision c9300-24p
ip domain name lab.example
no ip domain lookup
vtp domain LAB
vtp mode transparent
spanning-tree mode rapid-pvst
spanning-tree extend system-id
vlan 10
 name USERS
vlan 20
 name VOICE
vlan 30
 name PRINTERS
vlan 99
 name MGMT
interface GigabitEthernet0/0
 vrf forwarding Mgmt-vrf
 ip address 172.16.0.41 255.255.255.0
 negotiation auto
${access(1, 10, 'desk 1-101')}${access(2, 10, 'desk 1-102')}${access(3, 10, 'desk 1-103 phone', ' switchport voice vlan 20\n')}${access(4, 99, 'lab-ap1')}${access(5, 30, 'printer 1-105')}${access(6, 10, 'desk 1-106')}${access(7, 10, 'desk 1-107')}${access(8, 10, 'desk 1-108')}${
  Array.from({ length: 16 }, (_, i) => `interface ${GI(i + 9)}\n`).join('')}interface ${TE(1)}
 description to lab-dist1 Te1/0/1
 switchport trunk allowed vlan 10,20,30,99
 switchport mode trunk
interface ${TE(2)}
 description to lab-dist2 Te1/0/1
 switchport trunk allowed vlan 10,20,30,99
 switchport mode trunk
interface ${TE(3)}
interface ${TE(4)}
interface Vlan1
 no ip address
 shutdown
interface Vlan99
 description management
 ip address 172.16.99.11 255.255.255.0
ip default-gateway 172.16.99.1
ip ssh version 2
line con 0
 logging synchronous
line vty 0 4
 login local
 transport input ssh
`;
const BLANK = `version 17.9
service timestamps debug datetime msec
service timestamps log datetime msec
hostname Switch
vrf definition Mgmt-vrf
 address-family ipv4
 exit-address-family
no aaa new-model
switch 1 provision c9300-24p
spanning-tree mode rapid-pvst
spanning-tree extend system-id
interface GigabitEthernet0/0
 vrf forwarding Mgmt-vrf
 no ip address
 negotiation auto
${PORTS.slice(1).map((p) => `interface ${p}\n`).join('')}interface Vlan1
 no ip address
line con 0
line vty 0 4
 login
`;
const maskT = (s) => (maskLen(s) >= 0 ? [s, 1] : null);
const vlanListT = (s) => (vlanList(s) ? [s, 1] : null);
const hostT = (s) => (/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(s) ? [s, 1] : null);

export class Catalyst extends Ios {
  get id() { return 'catalyst'; }
  get defaultHost() { return 'Switch'; }
  get types() { return TYPES; }
  get ports() { return PORTS; }
  get world() { return WORLD; }
  get topOrder() {
    return ['version', 'service', 'hostname', 'vrf definition', 'no aaa', 'aaa', 'clock', 'switch', 'ip domain', 'no ip domain', 'ip routing', 'no ip routing',
      'vtp', 'spanning-tree', 'vlan', 'cdp', 'no cdp', 'lldp', 'interface', 'ip default-gateway', 'ip route', 'ip ssh', 'line con', 'line vty'];
  }
  get ifOrderLines() {
    return ['description', 'vrf forwarding', 'switchport access vlan', 'switchport trunk native vlan', 'switchport trunk allowed vlan', 'switchport mode', 'switchport nonegotiate',
      'switchport voice vlan', 'no switchport', 'ip address', 'no ip address', 'shutdown', 'speed', 'duplex', 'negotiation', 'no cdp enable', 'spanning-tree portfast', 'spanning-tree bpduguard'];
  }
  get srvOrder() { return []; }
  factory() { return parseIndented(FACTORY); }
  blankConfig() { return parseIndented(BLANK); }
  label() { return 'Catalyst C9300 · IOS XE'; }
  motd() {
    return [
      'Simulated practice CLI: a pretend Catalyst switch. Not a real device; nothing here touches a network.',
      'Type ? for help, Tab to complete. Start with "enable". write memory saves to this browser.',
      '',
      'User Access Verification',
      '',
      `Username: ${this.user}`,
      'Password: (simulated)',
    ].join('\n');
  }

  // ---------------------------------------------------------------- the switchport model
  port(name, tree = this.running) {
    const L = this.ifLines(name, tree);
    const get = (k) => L.find((l) => l === k || l.startsWith(k + ' '));
    const routed = L.includes('no switchport') || name === 'GigabitEthernet0/0';
    const ml = get('switchport mode');
    const mode = routed ? 'routed' : ml ? ml.split(' ')[2] : 'dynamic';
    const al = get('switchport trunk allowed vlan');
    let allowed = 'all';
    if (al) { const v = al.slice(30); allowed = v === 'none' ? [] : v === 'all' ? 'all' : vlanList(v) || []; }
    const vl = get('switchport voice vlan');
    return {
      L, routed, mode, allowed,
      access: +((get('switchport access vlan') || '').split(' ')[3] || 1),
      voice: vl ? +vl.split(' ')[3] : null,
      native: +((get('switchport trunk native vlan') || '').split(' ')[4] || 1),
      shut: L.includes('shutdown'),
      portfast: !!get('spanning-tree portfast') && get('spanning-tree portfast') !== 'spanning-tree portfast disable',
      desc: (get('description') || '').slice(12),
    };
  }
  vlans(tree = this.running) {
    const m = new Map([[1, 'default']]);
    for (const c of tree.k) {
      const x = c.l.match(/^vlan (\d+)$/);
      if (x) { const nm = childKey(c, 'name'); m.set(+x[1], nm ? nm.l.slice(5) : `VLAN${x[1].padStart(4, '0')}`); }
    }
    return new Map([...m].sort((a, b) => a[0] - b[0]));
  }
  vlanExists(v) { return this.vlans().has(v); }
  cdpOn(name) { return !this.running.k.some((c) => c.l === 'no cdp run') && !this.ifLines(name).includes('no cdp enable'); }
  linkUp(name) { const s = this.ifState(name); return s.proto; }
  trunking(name) {
    const p = this.port(name), c = WORLD[name];
    if (!this.linkUp(name) || p.routed) return false;
    return p.mode === 'trunk' || (p.mode === 'dynamic' && c && c.kind === 'up');
  }
  allowedHas(p, v) { return p.allowed === 'all' || p.allowed.includes(v); }
  carries(up, v) {
    const c = WORLD[up];
    return !!c && this.trunking(up) && this.allowedHas(this.port(up), v) && c.carries.includes(v) && this.vlanExists(v);
  }
  myPrio(v) {
    const l = this.running.k.find((c) => c.l.startsWith(`spanning-tree vlan ${v} priority `));
    return l ? +l.l.split(' ')[4] : 32768;
  }
  // the uplink toward the root for this VLAN, or null when this switch is the root
  rootPort(v) {
    const ups = UPLINKS.filter((u) => this.carries(u, v));
    if (!ups.length) return null;
    const best = Math.min(...ups.map((u) => WORLD[u].prio));
    if (this.myPrio(v) < best) return null;
    return ups.find((u) => WORLD[u].prio === best);
  }
  members(v) {
    const out = [];
    for (const n of PORTS) {
      if (!this.linkUp(n)) continue;
      const p = this.port(n);
      if (p.routed) continue;
      if (this.trunking(n)) { if (WORLD[n] && WORLD[n].kind === 'up' ? this.carries(n, v) : this.allowedHas(p, v)) out.push(n); }
      else if (p.access === v || p.voice === v) out.push(n);
    }
    return out;
  }
  sviUp(v) { return this.vlanExists(v) && this.members(v).length > 0; }
  // Can the device on this port reach its gateway (on the distribution switches)?
  hostOk(name) {
    const c = WORLD[name];
    if (!c || c.kind === 'up' || c.kind === 'oob') return false;
    const p = this.port(name);
    if (p.shut || p.routed || this.trunking(name)) return false;
    if (p.access !== c.vlan || !this.vlanExists(c.vlan) || !UPLINKS.some((u) => this.carries(u, c.vlan))) return false;
    if (c.voice && (p.voice !== c.voice || !this.vlanExists(c.voice) || !UPLINKS.some((u) => this.carries(u, c.voice)))) return false;
    return true;
  }
  extraSnap() {
    const nat = {};
    for (const u of UPLINKS) nat[u] = this.trunking(u) ? this.port(u).native : null;
    return { nat };
  }
  extraLogs(was, now) {
    const out = [];
    for (const u of UPLINKS) {
      const n = now.nat[u];
      if (n != null && n !== was.nat[u] && n !== WORLD[u].native) {
        out.push({ text: `{t}: %CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on ${u} (${n}), with ${WORLD[u].cdp.id} ${WORLD[u].peerIf} (${WORLD[u].native}).`, ms: 2600 });
      }
    }
    return out;
  }
  reach(dst) {
    const svis = this.allIfs().filter((n) => /^Vlan/.test(n) && this.ifState(n).proto && this.ipOf(n));
    const own = svis.find((n) => this.ipOf(n).ip === dst);
    if (own) return true;
    const known = ['172.16.99.1', '172.16.99.2', '172.16.99.3', '10.10.10.1', '10.10.20.1', '10.10.30.1'];
    const local = svis.find((n) => inNet(dst, this.ipOf(n).ip, this.ipOf(n).len));
    if (local) return known.includes(dst) && this.vlanExists(+local.slice(4)) && !!this.rootPort(+local.slice(4));
    const gw = this.running.k.find((c) => c.l.startsWith('ip default-gateway '));
    if (!gw) return false;
    const g = gw.l.split(' ')[2];
    const via = svis.find((n) => inNet(g, this.ipOf(n).ip, this.ipOf(n).len));
    return !!via && known.includes(dst) && !!this.rootPort(+via.slice(4));
  }

  // ---------------------------------------------------------------- config commands
  configTree() {
    const vlanNo = function (a) {
      const list = vlanList(a.vl);
      if (list.some((v) => v === 1 || (v >= 1002 && v <= 1005))) return '%Default VLAN 1 may not be deleted.\n';
      for (const v of list) {
        const n = childLine(this.running, `vlan ${v}`);
        if (n) this.running.k.splice(this.running.k.indexOf(n), 1);
      }
      this.touched();
      return '';
    };
    const stpVlan = function (a, prio) {
      for (const v of vlanList(a.vl)) setLine(this.running, `spanning-tree vlan ${v} priority`, `spanning-tree vlan ${v} priority ${prio}`, (x) => this.rank(x));
      this.touched();
      return '';
    };
    return [
      K('cdp', 'Global CDP configuration subcommands', { c: [K('run', 'Enable CDP', {
        run() { delKey(this.running, 'no cdp run'); this.touched(); return ''; },
        no() { setLine(this.running, 'no cdp run', 'no cdp run', (x) => this.rank(x)); this.touched(); return ''; },
      })] }),
      K('hostname', "Set system's network name", {
        c: [P('WORD', "This system's network name", hostT, { as: 'name', run(a) { setLine(this.running, 'hostname', `hostname ${a.name}`, (x) => this.rank(x)); this.touched(); return ''; } })],
        no() { setLine(this.running, 'hostname', 'hostname Switch', (x) => this.rank(x)); this.touched(); return ''; },
      }),
      K('interface', 'Select an interface to configure', { c: (d) => [
        d.ifP('if', { more: {
          run(a) { return this.goIf([a.if]); },
          no(a) {
            if (!this.typeOf(a.if).virtual) return '% Physical interfaces cannot be removed\n';
            const n = this.ifNode(a.if);
            if (n) { this.running.k.splice(this.running.k.indexOf(n), 1); this.touched(); }
            return '';
          },
        } }),
        K('range', 'interface range command', { c: [P('LINE', 'Interface range, for example Gi1/0/1 - 4 , Gi1/0/7', null, { rest: true, as: 'r', run(a) {
          const list = this.parseRange(a.r);
          if (!list) return "% Command rejected: Bad interface range\n";
          return this.goIf(list, true);
        } })] }),
      ] }),
      K('ip', 'Global IP configuration subcommands', { c: [
        K('default-gateway', 'Specify default gateway (if not routing IP)', {
          c: [P('A.B.C.D', 'IP address of default gateway', ipT, { as: 'gw', run(a) { setLine(this.running, 'ip default-gateway', `ip default-gateway ${a.gw}`, (x) => this.rank(x)); this.touched(); return ''; } })],
          no() { delKey(this.running, 'ip default-gateway'); this.touched(); return ''; },
        }),
        K('domain', 'IP DNS Resolver', { c: [
          K('lookup', 'Enable IP Domain Name System hostname translation', {
            run() { delKey(this.running, 'no ip domain lookup'); this.touched(); return ''; },
            no() { setLine(this.running, 'no ip domain lookup', 'no ip domain lookup', (x) => this.rank(x)); this.touched(); return ''; },
          }),
          K('name', 'Define the default domain name', {
            c: [P('WORD', 'Default domain name', wordT, { as: 'd', run(a) { setLine(this.running, 'ip domain name', `ip domain name ${a.d}`, (x) => this.rank(x)); this.touched(); return ''; } })],
            no() { delKey(this.running, 'ip domain name'); this.touched(); return ''; },
          }),
        ] }),
        K('route', 'Establish static routes', { c: [P('A.B.C.D', 'Destination prefix', ipT, { as: 'pfx', c: [P('A.B.C.D', 'Destination prefix mask', maskT, { as: 'mask', c: [P('A.B.C.D', "Forwarding router's address", ipT, { as: 'nh',
          run(a) { const l = `ip route ${a.pfx} ${a.mask} ${a.nh}`; if (!childLine(this.running, l)) this.running.k.push(tnode(l)); this.running.k.sort((x, y) => this.rank(x.l) - this.rank(y.l)); this.touched(); return ''; },
          no(a) { const l = `ip route ${a.pfx} ${a.mask} ${a.nh}`; this.running.k = this.running.k.filter((c) => c.l !== l); this.touched(); return ''; },
        })] })] })] }),
        K('routing', 'Enable IP routing', {
          run() { delKey(this.running, 'no ip routing'); setLine(this.running, 'ip routing', 'ip routing', (x) => this.rank(x)); this.touched(); return ''; },
          no() { delKey(this.running, 'ip routing'); this.touched(); return ''; },
        }),
        K('ssh', 'Configure ssh options', { c: [K('version', 'Specify protocol version to be supported', { c: [P('<1-2>', 'Protocol version', numT(1, 2), { as: 'v', run(a) { setLine(this.running, 'ip ssh version', `ip ssh version ${a.v}`, (x) => this.rank(x)); this.touched(); return ''; } })] })] }),
      ] }),
      K('line', 'Configure a terminal line', { c: [
        K('console', 'Primary terminal line', { c: [P('<0-0>', 'First Line number', numT(0, 0), { as: 'n', run() { return this.goLine('line con 0'); } })] }),
        K('vty', 'Virtual terminal', { c: [P('<0-15>', 'First Line number', numT(0, 15), { as: 'a', run(a) { return this.goLine(`line vty ${a.a}`); }, c: [P('<1-15>', 'Last Line number', numT(1, 15), { as: 'b', run(a) { return this.goLine(`line vty ${a.a} ${a.b}`); } })] })] }),
      ] }),
      K('lldp', 'Global LLDP configuration subcommands', { c: [K('run', 'Enable LLDP', {
        run() { setLine(this.running, 'lldp run', 'lldp run', (x) => this.rank(x)); this.touched(); return ''; },
        no() { delKey(this.running, 'lldp run'); this.touched(); return ''; },
      })] }),
      K('spanning-tree', 'Spanning Tree Subsystem', { c: [
        K('mode', 'Spanning tree operating mode', { c: ['mst', 'pvst', 'rapid-pvst'].map((m) => K(m, { mst: 'Multiple spanning tree mode', pvst: 'Per-Vlan spanning tree mode', 'rapid-pvst': 'Per-Vlan rapid spanning tree mode' }[m], {
          run() { setLine(this.running, 'spanning-tree mode', `spanning-tree mode ${m}`, (x) => this.rank(x)); this.touched(); return ''; },
        })), no() { setLine(this.running, 'spanning-tree mode', 'spanning-tree mode rapid-pvst', (x) => this.rank(x)); this.touched(); return ''; } }),
        K('vlan', 'VLAN Switch Spanning Tree', { c: [P('WORD', 'vlan range, example: 1,3-5,7,9-11', vlanListT, { as: 'vl', c: [
          K('priority', 'Set the bridge priority for the spanning tree', {
            c: [P('<0-61440>', 'bridge priority in increments of 4096', (s) => (/^\d+$/.test(s) && +s <= 61440 ? [+s, 1] : null), { as: 'prio', run(a) {
              if (a.prio % 4096) return '% Bridge Priority must be in increments of 4096.\n% Allowed values are:\n  0     4096  8192  12288 16384 20480 24576 28672\n  32768 36864 40960 45056 49152 53248 57344 61440\n';
              return stpVlan.call(this, a, a.prio);
            } })],
            no(a) { for (const v of vlanList(a.vl)) delKey(this.running, `spanning-tree vlan ${v} priority`); this.touched(); return ''; },
          }),
          K('root', 'Configure switch as root', { c: [
            K('primary', 'Configure this switch as primary root for this spanning tree', { run(a) { return stpVlan.call(this, a, 20480); } }),
            K('secondary', 'Configure switch as secondary root', { run(a) { return stpVlan.call(this, a, 28672); } }),
          ], no(a) { for (const v of vlanList(a.vl)) delKey(this.running, `spanning-tree vlan ${v} priority`); this.touched(); return ''; } }),
        ] })] }),
      ] }),
      K('vlan', 'Vlan commands', { c: [P('WORD', 'ISL VLAN IDs 1-1005, 802.1Q VLAN IDs 1-4094 (e.g. 10,20-25)', vlanListT, { as: 'vl',
        run(a) { return this.goVlan(vlanList(a.vl)); },
        no: vlanNo,
      })] }),
      K('vtp', 'Configure global VTP state', { c: [
        K('domain', 'Set the name of the VTP administrative domain.', { c: [P('WORD', 'The ascii name for the VTP administrative domain.', wordT, { as: 'd', run(a) { setLine(this.running, 'vtp domain', `vtp domain ${a.d}`, (x) => this.rank(x)); this.touched(); return `Changing VTP domain name from LAB to ${a.d}`; } })] }),
        K('mode', 'Configure VTP device mode', { c: ['client', 'off', 'server', 'transparent'].map((m) => K(m, `Set the device to ${m} mode.`, {
          run() { setLine(this.running, 'vtp mode', `vtp mode ${m}`, (x) => this.rank(x)); this.touched(); return `Setting device to VTP ${m.toUpperCase()} mode for VLANS.`; },
        })) }),
      ] }),
    ];
  }
  parseRange(text) {
    const out = [];
    let last = null;
    for (let part of text.replace(/\s*-\s*/g, '-').split(/\s*,\s*/)) {
      part = part.trim();
      if (!part) return null;
      let m = part.match(/^([a-zA-Z-]+)\s*((?:\d+\/)*)(\d+)(?:-(\d+))?$/);
      if (!m && last) m = [part, last.typ, last.pre, ...part.split('-')];  // ", 7" reuses the type
      if (!m) return null;
      const [, typ, pre = '', a, b] = m;
      last = { typ, pre };
      for (let i = +a; i <= +(b || a); i++) {
        const r = this.parseIf([{ t: `${typ}${pre}${i}` }], 0);
        if (!r) return null;
        if (!out.includes(r[0])) out.push(r[0]);
      }
    }
    return out.length ? out : null;
  }
  goIf(names, range = false) {
    for (const n of names) {
      if (!this.ifNode(n)) {
        const node = this.at([`interface ${n}`]);
        if (/^(Vlan|Loopback)/.test(n)) node.k.push(tnode('no ip address'));
        this.touched();
      }
    }
    this.enter('if', range ? 'config-if-range' : 'config-if', names.map((n) => [`interface ${n}`]));
    return '';
  }
  goVlan(list) {
    for (const v of list) {
      if (!childLine(this.running, `vlan ${v}`) && v !== 1) { this.at([`vlan ${v}`]); this.touched(); }
    }
    this.enter('vlan', 'config-vlan', list.map((v) => [`vlan ${v}`]));
    return '';
  }
  goLine(l) { this.at([l]); this.enter('line', 'config-line', [[l]]); return ''; }
  curIfs() { const t = this.top(); return t && t.m === 'if' ? t.paths.map((p) => p[0].slice(10)) : []; }

  vlanTree() {
    return [K('name', 'Ascii name of the VLAN', {
      c: [P('WORD', 'The ascii name for the VLAN', (s) => (s.length <= 32 ? [s, 1] : null), { as: 'nm', run(a) {
        if (this.top().paths.some((p) => p[0] === 'vlan 1')) return '%Default VLAN 1 may not have its name changed.\n';
        this.setHere('name', `name ${a.nm}`);
        return '';
      } })],
      no() { this.delHere('name'); return ''; },
    })];
  }
  lineTree() {
    return [
      K('exec-timeout', 'Set the EXEC timeout', { c: [P('<0-35791>', 'Timeout in minutes', numT(0, 35791), { as: 'm', run(a) { this.setHere('exec-timeout', `exec-timeout ${a.m} 0`); return ''; }, c: [P('<0-2147483>', 'Timeout in seconds', numT(0, 2147483), { as: 's', run(a) { this.setHere('exec-timeout', `exec-timeout ${a.m} ${a.s}`); return ''; } })] })], no() { this.delHere('exec-timeout'); return ''; } }),
      K('logging', 'Modify message logging facilities', { c: [K('synchronous', 'Synchronized message output', { run() { this.setHere('logging synchronous', 'logging synchronous'); return ''; }, no() { this.delHere('logging synchronous'); return ''; } })] }),
      K('login', 'Enable password checking', { run() { this.setHere('login', 'login'); return ''; }, no() { this.delHere('login'); return ''; }, c: [K('local', 'Local password checking', { run() { this.setHere('login', 'login local'); return ''; } })] }),
      K('transport', 'Define transport protocols for line', { c: [K('input', 'Define which protocols to use when connecting to the terminal server', { c: ['all', 'none', 'ssh', 'telnet'].map((t) => K(t, `${t === 'all' ? 'All protocols' : t === 'none' ? 'No protocols' : t.toUpperCase() + ' protocol'}`, { run() { this.setHere('transport input', `transport input ${t}`); return ''; } })), no() { this.delHere('transport input'); return ''; } })] }),
    ];
  }
  srvTree() { return []; }

  ifTree() {
    const each = (fn) => function (a) { const out = []; for (const name of this.curIfs()) { const r = fn.call(this, name, a); if (r) out.push(r); } this.touched(); return out.join(''); };
    const onL2 = (fn) => each(function (name, a) {
      if (this.port(name).routed) return `% Command rejected: ${name} is not a switching port.\n`;
      return fn.call(this, name, a);
    });
    const set = (name, key, line) => setLine(this.ifNode(name), key, line, (x) => this.subRank(x, 'interface'));
    const del = (name, key) => delKey(this.ifNode(name), key);
    const allowedOp = (op) => onL2(function (name, a) {
      const p = this.port(name);
      const cur = p.allowed === 'all' ? vlanList('1-4094') : p.allowed;
      const list = op === 'all' || op === 'none' ? [] : vlanList(a.vl);
      let next;
      if (op === 'set') next = list;
      else if (op === 'add') next = [...new Set([...cur, ...list])];
      else if (op === 'remove') next = cur.filter((v) => !list.includes(v));
      else if (op === 'except') next = vlanList('1-4094').filter((v) => !list.includes(v));
      else if (op === 'none') next = [];
      if (op === 'all' || (next && next.length === 4094)) del(name, 'switchport trunk allowed vlan');
      else set(name, 'switchport trunk allowed vlan', `switchport trunk allowed vlan ${next.length ? vlanText(next) : 'none'}`);
      return '';
    });
    const dot = (k, h, words) => K(k, h, { c: words.map(([w, wh]) => K(w, wh, { run: each(function (name) { set(name, k, `${k} ${w}`); return ''; }) })), no: each(function (name) { del(name, k); return ''; }) });
    return [
      K('cdp', 'CDP interface subcommands', { c: [K('enable', 'Enable CDP on interface', {
        run: each(function (name) { del(name, 'no cdp enable'); return ''; }),
        no: each(function (name) { set(name, 'no cdp enable', 'no cdp enable'); return ''; }),
      })] }),
      K('description', 'Interface specific description', {
        c: [P('LINE', 'Up to 200 characters describing this interface', null, { rest: true, as: 'text', run: each(function (name, a) { set(name, 'description', `description ${a.text}`); return ''; }) })],
        no: each(function (name) { del(name, 'description'); return ''; }),
      }),
      dot('duplex', 'Configure duplex operation.', [['auto', 'Enable AUTO duplex configuration'], ['full', 'Force full duplex operation'], ['half', 'Force half-duplex operation']]),
      K('ip', 'Interface Internet Protocol config commands', { c: [K('address', 'Set the IP address of an interface', {
        c: [P('A.B.C.D', 'IP address', ipT, { as: 'ip', c: [P('A.B.C.D', 'IP subnet mask', maskT, { as: 'mask', run: each(function (name, a) { return this.setIp(name, a.ip, a.mask); }) })] })],
        no: each(function (name) {
          const n = this.ifNode(name);
          const had = n.k.some((c) => c.l.startsWith('ip address '));
          n.k = n.k.filter((c) => !c.l.startsWith('ip address '));
          if (had || /^(Vlan|Loopback)/.test(name) || this.port(name).routed) set(name, 'no ip address', 'no ip address');
          return '';
        }),
      })] }),
      K('shutdown', 'Shutdown the selected interface', {
        run: each(function (name) { set(name, 'shutdown', 'shutdown'); return ''; }),
        no: each(function (name) { del(name, 'shutdown'); return ''; }),
      }),
      dot('speed', 'Configure speed operation.', [['10', 'Force 10 Mbps operation'], ['100', 'Force 100 Mbps operation'], ['1000', 'Force 1000 Mbps operation'], ['auto', 'Enable AUTO speed configuration']]),
      K('spanning-tree', 'Spanning Tree Subsystem', { c: [
        K('bpduguard', "Don't accept BPDUs on this interface", { c: [
          K('enable', 'Enable BPDU guard for this interface', { run: each(function (name) { set(name, 'spanning-tree bpduguard', 'spanning-tree bpduguard enable'); return ''; }) }),
          K('disable', 'Disable BPDU guard for this interface', { run: each(function (name) { set(name, 'spanning-tree bpduguard', 'spanning-tree bpduguard disable'); return ''; }) }),
        ], no: each(function (name) { del(name, 'spanning-tree bpduguard'); return ''; }) }),
        K('portfast', 'Portfast options for the interface', {
          run: each(function (name) {
            set(name, 'spanning-tree portfast', 'spanning-tree portfast');
            return `%Warning: portfast should only be enabled on ports connected to a single\n host. Connecting hubs, concentrators, switches, bridges, etc... to this\n interface  when portfast is enabled, can cause temporary bridging loops.\n Use with CAUTION\n\n%Portfast has been configured on ${name} but will only\n have effect when the interface is in a non-trunking mode.\n`;
          }),
          no: each(function (name) { del(name, 'spanning-tree portfast'); return ''; }),
          c: [
            K('disable', 'Disable portfast for this interface', { run: each(function (name) { set(name, 'spanning-tree portfast', 'spanning-tree portfast disable'); return ''; }) }),
            K('trunk', 'Enable portfast on the interface even in trunk mode', { run: each(function (name) { set(name, 'spanning-tree portfast', 'spanning-tree portfast trunk'); return ''; }) }),
          ],
        }),
      ] }),
      K('switchport', 'Set switching mode characteristics', {
        run: each(function (name) {
          if (/^(Vlan|Loopback)/.test(name) || name === 'GigabitEthernet0/0') return "% Invalid input detected at '^' marker.\n";
          const n = this.ifNode(name);
          n.k = n.k.filter((c) => !['no switchport', 'no ip address'].includes(c.l) && !c.l.startsWith('ip address '));
          return '';
        }),
        no: each(function (name) {
          if (/^(Vlan|Loopback)/.test(name) || name === 'GigabitEthernet0/0') return '';
          const n = this.ifNode(name);
          n.k = n.k.filter((c) => !c.l.startsWith('switchport') && !c.l.startsWith('spanning-tree portfast'));
          set(name, 'no switchport', 'no switchport');
          set(name, 'no ip address', 'no ip address');
          return '';
        }),
        c: [
          K('access', 'Set access mode characteristics of the interface', { c: [K('vlan', 'Set VLAN when interface is in access mode', {
            c: [P('<1-4094>', 'VLAN ID of the VLAN when this port is in access mode', numT(1, 4094), { as: 'vlan', run: onL2(function (name, a) {
              let msg = '';
              if (!this.vlanExists(a.vlan)) {
                this.at([`vlan ${a.vlan}`]);
                msg = `% Access VLAN does not exist. Creating vlan ${a.vlan}\n`;
              }
              if (a.vlan === 1) del(name, 'switchport access vlan'); else set(name, 'switchport access vlan', `switchport access vlan ${a.vlan}`);
              return msg;
            }) })],
            no: onL2(function (name) { del(name, 'switchport access vlan'); return ''; }),
          })] }),
          K('mode', 'Set trunking mode of the interface', {
            c: [
              K('access', 'Set trunking mode to ACCESS unconditionally', { run: onL2(function (name) { set(name, 'switchport mode', 'switchport mode access'); return ''; }) }),
              K('dynamic', 'Set trunking mode to dynamically negotiate access or trunk mode', { c: [
                K('auto', 'Set trunking mode dynamic negotiation parameter to AUTO', { run: onL2(function (name) { set(name, 'switchport mode', 'switchport mode dynamic auto'); return ''; }) }),
                K('desirable', 'Set trunking mode dynamic negotiation parameter to DESIRABLE', { run: onL2(function (name) { set(name, 'switchport mode', 'switchport mode dynamic desirable'); return ''; }) }),
              ] }),
              K('trunk', 'Set trunking mode to TRUNK unconditionally', { run: onL2(function (name) { set(name, 'switchport mode', 'switchport mode trunk'); return ''; }) }),
            ],
            no: onL2(function (name) { del(name, 'switchport mode'); return ''; }),
          }),
          K('nonegotiate', 'Device will not engage in negotiation protocol on this interface', {
            run: onL2(function (name) { set(name, 'switchport nonegotiate', 'switchport nonegotiate'); return ''; }),
            no: onL2(function (name) { del(name, 'switchport nonegotiate'); return ''; }),
          }),
          K('trunk', 'Set trunking characteristics of the interface', { c: [
            K('allowed', 'Set allowed VLAN characteristics when interface is in trunking mode', { c: [K('vlan', 'Set allowed VLANs when interface is in trunking mode', {
              c: [
                K('add', 'add VLANs to the current list', { c: [P('WORD', 'VLAN IDs of the allowed VLANs when this port is in trunking mode', vlanListT, { as: 'vl', run: allowedOp('add') })] }),
                K('all', 'all VLANs', { run: allowedOp('all') }),
                K('except', 'all VLANs except the following', { c: [P('WORD', 'VLAN IDs of the VLANs that will not be allowed', vlanListT, { as: 'vl', run: allowedOp('except') })] }),
                K('none', 'no VLANs', { run: allowedOp('none') }),
                K('remove', 'remove VLANs from the current list', { c: [P('WORD', 'VLAN IDs of disallowed VLANS when this port is in trunking mode', vlanListT, { as: 'vl', run: allowedOp('remove') })] }),
                P('WORD', 'VLAN IDs of the allowed VLANs when this port is in trunking mode', vlanListT, { as: 'vl', run: allowedOp('set') }),
              ],
              no: onL2(function (name) { del(name, 'switchport trunk allowed vlan'); return ''; }),
            })] }),
            K('native', 'Set trunking native characteristics when interface is in trunking mode', { c: [K('vlan', 'Set native VLAN when interface is in trunking mode', {
              c: [P('<1-4094>', 'VLAN ID of the native VLAN when this port is in trunking mode', numT(1, 4094), { as: 'vlan', run: onL2(function (name, a) {
                if (a.vlan === 1) del(name, 'switchport trunk native vlan'); else set(name, 'switchport trunk native vlan', `switchport trunk native vlan ${a.vlan}`);
                return '';
              }) })],
              no: onL2(function (name) { del(name, 'switchport trunk native vlan'); return ''; }),
            })] }),
          ] }),
          K('voice', 'Voice appliance attributes', { c: [K('vlan', 'Vlan for voice traffic', {
            c: [P('<1-4094>', 'Vlan for voice traffic', numT(1, 4094), { as: 'vlan', run: onL2(function (name, a) { set(name, 'switchport voice vlan', `switchport voice vlan ${a.vlan}`); return ''; }) })],
            no: onL2(function (name) { del(name, 'switchport voice vlan'); return ''; }),
          })] }),
        ],
      }),
    ];
  }
  setIp(name, ip, mask) {
    const len = maskLen(mask);
    if (!/^(Vlan|Loopback)/.test(name) && name !== 'GigabitEthernet0/0' && !this.port(name).routed) return '% IP addresses may not be configured on L2 links.\n';
    if (len < 32 && (net(ip, len) === ip || ipNumBroadcast(ip, len) === ip)) return `Bad mask /${len} for address ${ip}\n`;
    for (const other of this.allIfs()) {
      if (other === name) continue;
      const o = this.ipOf(other);
      if (o && (inNet(ip, o.ip, Math.min(o.len, len)))) return `% ${net(ip, len)} overlaps with ${other}\n`;
    }
    const n = this.ifNode(name);
    n.k = n.k.filter((c) => c.l !== 'no ip address');
    setLine(n, 'ip address', `ip address ${ip} ${mask}`, (x) => this.subRank(x, 'interface'));
    return '';
  }

  // ---------------------------------------------------------------- show commands
  ifShowSubs(withIf) {
    const pick = (a) => (a.if ? [a.if] : null);
    return [
      K('description', 'Show interface description', { run(a) { return this.showIfDesc(pick(a)); } }),
      K('status', 'Show interface line status', { run(a) { return this.showIfStatus(pick(a)); } }),
      K('switchport', 'Show interface switchport information', { run(a) { return this.showSwitchport(pick(a)); } }),
      K('trunk', 'Show interface trunk information', { run(a) { return this.showTrunk(pick(a)); } }),
    ];
  }
  extraShow() {
    const mac = K('mac', 'MAC configuration', { c: [K('address-table', 'MAC forwarding table', this.macTree())] });
    return [
      K('cdp', 'CDP information', { c: [K('neighbors', 'CDP neighbor entries', { run() { return this.showCdp(false); }, c: [K('detail', 'Show detailed information', { run() { return this.showCdp(true); } })] })] }),
      mac,
      K('mac-address-table', 'MAC forwarding table', { hide: true, ...this.macTree() }),
    ];
  }
  macTree() {
    const f = (fn) => function (a) { return this.showMac(fn ? (r) => fn(r, a) : null); };
    return {
      run: f(),
      c: [
        K('address', 'address keyword', { c: [P('H.H.H', '48 bit mac address', (s) => (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(s) ? [s.toLowerCase(), 1] : null), { as: 'mac', run: f((r, a) => r[1] === a.mac) })] }),
        K('dynamic', 'dynamic entry type', { run: f((r) => r[2] === 'DYNAMIC') }),
        K('interface', 'interface keyword', { c: (d) => [d.ifP('if', { exists: true, more: { run: f((r, a) => r[3] === d.short(a.if)) } })] }),
        K('vlan', 'VLAN keyword', { c: [P('<1-4094>', 'VLAN number', numT(1, 4094), { as: 'vlan', run: f((r, a) => r[0] === a.vlan) })] }),
      ],
    };
  }
  statusOf(name) {
    const p = this.port(name), st = this.ifState(name);
    if (!st.admin) return 'disabled';
    if (!st.link) return 'notconnect';
    if (!p.routed && !this.trunking(name) && !this.vlanExists(p.access)) return 'inactive';
    return 'connected';
  }
  showIfStatus(only) {
    const rows = ['Port         Name               Status       Vlan       Duplex  Speed Type '];
    for (const n of only || PORTS) {
      const T = this.typeOf(n);
      if (!T || T.virtual) continue;
      const p = this.port(n), status = this.statusOf(n), up = status === 'connected' || status === 'inactive';
      const vlan = p.routed ? 'routed' : this.trunking(n) ? 'trunk' : String(p.access);
      const te = T.name === 'TenGigabitEthernet';
      const duplex = up ? (te ? 'full' : 'a-full') : te ? 'full' : 'auto';
      const speed = up ? (te ? '10G' : 'a-1000') : te ? '10G' : 'auto';
      const type = te ? (WORLD[n] ? 'SFP-10GBase-SR' : 'Not Present') : '10/100/1000BaseTX';
      rows.push(pad(this.short(n), 13) + pad(p.desc.slice(0, 18), 19) + pad(status, 13) + pad(vlan, 11) + lpad(duplex, 6) + ' ' + lpad(speed, 6) + ' ' + type);
    }
    return rows.join('\n');
  }
  showIfDesc(only) {
    const rows = [pad('Interface', 31) + pad('Status', 15) + pad('Protocol', 9) + 'Description'];
    for (const n of only || this.allIfs()) {
      const st = this.ifState(n), p = this.ifLines(n).find((l) => l.startsWith('description '));
      rows.push(pad(this.short(n), 31) + pad(!st.admin ? 'admin down' : st.link ? 'up' : 'down', 15) + pad(st.proto ? 'up' : 'down', 9) + (p ? p.slice(12) : ''));
    }
    return rows.join('\n');
  }
  showTrunk(only) {
    const ports = (only || PORTS).filter((n) => this.trunking(n));
    if (!ports.length) return '';
    const sec = (title, fn) => ['', pad('Port', 12) + title, ...ports.map((n) => pad(this.short(n), 12) + fn(n, this.port(n)))];
    const allowed = (p) => (p.allowed === 'all' ? vlanList('1-4094') : p.allowed);
    const active = (p) => allowed(p).filter((v) => this.vlanExists(v));
    return [
      ...sec('Mode             Encapsulation  Status        Native vlan', (n, p) => pad(p.mode === 'trunk' ? 'on' : 'auto', 17) + pad('802.1q', 15) + pad('trunking', 14) + p.native),
      ...sec('Vlans allowed on trunk', (n, p) => (p.allowed === 'all' ? '1-4094' : p.allowed.length ? vlanText(p.allowed) : 'none')),
      ...sec('Vlans allowed and active in management domain', (n, p) => (active(p).length ? vlanText(active(p)) : 'none')),
      ...sec('Vlans in spanning tree forwarding state and not pruned', (n, p) => {
        const fwd = active(p).filter((v) => {
          const rp = this.rootPort(v);
          if (WORLD[n] && WORLD[n].kind === 'up') return this.carries(n, v) && (!rp || rp === n || this.rootPort(v) === null);
          return true;
        });
        return fwd.length ? vlanText(fwd) : 'none';
      }),
    ].slice(1).join('\n');
  }
  showSwitchport(only) {
    const out = [];
    for (const n of only || PORTS) {
      const T = this.typeOf(n);
      if (!T || T.virtual) continue;
      const p = this.port(n), vl = this.vlans();
      if (out.length) out.push('');
      if (p.routed) { out.push(`Name: ${this.short(n)}`, 'Switchport: Disabled'); continue; }
      const trunk = this.trunking(n);
      const admin = p.mode === 'access' ? 'static access' : p.mode === 'trunk' ? 'trunk' : 'dynamic auto';
      const oper = !this.linkUp(n) ? 'down' : trunk ? 'trunk' : 'static access';
      const nm = (v) => (vl.has(v) ? `${v} (${vl.get(v)})` : `${v} (Inactive)`);
      out.push(
        `Name: ${this.short(n)}`, 'Switchport: Enabled', `Administrative Mode: ${admin}`, `Operational Mode: ${oper}`,
        'Administrative Trunking Encapsulation: dot1q', `Operational Trunking Encapsulation: ${trunk ? 'dot1q' : 'native'}`,
        `Negotiation of Trunking: ${p.mode === 'trunk' ? 'On' : p.mode === 'access' ? 'Off' : 'On'}`,
        `Access Mode VLAN: ${nm(p.access)}`, `Trunking Native Mode VLAN: ${nm(p.native)}`, 'Administrative Native VLAN tagging: enabled',
        `Voice VLAN: ${p.voice ? nm(p.voice) : 'none'}`, 'Administrative private-vlan host-association: none',
        `Trunking VLANs Enabled: ${p.allowed === 'all' ? 'ALL' : p.allowed.length ? vlanText(p.allowed) : 'NONE'}`, 'Pruning VLANs Enabled: 2-1001',
      );
    }
    return out.join('\n');
  }
  showVlan(brief, filter) {
    const vl = this.vlans(), out = [];
    out.push(pad('VLAN', 5) + pad('Name', 33) + pad('Status', 10) + 'Ports', '---- -------------------------------- --------- -------------------------------');
    const rows = [...vl, [1002, 'fddi-default'], [1003, 'token-ring-default'], [1004, 'fddinet-default'], [1005, 'trnet-default']];
    for (const [v, nm] of rows) {
      if (filter && !filter(v, nm)) continue;
      const ports = v >= 1002 ? [] : PORTS.filter((n) => { const p = this.port(n); return !p.routed && !this.trunking(n) && (p.access === v || p.voice === v); }).map((n) => this.short(n));
      const lines = [];
      let cur = '';
      for (const p of ports) {
        const add = cur ? `${cur}, ${p}` : p;
        if (add.length > 31) { lines.push(cur + ','); cur = p; } else cur = add;
      }
      if (cur) lines.push(cur);
      out.push(pad(String(v), 5) + pad(nm, 33) + pad(v >= 1002 ? 'act/unsup' : 'active', 10) + (lines[0] || ''));
      for (const l of lines.slice(1)) out.push(' '.repeat(48) + l);
    }
    if (!brief) {
      out.push('', 'VLAN Type  SAID       MTU   Parent RingNo BridgeNo Stp  BrdgMode Trans1 Trans2',
        '---- ----- ---------- ----- ------ ------ -------- ---- -------- ------ ------');
      for (const [v] of rows) if (!filter || filter(v, vl.get(v))) out.push(`${pad(v, 5)}${pad(v >= 1002 ? (v === 1003 || v === 1005 ? 'tr' : 'fddi') : 'enet', 6)}${pad(100000 + v, 11)}1500  -      -      -        -    -        0      0`);
    }
    return out.join('\n');
  }
  showStp(only) {
    const mode = (childKey(this.running, 'spanning-tree mode') || { l: 'x x rapid-pvst' }).l.split(' ')[2];
    const proto = mode === 'rapid-pvst' ? 'rstp' : mode === 'pvst' ? 'ieee' : 'mstp';
    const out = [];
    const list = [...this.vlans().keys()].filter((v) => (only ? v === only : true) && this.members(v).length);
    if (only && !list.length) return `Spanning tree instance(s) for vlan ${only} does not exist.`;
    for (const v of list) {
      const rp = this.rootPort(v), mine = this.myPrio(v);
      const rootPrio = rp ? WORLD[rp].prio + v : mine + v;
      out.push(`VLAN${String(v).padStart(4, '0')}`, `  Spanning tree enabled protocol ${proto}`);
      if (rp) {
        out.push(`  Root ID    Priority    ${rootPrio}`, `             Address     ${WORLD[rp].mac}`, '             Cost        2',
          `             Port        ${this.portNo(rp)} (${rp})`);
      } else {
        out.push(`  Root ID    Priority    ${rootPrio}`, `             Address     ${ME}`, '             This bridge is the root');
      }
      out.push('             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec', '',
        `  Bridge ID  Priority    ${mine + v}  (priority ${mine} sys-id-ext ${v})`, `             Address     ${ME}`,
        '             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec', '             Aging Time  300 sec', '',
        'Interface           Role Sts Cost      Prio.Nbr Type', '------------------- ---- --- --------- -------- --------------------------------');
      for (const n of this.members(v)) {
        const up = WORLD[n] && WORLD[n].kind === 'up';
        let role = 'Desg', sts = 'FWD';
        if (up && rp) { if (n === rp) role = 'Root'; else { role = 'Altn'; sts = 'BLK'; } }
        const te = /^Ten/.test(n), p = this.port(n);
        const type = !up && p.portfast && !this.trunking(n) ? 'P2p Edge' : 'P2p';
        out.push(pad(this.short(n), 20) + pad(role, 5) + pad(sts, 4) + pad(te ? 2 : 4, 10) + pad(`128.${this.portNo(n)}`, 9) + type);
      }
      out.push('', '');
    }
    return out.join('\n').trimEnd();
  }
  portNo(n) { const m = n.match(/(\d+)$/); return /^Ten/.test(n) ? 24 + +m[1] : +m[1]; }
  macRows() {
    const rows = [];
    for (const n of PORTS) {
      const c = WORLD[n];
      if (!c || c.kind === 'up' || c.kind === 'oob' || !this.linkUp(n)) continue;
      const p = this.port(n);
      if (p.routed || this.trunking(n) || !this.vlanExists(p.access)) continue;
      if (c.kind === 'phone') {
        if (p.voice && this.vlanExists(p.voice)) rows.push([p.voice, c.mac, 'DYNAMIC', this.short(n)]);
        rows.push([p.access, c.pc, 'DYNAMIC', this.short(n)]);
      } else rows.push([p.access, c.mac, 'DYNAMIC', this.short(n)]);
    }
    for (const v of this.vlans().keys()) {
      const rp = this.rootPort(v);
      if (rp) { rows.push([v, WORLD[TE(1)].mac, 'DYNAMIC', this.short(rp)]); rows.push([v, WORLD[TE(2)].mac, 'DYNAMIC', this.short(rp)]); }
    }
    return rows.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  }
  showMac(filter) {
    const cpu = ['0100.0ccc.cccc', '0100.0ccc.cccd', '0180.c200.0000', '0180.c200.0002', '0180.c200.000e', 'ffff.ffff.ffff'].map((m) => ['All', m, 'STATIC', 'CPU']);
    let rows = [...(filter ? [] : cpu), ...this.macRows()];
    if (filter) rows = rows.filter(filter);
    return ['          Mac Address Table', '-------------------------------------------', '',
      'Vlan    Mac Address       Type        Ports', '----    -----------       --------    -----',
      ...rows.map((r) => `${lpad(r[0], 4)}    ${pad(r[1], 18)}${pad(r[2], 12)}${r[3]}`),
      `Total Mac Addresses for this criterion: ${rows.length}`].join('\n');
  }
  showCdp(detail) {
    const on = this.running.k.some((c) => c.l === 'no cdp run');
    if (on) return '% CDP is not enabled';
    const rows = PORTS.filter((n) => WORLD[n] && WORLD[n].cdp && this.linkUp(n) && this.cdpOn(n));
    if (detail) {
      return rows.map((n) => {
        const c = WORLD[n].cdp;
        return ['-------------------------', `Device ID: ${c.id}`, 'Entry address(es): ', `  IP address: ${{ 'lab-dist1': '172.16.99.2', 'lab-dist2': '172.16.99.3', 'lab-ap1': '172.16.99.21' }[c.id] || '10.10.20.13'}`,
          `Platform: ${c.plat === 'C9500-24Y' ? 'cisco C9500-24Y' : c.plat === 'IP Phone' ? 'Cisco IP Phone 8851' : 'cisco C9120AXI-B'},  Capabilities: ${c.cap.includes('R') ? 'Router Switch IGMP' : c.cap.includes('P') ? 'Host Phone Two-port Mac Relay' : 'Trans-Bridge Source-Route-Bridge IGMP'}`,
          `Interface: ${n},  Port ID (outgoing port): ${c.port.replace('Ten ', 'TenGigabitEthernet').replace('Gig ', 'GigabitEthernet')}`, 'Holdtime : 151 sec', '',
          `Version :`, c.plat === 'C9500-24Y' ? 'Cisco IOS Software [Cupertino], Catalyst L3 Switch Software (CAT9K_IOSXE), Version 17.9.4a (simulated)' : 'simulated', '',
          'advertisement version: 2', `Native VLAN: ${WORLD[n].native || 1}`, 'Duplex: full'].join('\n');
      }).join('\n\n') + `\n\nTotal cdp entries displayed : ${rows.length}`;
    }
    const T = (n) => { const t = this.typeOf(n); return `${t.cdp} ${n.slice(t.name.length)}`; };
    return ['Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge',
      '                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone, ',
      '                  D - Remote, C - CVTA, M - Two-port Mac Relay ', '',
      'Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID',
      ...rows.map((n, i) => { const c = WORLD[n].cdp; return pad(c.id, 17) + pad(T(n), 18) + pad(String(130 + i * 9), 11) + lpad(c.cap, 10) + '  ' + pad(c.plat, 10) + c.port; }),
      '', `Total cdp entries displayed : ${rows.length}`].join('\n');
  }
  showVersion() {
    return [
      'Cisco IOS XE Software, Version 17.09.04a (simulated)',
      'Cisco IOS Software [Cupertino], Catalyst L3 Switch Software (CAT9K_IOSXE), Version 17.9.4a, RELEASE SOFTWARE (fc3)',
      '',
      'This is a practice simulation, not a real device.',
      '',
      `${this.host()} uptime is ${longUptime(this.uptime())}`,
      `Uptime for this control processor is ${longUptime(this.uptime() + 120)}`,
      'System returned to ROM by Reload Command',
      'System image file is "flash:packages.conf"',
      'Last reload reason: Reload Command',
      '',
      'cisco C9300-24P (X86) processor with 1331521K/6147K bytes of memory.',
      'Processor board ID LAB00000001',
      '1 Virtual Ethernet interface',
      '28 Gigabit Ethernet interfaces',
      '4 Ten Gigabit Ethernet interfaces',
      '2048K bytes of non-volatile configuration memory.',
      '',
      'Switch Ports Model              SW Version        SW Image              Mode   ',
      '------ ----- -----              ----------        ----------            ----   ',
      '*    1 29    C9300-24P          17.09.04a         CAT9K_IOSXE           INSTALL',
      '',
      'Configuration register is 0x102',
    ].join('\n');
  }
  bootLines() {
    return ['Chassis 1 reloading, reason - Reload command', '', 'Initializing Hardware......', 'System Bootstrap, Version 17.9.1r (simulated)',
      'Loading: flash:packages.conf', 'Both links down, not bridging; preparing hardware', 'Waiting for 120 seconds for other switches to boot (skipped: simulated)',
      `All switches in the stack have been discovered. Accelerating discovery`];
  }
}
function ipNumBroadcast(ip, len) {
  const base = net(ip, len).split('.').reduce((a, o) => a * 256 + +o, 0) + 2 ** (32 - len) - 1;
  return [24, 16, 8, 0].map((b) => Math.floor(base / 2 ** b) % 256).join('.');
}
