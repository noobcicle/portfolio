// Hero canvas: a small network whose packets are gummy worms of light.
// Nodes are routers, edges are links, packets hop node to node along them.
// Pointer pushes the mesh a little; a click pings the nearest router.
// It's a background, so it's kept cheap: at most 30 frames a second at 1.5x resolution, links
// batched into a few strokes, packet tails drawn from pre-made sprites, and it stops entirely
// once you've scrolled away.

const COLORS = ['#ff5ca8', '#c46bff', '#4c8dff', '#8fd3ff', '#ff9fd0'];

export function initHero(canvas, { reduceMotion = false } = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  let w = 0, h = 0, dpr = 1;
  let nodes = [], edges = [], adj = [], packets = [], pings = [];
  let pointer = { x: -9999, y: -9999, active: false };
  let running = false, visible = true, raf = 0, last = 0, drawn = 0, fade = 1, slow = 0, shown = false;
  const sprites = new Map(), tails = new Map();
  const FRAME = 1000 / 30;   // a background doesn't need 60 (or a ProMotion 120) frames a second
  const LEVELS = 6;          // links are stroked in this many brightness buckets, not one by one

  function sprite(color) {
    if (sprites.has(color)) return sprites.get(color);
    const s = document.createElement('canvas');
    const r = 28 * dpr;
    s.width = s.height = r * 2;
    const g = s.getContext('2d');
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.18, color);
    grad.addColorStop(0.45, hexA(color, 0.35));
    grad.addColorStop(1, hexA(color, 0));
    g.fillStyle = grad;
    g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
    sprites.set(color, s);
    return s;
  }

  // a packet's tail: a short streak that fades out behind it, drawn once per color
  function tail(color) {
    if (tails.has(color)) return tails.get(color);
    const s = document.createElement('canvas');
    s.width = Math.round(26 * dpr); s.height = Math.round(6 * dpr);
    const g = s.getContext('2d');
    const grad = g.createLinearGradient(0, 0, s.width, 0);
    grad.addColorStop(0, hexA(color, 0)); grad.addColorStop(1, hexA(color, 0.95));
    g.strokeStyle = grad; g.lineWidth = 3.2 * dpr; g.lineCap = 'round';
    g.beginPath(); g.moveTo(1.6 * dpr, s.height / 2); g.lineTo(s.width - 1.6 * dpr, s.height / 2); g.stroke();
    tails.set(color, s);
    return s;
  }

  function build() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = Math.max(1, rect.width); h = Math.max(1, rect.height);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sprites.clear(); tails.clear();

    const area = w * h;
    const target = Math.round(Math.min(90, Math.max(30, area / 16000)));
    const minD = Math.sqrt(area / target) * 0.62;
    nodes = [];
    let tries = 0;
    while (nodes.length < target && tries < target * 60) {
      tries++;
      const x = 20 + Math.random() * (w - 40);
      const y = 20 + Math.random() * (h - 40);
      if (nodes.every(n => (n.x - x) ** 2 + (n.y - y) ** 2 > minD * minD)) {
        nodes.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, big: Math.random() < 0.12, glow: 0 });
      }
    }
    // connect each node to its 2-3 nearest neighbours
    const set = new Set();
    edges = []; adj = nodes.map(() => []);
    nodes.forEach((n, i) => {
      const near = nodes.map((m, j) => [j, (m.x - n.x) ** 2 + (m.y - n.y) ** 2]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]);
      const k = n.big ? 4 : 2 + (Math.random() < 0.5 ? 1 : 0);
      for (const [j] of near.slice(0, k)) {
        const key = i < j ? i + ':' + j : j + ':' + i;
        if (set.has(key)) continue;
        set.add(key);
        const e = { a: i, b: j, heat: 0 };
        adj[i].push(edges.length); adj[j].push(edges.length);
        edges.push(e);
      }
    });
    const pc = Math.round(nodes.length * (w < 700 ? 0.4 : 0.6));
    packets = Array.from({ length: pc }, () => newPacket());
  }

  function newPacket(from) {
    const start = from ?? Math.floor(Math.random() * nodes.length);
    const list = adj[start];
    const ei = list.length ? list[Math.floor(Math.random() * list.length)] : 0;
    const e = edges[ei];
    return {
      e: ei, from: start, to: e ? (e.a === start ? e.b : e.a) : start,
      t: from === undefined ? Math.random() : 0,
      speed: 70 + Math.random() * 110,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      len: 10 + Math.random() * 16,
    };
  }

  function step(dt) {
    // springs back to home position, pushed by pointer
    for (const n of nodes) {
      let fx = (n.ox - n.x) * 6, fy = (n.oy - n.y) * 6;
      if (pointer.active) {
        const dx = n.x - pointer.x, dy = n.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 170 * 170) {
          const d = Math.sqrt(d2) || 1;
          const f = (1 - d / 170) * 900;
          fx += (dx / d) * f; fy += (dy / d) * f;
          n.glow = Math.min(1, n.glow + dt * 4);
        }
      }
      n.vx = (n.vx + fx * dt) * 0.86; n.vy = (n.vy + fy * dt) * 0.86;
      n.x += n.vx * dt; n.y += n.vy * dt;
      n.glow = Math.max(0, n.glow - dt * 1.2);
    }
    for (const e of edges) e.heat = Math.max(0, e.heat - dt * 1.6);
    for (const p of packets) {
      const a = nodes[p.from], b = nodes[p.to];
      if (!a || !b) continue;
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      p.t += (p.speed * dt) / L;
      edges[p.e].heat = Math.min(1, edges[p.e].heat + dt * 2.5);
      if (p.t >= 1) {
        b.glow = Math.min(1, b.glow + 0.35);
        const options = adj[p.to].filter(ei => ei !== p.e);
        const ei = (options.length ? options : adj[p.to])[Math.floor(Math.random() * (options.length || adj[p.to].length))];
        const e = edges[ei];
        p.e = ei; p.from = p.to; p.to = e.a === p.to ? e.b : e.a; p.t = 0;
      }
    }
    for (const g of pings) g.r += dt * 520, g.a -= dt * 0.9;
    pings = pings.filter(g => g.a > 0);
  }

  const buckets = Array.from({ length: LEVELS }, () => []);
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = fade;
    // links, in a few brightness buckets
    for (const b of buckets) b.length = 0;
    for (const e of edges) {
      const a = nodes[e.a], b = nodes[e.b];
      const lit = Math.max(e.heat * 0.5, (a.glow + b.glow) * 0.5);
      buckets[Math.min(LEVELS - 1, Math.round(lit * (LEVELS - 1)))].push(e);
    }
    ctx.lineWidth = 1;
    buckets.forEach((list, i) => {
      if (!list.length) return;
      ctx.strokeStyle = `rgba(205,180,255,${(0.07 + (i / (LEVELS - 1)) * 0.22).toFixed(3)})`;
      ctx.beginPath();
      for (const e of list) { const a = nodes[e.a], b = nodes[e.b]; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    });
    // routers: the quiet ones in one path, the lit and big ones on their own
    ctx.fillStyle = 'rgba(245,240,253,0.35)';
    ctx.beginPath();
    for (const n of nodes) if (!n.big && n.glow < 0.02) { ctx.moveTo(n.x + 1.7, n.y); ctx.arc(n.x, n.y, 1.7, 0, Math.PI * 2); }
    ctx.fill();
    for (const n of nodes) {
      if (!n.big && n.glow < 0.02) continue;
      const r = n.big ? 3.2 : 1.7;
      ctx.fillStyle = `rgba(245,240,253,${(0.35 + n.glow * 0.6).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
      if (n.big) {
        ctx.strokeStyle = `rgba(143,211,255,${(0.25 + n.glow * 0.5).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 5 + n.glow * 4, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // packets: a soft glow plus a short gummy tail along the link
    ctx.globalCompositeOperation = 'lighter';
    for (const p of packets) {
      const a = nodes[p.from], b = nodes[p.to];
      if (!a || !b) continue;
      const x = a.x + (b.x - a.x) * p.t, y = a.y + (b.y - a.y) * p.t;
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(sprite(p.color), x - 11, y - 11, 22, 22);
      const len = Math.min(p.len, p.t * L);
      if (len > 1) {
        // rotate onto the link, so the tail's bright end sits on the packet
        ctx.setTransform(dpr * ux, dpr * uy, -dpr * uy, dpr * ux, dpr * x, dpr * y);
        ctx.drawImage(tail(p.color), -len, -3, len, 6);
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    for (const g of pings) {
      ctx.strokeStyle = `rgba(255,159,208,${Math.max(0, g.a)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // the canvas fades in (site.css) once there's a network on it, rather than popping in
    if (!shown) { shown = true; canvas.classList.add('on'); }
  }

  function frame(t) {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (drawn && t - drawn < FRAME - 2) return;   // hold to ~30 frames a second
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t; drawn = t;
    // shed load on machines that can't keep up even at 30
    if (dt > 0.045) { slow++; if (slow > 30 && packets.length > 20) { packets.length = Math.floor(packets.length * 0.75); slow = 0; } }
    else slow = Math.max(0, slow - 1);
    step(dt); draw();
  }

  function start() {
    if (running || reduceMotion || !visible || document.hidden || fade < 0.04) return;
    running = true; last = 0; drawn = 0; raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  build();
  if (reduceMotion) { step(0.016); draw(); }
  else start();

  const ro = new ResizeObserver(() => { build(); if (!running) draw(); });
  ro.observe(canvas);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; visible ? start() : stop(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  const host = canvas.parentElement;
  host.addEventListener('pointermove', (ev) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = ev.clientX - r.left; pointer.y = ev.clientY - r.top; pointer.active = true;
  }, { passive: true });
  host.addEventListener('pointerleave', () => { pointer.active = false; });
  host.addEventListener('click', (ev) => {
    if (ev.target.closest('a, button')) return;
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    let best = 0, bd = Infinity;
    nodes.forEach((n, i) => { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = i; } });
    const n = nodes[best];
    if (!n) return;
    pings.push({ x: n.x, y: n.y, r: 4, a: 0.9 });
    n.glow = 1;
    for (let i = 0; i < 6; i++) packets.push(newPacket(best));
    if (packets.length > 220) packets.splice(0, packets.length - 220);
  });

  return {
    // called on every scroll frame: only repaint when the fade really changed and the hero is on screen
    setFade(v) {
      if (Math.abs(v - fade) < 0.004 && v !== 0 && v !== 1) return;
      if (v === fade) return;
      fade = v;
      // nearly faded out: stop drawing a canvas nobody can see; back near the top, start again
      if (fade < 0.04) { if (running) { stop(); draw(); } }
      else if (!running) { start(); if (!running && visible) draw(); }
    },
  };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
