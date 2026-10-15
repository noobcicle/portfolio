// A metro Ethernet access switch (ME 3600X style, IOS 15): customer ports (UNIs) and two 10G
// uplinks (NNIs) toward an aggregation router. Services are EVCs: a service instance per port,
// matched on dot1q tags (and second-dot1q for Q-in-Q), tags popped or pushed by rewrite, and joined
// in a bridge-domain. The world: four customers, each sending certain tags, and an aggregation
// router expecting certain tags back. A service passes only when every step lines up.
import { Ios, K, P, numT, wordT, ipT } from './ios.js';
import { pad, lpad, longUptime, maskLen, net, inNet, vlanList, vlanText, tnode, childKey, childLine, setLine, delKey, parseIndented } from './engine.js';

const GI = (n) => `GigabitEthernet0/${n}`;
const TE = (n) => `TenGigabitEthernet0/${n}`;
const NNI = TE(1);
const TYPES = [
  { name: 'Loopback', abbr: 'Lo', h: 'Loopback interface', re: /^\d{1,4}$/, virtual: true, order: 0, hw: 'Loopback', bw: 8000000 },
  { name: 'FastEthernet', abbr: 'Fa', h: 'FastEthernet IEEE 802.3', re: /^0$/, order: 1, hw: 'Fast Ethernet', bw: 100000, speed: '100Mb/s', media: '10/100BaseTX' },
  { name: 'GigabitEthernet', abbr: 'Gi', h: 'GigabitEthernet IEEE 802.3z', re: /^0\/([1-9]|1\d|2[0-4])$/, order: 2, hw: 'Gigabit Ethernet', bw: 1000000, speed: '1000Mb/s', media: '10/100/1000BaseTX' },
  { name: 'TenGigabitEthernet', abbr: 'Te', h: 'Ten Gigabit Ethernet', re: /^0\/[12]$/, order: 3, hw: 'Ten Gigabit Ethernet', bw: 10000000, speed: '10Gb/s', media: 'SFP-10GBase-LR' },
  { name: 'Vlan', abbr: 'Vl', h: 'Vlan interface', re: /^([1-9]\d{0,2}|[1-3]\d{3}|40[0-8]\d|409[0-4])$/, virtual: true, order: 4, hw: 'EtherSVI', bw: 1000000 },
];
const PORTS = ['FastEthernet0', ...Array.from({ length: 24 }, (_, i) => GI(i + 1)), TE(1), TE(2)];
// The customers: the tags their frames carry at the UNI, and the tags the aggregation router
// expects for them on the NNI (S-tag first). An empty list is an untagged frame.
export const CUSTOMERS = {
  'CUST-A': { uni: GI(1), what: 'port-based (all-to-one) Q-in-Q, S-VLAN 300', samples: [{ uni: [], nni: [300] }, { uni: [7], nni: [300, 7] }], mac: '0000.5e00.5331', far: '0000.5e00.5341' },
  'CUST-B': { uni: GI(2), what: 'EVPL, C-VLAN 100 handed off as VLAN 100', samples: [{ uni: [100], nni: [100] }], mac: '0000.5e00.5332', far: '0000.5e00.5342' },
  'CUST-C': { uni: GI(3), what: 'selective Q-in-Q, C-VLANs 10-20 inside S-VLAN 200', samples: [{ uni: [10], nni: [200, 10] }, { uni: [15], nni: [200, 15] }, { uni: [20], nni: [200, 20] }], mac: '0000.5e00.5333', far: '0000.5e00.5343' },
  'CUST-D': { uni: GI(4), what: 'new EVPL, C-VLAN 150 handed off as VLAN 150 (not built yet)', samples: [{ uni: [150], nni: [150] }], mac: '0000.5e00.5334', far: '0000.5e00.5344' },
};
const CABLED = new Set(['FastEthernet0', GI(1), GI(2), GI(3), GI(4), TE(1), TE(2)]);
const UNI = (n, desc, id, enc, rw, bd) => ` service instance ${id} ethernet\n  description ${desc}\n  encapsulation ${enc}\n${rw ? `  rewrite ingress tag ${rw}\n` : ''}  bridge-domain ${bd}\n`;
const trunkNone = ' switchport trunk allowed vlan none\n switchport mode trunk\n';
const FACTORY = `version 15.6
service timestamps debug datetime msec
service timestamps log datetime msec
hostname lab-me1
no aaa new-model
clock timezone CST -6 0
clock summer-time CDT recurring
ip domain name lab.example
no ip domain lookup
spanning-tree mode mst
spanning-tree extend system-id
interface FastEthernet0
 ip address 172.16.0.31 255.255.255.0
interface ${GI(1)}
 description CUST-A port-based
${trunkNone}${UNI(1, 'CUST-A all-to-one', 300, 'default', '', 300)}interface ${GI(2)}
 description CUST-B EVPL
${trunkNone}${UNI(2, 'CUST-B vlan 100', 100, 'dot1q 100', 'pop 1 symmetric', 100)}interface ${GI(3)}
 description CUST-C selective QinQ
${trunkNone}${UNI(3, 'CUST-C cvlans 10-20', 200, 'dot1q 10-20', '', 200)}${
  Array.from({ length: 21 }, (_, i) => `interface ${GI(i + 4)}\n${trunkNone}`).join('')}interface ${TE(1)}
 description NNI to lab-agg1
 mtu 9216
${trunkNone}${UNI(0, 'CUST-A s-vlan 300', 300, 'dot1q 300', 'pop 1 symmetric', 300)}${UNI(0, 'CUST-B vlan 100', 100, 'dot1q 100', 'pop 1 symmetric', 100)}${UNI(0, 'CUST-C s-vlan 200', 200, 'dot1q 200 second-dot1q 10-20', 'pop 1 symmetric', 200)}interface ${TE(2)}
 description NNI to lab-agg2 (standby)
 mtu 9216
${trunkNone}interface Vlan1
 no ip address
 shutdown
ip ssh version 2
line con 0
 logging synchronous
line vty 0 4
 login local
 transport input ssh
`;
const BLANK = `version 15.6
service timestamps debug datetime msec
service timestamps log datetime msec
hostname Switch
no aaa new-model
spanning-tree mode mst
spanning-tree extend system-id
interface FastEthernet0
 no ip address
${PORTS.slice(1).map((p) => `interface ${p}\n${trunkNone}`).join('')}interface Vlan1
 no ip address
line con 0
line vty 0 4
 login
`;
const maskT = (s) => (maskLen(s) >= 0 ? [s, 1] : null);
const vlanListT = (s) => (vlanList(s) ? [s, 1] : null);
const rangeT = (s) => (/^\d+(-\d+)?$/.test(s) && vlanList(s) ? [s, 1] : null);
const hostT = (s) => (/^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(s) ? [s, 1] : null);

// "dot1q 10-20 second-dot1q 5" -> { kind: 'dot1q', outer: [...], inner: [...] | null }
export function parseEncap(line) {
  if (!line) return null;
  const w = line.split(' ').slice(1);
  if (w[0] === 'default') return { kind: 'default' };
  if (w[0] === 'untagged') return { kind: 'untagged' };
  const list = (s) => (s === 'any' ? 'any' : vlanList(s));
  return { kind: 'dot1q', outer: list(w[1]), inner: w[2] === 'second-dot1q' ? list(w[3]) : null };
}
const inList = (l, v) => l === 'any' || l.includes(v);
function matches(enc, tags) {
  if (!enc) return false;
  if (enc.kind === 'default') return true;
  if (enc.kind === 'untagged') return tags.length === 0;
  if (!tags.length || !inList(enc.outer, tags[0])) return false;
  return !enc.inner || (tags.length > 1 && inList(enc.inner, tags[1]));
}
const specific = (enc) => (enc.kind === 'default' ? 0 : enc.kind === 'untagged' ? 1 : enc.inner ? 3 : 2);
function ingress(rw, tags) {
  if (!rw) return tags.slice();
  const w = rw.split(' ');   // rewrite ingress tag pop 1 symmetric
  if (w[3] === 'pop') return tags.slice(+w[4]);
  if (w[3] === 'push') return [+w[5], ...(w[6] === 'second-dot1q' ? [+w[7]] : []), ...tags];
  if (w[3] === 'translate') return [+w[6], ...tags.slice(1)];
  return tags.slice();
}
function egress(rw, enc, tags) {
  if (!rw || !/symmetric$/.test(rw)) return tags.slice();
  const w = rw.split(' ');
  const first = enc && enc.kind === 'dot1q' && enc.outer !== 'any' ? enc.outer[0] : null;
  const second = enc && enc.inner && enc.inner !== 'any' ? enc.inner[0] : null;
  if (w[3] === 'pop') return +w[4] === 2 ? [first, second, ...tags] : [first, ...tags];
  if (w[3] === 'push') return tags.slice(w[6] === 'second-dot1q' ? 2 : 1);
  if (w[3] === 'translate') return [first, ...tags.slice(1)];
  return tags.slice();
}

export class Me3600 extends Ios {
  get id() { return 'me3600x'; }
  get defaultHost() { return 'Switch'; }
  get types() { return TYPES; }
  get ports() { return PORTS; }
  get world() { return {}; }
  get topOrder() {
    return ['version', 'service', 'hostname', 'no aaa', 'aaa', 'clock', 'ip domain', 'no ip domain', 'spanning-tree', 'vlan', 'interface', 'ip default-gateway', 'ip route', 'ip ssh', 'line con', 'line vty'];
  }
  get ifOrderLines() { return ['description', 'mtu', 'switchport access vlan', 'switchport trunk allowed vlan', 'switchport mode', 'ip address', 'no ip address', 'shutdown', 'service instance']; }
  get srvOrder() { return ['description', 'encapsulation', 'rewrite', 'shutdown', 'bridge-domain']; }
  factory() { return parseIndented(FACTORY); }
  blankConfig() { return parseIndented(BLANK); }
  label() { return 'ME 3600X · IOS 15'; }
  motd() {
    return [
      'Simulated practice CLI: a pretend ME 3600X metro Ethernet switch. Not a real device; nothing here touches a network.',
      'Type ? for help, Tab to complete. Start with "enable". write memory saves to this browser.',
      '',
      'User Access Verification',
      '',
      `Username: ${this.user}`,
      'Password: (simulated)',
    ].join('\n');
  }
  cable(name) { return CABLED.has(name) ? { kind: name.startsWith('Ten') ? 'nni' : 'uni' } : null; }

  // ---------------------------------------------------------------- EVCs
  efps(ifName, tree = this.running) {
    const n = this.ifNode(ifName, tree);
    if (!n) return [];
    return n.k.filter((c) => /^service instance \d+ ethernet/.test(c.l)).map((s) => {
      const get = (k) => s.k.find((x) => x.l === k || x.l.startsWith(k + ' '));
      const bd = get('bridge-domain');
      return {
        if: ifName, id: +s.l.split(' ')[2], node: s,
        encLine: get('encapsulation') ? get('encapsulation').l : null,
        enc: parseEncap(get('encapsulation') && get('encapsulation').l),
        rw: get('rewrite ingress tag') ? get('rewrite ingress tag').l : null,
        bd: bd ? +bd.l.split(' ')[1] : null,
        shut: !!get('shutdown'),
        desc: get('description') ? get('description').l.slice(12) : '',
      };
    });
  }
  allEfps() { return PORTS.flatMap((p) => this.efps(p)); }
  efpUp(e) { return !!e.enc && !e.shut && this.ifState(e.if).proto; }
  // which EFP on a port takes a frame with these tags (the most specific match wins)
  efpFor(ifName, tags) {
    const c = this.efps(ifName).filter((e) => e.enc && matches(e.enc, tags));
    return c.sort((a, b) => specific(b.enc) - specific(a.enc))[0] || null;
  }
  // Walk each of the customer's sample frames across the box and out the NNI.
  svc(name) {
    const C = CUSTOMERS[name];
    for (const s of C.samples) {
      const tagText = s.uni.length ? `VLAN ${s.uni[0]}` : 'untagged frames';
      if (!this.ifState(C.uni).proto) return { ok: false, why: `${C.uni} is down` };
      const u = this.efpFor(C.uni, s.uni);
      if (!u) return { ok: false, why: `no service instance on ${C.uni} matches ${tagText}` };
      if (u.shut) return { ok: false, why: `service instance ${u.id} on ${C.uni} is shut down` };
      if (u.bd == null) return { ok: false, why: `service instance ${u.id} on ${C.uni} isn't in a bridge-domain` };
      if (!this.ifState(NNI).proto) return { ok: false, why: `${NNI} is down` };
      const inBd = ingress(u.rw, s.uni);
      const n = this.efpFor(NNI, s.nni);
      if (!n) return { ok: false, why: `nothing on ${NNI} matches what the aggregation router sends (${s.nni.join(' / ')})` };
      if (n.shut) return { ok: false, why: `service instance ${n.id} on ${NNI} is shut down` };
      if (n.bd !== u.bd) return { ok: false, why: `${C.uni} is in bridge-domain ${u.bd} but the NNI service for these tags is in ${n.bd == null ? 'no bridge-domain' : `bridge-domain ${n.bd}`}` };
      const out = egress(n.rw, n.enc, inBd);
      if (out.join(',') !== s.nni.join(',')) return { ok: false, why: `frames leave ${NNI} tagged ${out.length ? out.join(' / ') : 'untagged'}, the aggregation router expects ${s.nni.join(' / ')}` };
      const back = egress(u.rw, u.enc, ingress(n.rw, s.nni));
      if (back.join(',') !== s.uni.join(',')) return { ok: false, why: `return frames reach the customer tagged ${back.length ? back.join(' / ') : 'untagged'}, not ${s.uni.length ? s.uni.join(' / ') : 'untagged'}` };
    }
    return { ok: true, why: 'passing traffic' };
  }
  bds() {
    const m = new Map();
    for (const e of this.allEfps()) if (e.bd != null) { if (!m.has(e.bd)) m.set(e.bd, []); m.get(e.bd).push(e); }
    return new Map([...m].sort((a, b) => a[0] - b[0]));
  }
  sviUp(v) { return this.bds().has(v) && this.bds().get(v).some((e) => this.efpUp(e)); }
  reach(dst) {
    const ip = this.ipOf('FastEthernet0');
    return !!ip && this.ifState('FastEthernet0').proto && ['172.16.0.1', ip.ip].includes(dst) && inNet(dst, ip.ip, ip.len);
  }

  // ---------------------------------------------------------------- config commands
  configTree() {
    return [
      K('hostname', "Set system's network name", {
        c: [P('WORD', "This system's network name", hostT, { as: 'name', run(a) { setLine(this.running, 'hostname', `hostname ${a.name}`, (x) => this.rank(x)); this.touched(); return ''; } })],
        no() { setLine(this.running, 'hostname', 'hostname Switch', (x) => this.rank(x)); this.touched(); return ''; },
      }),
      K('interface', 'Select an interface to configure', { c: (d) => [d.ifP('if', { more: {
        run(a) {
          if (!this.ifNode(a.if)) { const n = this.at([`interface ${a.if}`]); if (/^(Vlan|Loopback)/.test(a.if)) n.k.push(tnode('no ip address')); this.touched(); }
          this.enter('if', 'config-if', [[`interface ${a.if}`]]);
          return '';
        },
        no(a) {
          if (!this.typeOf(a.if).virtual) return '% Physical interfaces cannot be removed\n';
          const n = this.ifNode(a.if);
          if (n) { this.running.k.splice(this.running.k.indexOf(n), 1); this.touched(); }
          return '';
        },
      } })] }),
      K('ip', 'Global IP configuration subcommands', { c: [
        K('domain', 'IP DNS Resolver', { c: [K('lookup', 'Enable IP Domain Name System hostname translation', {
          run() { delKey(this.running, 'no ip domain lookup'); this.touched(); return ''; },
          no() { setLine(this.running, 'no ip domain lookup', 'no ip domain lookup', (x) => this.rank(x)); this.touched(); return ''; },
        })] }),
        K('route', 'Establish static routes', { c: [P('A.B.C.D', 'Destination prefix', ipT, { as: 'pfx', c: [P('A.B.C.D', 'Destination prefix mask', maskT, { as: 'mask', c: [P('A.B.C.D', "Forwarding router's address", ipT, { as: 'nh',
          run(a) { const l = `ip route ${a.pfx} ${a.mask} ${a.nh}`; if (!childLine(this.running, l)) this.at([l]); this.touched(); return ''; },
          no(a) { const l = `ip route ${a.pfx} ${a.mask} ${a.nh}`; this.running.k = this.running.k.filter((c) => c.l !== l); this.touched(); return ''; },
        })] })] })] }),
      ] }),
      K('line', 'Configure a terminal line', { c: [
        K('console', 'Primary terminal line', { c: [P('<0-0>', 'First Line number', numT(0, 0), { as: 'n', run() { this.at(['line con 0']); this.enter('line', 'config-line', [['line con 0']]); return ''; } })] }),
        K('vty', 'Virtual terminal', { c: [P('<0-15>', 'First Line number', numT(0, 15), { as: 'a', c: [P('<1-15>', 'Last Line number', numT(1, 15), { as: 'b', run(a) { const l = `line vty ${a.a} ${a.b}`; this.at([l]); this.enter('line', 'config-line', [[l]]); return ''; } })] })] }),
      ] }),
      K('spanning-tree', 'Spanning Tree Subsystem', { c: [K('mode', 'Spanning tree operating mode', { c: ['mst', 'pvst', 'rapid-pvst'].map((m) => K(m, `${m} mode`, {
        run() { setLine(this.running, 'spanning-tree mode', `spanning-tree mode ${m}`, (x) => this.rank(x)); this.touched(); return ''; },
      })) })] }),
      K('vlan', 'Vlan commands', { c: [P('WORD', 'ISL VLAN IDs 1-1005, 802.1Q VLAN IDs 1-4094 (e.g. 10,20-25)', vlanListT, { as: 'vl',
        run(a) { const list = vlanList(a.vl); for (const v of list) if (v !== 1) this.at([`vlan ${v}`]); this.touched(); this.enter('vlan', 'config-vlan', list.map((v) => [`vlan ${v}`])); return ''; },
        no(a) { for (const v of vlanList(a.vl)) { const n = childLine(this.running, `vlan ${v}`); if (n) this.running.k.splice(this.running.k.indexOf(n), 1); } this.touched(); return ''; },
      })] }),
    ];
  }
  vlanTree() {
    return [K('name', 'Ascii name of the VLAN', { c: [P('WORD', 'The ascii name for the VLAN', wordT, { as: 'nm', run(a) { this.setHere('name', `name ${a.nm}`); return ''; } })], no() { this.delHere('name'); return ''; } })];
  }
  lineTree() {
    return [
      K('exec-timeout', 'Set the EXEC timeout', { c: [P('<0-35791>', 'Timeout in minutes', numT(0, 35791), { as: 'm', run(a) { this.setHere('exec-timeout', `exec-timeout ${a.m} 0`); return ''; } })], no() { this.delHere('exec-timeout'); return ''; } }),
      K('logging', 'Modify message logging facilities', { c: [K('synchronous', 'Synchronized message output', { run() { this.setHere('logging synchronous', 'logging synchronous'); return ''; }, no() { this.delHere('logging synchronous'); return ''; } })] }),
      K('login', 'Enable password checking', { run() { this.setHere('login', 'login'); return ''; }, c: [K('local', 'Local password checking', { run() { this.setHere('login', 'login local'); return ''; } })] }),
      K('transport', 'Define transport protocols for line', { c: [K('input', 'Define which protocols to use when connecting to the terminal server', { c: ['all', 'none', 'ssh', 'telnet'].map((t) => K(t, `${t} protocols`, { run() { this.setHere('transport input', `transport input ${t}`); return ''; } })) })] }),
    ];
  }
  ifTree() {
    const here = function () { return this.top().paths[0][0].slice(10); };
    return [
      K('description', 'Interface specific description', {
        c: [P('LINE', 'Up to 240 characters describing this interface', null, { rest: true, as: 'text', run(a) { this.setHere('description', `description ${a.text}`); return ''; } })],
        no() { this.delHere('description'); return ''; },
      }),
      K('ip', 'Interface Internet Protocol config commands', { c: [K('address', 'Set the IP address of an interface', {
        c: [P('A.B.C.D', 'IP address', ipT, { as: 'ip', c: [P('A.B.C.D', 'IP subnet mask', maskT, { as: 'mask', run(a) {
          const name = here.call(this);
          if (!/^(Vlan|Loopback|FastEthernet)/.test(name)) return '% IP addresses may not be configured on L2 links.\n';
          this.delHere('no ip address');
          this.setHere('ip address', `ip address ${a.ip} ${a.mask}`);
          return '';
        } })] })],
        no() { this.delHere('ip address'); this.setHere('no ip address', 'no ip address'); return ''; },
      })] }),
      K('mtu', 'Set the interface Maximum Transmission Unit (MTU)', {
        c: [P('<1500-9800>', 'MTU size in bytes', numT(1500, 9800), { as: 'mtu', run(a) { this.setHere('mtu', `mtu ${a.mtu}`); return ''; } })],
        no() { this.delHere('mtu'); return ''; },
      }),
      K('service', 'Configure service', { c: [K('instance', 'Configure service instance', { c: [P('<1-8000>', 'Service instance id', numT(1, 8000), { as: 'id',
        no(a) { return this.noSrv(a.id); },
        c: [K('ethernet', 'Configure ethernet service instance', {
          run(a) { return this.goSrv(a.id); },
          no(a) { return this.noSrv(a.id); },
          c: [P('WORD', 'Ethernet Virtual Circuit (EVC) name', wordT, { as: 'evc', run(a) { return this.goSrv(a.id, a.evc); } })],
        })],
      })] })] }),
      K('shutdown', 'Shutdown the selected interface', { run() { this.setHere('shutdown', 'shutdown'); return ''; }, no() { this.delHere('shutdown'); return ''; } }),
      K('switchport', 'Set switching mode characteristics', { c: [
        K('mode', 'Set trunking mode of the interface', { c: [
          K('access', 'Set trunking mode to ACCESS unconditionally', { run() { this.setHere('switchport mode', 'switchport mode access'); return ''; } }),
          K('trunk', 'Set trunking mode to TRUNK unconditionally', { run() { this.setHere('switchport mode', 'switchport mode trunk'); return ''; } }),
        ], no() { this.delHere('switchport mode'); return ''; } }),
        K('trunk', 'Set trunking characteristics of the interface', { c: [K('allowed', 'Set allowed VLAN characteristics when interface is in trunking mode', { c: [K('vlan', 'Set allowed VLANs when interface is in trunking mode', {
          c: [
            K('none', 'no VLANs', { run() { this.setHere('switchport trunk allowed vlan', 'switchport trunk allowed vlan none'); return ''; } }),
            P('WORD', 'VLAN IDs of the allowed VLANs when this port is in trunking mode', vlanListT, { as: 'vl', run(a) { this.setHere('switchport trunk allowed vlan', `switchport trunk allowed vlan ${vlanText(vlanList(a.vl))}`); return ''; } }),
          ],
          no() { this.delHere('switchport trunk allowed vlan'); return ''; },
        })] })] }),
      ] }),
    ];
  }
  goSrv(id, evc) {
    const ifl = this.top().paths[0][0];
    const line = evc ? `service instance ${id} ethernet ${evc}` : `service instance ${id} ethernet`;
    const ifn = this.at([ifl]);
    const existing = ifn.k.find((c) => c.l.startsWith(`service instance ${id} ethernet`));
    if (!existing) this.at([ifl, line]);
    this.touched();
    this.enter('srv', 'config-if-srv', [[ifl, existing ? existing.l : line]]);
    return '';
  }
  noSrv(id) {
    const n = this.at([this.top().paths[0][0]]);
    n.k = n.k.filter((c) => !c.l.startsWith(`service instance ${id} ethernet`));
    this.touched();
    return '';
  }
  srvTree() {
    const efp = function () { const n = this.nodes()[0]; const get = (k) => n.k.find((x) => x.l.startsWith(k)); return { n, enc: get('encapsulation'), rw: get('rewrite') }; };
    const rewrite = (fn) => function (a) {
      const { enc } = efp.call(this);
      if (!enc) return '% Encapsulation must be configured before rewrite\n';
      const e = parseEncap(enc.l);
      const msg = fn.call(this, a, e);
      if (msg) return msg;
      return '';
    };
    // a symmetric rewrite has to know what to push back: one outer VLAN (and one inner, to pop both)
    const single = (e, both = false) => e.kind === 'dot1q' && e.outer !== 'any' && e.outer.length === 1 && (!both || (e.inner && e.inner !== 'any' && e.inner.length === 1));
    return [
      K('bridge-domain', 'Bridge-domain', {
        c: [P('<1-4094>', 'Bridge-domain number', numT(1, 4094), { as: 'bd',
          run(a) {
            if (!efp.call(this).enc) return '% Encapsulation must be configured before bridge-domain\n';
            this.setHere('bridge-domain', `bridge-domain ${a.bd}`);
            return '';
          },
          c: [K('split-horizon', 'Configure this port as a member of a split horizon group', { run(a) {
            if (!efp.call(this).enc) return '% Encapsulation must be configured before bridge-domain\n';
            this.setHere('bridge-domain', `bridge-domain ${a.bd} split-horizon`);
            return '';
          } })],
        })],
        no() { this.delHere('bridge-domain'); return ''; },
      }),
      K('description', 'Service instance specific description', {
        c: [P('LINE', 'Up to 240 characters describing this service instance', null, { rest: true, as: 'text', run(a) { this.setHere('description', `description ${a.text}`); return ''; } })],
        no() { this.delHere('description'); return ''; },
      }),
      K('encapsulation', 'Configure ethernet frame match criteria', {
        c: [
          K('default', 'catch all encapsulation', { run() { this.setHere('encapsulation', 'encapsulation default'); this.delHere('rewrite'); return ''; } }),
          K('dot1q', 'IEEE 802.1Q encapsulation', { c: [
            K('any', 'any vlan tag', { run() { this.setHere('encapsulation', 'encapsulation dot1q any'); return ''; } }),
            P('<1-4094>', 'VLAN id, or a range like 10-20', rangeT, { as: 'outer',
              run(a) { this.setHere('encapsulation', `encapsulation dot1q ${a.outer}`); return ''; },
              c: [K('second-dot1q', 'Second (inner) 802.1Q VLAN tag', { c: [
                K('any', 'any inner vlan tag', { run(a) { this.setHere('encapsulation', `encapsulation dot1q ${a.outer} second-dot1q any`); return ''; } }),
                P('<1-4094>', 'inner VLAN id, or a range like 10-20', rangeT, { as: 'inner', run(a) { this.setHere('encapsulation', `encapsulation dot1q ${a.outer} second-dot1q ${a.inner}`); return ''; } }),
              ] })],
            }),
          ] }),
          K('untagged', 'Untagged encapsulation', { run() { this.setHere('encapsulation', 'encapsulation untagged'); this.delHere('rewrite'); return ''; } }),
        ],
        no() { this.delHere('encapsulation'); this.delHere('rewrite'); this.delHere('bridge-domain'); return ''; },
      }),
      K('rewrite', 'Configure ethernet rewrite criteria', {
        c: [K('ingress', 'Ingress rewrite', { c: [K('tag', 'Tag rewrite', { c: [
          K('pop', 'Pop the tag', { c: [P('<1-2>', 'Number of tags to pop', numT(1, 2), { as: 'n', c: [K('symmetric', 'Tag egress packets as specified in encapsulation', { run: rewrite(function (a, e) {
            if (e.kind !== 'dot1q') return '% Rewrite is not supported with this encapsulation\n';
            if (a.n === 2 && !e.inner) return '% Rewrite pop 2 needs two tags in the encapsulation (second-dot1q)\n';
            if (!single(e, a.n === 2)) return '% Symmetric rewrite needs a single VLAN in the encapsulation, not a range or any\n';
            this.setHere('rewrite', `rewrite ingress tag pop ${a.n} symmetric`);
            return '';
          }) })] })] }),
          K('push', 'Push the tag', { c: [K('dot1q', 'Push dot1q tag', { c: [P('<1-4094>', 'VLAN id', numT(1, 4094), { as: 'v1', c: [
            K('symmetric', 'Tag egress packets as specified in encapsulation', { run: rewrite(function (a) { this.setHere('rewrite', `rewrite ingress tag push dot1q ${a.v1} symmetric`); return ''; }) }),
            K('second-dot1q', 'Push a second dot1q tag', { c: [P('<1-4094>', 'VLAN id', numT(1, 4094), { as: 'v2', c: [K('symmetric', 'Tag egress packets as specified in encapsulation', { run: rewrite(function (a) { this.setHere('rewrite', `rewrite ingress tag push dot1q ${a.v1} second-dot1q ${a.v2} symmetric`); return ''; }) })] })] }),
          ] })] })] }),
          K('translate', 'Translate the tag', { c: [K('1-to-1', 'Translate 1-to-1', { c: [K('dot1q', 'Translate to a dot1q tag', { c: [P('<1-4094>', 'VLAN id', numT(1, 4094), { as: 'v1', c: [K('symmetric', 'Tag egress packets as specified in encapsulation', { run: rewrite(function (a, e) {
            if (!single(e)) return '% Symmetric rewrite needs a single VLAN in the encapsulation, not a range or any\n';
            this.setHere('rewrite', `rewrite ingress tag translate 1-to-1 dot1q ${a.v1} symmetric`);
            return '';
          }) })] })] })] })] }),
        ] })] })],
        no() { this.delHere('rewrite'); return ''; },
      }),
      K('shutdown', 'Take the Service Instance out of Service', { run() { this.setHere('shutdown', 'shutdown'); return ''; }, no() { this.delHere('shutdown'); return ''; } }),
    ];
  }

  // ---------------------------------------------------------------- show commands
  extraShow() {
    const one = (fn) => function (a) { return this.showEfp(fn ? (e) => fn(e, a) : null, false); };
    const det = (fn) => function (a) { return this.showEfp(fn ? (e) => fn(e, a) : null, true); };
    return [
      K('bridge-domain', 'Bridge-domain information', {
        run() { return this.showBd(); },
        c: [P('<1-4094>', 'Bridge-domain number', numT(1, 4094), { as: 'bd', run(a) { return this.showBd(a.bd); } })],
      }),
      K('ethernet', 'Ethernet parameters', { c: [K('service', 'Ethernet service', { c: [K('instance', 'Show ethernet service instances', {
        run: one(),
        c: (d) => [
          K('detail', 'Detailed information', { run: det() }),
          K('id', 'Show a specific service instance', { c: [P('<1-8000>', 'Service instance id', numT(1, 8000), { as: 'id', c: [K('interface', 'Interface', { c: [d.ifP('if', { exists: true, physical: true, more: {
            run: one((e, a) => e.id === a.id && e.if === a.if),
            c: [K('detail', 'Detailed information', { run: det((e, a) => e.id === a.id && e.if === a.if) })],
          } })] })] })] }),
          K('interface', 'Show service instances on an interface', { c: [d.ifP('if', { exists: true, physical: true, more: {
            run: one((e, a) => e.if === a.if),
            c: [K('detail', 'Detailed information', { run: det((e, a) => e.if === a.if) })],
          } })] }),
        ],
      })] })] }),
    ];
  }
  ifShowSubs() {
    return [
      K('status', 'Show interface line status', { run(a) { return this.showIfStatus(a.if ? [a.if] : null); } }),
      K('description', 'Show interface description', { run(a) { return this.showIfDesc(a.if ? [a.if] : null); } }),
    ];
  }
  efpState(e) { return e.shut ? 'AdminDown' : !this.ifState(e.if).proto || !e.enc ? 'Down' : 'Up'; }
  counters(e) {
    // frames in when a customer's (or the aggregation router's) frames match; out when the service passes
    let inP = 0, outP = 0;
    const secs = Math.floor(this.uptime());
    for (const [name, C] of Object.entries(CUSTOMERS)) {
      const r = this.svc(name);
      for (const s of C.samples) {
        const side = e.if === C.uni ? s.uni : e.if === NNI ? s.nni : null;
        if (!side) continue;
        const hit = this.efpFor(e.if, side);
        if (hit && hit.id === e.id && this.efpUp(e)) { inP += 1; if (r.ok) outP += 1; }
      }
    }
    const k = (n, base) => (n ? Math.floor(base + secs * (17 + e.id % 7) * n) : 0);
    return { pi: k(inP, 1200), bi: k(inP, 1200) * 412, po: k(outP, 1100), bo: k(outP, 1100) * 398 };
  }
  showEfp(filter, detail) {
    let list = this.allEfps();
    if (filter) list = list.filter(filter);
    if (!detail) {
      return [pad('Identifier', 11) + pad('Type', 8) + pad('Interface', 25) + pad('State', 11) + 'CE-Vlans',
        ...list.map((e) => pad(e.id, 11) + pad('Static', 8) + pad(e.if, 25) + pad(this.efpState(e), 11) + (e.if === NNI || !e.enc || e.enc.kind !== 'dot1q' ? '' : e.enc.outer === 'any' ? '' : vlanText(e.enc.outer)))].join('\n');
    }
    return list.map((e) => {
      const c = this.counters(e);
      return [`Service Instance ID: ${e.id}`, 'Service instance type: Static', `Associated Interface: ${e.if}`, `Associated EVC: ${e.node.l.split(' ')[4] || ''}`,
        'L2protocol drop', `CE-Vlans: ${e.enc && e.enc.kind === 'dot1q' && e.enc.outer !== 'any' && e.if !== NNI ? vlanText(e.enc.outer) : ''}`,
        `Encapsulation: ${e.encLine ? e.encLine.slice(14) + ' vlan protocol type 0x8100' : 'none'}`,
        ...(e.rw ? [`Rewrite: ${e.rw.slice(8)}`] : []), 'Interface Dot1q Tunnel Ethertype: 0x8100', `State: ${this.efpState(e)}`,
        'EFP Statistics:', '   Pkts In   Bytes In   Pkts Out  Bytes Out',
        `${lpad(c.pi, 10)} ${lpad(c.bi, 10)} ${lpad(c.po, 10)} ${lpad(c.bo, 10)}`,
        'EFP Microblocks:', '****************', ...(e.bd != null ? ['Microblock type: Bridge-domain', `Bridge-domain: ${e.bd}`] : ['Microblock type: none'])].join('\n');
    }).join('\n\n');
  }
  macsIn(bd) {
    const rows = [];
    for (const [, C] of Object.entries(CUSTOMERS)) {
      const s = C.samples[0];
      const u = this.efpFor(C.uni, s.uni), n = this.efpFor(NNI, s.nni);
      if (u && u.bd === bd && this.efpUp(u)) rows.push([C.mac.toUpperCase().replace(/^0000\.5E/, '0000.5E'), `${C.uni}.EFP${u.id}`]);
      if (n && n.bd === bd && this.efpUp(n)) rows.push([C.far.toUpperCase().replace(/^0000\.5E/, '0000.5E'), `${NNI}.EFP${n.id}`]);
    }
    return rows;
  }
  showBd(only) {
    const all = this.bds();
    if (only != null && !all.has(only)) return `Bridge-domain ${only} (0 ports in all)\nState: DOWN                  Mac learning: Enabled\nAging-Timer: 300 second(s)`;
    const out = [];
    for (const [bd, list] of all) {
      if (only != null && bd !== only) continue;
      const up = list.some((e) => this.efpUp(e));
      if (out.length) out.push('');
      out.push(`Bridge-domain ${bd} (${list.length} ports in all)`, `State: ${up ? 'UP  ' : 'DOWN'}                    Mac learning: Enabled`, 'Aging-Timer: 300 second(s)',
        ...list.map((e) => `    ${e.if} service instance ${e.id}`));
      const macs = this.macsIn(bd);
      if (macs.length) out.push('   MAC address    Policy  Tag       Age  Pseudoport', ...macs.map(([m, p], i) => `   ${pad(m, 15)}forward dynamic   ${lpad(298 - i * 7, 3)}  ${p}`));
    }
    return out.join('\n');
  }
  showVlan(brief, filter) {
    const vl = new Map([[1, 'default']]);
    for (const c of this.running.k) { const x = c.l.match(/^vlan (\d+)$/); if (x) { const nm = childKey(c, 'name'); vl.set(+x[1], nm ? nm.l.slice(5) : `VLAN${x[1].padStart(4, '0')}`); } }
    for (const bd of this.bds().keys()) if (!vl.has(bd)) vl.set(bd, `VLAN${String(bd).padStart(4, '0')}`);
    const rows = [...vl].sort((a, b) => a[0] - b[0]).concat([[1002, 'fddi-default'], [1003, 'token-ring-default'], [1004, 'fddinet-default'], [1005, 'trnet-default']]);
    const out = [pad('VLAN', 5) + pad('Name', 33) + pad('Status', 10) + 'Ports', '---- -------------------------------- --------- -------------------------------'];
    for (const [v, nm] of rows) {
      if (filter && !filter(v, nm)) continue;
      const ports = v >= 1002 ? [] : PORTS.filter((n) => this.ifLines(n).includes('switchport mode access') && +((this.ifLines(n).find((l) => l.startsWith('switchport access vlan ')) || 'x x x 1').split(' ')[3]) === v).map((n) => this.short(n));
      out.push(pad(String(v), 5) + pad(nm, 33) + pad(v >= 1002 ? 'act/unsup' : 'active', 10) + ports.join(', '));
    }
    return out.join('\n');
  }
  showStp() {
    const port = (n, role, sts) => pad(this.short(n), 20) + pad(role, 5) + pad(sts, 4) + pad(2000, 10) + pad(`128.${24 + +n.slice(-1)}`, 9) + 'P2p';
    const ups = [TE(1), TE(2)].filter((n) => this.ifState(n).proto);
    if (!ups.length) return 'No spanning tree instance exists.';
    return ['', 'MST0', '  Spanning tree enabled protocol mstp', '  Root ID    Priority    24576', '             Address     0000.5e00.5351', '             Cost        2000',
      `             Port        ${24 + +ups[0].slice(-1)} (${ups[0]})`, '             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec', '',
      '  Bridge ID  Priority    32768  (priority 32768 sys-id-ext 0)', '             Address     0000.5e00.5390', '             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec', '',
      'Interface           Role Sts Cost      Prio.Nbr Type', '------------------- ---- --- --------- -------- --------------------------------',
      ...ups.map((n, i) => port(n, i ? 'Altn' : 'Root', i ? 'BLK' : 'FWD'))].join('\n');
  }
  showIfStatus(only) {
    const rows = ['Port      Name               Status       Vlan       Duplex  Speed Type'];
    for (const n of only || PORTS) {
      const T = this.typeOf(n);
      if (!T || T.virtual) continue;
      const st = this.ifState(n), d = (this.ifLines(n).find((l) => l.startsWith('description ')) || '').slice(12);
      const status = !st.admin ? 'disabled' : st.link ? 'connected' : 'notconnect';
      const te = T.name === 'TenGigabitEthernet', fa = T.name === 'FastEthernet';
      const vlan = fa ? 'routed' : this.ifLines(n).includes('switchport mode access') ? (this.ifLines(n).find((l) => l.startsWith('switchport access vlan ')) || 'x x x 1').split(' ')[3] : 'trunk';
      rows.push(pad(this.short(n), 10) + pad(d.slice(0, 18), 19) + pad(status, 13) + pad(vlan, 11) + lpad(st.link ? (te ? 'full' : 'a-full') : 'auto', 6) + ' ' + lpad(st.link ? (te ? '10G' : fa ? 'a-100' : 'a-1000') : 'auto', 6) + ' ' + (te ? 'SFP-10GBase-LR' : T.media));
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
  showVersion() {
    return [
      'Cisco IOS Software, ME360x Software (ME360x-UNIVERSALK9-M), Version 15.6(2)SP3, RELEASE SOFTWARE (fc4) (simulated)',
      '',
      'This is a practice simulation, not a real device.',
      '',
      'ROM: Bootstrap program is ME360x boot loader',
      `${this.host()} uptime is ${longUptime(this.uptime())}`,
      'System returned to ROM by power-on',
      'System image file is "flash:me360x-universalk9-mz.156-2.SP3.bin"',
      '',
      'License Level: AdvancedMetroIPAccess',
      'cisco ME-3600X-24CX-M (PowerPC8572) processor with 786432K/262144K bytes of memory.',
      'Processor board ID LAB00000002',
      '1 FastEthernet interface',
      '24 Gigabit Ethernet interfaces',
      '2 Ten Gigabit Ethernet interfaces',
      '',
      'Configuration register is 0xF',
    ].join('\n');
  }
  bootLines() {
    return ['Initializing flashfs...', 'Loading "flash:me360x-universalk9-mz.156-2.SP3.bin"...@@@@@@@@@@@@@@@@@@@@@@@@@@@@@', 'File "flash:me360x-universalk9-mz.156-2.SP3.bin" uncompressed and installed', 'Restricted Rights Legend (simulated)'];
  }
}
