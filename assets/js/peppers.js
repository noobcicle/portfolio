// Pepper plants for the garden section. They grow up from the bottom of the screen as you
// scroll through it, set fruit, and the peppers swell and ripen from green to big and red by the
// time you leave it.
// Scrolling back up shrinks them again. It is one small SVG, and a frame only rewrites a
// few transform and opacity attributes, and only when the scroll position moved enough to show.

const NS = 'http://www.w3.org/2000/svg';
const W = 640, H = 230;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// where each plant stands, when in the scroll it sprouts, how big it gets, and whether it is mirrored
const PLANTS = [
  { x: 72, at: 0.10, size: 0.8, flip: false },
  { x: 178, at: 0.02, size: 1, flip: true },
  { x: 292, at: 0.15, size: 0.9, flip: false },
  { x: 404, at: 0.05, size: 1.06, flip: true },
  { x: 508, at: 0.19, size: 0.86, flip: false },
  { x: 596, at: 0.11, size: 0.72, flip: true },
];
const GROW = 0.56;      // how much of the scroll one plant takes to grow up
const RIPE = 0.78;      // where in the scroll the peppers start turning red

// one plant, drawn with its base at 0,0 and growing up (negative y)
const STEM = 'M0 0C-3-50 5-105 1-168';
const BRANCHES = ['M0-48C10-58 22-64 34-70', 'M1-82C-10-96-22-106-32-124', 'M2-112C12-126 22-136 26-152'];
// [x, y, angle, length]; 0° points right, negative angles point up
const LEAVES = [
  [0, -16, 200, 24], [1, -22, -18, 26], [34, -70, -14, 30], [21, -61, 52, 22],
  [-32, -124, 214, 30], [-18, -103, 158, 24], [26, -152, -62, 28], [15, -129, 12, 24],
  [1, -168, -100, 26], [1, -160, -148, 22], [2, -158, -38, 22], [-1, -68, 192, 22],
  [1, -96, -14, 22], [1, -140, 202, 21],
];
const FRUIT = [[23, -64], [-23, -110], [16, -133]];
const PEPPER = 'M-5.5 3C-8 11-5.5 21-1 29C0 30.5 1.4 30.5 2.2 29C6.5 20 8 10 5.5 3C3 .5-3 .5-5.5 3Z';
const CAP = 'M-6.5 3.6C-3.5-.6 3.5-.6 6.5 3.6C3.4 2.2-3.4 2.2-6.5 3.6Z';

const leaf = ([x, y, a, l]) =>
  `<g transform="translate(${x} ${y}) rotate(${a})"><path fill="url(#pp-leaf)" d="M0 0C${l * .3} ${-l * .28} ${l * .72} ${-l * .26} ${l} 0C${l * .7} ${l * .22} ${l * .28} ${l * .24} 0 0Z"/><path class="pp-rib" d="M${l * .08} 0L${l * .84} 0"/></g>`;
const fruit = ([x, y]) =>
  `<g class="pp-fruit" transform="translate(${x} ${y}) scale(0)"><path class="pp-stalk" d="M0 1.5C.5-2.5 2-4.5 4-6"/><path fill="url(#pp-green)" d="${PEPPER}"/><path fill="url(#pp-amber)" opacity="0" d="${PEPPER}"/><path fill="url(#pp-red)" opacity="0" d="${PEPPER}"/><path fill="#2f7d45" d="${CAP}"/><path class="pp-shine" d="M-2.6 7C-3.6 13-2.6 19-.6 24"/></g>`;
const plant = (p) =>
  `<ellipse class="pp-soil" cx="${p.x}" cy="${H}" rx="${30 * p.size}" ry="7"/>` +
  `<g class="pp-plant" transform="translate(${p.x} ${H}) scale(0)"><path class="pp-stem" d="${STEM}"/>${BRANCHES.map(d => `<path class="pp-branch" d="${d}"/>`).join('')}${LEAVES.map(leaf).join('')}${FRUIT.map(fruit).join('')}</g>`;

export function initPeppers(el, { reduceMotion = false } = {}) {
  if (!el) return { update() {} };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML =
    '<defs>' +
    '<linearGradient id="pp-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#86e29a"/><stop offset="1" stop-color="#2e8c50"/></linearGradient>' +
    '<linearGradient id="pp-green" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9be47f"/><stop offset="1" stop-color="#3d9c45"/></linearGradient>' +
    '<linearGradient id="pp-amber" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd36b"/><stop offset="1" stop-color="#ee8a22"/></linearGradient>' +
    '<linearGradient id="pp-red" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff7a6e"/><stop offset="1" stop-color="#d91f3c"/></linearGradient>' +
    '</defs>' + PLANTS.map(plant).join('');
  el.append(svg);

  const plants = [...svg.querySelectorAll('.pp-plant')].map((g, i) => ({
    ...PLANTS[i], g, last: '',
    fruit: [...g.querySelectorAll('.pp-fruit')].map(f => ({ f, amber: f.children[2], red: f.children[3], s: -1, r: -1 })),
  }));

  let lastQ = -1;
  function update(p) {
    const q = Math.round(clamp(p) * 400) / 400;
    if (q === lastQ) return;
    lastQ = q;
    for (const pl of plants) {
      const g = clamp((q - pl.at) / GROW);
      const e = 1 - (1 - g) ** 3;
      // taller faster than wider, so it reads as growing up rather than zooming in
      const sy = g > 0 ? (0.06 + 0.94 * e) * pl.size : 0;
      const sx = g > 0 ? (0.4 + 0.6 * e) * pl.size * (pl.flip ? -1 : 1) : 0;
      const t = `translate(${pl.x} ${H}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})`;
      if (t !== pl.last) { pl.last = t; pl.g.setAttribute('transform', t); }
      pl.fruit.forEach((fr, j) => {
        // the fruit sets small and swells past full size as it ripens
        const s = Math.round((clamp((g - 0.55 - j * 0.08) / 0.22) * 1.0 + clamp((q - RIPE + 0.12) / 0.2) * 0.45) * 100) / 100;
        const r = Math.round(clamp((q - RIPE - j * 0.035 - pl.at * 0.12) / 0.1) * 100) / 100;
        if (s !== fr.s) { fr.s = s; fr.f.setAttribute('transform', `translate(${FRUIT[j][0]} ${FRUIT[j][1]}) scale(${s})`); }
        // green, then amber, then red: a straight green-to-red fade goes through mud
        if (r !== fr.r) { fr.r = r; fr.amber.setAttribute('opacity', clamp(r * 2)); fr.red.setAttribute('opacity', clamp(r * 2 - 1)); }
      });
    }
  }
  if (reduceMotion) update(1);
  return { update };
}
