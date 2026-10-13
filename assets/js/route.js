// The scroll bar is a small internet. Scrolling carries one packet from your computer to me,
// one router per section. It leaves as a frame, becomes a packet at your router, and gets
// routed for real on the way: IS-IS runs Dijkstra over the ISP's link costs, and BGP walks
// its best-path rules at the borders. Cloudflare (AS13335) and Starlink (AS14593) are the
// networks this page really crossed. The ISP, the transit networks (RFC 5398 documentation
// ASNs) and every metric are made up.

const LAYERS = 13;
const GUMMY = [[255, 92, 168], [196, 107, 255], [76, 141, 255]];

// [id, layer, lane, kind, name]: one layer per section, three lanes across
const NODES = [
  ['tv', 0, 0, 'ghost', 'smart TV'], ['you', 0, 1, 'host', 'you'], ['phone', 0, 2, 'ghost', 'phone'],
  ['gw', 1, 1, 'router', 'your router'],
  ['pe2', 2, 0, 'router', 'pe2'], ['pe1', 2, 1, 'router', 'pe1'], ['pe3', 2, 2, 'router', 'pe3'],
  ['p1', 3, 0, 'router', 'p1'], ['p2', 3, 1, 'router', 'p2'], ['p3', 3, 2, 'router', 'p3'],
  ['p4', 4, 0, 'router', 'p4'], ['p5', 4, 1, 'router', 'p5'], ['p6', 4, 2, 'router', 'p6'],
  ['bdr1', 5, 0, 'router', 'bdr1'], ['bdr2', 5, 1, 'router', 'bdr2'], ['bdr3', 5, 2, 'router', 'bdr3'],
  ['tr1', 6, 0, 'router', 'transit, AS64511'], ['ixa', 6, 1, 'fabric', 'exchange A'], ['ixb', 6, 2, 'fabric', 'exchange B'],
  ['cf0', 7, 0, 'router', 'Cloudflare'], ['cf1', 7, 1, 'router', 'Cloudflare'], ['cf2', 7, 2, 'router', 'Cloudflare'],
  ['ord', 8, 1, 'router', 'Cloudflare ORD'],
  ['sl0', 9, 0, 'router', 'Starlink PoP'], ['sl1', 9, 1, 'router', 'Starlink PoP'], ['sl2', 9, 2, 'router', 'Starlink PoP'],
  ['sat0', 10, 0, 'sat', 'satellite'], ['sat1', 10, 1, 'sat', 'satellite'], ['sat2', 10, 2, 'sat', 'satellite'],
  ['nas', 11, 0, 'ghost', 'NAS'], ['pi', 11, 1, 'host', 'Pi Black'], ['studio', 11, 2, 'ghost', 'Mac Studio'],
  ['mike', 12, 1, 'mike', 'Mike'],
];

// [a, b, metric or kind]: a number is an IS-IS link cost inside the ISP
const LINKS = [
  ['tv', 'gw', 'lan'], ['you', 'gw', 'lan'], ['phone', 'gw', 'lan'],
  ['gw', 'pe1', 'access'],
  ['pe2', 'p1', 10], ['pe2', 'p2', 20], ['pe1', 'p1', 10], ['pe1', 'p2', 50], ['pe1', 'p3', 20], ['pe3', 'p2', 20], ['pe3', 'p3', 10],
  ['p1', 'p4', 10], ['p1', 'p5', 10], ['p2', 'p4', 10], ['p2', 'p5', 10], ['p2', 'p6', 10], ['p3', 'p5', 30], ['p3', 'p6', 20],
  ['p4', 'bdr1', 10], ['p4', 'bdr2', 30], ['p5', 'bdr2', 30], ['p5', 'bdr3', 10], ['p6', 'bdr2', 10], ['p6', 'bdr3', 20],
  ['bdr1', 'tr1', 'ebgp'], ['bdr2', 'ixa', 'ebgp'], ['bdr3', 'ixb', 'ebgp'],
  ['tr1', 'cf0', 'ebgp'], ['ixa', 'cf1', 'ebgp'], ['ixb', 'cf2', 'ebgp'],
  ['cf0', 'ord', 'core'], ['cf1', 'ord', 'core'], ['cf2', 'ord', 'core'],
  ['ord', 'sl0', 'ebgp'], ['ord', 'sl1', 'ebgp'], ['ord', 'sl2', 'ebgp'],
  ['sl0', 'sat0', 'space'], ['sl0', 'sat1', 'space'], ['sl1', 'sat0', 'space'], ['sl1', 'sat1', 'space'],
  ['sl1', 'sat2', 'space'], ['sl2', 'sat1', 'space'], ['sl2', 'sat2', 'space'],
  ['sat0', 'pi', 'space'], ['sat1', 'pi', 'space'], ['sat2', 'pi', 'space'],
  ['nas', 'pi', 'lan'], ['pi', 'studio', 'lan'],
  ['pi', 'mike', 'human'],
];

const ZONES = [
  { from: 0, to: 1, label: 'LAN', name: 'your network' },
  { from: 2, to: 5, label: 'AS64496', name: 'your ISP' },
  { from: 6, to: 6, label: 'AS64511', right: 'IX', name: 'the border' },
  { from: 7, to: 8, label: 'AS13335', name: 'Cloudflare' },
  { from: 9, to: 10, label: 'AS14593', name: 'Starlink' },
  { from: 11, to: 12, label: 'HOME', name: 'my basement' },
];

// ---------------------------------------------------------------- routing, for real
function graph(keep) {
  const g = new Map();
  const add = (u, v, m) => (g.get(u) || g.set(u, []).get(u)).push([v, m]);
  for (const [a, b, m] of LINKS) if (keep(m)) { add(a, b, m); add(b, a, m); }
  return g;
}

// IS-IS SPF: Dijkstra from one router over everyone's flooded link costs
function spf(g, src) {
  const dist = new Map([[src, 0]]), prev = new Map(), done = new Set();
  for (;;) {
    let u = null, du = Infinity;
    for (const [n, d] of dist) if (!done.has(n) && d < du) { u = n; du = d; }
    if (u === null) return { dist, prev };
    done.add(u);
    for (const [v, m] of g.get(u) || []) {
      if (du + m < (dist.get(v) ?? Infinity)) { dist.set(v, du + m); prev.set(v, u); }
    }
  }
}

// BGP best path: walk the rules in order until one route is left
const RULES = [
  ['LOCAL_PREF', r => -r.lp, (w, l) => `LOCAL_PREF ${w.lp} > ${l.lp}`],
  ['AS_PATH', r => r.path.length, (w, l) => `AS_PATH ${w.path.length} < ${l.path.length}`],
  ['ORIGIN', r => 'ie?'.indexOf(r.origin), (w, l) => `ORIGIN ${w.origin} < ${l.origin}`],
  ['MED', null, (w, l) => `MED ${w.med} < ${l.med}`],
  ['eBGP', r => (r.ibgp ? 1 : 0), () => 'eBGP over iBGP'],
  ['IGP', r => r.igp, (w, l) => `IGP cost ${w.igp} < ${l.igp}`],
];
function bestPath(routes) {
  let left = routes;
  const why = [];
  for (const [rule, key, say] of RULES) {
    if (left.length < 2) break;
    // MED only means something between routes from the same neighbor AS
    const keep = rule === 'MED'
      ? left.filter(r => !left.some(o => o.path[0] === r.path[0] && o.med < r.med))
      : left.filter(r => key(r) === Math.min(...left.map(key)));
    const lost = left.filter(r => !keep.includes(r));
    if (lost.length) why.push(say(keep[0], lost[0]));
    left = keep;
  }
  return { best: left[0], why };
}

const downOf = (id) => {
  const L = NODES.find(n => n[0] === id)[1];
  return LINKS.filter(l => l[0] === id && NODES.find(n => n[0] === l[1])[1] === L + 1).map(l => l[1]);
};

// Starlink hands your dish a new satellite every 15 seconds
const satSlot = () => Math.floor(Date.now() / 15000);

function computeRoute(slot) {
  const isis = graph(m => typeof m === 'number');
  const metric = (a, b) => (isis.get(a) || []).find(([v]) => v === b)?.[1];
  const fromPE = spf(isis, 'pe1');
  const exits = [
    { via: 'bdr1', lp: 100, path: [64511, 13335] }, // transit: costs money, so lower preference
    { via: 'bdr2', lp: 200, path: [13335] },        // peering at exchange A
    { via: 'bdr3', lp: 200, path: [13335] },        // peering at exchange B
  ].map(r => ({ origin: 'i', med: 0, ibgp: true, igp: fromPE.dist.get(r.via), ...r }));
  const edge = bestPath(exits);
  const exit = edge.best.via;
  const toExit = spf(isis, exit).dist;
  const inside = [exit];
  while (inside[0] !== 'pe1') inside.unshift(fromPE.prev.get(inside[0]));

  const path = ['you', 'gw', ...inside];
  path.push(downOf(exit)[0]);           // the eBGP neighbor: an exchange or the transit
  path.push(downOf(path.at(-1))[0]);    // the Cloudflare colo on the far side
  path.push('ord');                     // Cloudflare carries it to the colo my tunnel lands in
  const toStarlink = [
    { via: 'sl0', path: [64500, 14593] },  // through a transit network
    { via: 'sl1', path: [14593], med: 0 },
    { via: 'sl2', path: [14593], med: 50 },
  ].map(r => ({ lp: 100, origin: 'i', med: 0, ibgp: false, igp: 0, ...r }));
  const space = bestPath(toStarlink);
  path.push(space.best.via);
  const sats = downOf(space.best.via);
  path.push(sats[slot % sats.length], 'pi', 'mike');

  // every hop's choice, for the animation: which next hops it weighed and why
  const picks = path.map((id, k) => {
    const next = path[k + 1];
    const cands = next ? downOf(id) : [];
    const pick = { cands, next };
    if (k === 2) {
      pick.bgp = exits.map(r => {
        const via = [r.via];
        while (via[0] !== 'pe1') via.unshift(fromPE.prev.get(via[0]));
        return { ids: [...via, downOf(r.via)[0]], win: r.via === exit };
      });
      pick.why = edge.why;
    } else if (k > 2 && k < 2 + inside.length - 1) {
      const cost = c => metric(id, c) + (toExit.get(c) ?? Infinity);
      const rivals = cands.filter(c => c !== next && Number.isFinite(cost(c))).sort((a, b) => cost(a) - cost(b));
      pick.spf = { win: cost(next), lose: rivals[0], loseCost: rivals.length ? cost(rivals[0]) : null };
    } else if (k === 8) {
      pick.why = space.why;
    }
    return pick;
  });
  return { path, picks, exit, starlink: space.best.via };
}

// what the card next to the packet says at each hop, and its line in the traceroute
function writeNotes(route, visitor) {
  const { path, picks } = route;
  const field = visitor.v6 ? 'HOP LIMIT' : 'TTL';
  const fieldLow = visitor.v6 ? 'hop limit' : 'TTL';
  let ttl = visitor.ttl;
  const colo = visitor.colo ? `Cloudflare ${visitor.colo}` : 'Cloudflare';
  return path.map((id, k) => {
    const p = picks[k];
    const n = (pdu, msg, why, line = why) => ({ pdu, msg, why, line });
    switch (k) {
      case 0: return n('FRAME', 'Leaves your computer', "a frame, to your router's MAC");
      case 1: return n(`PACKET · ${field} ${--ttl}`, 'Your router', 'drops the frame. Now it’s a packet.');
      case 2: return n(`${field} ${--ttl}`, `BGP picks the exit: ${route.exit}`, p.why.join(', then '), `BGP picks ${route.exit}: ${p.why.join(', then ')}`);
      case 6: return n(`${field} ${ttl}`, 'Internet exchange', `switched, not routed: ${fieldLow} stays ${ttl}`);
      case 7: return n('PROXIED', colo, 'anycast caught it. TLS ends here.');
      case 8: return n('QUIC · HOP LIMIT 64', 'Into my tunnel at ORD', `BGP: ${p.why.join(', ')}`, `into my tunnel. BGP to AS14593: ${p.why.join(', ')}`);
      case 9: return n('HOP LIMIT 63', 'Starlink ground station', 'a new satellite every 15 seconds');
      case 10: return n('HOP LIMIT 63', 'Satellite, ~550 km up', 'not a router: hop limit stays 63', 'about 550 km up. Not a router: hop limit stays 63');
      case 11: return n('HTTP · GET /', 'Pi Black, in my basement', 'out of the tunnel, into nginx');
      case 12: return n('LAYER 8', 'Mike', 'delivered. Okay, cool.', 'layer 8. Delivered. Okay, cool.');
      default: {
        // inside the ISP: hop-by-hop IS-IS, then the exit hands it over
        if (id === route.exit) {
          const as = path[k + 1] === 'tr1' ? 64511 : 13335;
          return n(`${field} ${--ttl}`, `eBGP to AS${as}`, as === 13335 ? 'peering at an exchange' : 'through a transit network', `eBGP to AS${as}, ${as === 13335 ? 'peering at an exchange' : 'through a transit network'}`);
        }
        const s = p.spf || {};
        const why = s.lose ? `cost ${s.win} beats ${s.loseCost} via ${s.lose}` : `cost ${s.win}`;
        return n(`${field} ${--ttl}`, `IS-IS next hop: ${p.next}`, `SPF ${why}`, `IS-IS next hop ${p.next}: ${why}`);
      }
    }
  });
}

// ---------------------------------------------------------------- drawing
const mix = (t) => {
  const s = Math.min(1, Math.max(0, t)) * (GUMMY.length - 1), i = Math.min(GUMMY.length - 2, Math.floor(s)), f = s - i;
  return GUMMY[i].map((c, j) => Math.round(c + (GUMMY[i + 1][j] - c) * f));
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const ease = (u) => 1 - Math.pow(1 - u, 3);
const esc = (v) => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initRoute(root, { chapters, reduceMotion = false } = {}) {
  const canvas = root.querySelector('canvas');
  const main = canvas.getContext('2d');
  // The network itself only changes when the packet reaches a new router, so it's painted
  // into two cached layers (under and over the trail). A scroll frame just stacks them around
  // the trail and the packet instead of re-stroking every link.
  const under = document.createElement('canvas'), over = document.createElement('canvas');
  let ctx = main, layerKey = '', prefix = [], drawnHop = -1, noteTf = '';
  const note = root.querySelector('.route-note');
  const pduEl = note.querySelector('.route-pdu'), msgEl = note.querySelector('.route-msg'), whyEl = note.querySelector('.route-why');
  const map = root.querySelector('.route-map');
  const mapList = map.querySelector('ol');

  const nodes = new Map(NODES.map(([id, L, lane, kind, name]) => [id, { id, L, lane, kind, name, x: 0, y: 0 }]));
  const links = LINKS.map(([a, b, m]) => ({ a: nodes.get(a), b: nodes.get(b), kind: typeof m === 'number' ? 'isis' : m, pts: [], cum: [] }));
  const linkBy = new Map();
  for (const l of links) { linkBy.set(l.a.id + '>' + l.b.id, l); linkBy.set(l.b.id + '>' + l.a.id, l); }

  const visitor = { colo: null, v6: false, ttl: /Windows/.test(navigator.userAgent) ? 128 : 64 };
  let route = computeRoute(satSlot());
  let notes = writeNotes(route, visitor);
  // a tall box is the desktop rail; a wide one is the phone strip under the nav
  let W = 0, H = 0, dpr = 1, step = 0, zones = [], horiz = false, noteW = 0;
  const at = (x, y) => (horiz ? x / W : y / H);
  let stops = [], hop = 0, lastK = -1, raf = 0, noteT = 0;
  const fx = [];
  const sprites = new Map();

  // ------------------------------------------------------------ layout
  function sample(l) {
    const { a, b } = l, n = a.L === b.L ? 1 : 22;
    const dx = b.x - a.x, dy = b.y - a.y;
    const c1 = horiz ? [a.x + dx * 0.5, a.y] : [a.x, a.y + dy * 0.5];
    const c2 = horiz ? [b.x - dx * 0.5, b.y] : [b.x, b.y - dy * 0.5];
    l.pts = []; l.cum = [0];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * u * a.x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b.x;
      const y = u * u * u * a.y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b.y;
      if (i) l.cum.push(l.cum[i - 1] + Math.hypot(x - l.pts[i - 1][0], y - l.pts[i - 1][1]));
      l.pts.push([x, y]);
    }
  }
  function layout() {
    const r = root.getBoundingClientRect();
    const d = Math.min(window.devicePixelRatio || 1, 2);
    if (r.width === W && r.height === H && d === dpr && W >= 10) return true;
    W = r.width; H = r.height;
    if (W < 10 || H < 10) { W = 0; return false; }
    dpr = d;
    for (const c of [canvas, under, over]) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    sprites.clear();
    layerKey = '';
    horiz = W > H;
    root.classList.toggle('is-horiz', horiz);
    step = (horiz ? W : H) / LAYERS;
    const c = (z) => mix((z.from + z.to + 1) / 2 / LAYERS);
    if (horiz) {
      const lanes = [H * 0.47, H * 0.67, H * 0.87];
      for (const n of nodes.values()) { n.x = (n.L + 0.5) * step; n.y = lanes[n.lane]; }
      zones = ZONES.map(z => ({ ...z, x0: z.from * step + 1.5, x1: (z.to + 1) * step - 1.5, y0: 1.5, y1: H - 1.5, c: c(z) }));
    } else {
      const lanes = [W * 0.3, W * 0.58, W * 0.86];
      for (const n of nodes.values()) { n.x = lanes[n.lane]; n.y = (n.L + 0.5) * step; }
      zones = ZONES.map(z => ({ ...z, x0: 1.5, x1: W - 1.5, y0: z.from * step + 2, y1: (z.to + 1) * step - 2, c: c(z) }));
    }
    for (const l of links) sample(l);
    return true;
  }

  // ------------------------------------------------------------ primitives
  function glow(c, size) {
    const key = c.join(',') + '|' + size;
    if (sprites.has(key)) return sprites.get(key);
    const s = document.createElement('canvas'), r = Math.ceil(size * dpr);
    s.width = s.height = r * 2;
    const g = s.getContext('2d'), grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.2, rgba(c, 0.85));
    grad.addColorStop(0.5, rgba(c, 0.25));
    grad.addColorStop(1, rgba(c, 0));
    g.fillStyle = grad; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
    sprites.set(key, s);
    return s;
  }
  const blit = (c, x, y, size, alpha = 1) => { ctx.globalAlpha = alpha; ctx.drawImage(glow(c, size), x - size, y - size, size * 2, size * 2); ctx.globalAlpha = 1; };
  function strokePts(pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  // the first fraction f of a link, oriented from `from`
  function partial(l, from, f) {
    const pts = l.a === from ? l.pts : [...l.pts].reverse();
    const cum = l.a === from ? l.cum : l.cum.map(c => l.cum.at(-1) - c).reverse();
    const want = f * cum.at(-1), out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] <= want) { out.push(pts[i]); continue; }
      const u = (want - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u]);
      break;
    }
    return out;
  }
  const linkOn = (a, b) => linkBy.get(a + '>' + b);
  const onPath = (n) => route.path[n.L] === n.id;
  function routePts(ids) {
    const out = [];
    for (let i = 0; i + 1 < ids.length; i++) out.push(...partial(linkOn(ids[i], ids[i + 1]), nodes.get(ids[i]), 1));
    return out;
  }
  // furthest layer the decisions so far have already settled
  const horizon = (k) => (k >= 2 && k < 7 ? 7 : k + 1);

  // ------------------------------------------------------------ frame
  function paintLayers(k) {
    const labels = horiz ? H >= 26 : step >= 34;
    ctx = under.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    // autonomous systems
    ctx.font = `500 ${horiz ? 6.5 : 7.5}px "Geist Mono", ui-monospace, monospace`;
    ctx.textBaseline = 'alphabetic';
    for (const z of zones) {
      const on = k >= z.from && k <= z.to;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0, horiz ? 7 : 9) : ctx.rect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      ctx.fillStyle = on ? rgba(z.c, 0.075) : 'rgba(205,180,255,0.025)';
      ctx.fill();
      ctx.strokeStyle = on ? rgba(z.c, 0.5) : 'rgba(205,180,255,0.09)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (!labels) continue;
      ctx.fillStyle = on ? 'rgba(245,240,253,0.95)' : 'rgba(185,172,212,0.5)';
      ctx.textAlign = 'left';
      const wide = z.x1 - z.x0;
      if (horiz && ctx.measureText(z.label).width > wide - 8) continue;
      ctx.fillText(z.label, z.x0 + (horiz ? 4 : 4.5), z.y0 + (horiz ? 8 : 11));
      const right = z.label === 'LAN' ? (visitor.family || '') : z.label === 'AS13335' ? (visitor.colo || '') : z.right;
      if (right && ctx.measureText(z.label + right).width < wide - 14) { ctx.textAlign = 'right'; ctx.fillText(right, z.x1 - 4.5, z.y0 + (horiz ? 8 : 11)); }
    }
    ctx.textAlign = 'left';

    // links: idle, rejected (a choice already made against it) or planned (the route ahead)
    for (const l of links) {
      const flat = l.a.L === l.b.L;
      const onRoute = !flat && onPath(l.a) && onPath(l.b);
      const decided = !flat && onPath(l.a) && l.a.L <= k;
      ctx.setLineDash(l.kind === 'ebgp' ? [3, 3] : l.kind === 'space' ? [1, 3] : []);
      ctx.lineWidth = 1;
      if (onRoute && l.a.L >= k && l.b.L <= horizon(k)) {
        ctx.strokeStyle = rgba(mix(at(l.b.x, l.b.y)), 0.55);
        ctx.setLineDash([2, 3]);
      } else if (decided && !onRoute) {
        ctx.strokeStyle = 'rgba(205,180,255,0.05)';
      } else {
        const past = l.b.L <= k && !onRoute;
        ctx.strokeStyle = `rgba(205,180,255,${past ? 0.07 : l.kind === 'lan' || l.kind === 'human' ? 0.12 : 0.17})`;
      }
      strokePts(l.pts);
    }
    ctx.setLineDash([]);


    ctx = over.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    // routers
    for (const n of nodes.values()) {
      const lit = onPath(n) && n.L <= k;
      const cur = onPath(n) && n.L === k;
      const c = mix(at(n.x, n.y));
      if (lit) blit(c, n.x, n.y, cur ? (horiz ? 9 : 13) : (horiz ? 6 : 8), cur ? 0.9 : 0.55);
      const dim = !onPath(n) && n.L < k ? 0.16 : n.kind === 'ghost' ? 0.2 : 0.42;
      ctx.fillStyle = lit ? '#fff' : `rgba(245,240,253,${dim})`;
      ctx.strokeStyle = ctx.fillStyle;
      if (n.kind === 'fabric') {
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(n.x - 6, n.y - 1.4, 12, 2.8, 1.4) : ctx.rect(n.x - 6, n.y - 1.4, 12, 2.8); ctx.fill();
      } else if (n.kind === 'sat') {
        ctx.beginPath(); ctx.moveTo(n.x, n.y - 3); ctx.lineTo(n.x + 3, n.y); ctx.lineTo(n.x, n.y + 3); ctx.lineTo(n.x - 3, n.y); ctx.closePath(); ctx.fill();
      } else if (n.kind === 'mike') {
        drawWorm(n.x, n.y, k >= LAYERS - 1);
      } else {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.kind === 'ghost' ? 1.5 : n.kind === 'host' ? 2.8 : 2.2, 0, Math.PI * 2); ctx.fill();
        if (n.kind === 'host') { ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(n.x, n.y, 5, 0, Math.PI * 2); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1; }
      }
      if (cur && k < LAYERS - 1) {
        ctx.strokeStyle = rgba(c, 0.75); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(n.x, n.y, horiz ? 4.5 : 6.5, 0, Math.PI * 2); ctx.stroke();
      }
    }

    ctx = main;
    // the trail up to the current router never changes within a hop either
    prefix = [];
    for (let i = 0; i < k; i++) prefix.push(...partial(linkOn(route.path[i], route.path[i + 1]), nodes.get(route.path[i]), 1));
  }

  function draw(now) {
    const k = Math.min(LAYERS - 1, Math.floor(hop + 1e-6)), f = hop - k;
    const key = [k, route.path.join(), visitor.colo, visitor.family, W, H, dpr, fontsReady].join('|');
    if (key !== layerKey) { paintLayers(k); layerKey = key; }
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(under, 0, 0, W, H);

    // transient flashes under the trail
    ctx.globalCompositeOperation = 'lighter';
    for (const e of fx) {
      if (e.kind !== 'flash') continue;
      const u = (now - e.t0) / e.dur;
      if (u < 0 || u > 1) continue;
      ctx.lineWidth = e.width || 1.6;
      ctx.strokeStyle = rgba(e.c, (1 - u) * (e.a || 0.9));
      strokePts(e.pts);
    }

    // the trail: everything the packet has crossed, in gummy
    const trail = prefix.slice();
    if (k < LAYERS - 1) trail.push(...partial(linkOn(route.path[k], route.path[k + 1]), nodes.get(route.path[k]), f));
    if (!trail.length) trail.push([nodes.get('you').x, nodes.get('you').y]);
    const grad = horiz ? ctx.createLinearGradient(0, 0, W, 0) : ctx.createLinearGradient(0, 0, 0, H);
    GUMMY.forEach((c, i) => grad.addColorStop(i / (GUMMY.length - 1), rgba(c, 1)));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = grad;
    ctx.globalAlpha = 0.22; ctx.lineWidth = 7; strokePts(trail);
    ctx.globalAlpha = 1; ctx.lineWidth = 2.2; strokePts(trail);
    ctx.globalCompositeOperation = 'source-over';

    ctx.drawImage(over, 0, 0, W, H);

    // probes, ripples and shed headers
    ctx.globalCompositeOperation = 'lighter';
    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i], u = (now - e.t0) / e.dur;
      if (u > 1) { fx.splice(i, 1); continue; }
      if (u < 0 || e.kind === 'flash') continue;
      if (e.kind === 'ripple') {
        ctx.strokeStyle = rgba(e.c, 0.8 * (1 - u)); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(e.x, e.y, 4 + ease(u) * (e.r || 16), 0, Math.PI * 2); ctx.stroke();
      } else if (e.kind === 'probe') {
        const pos = pointAt(e.pts, e.cum, ease(u));
        blit(e.c, pos[0], pos[1], 9, e.win ? 1 : 0.9 * (1 - u * 0.4));
      } else if (e.kind === 'shard') {
        const d = ease(u);
        const sx = e.x + e.vx * d, sy = e.y + e.vy * d;
        blit(e.c, sx, sy, 7, 0.6 * (1 - u));
        ctx.fillStyle = rgba(e.c, 1 - u);
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(e.rot * d);
        ctx.fillRect(-e.w / 2, -1.5, e.w, 3); ctx.restore();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // the packet
    if (hop < LAYERS - 1 - 1e-6) {
      const [x, y] = trail.at(-1);
      const prev = trail.length > 1 ? trail.at(-2) : [x, y - 1];
      const ang = Math.atan2(y - prev[1], x - prev[0]);
      const c = mix(at(x, y));
      if (k === 0) {
        blit(GUMMY[0], x, y, horiz ? 10 : 14, 0.9);
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.fillStyle = '#ff5ca8';
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-7, -2.8, 14, 5.6, 2.8) : ctx.rect(-7, -2.8, 14, 5.6); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(2.5, -2, 2.6, 4); // the header, out front
        ctx.restore();
      } else {
        blit(c, x, y, horiz ? 10 : 15, 1);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, horiz ? 2.2 : 2.6, 0, Math.PI * 2); ctx.fill();
        if (k >= 8 && k < 11) { // wrapped in the tunnel
          ctx.strokeStyle = 'rgba(196,107,255,0.95)'; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.arc(x, y, horiz ? 4.6 : 6, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
  }

  function pointAt(pts, cum, u) {
    const want = u * cum.at(-1);
    let i = 1;
    while (i < pts.length - 1 && cum[i] < want) i++;
    const t = (want - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  }
  function cumOf(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return cum;
  }

  const WORM = new Path2D('M6 20c6-10 12-10 18 0s12 10 18 0 12-10 16-2');
  function drawWorm(x, y, home) {
    const s = horiz ? 0.27 : 0.36;
    ctx.save();
    ctx.translate(x - 32 * s, y - 17 * s); ctx.scale(s, s);
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, '#ff5ca8'); g.addColorStop(0.48, '#c46bff'); g.addColorStop(1, '#4c8dff');
    ctx.lineCap = 'round';
    if (home) { ctx.globalAlpha = 0.35; ctx.strokeStyle = g; ctx.lineWidth = 16; ctx.stroke(WORM); }
    ctx.globalAlpha = home ? 1 : 0.45;
    ctx.strokeStyle = g; ctx.lineWidth = 7; ctx.stroke(WORM);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ the choices, animated
  function arrive(k, now) {
    const id = route.path[k], n = nodes.get(id), pick = route.picks[k];
    const c = mix(at(n.x, n.y));
    const add = (e, delay = 0) => fx.push({ t0: now + delay, ...e });
    add({ kind: 'ripple', x: n.x, y: n.y, c, dur: 650 });

    if (k === 1) { // the frame comes off: header one way, trailer the other
      add({ kind: 'shard', x: n.x, y: n.y, vx: -24, vy: -14, rot: -2.2, w: 8, c: [255, 255, 255], dur: 900 });
      add({ kind: 'shard', x: n.x, y: n.y, vx: 22, vy: -10, rot: 2.6, w: 5, c: GUMMY[0], dur: 900 });
    }
    if (k === 2) {
      // IS-IS floods the ISP first, then BGP weighs every way out
      const seen = new Set([id]); let wave = [id], d = 0;
      while (wave.length) {
        const nextWave = [];
        for (const u of wave) for (const l of links) {
          if (l.kind !== 'isis' || (l.a.id !== u && l.b.id !== u)) continue;
          const v = l.a.id === u ? l.b.id : l.a.id;
          add({ kind: 'flash', pts: l.pts, c: [143, 211, 255], a: 0.85, width: 1.8, dur: 560 }, d);
          if (!seen.has(v)) { seen.add(v); nextWave.push(v); }
        }
        wave = nextWave; d += 90;
      }
      for (const r of pick.bgp) {
        const pts = routePts(r.ids);
        add({ kind: 'probe', pts, cum: cumOf(pts), c: r.win ? [143, 211, 255] : GUMMY[0], win: r.win, dur: 900 }, d + 60);
        add({ kind: 'flash', pts, c: r.win ? [143, 211, 255] : GUMMY[0], a: r.win ? 0.9 : 0.6, width: r.win ? 2 : 1.4, dur: 900 }, d + 700);
      }
      return;
    }
    if (pick.cands.length > 1) {
      for (const cId of pick.cands) {
        const l = linkOn(id, cId), pts = partial(l, n, 1), win = cId === pick.next;
        add({ kind: 'probe', pts, cum: cumOf(pts), c: win ? [143, 211, 255] : GUMMY[0], win, dur: 480 }, 80);
        add({ kind: 'flash', pts, c: win ? [143, 211, 255] : GUMMY[0], a: win ? 0.95 : 0.55, width: win ? 2 : 1.3, dur: 700 }, 480);
      }
    }
    if (k === 8) add({ kind: 'ripple', x: n.x, y: n.y, c: [196, 107, 255], r: 9, dur: 500 }, 120);
    if (k === 11) for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      add({ kind: 'shard', x: n.x, y: n.y, vx: Math.cos(a) * 12, vy: Math.sin(a) * 12, rot: 1.5, w: 3.5, c: [196, 107, 255], dur: 650 });
    }
    if (k === LAYERS - 1) add({ kind: 'ripple', x: n.x, y: n.y, c: GUMMY[1], r: 26, dur: 1100 }, 60);
  }

  // ------------------------------------------------------------ the card and the map
  function writeNote(k) {
    const n = notes[k];
    pduEl.textContent = n.pdu; msgEl.textContent = n.msg; whyEl.textContent = n.why;
    note.classList.toggle('is-frame', k === 0);
    noteW = note.offsetWidth;
    for (const li of mapList.children) li.classList.toggle('is-here', +li.dataset.k === k);
  }
  function buildMap() {
    mapList.innerHTML = notes.map((n, k) => {
      const node = nodes.get(route.path[k]);
      const zone = ZONES.find(z => k >= z.from && k <= z.to);
      const as = node.L === 6 ? (node.id === 'tr1' ? 'AS64511' : '') : zone.label.startsWith('AS') ? zone.label : '';
      const name = node.L === 7 && visitor.colo ? `Cloudflare ${visitor.colo}` : node.name;
      return `<li data-k="${k}"><span class="rm-k">${String(k).padStart(2, '0')}</span>` +
        `<span class="rm-node">${esc(name)}${as ? ` <i>${as}</i>` : ''}</span>` +
        `<span class="rm-ch">${esc(chapters[k]?.dataset.chapter || '')}</span>` +
        `<span class="rm-msg">${esc(n.line)}</span></li>`;
    }).join('');
    writeNote(Math.min(LAYERS - 1, Math.floor(hop + 1e-6)));
  }
  mapList.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    if (horiz) root.classList.remove('is-open');
    chapters[+li.dataset.k]?.scrollIntoView();
  });
  let mapT = 0;
  root.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(mapT); mapT = setTimeout(() => root.classList.add('is-open'), 140);
  });
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(mapT); mapT = setTimeout(() => root.classList.remove('is-open'), 220);
  });
  let lastPointer = 'mouse';
  canvas.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; });
  canvas.addEventListener('click', (e) => {
    if (lastPointer !== 'mouse') { root.classList.toggle('is-open'); return; }
    // it's still a scroll bar: click a router to go to its section
    const r = canvas.getBoundingClientRect();
    const along = horiz ? e.clientX - r.left : e.clientY - r.top;
    chapters[Math.max(0, Math.min(LAYERS - 1, Math.floor(along / step)))]?.scrollIntoView();
  });
  document.addEventListener('click', (e) => {
    if (root.classList.contains('is-open') && !root.contains(e.target)) root.classList.remove('is-open');
  });

  // ------------------------------------------------------------ scroll
  function frame(now) {
    raf = 0;
    drawnHop = hop;
    draw(now);
    if (fx.length) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf && W) raf = requestAnimationFrame(frame); };
  const kickIfMoved = () => { if (fx.length || Math.abs(hop - drawnHop) > 0.0004) kick(); };

  function measure() {
    if (!layout()) return;
    const docH = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    stops = chapters.map((c, i) => (i ? Math.min(1, Math.max(0, (c.getBoundingClientRect().top + scrollY - innerHeight * 0.35) / docH)) : 0));
    for (let i = 1; i < stops.length; i++) stops[i] = Math.max(stops[i], stops[i - 1] + 1e-4);
    // on wide screens the card fits in the margin, so it can stay up
    const wrap = document.querySelector('main .wrap');
    const left = wrap ? wrap.getBoundingClientRect().left + parseFloat(getComputedStyle(wrap).paddingLeft) : 0;
    root.classList.toggle('is-roomy', !horiz && left - root.getBoundingClientRect().right > 330);
    kick();
  }

  function update(p, scrolling) {
    if (!W) return;
    // reading, not exploring: a scroll with the pointer parked on the rail closes the map
    if (scrolling && root.classList.contains('is-open') && (horiz || !map.matches(':hover'))) { clearTimeout(mapT); root.classList.remove('is-open'); }
    if (stops.length === LAYERS) {
      let k = 0;
      while (k < LAYERS - 1 && p >= stops[k + 1]) k++;
      hop = k === LAYERS - 1 ? k : k + Math.min(1, (p - stops[k]) / (stops[k + 1] - stops[k]));
    } else hop = p * (LAYERS - 1);
    const k = Math.min(LAYERS - 1, Math.floor(hop + 1e-6));
    if (k !== lastK) {
      const now = performance.now();
      if (k === 9 && lastK === 8) { // the dish may be on a different satellite by now
        const fresh = computeRoute(satSlot());
        if (fresh.path.join() !== route.path.join()) { route = fresh; notes = writeNotes(route, visitor); buildMap(); }
      }
      if (!reduceMotion && lastK >= 0 && k > lastK && k - lastK <= 2) for (let j = lastK + 1; j <= k; j++) arrive(j, now);
      if (lastK >= 0 && scrolling) {
        root.classList.add('is-noting');
        clearTimeout(noteT); noteT = setTimeout(() => root.classList.remove('is-noting'), 2600);
      }
      lastK = k;
      writeNote(k);
    }
    const [x, y] = currentPos();
    const tf = horiz
      ? `translate3d(${Math.round(Math.min(W - noteW - 8, Math.max(8, x - noteW / 2)))}px, 0, 0)`
      : `translate3d(0, ${Math.round(Math.min(H - 70, Math.max(0, y - 22)))}px, 0)`;
    // only move the card while it's showing: a transform write re-runs layout for the rail's overflow
    const shown = root.classList.contains('is-noting') || root.classList.contains('is-roomy');
    if (shown && tf !== noteTf) note.style.transform = noteTf = tf;
    kickIfMoved();
  }
  function currentPos() {
    const k = Math.min(LAYERS - 1, Math.floor(hop + 1e-6));
    if (k >= LAYERS - 1) return [nodes.get('mike').x, nodes.get('mike').y];
    return partial(linkOn(route.path[k], route.path[k + 1]), nodes.get(route.path[k]), hop - k).at(-1);
  }

  buildMap();
  let fontsReady = false;
  (document.fonts?.ready || Promise.resolve()).then(() => { fontsReady = true; kick(); });

  return {
    measure,
    update,
    // what Cloudflare told us about this visit: the colo that caught it and the IP family
    setVisitor({ colo, v6 }) {
      visitor.colo = colo || null; visitor.v6 = !!v6; visitor.family = v6 ? 'IPv6' : 'IPv4';
      notes = writeNotes(route, visitor);
      buildMap();
      kick();
    },
  };
}
