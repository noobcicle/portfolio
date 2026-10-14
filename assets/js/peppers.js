// Pepper plants for the garden section, and one whole season of them as you scroll by.
// They grow up from the bottom of the screen, set fruit, and the peppers swell and ripen from
// green to red. Keep scrolling and the season ends: the plants slump and wilt, everything goes
// brown, and then it snows. Scrolling back up runs the year backwards.
// It is one small SVG, and a frame only rewrites transforms, opacities and a few gradient stops,
// and only when the scroll position moved enough to show.

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
// past 1 the plants are grown and red; the rest of the scroll is autumn, then winter
const WILT = [1.12, 0.32];   // [start, length]: the plants slump and the leaves droop
const BROWN = [1.3, 0.3];    // leaves, stems and fruit go brown
const SNOW = [1.55, 0.45];   // snow falls and settles
const FLAKES = 70;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hex = (c) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const LEAF_LIVE = [[0x86, 0xe2, 0x9a], [0x2e, 0x8c, 0x50]], LEAF_DEAD = [[0xb8, 0x8f, 0x52], [0x6b, 0x4a, 0x2a]];
const LEAF_SNOWY = [[0xf1, 0xf3, 0xff], [0x7d, 0x6a, 0x5a]];
const STEM_LIVE = [0x3b, 0x8a, 0x50], STEM_DEAD = [0x6e, 0x50, 0x34];
const CAP_LIVE = [0x2f, 0x7d, 0x45], CAP_DEAD = [0x5a, 0x40, 0x28];
// a leaf at angle a droops toward pointing down: down-right on the right side, down-left on the left
const droop = (a) => { const n = ((a % 360) + 360) % 360; const t = Math.cos(n * Math.PI / 180) >= 0 ? 62 : 118; return ((t - n + 540) % 360) - 180; };

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
  `<g class="pp-leaf" transform="translate(${x} ${y}) rotate(${a})"><path fill="url(#pp-leaf)" d="M0 0C${l * .3} ${-l * .28} ${l * .72} ${-l * .26} ${l} 0C${l * .7} ${l * .22} ${l * .28} ${l * .24} 0 0Z"/><path class="pp-rib" d="M${l * .08} 0L${l * .84} 0"/></g>`;
const fruit = ([x, y]) =>
  `<g class="pp-fruit" transform="translate(${x} ${y}) scale(0)"><path class="pp-stalk" d="M0 1.5C.5-2.5 2-4.5 4-6"/><path fill="url(#pp-green)" d="${PEPPER}"/><path fill="url(#pp-amber)" opacity="0" d="${PEPPER}"/><path fill="url(#pp-red)" opacity="0" d="${PEPPER}"/><path fill="url(#pp-rot)" opacity="0" d="${PEPPER}"/><path class="pp-cap" d="${CAP}"/><path class="pp-shine" d="M-2.6 7C-3.6 13-2.6 19-.6 24"/></g>`;
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
    '<linearGradient id="pp-leaf" x1="0" y1="0" x2="1" y2="1"><stop id="pp-leaf-a" offset="0" stop-color="#86e29a"/><stop id="pp-leaf-b" offset="1" stop-color="#2e8c50"/></linearGradient>' +
    '<linearGradient id="pp-rot" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a6a45"/><stop offset="1" stop-color="#4a3020"/></linearGradient>' +
    '<linearGradient id="pp-green" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9be47f"/><stop offset="1" stop-color="#3d9c45"/></linearGradient>' +
    '<linearGradient id="pp-amber" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd36b"/><stop offset="1" stop-color="#ee8a22"/></linearGradient>' +
    '<linearGradient id="pp-red" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff7a6e"/><stop offset="1" stop-color="#d91f3c"/></linearGradient>' +
    '</defs>' + PLANTS.map(plant).join('') +
    `<g class="pp-snow" transform="translate(0 ${H}) scale(1 0)"><path d="M-20 0V-9C40-15 90-6 150-11S260-16 330-9 450-14 520-10 610-13 660-9V0Z"/></g>` +
    '<g class="pp-flakes" opacity="0">' + Array.from({ length: FLAKES }, () => '<circle r="1"/>').join('') + '</g>';
  el.append(svg);
  const leafA = svg.querySelector('#pp-leaf-a'), leafB = svg.querySelector('#pp-leaf-b');
  const snow = svg.querySelector('.pp-snow'), flakeG = svg.querySelector('.pp-flakes');
  // each flake: where it falls, how fast, how big, and where in its fall it starts
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const flakes = [...flakeG.children].map(c => {
    const f = { c, x: rnd() * W, v: 0.7 + rnd() * 0.7, o: rnd(), sway: 3 + rnd() * 6 };
    c.setAttribute('r', (0.9 + rnd() * 1.9).toFixed(2));
    return f;
  });

  const plants = [...svg.querySelectorAll('.pp-plant')].map((g, i) => ({
    ...PLANTS[i], g, last: '', droop: -1,
    leaves: [...g.querySelectorAll('.pp-leaf')].map((l, j) => ({ l, x: LEAVES[j][0], y: LEAVES[j][1], a: LEAVES[j][2] })),
    fruit: [...g.querySelectorAll('.pp-fruit')].map(f => ({ f, amber: f.children[2], red: f.children[3], rot: f.children[4], s: -1, r: -1, d: -1 })),
  }));

  let lastQ = -1, lastBrown = -1, lastSnow = -1;
  const ease = (v) => v * v * (3 - 2 * v);
  function update(p) {
    const q = Math.round(clamp(p, 0, SNOW[0] + SNOW[1]) * 400) / 400;
    if (q === lastQ) return;
    lastQ = q;
    const ripe = Math.min(q, 1);
    const wilt = ease(clamp((q - WILT[0]) / WILT[1]));
    const brown = ease(clamp((q - BROWN[0]) / BROWN[1]));
    const snowy = clamp((q - SNOW[0]) / SNOW[1]);
    for (const pl of plants) {
      const g = clamp((ripe - pl.at) / GROW);
      const e = 1 - (1 - g) ** 3;
      // taller faster than wider, so it reads as growing up rather than zooming in
      const sy = g > 0 ? (0.06 + 0.94 * e) * pl.size * (1 - 0.2 * wilt) : 0;
      const sx = g > 0 ? (0.4 + 0.6 * e) * pl.size * (pl.flip ? -1 : 1) : 0;
      // wilting: the whole plant slumps a little to one side
      const lean = (pl.flip ? 1 : -1) * 9 * wilt;
      const t = `translate(${pl.x} ${H}) rotate(${lean.toFixed(2)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})`;
      if (t !== pl.last) { pl.last = t; pl.g.setAttribute('transform', t); }
      const dr = Math.round(wilt * 50) / 50;
      if (dr !== pl.droop) {
        pl.droop = dr;
        for (const lf of pl.leaves) lf.l.setAttribute('transform', `translate(${lf.x} ${lf.y}) rotate(${(lf.a + droop(lf.a) * 0.6 * dr).toFixed(1)})`);
      }
      pl.fruit.forEach((fr, j) => {
        // the fruit sets small and swells past full size as it ripens, then shrivels as it rots
        const s = Math.round(((clamp((g - 0.55 - j * 0.08) / 0.22) * 1.0 + clamp((ripe - RIPE + 0.12) / 0.2) * 0.45) * (1 - 0.3 * brown)) * 100) / 100;
        const r = Math.round(clamp((ripe - RIPE - j * 0.035 - pl.at * 0.12) / 0.1) * 100) / 100;
        const d = Math.round(brown * 50) / 50;
        if (s !== fr.s) { fr.s = s; fr.f.setAttribute('transform', `translate(${FRUIT[j][0]} ${FRUIT[j][1] + 6 * wilt}) scale(${s})`); }
        // green, then amber, then red: a straight green-to-red fade goes through mud
        if (r !== fr.r) { fr.r = r; fr.amber.setAttribute('opacity', clamp(r * 2)); fr.red.setAttribute('opacity', clamp(r * 2 - 1)); }
        if (d !== fr.d) { fr.d = d; fr.rot.setAttribute('opacity', d); }
      });
    }
    // brown: every leaf shares one gradient, and stems and caps read their color from the svg
    const b = Math.round(brown * 60) / 60, n = Math.round(snowy * 200) / 200;
    if (b !== lastBrown || n !== lastSnow) {
      const frost = clamp(n * 1.6);
      const a = mix(mix(LEAF_LIVE[0], LEAF_DEAD[0], b), LEAF_SNOWY[0], frost), z = mix(mix(LEAF_LIVE[1], LEAF_DEAD[1], b), LEAF_SNOWY[1], frost * 0.5);
      leafA.setAttribute('stop-color', hex(a)); leafB.setAttribute('stop-color', hex(z));
      svg.style.setProperty('--pp-stem', hex(mix(STEM_LIVE, STEM_DEAD, b)));
      svg.style.setProperty('--pp-cap', hex(mix(CAP_LIVE, CAP_DEAD, b)));
      lastBrown = b;
    }
    // snow: flakes fall as you scroll, and the ground fills in white
    if (n !== lastSnow) {
      lastSnow = n;
      flakeG.setAttribute('opacity', n > 0 ? Math.min(1, n * 4).toFixed(2) : '0');
      snow.setAttribute('transform', `translate(0 ${H}) scale(1 ${(n * 1.6).toFixed(3)})`);
      if (n > 0) for (const f of flakes) {
        const y = ((f.o + n * 2.4 * f.v) % 1) * (H + 30) - 20;
        const x = f.x + Math.sin(n * 9 + f.o * 12) * f.sway;
        f.c.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      }
    }
  }
  if (reduceMotion) update(1);
  return { update };
}
