// The lab's system map: what comes in, which machine handles it, what goes out.
// The boxes are plain HTML. This draws the wires between them on wide screens: square-cornered
// hairlines that run down the side of each machine's panel, with a light pulse riding each one.

// [from, to, kind]: in = an input into a system, out = a system out to a device, x = system to system
const WIRES = [
  ['io-voice', 'app-hub', 'in'], ['io-keys', 'app-hub', 'in'], ['io-market', 'app-ticker', 'in'],
  ['io-nws', 'app-house', 'in'], ['io-you', 'app-site', 'in'],
  ['app-ollama', 'app-house', 'x'],
  ['app-thaddeus', 'io-sonos', 'out'], ['app-dj', 'io-sonos', 'out'], ['app-house', 'io-phones', 'out'],
  ['app-dnd', 'io-discord', 'out'], ['app-plex', 'io-tv', 'out'],
];
const COLOR = { in: '#ff5ca8', out: '#4c8dff', x: '#c46bff' };

// an orthogonal path through the points, with rounded corners
function path(pts, r = 8) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const a = Math.min(r, Math.hypot(x1 - x0, y1 - y0) / 2), b = Math.min(r, Math.hypot(x2 - x1, y2 - y1) / 2);
    const ux = Math.sign(x1 - x0), uy = Math.sign(y1 - y0), vx = Math.sign(x2 - x1), vy = Math.sign(y2 - y1);
    d += ` L${(x1 - ux * a).toFixed(1)},${(y1 - uy * a).toFixed(1)} Q${x1.toFixed(1)},${y1.toFixed(1)} ${(x1 + vx * b).toFixed(1)},${(y1 + vy * b).toFixed(1)}`;
  }
  const [xe, ye] = pts[pts.length - 1];
  return d + ` L${xe.toFixed(1)},${ye.toFixed(1)}`;
}

export function initSysmap(root, { reduceMotion = false } = {}) {
  if (!root) return;
  const svg = root.querySelector('.sys-wires');
  const wide = matchMedia('(min-width: 861px)');

  function draw() {
    if (!wide.matches) { svg.innerHTML = ''; root.classList.remove('has-wires'); return; }
    const R = root.getBoundingClientRect();
    if (R.width < 10) return;
    const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left - R.left, r: r.right - R.left, t: r.top - R.top, b: r.bottom - R.top, cx: r.left + r.width / 2 - R.left, cy: r.top + r.height / 2 - R.top }; };
    const panel = (el) => box(el.closest('.sys-host'));
    let out = '';
    WIRES.forEach(([from, to, kind], i) => {
      const a = document.getElementById(from), b = document.getElementById(to);
      if (!a || !b) return;
      const A = box(a), B = box(b);
      let pts;
      if (kind === 'in') {
        // down from the input, along the panel's left gutter, into the app's left edge
        const P = panel(b), y = P.t - 12 - (i % 3) * 3, gx = P.l + 6;
        pts = [[A.cx, A.b], [A.cx, y], [gx, y], [gx, B.cy], [B.l, B.cy]];
      } else if (kind === 'out') {
        // out of the app's right edge, down the panel's right gutter, into the output from above
        const P = panel(a), y = P.b + 12 + (i % 3) * 3, gx = P.r - 6;
        pts = [[A.r, A.cy], [gx, A.cy], [gx, y], [B.cx, y], [B.cx, B.t]];
      } else {
        // machine to machine, through the gap between their panels
        const P = panel(a), Q = panel(b), gx = (P.r + Q.l) / 2;
        pts = [[A.r, A.cy], [gx, A.cy], [gx, B.cy], [B.l, B.cy]];
      }
      const d = path(pts);
      const c = COLOR[kind];
      out += `<path class="sys-wire" d="${d}" stroke="${c}"/>`;
      if (!reduceMotion) {
        const dur = (3.2 + (i % 4) * 0.45).toFixed(2);
        out += `<circle class="sys-pulse" r="2.6" fill="#fff" style="filter:drop-shadow(0 0 4px ${c})"><animateMotion dur="${dur}s" begin="-${(i * 0.7).toFixed(1)}s" repeatCount="indefinite" path="${d}"/></circle>`;
      }
    });
    svg.setAttribute('viewBox', `0 0 ${R.width.toFixed(1)} ${R.height.toFixed(1)}`);
    svg.innerHTML = out;
    root.classList.add('has-wires');
  }

  // pulses only run while the map is on screen
  if (!reduceMotion) new IntersectionObserver(([en]) => {
    if (typeof svg.pauseAnimations !== 'function') return;
    en.isIntersecting ? svg.unpauseAnimations() : svg.pauseAnimations();
  }).observe(root);
  new ResizeObserver(draw).observe(root);
  wide.addEventListener('change', draw);
  (document.fonts?.ready || Promise.resolve()).then(draw);
}
