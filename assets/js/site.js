import { initHero } from './hero.js';
import { initAudio } from './audio.js';
import { initRoute } from './route.js';
import { initSkills, initSkillTabs } from './skills.js';
import { initSysmap } from './lab.js';
import { initLightbox } from './lightbox.js';
import { initPeppers } from './peppers.js';
import { initWidgets } from './widgets.js';
import { initMission } from './mission.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ toast
const toastEl = $('#toast');
let toastT = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

// ------------------------------------------------------------------ hero
const hero = $('#hero');
const heroCtl = initHero($('#hero-canvas'), { reduceMotion: reduce });
const ready = () => hero.classList.add('ready');
(document.fonts?.ready || Promise.resolve()).then(() => requestAnimationFrame(ready));
setTimeout(ready, 900);

// ------------------------------------------------------------------ nav
const nav = $('#nav');
const menuBtn = $('#menu-btn');
const menu = $('#mobile-menu');
menuBtn.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') !== 'true';
  menuBtn.setAttribute('aria-expanded', String(open));
  menu.hidden = !open;
});
menu.addEventListener('click', (e) => { if (e.target.closest('a')) { menuBtn.setAttribute('aria-expanded', 'false'); menu.hidden = true; } });

const navLinks = $$('.nav-links a');
const linkFor = new Map(navLinks.map(a => [a.getAttribute('href').slice(1), a]));

// ------------------------------------------------------------------ reveal on scroll
const revealIO = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); revealIO.unobserve(en.target); }
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
$$('.reveal').forEach(el => revealIO.observe(el));

// ------------------------------------------------------------------ counters
const countIO = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    countIO.unobserve(en.target);
    const el = en.target;
    const to = +el.dataset.countTo, from = +(el.dataset.countFrom || 0);
    const comma = el.dataset.format === 'comma';
    const show = v => (el.textContent = comma ? Math.round(v).toLocaleString('en-US') : Math.round(v));
    if (reduce) { show(to); continue; }
    const t0 = performance.now(), dur = 1600 + Math.min(900, Math.abs(to - from));
    const tick = (t) => {
      const p = clamp((t - t0) / dur);
      show(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    show(from);
    requestAnimationFrame(tick);
  }
}, { threshold: 0.6 });
$$('[data-count-to]').forEach(el => countIO.observe(el));

// ------------------------------------------------------------------ traceroute sync
const hops = $$('.hop');
const termLines = $$('.term-line');
function setHop(n) {
  hops.forEach(h => {
    const k = +h.dataset.hop;
    h.classList.toggle('is-active', k === n);
    h.classList.toggle('passed', k < n);
  });
  termLines.forEach(l => {
    const k = +l.dataset.hop;
    l.classList.toggle('cur', k === n);
    l.classList.toggle('on', k < n);
  });
}
const hopIO = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) setHop(+en.target.dataset.hop);
}, { rootMargin: '-45% 0px -45% 0px' });
hops.forEach(h => hopIO.observe(h));

// ------------------------------------------------------------------ the Hub: one real request, start to finish (mission.js)
initMission($('#mc'), { reduceMotion: reduce });

// ------------------------------------------------------------------ early projects: a small working model of each project
// (the strip itself is a plain scroller with arrow buttons, wired up with the project carousels below)
initWidgets($('#before'), { reduceMotion: reduce });

// ------------------------------------------------------------------ garden: 60 plots, one per garden year
// Nothing here pins the page. The sun comes up as the section rises into view, the plots sprout
// row by row as the grid climbs the screen, and the peppers grow as their strip rises from the
// bottom of the screen to just past the middle.
const sixty = $('#sixty');
const sixtyN = $('#sixty-n');
const garden = $('#garden');
const sun = $('.garden-sun', garden);
const PALETTE = [0, 4, 3, 2, 1, 4, 0, 3, 4, 2];
sixty.innerHTML = Array.from({ length: 60 }, (_, i) => `<i class="c${PALETTE[i % PALETTE.length]}"></i>`).join('');
const squares = [...sixty.children];
let lastLit = -1;
function setGardens(n) {
  if (n === lastLit) return;
  lastLit = n;
  squares.forEach((sq, i) => { sq.classList.toggle('on', i < n); sq.classList.toggle('now', i === n - 1); });
  sixtyN.textContent = n;
}
if (reduce) { setGardens(60); garden.classList.add('day'); sun.style.clipPath = 'none'; }
const patch = $('#garden-patch');
const peppers = initPeppers(patch, { reduceMotion: reduce });
// the router-versus-pepper loop plays only while it's on screen
const vs = $('#garden-vs');
if (vs && !reduce) new IntersectionObserver(([en]) => vs.classList.toggle('play', en.isIntersecting)).observe(vs);

// ------------------------------------------------------------------ skills map and the lab's system map
initSkills($('#skillmap'), { detail: $('#skillmap-detail'), table: $('#skill-table'), reduceMotion: reduce });
initSkillTabs($('#skill-views'));
initSysmap($('#sysmap'), { reduceMotion: reduce });

// ------------------------------------------------------------------ scroll progress: a packet routed to me
const chapters = $$('[data-chapter]');
const route = initRoute($('#route'), { chapters, reduceMotion: reduce });
let docH = 1;
// Everything the scroll loop needs is measured here, on load and resize, so a scroll
// frame never reads layout. Reading after a style write forces a synchronous layout
// of the whole page, and that is what made scrolling stutter on phones.
const bands = $$('.chapter-band');
const bandArt = bands.map(b => $('.chapter-band-art', b));
let geo = null;
function measure() {
  docH = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top + scrollY, h: r.height }; };
  geo = {
    garden: box(garden), sixty: box(sixty), patch: box(patch), hero: box(hero),
    bands: bands.map(box),
    nav: [...linkFor.keys()].map(id => document.getElementById(id)).filter(Boolean).map(el => ({ id: el.id, ...box(el) })),
  };
  route.measure();
}

// ------------------------------------------------------------------ the one scroll loop
let ticking = false, scrolled = false;
const last = { scrolled: null, g: -1, day: null, bands: [], active: undefined };
const near = (b, y, vh) => y + vh > b.top && y < b.top + b.h;
function update() {
  ticking = false;
  if (!geo) return;
  const y = scrollY, vh = innerHeight;
  if (last.scrolled !== (y > 20)) nav.classList.toggle('scrolled', (last.scrolled = y > 20));
  heroCtl.setFade(clamp(1 + (geo.hero.top - y) / (geo.hero.h * 0.9)));

  if (!reduce && near(geo.garden, y, vh)) {
    const g = Math.round(clamp((y + vh - geo.garden.top) / (vh * 0.75)) * 500) / 500;
    if (g !== last.g) { last.g = g; sun.style.clipPath = `circle(${(g * 150).toFixed(1)}% at 74% 50%)`; }
    if (last.day !== (g > 0.62)) garden.classList.toggle('day', (last.day = g > 0.62));
    setGardens(Math.round(clamp((y + vh * 0.92 - geo.sixty.top) / Math.max(1, geo.sixty.h + vh * 0.3)) * 60));
    peppers.update((y + vh - geo.patch.top) / (vh * 0.55));
  }
  geo.bands.forEach((b, i) => {
    if (!near(b, y, vh)) return;
    const p = Math.round(clamp(1 - (b.top - y) / vh, 0, 2) * 400) / 400;
    if (p !== last.bands[i]) { last.bands[i] = p; if (bandArt[i]) bandArt[i].style.transform = `scale(${(1.12 - p * 0.12).toFixed(4)})`; }
  });

  route.update(clamp(y / docH), scrolled);
  scrolled = false;

  // nav highlight by section
  const line = y + vh * 0.35;
  const hit = geo.nav.findLast(b => b.top <= line && b.top + b.h > line);
  const active = hit ? hit.id : null;
  if (active !== last.active) {
    last.active = active;
    navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + active));
  }
}
// The scroll event only schedules a frame. Reading scrollY here would force a layout on
// every scroll event; update() reads it once per frame instead.
function onScroll() {
  scrolled = true;
  if (!ticking) { ticking = true; requestAnimationFrame(update); }
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', () => { measure(); update(); });
new ResizeObserver(() => { measure(); update(); }).observe(document.body);

measure(); update();
addEventListener('load', () => { measure(); update(); });

// ------------------------------------------------------------------ email (assembled here to keep scrapers off it)
const emailLink = $('#email-link');
const addr = `${emailLink.dataset.u}@${emailLink.dataset.d}`;
$$('.js-email').forEach(a => {
  a.href = `mailto:${addr}?subject=${encodeURIComponent('Hello from okay-cool.net')}`;
  a.title = addr;
});

// ------------------------------------------------------------------ live: the visitor's trip and the Pi's vitals
const COLOS = { ORD: 'Chicago', MSP: 'Minneapolis', MCI: 'Kansas City', STL: 'St. Louis', DTW: 'Detroit', IND: 'Indianapolis',
  CMH: 'Columbus', CLE: 'Cleveland', OMA: 'Omaha', DFW: 'Dallas', IAH: 'Houston', DEN: 'Denver', IAD: 'Ashburn', ATL: 'Atlanta',
  EWR: 'Newark', JFK: 'New York', BOS: 'Boston', MIA: 'Miami', CLT: 'Charlotte', BNA: 'Nashville', PIT: 'Pittsburgh', PHL: 'Philadelphia',
  LAX: 'Los Angeles', SJC: 'San Jose', SFO: 'San Francisco', SEA: 'Seattle', PDX: 'Portland', PHX: 'Phoenix', LAS: 'Las Vegas',
  SLC: 'Salt Lake City', SAN: 'San Diego', YYZ: 'Toronto', YVR: 'Vancouver', YUL: 'Montreal', LHR: 'London', AMS: 'Amsterdam',
  FRA: 'Frankfurt', CDG: 'Paris', DUB: 'Dublin', NRT: 'Tokyo', SIN: 'Singapore', SYD: 'Sydney', GRU: 'São Paulo' };
const esc = (v) => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const facts = (pairs) => pairs.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}
function uptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

async function liveTrip() {
  try {
    const r = await fetch('/cdn-cgi/trace', { cache: 'no-store' });
    if (!r.ok) return;
    const t = Object.fromEntries((await r.text()).trim().split('\n').map(l => l.split('=')));
    if (!t.colo) return;
    const city = COLOS[t.colo] ? `${COLOS[t.colo]} (${t.colo})` : t.colo;
    const http = (t.http || '').replace('http/', 'HTTP/').replace('HTTP/2', 'HTTP/2');
    const tls = (t.tls || '').replace('TLSv', 'TLS ');
    const fam = (t.ip || '').includes(':') ? 'IPv6' : 'IPv4';
    $('#trip-text').innerHTML = `You came in through Cloudflare's <b>${esc(city)}</b> data center over ${esc(http)}${tls ? ` and ${esc(tls)}` : ''}, then down a tunnel over Starlink to a Raspberry Pi in Milton, Wisconsin.`;
    $('#trip-facts').innerHTML = facts([['Edge', city], ['Protocol', http], ['Encryption', tls], ['You arrived on', fam], ['From', t.loc]]);
    const colo = $('[data-live="colo"]');
    if (colo) colo.textContent = `you're on ${t.colo} right now`;
    route.setVisitor({ colo: t.colo, v6: fam === 'IPv6' });
  } catch { /* not behind Cloudflare (local preview): keep the static copy */ }
}

async function livePi() {
  try {
    const r = await fetch('/status.json', { cache: 'no-store' });
    if (!r.ok) return;
    const s = await r.json();
    const up = uptime(s.uptime_s), temp = s.temp_c != null ? `${Math.round(s.temp_c)}°C` : null;
    const vitals = `Pi 4 · up ${up}${temp ? ` · ${temp}` : ''}`;
    $('#route-live-text').textContent = vitals;
    $('#route-live').hidden = false;
    route.setLive(`Live from my house: Raspberry ${vitals}`);
    $('#made-live').textContent = `Right now: up ${up}${temp ? `, ${temp}` : ''}${s.deploy ? `, last deploy ${ago(s.deploy.time)}` : ''}`;
    const pi = $('[data-live="pi"]');
    if (pi) pi.textContent = `up ${up}${temp ? ` · ${temp}` : ''}`;
    const reqs = s.requests_today > 0 ? `, and it has served ${Number(s.requests_today).toLocaleString('en-US')} requests today` : '';
    $('#pi-text').innerHTML = `A ${esc(s.host || 'Raspberry Pi 4')} in my basement. It's been up <b>${esc(up)}</b>${temp ? `, it's running at ${esc(temp)}` : ''}${esc(reqs)}.`;
    const t = s.tunnel || {};
    $('#pi-facts').innerHTML = facts([
      ['Load', s.load1 != null ? `${s.load1} (4 cores)` : null],
      ['Memory', s.mem_used_pct != null ? `${s.mem_used_pct}% used` : null],
      ['Tunnel', t.connections ? `${t.connections} connections over ${t.family || 'IPv6'}${t.edges && t.edges.length ? ` to ${t.edges.join(', ')}` : ''}` : null],
      ['Last deploy', s.deploy ? `${s.deploy.commit} "${s.deploy.subject}" ${ago(s.deploy.time)}` : null],
      ['OS', s.os],
    ]);
  } catch { /* status.json only exists on the Pi */ }
}
liveTrip();
livePi();
setInterval(livePi, 60000);
$('#copy-email').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(addr); toast(`Copied ${addr}`); }
  catch { toast(addr); }
});

// ------------------------------------------------------------------ warm the image cache
// Once the page has settled, fetch the lazy images in page order during idle time, so a fast
// scroll never waits on the network (1.3 MB in all). Skipped on data saver and 2G.
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200));
addEventListener('load', () => {
  const c = navigator.connection;
  if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return;
  const queue = $$('img[loading="lazy"]').filter(img => !img.complete && img.getClientRects().length);
  const next = () => { const img = queue.shift(); if (!img) return; img.loading = 'eager'; idle(next); };
  setTimeout(() => idle(next), 1200);
});

// ------------------------------------------------------------------ projects: arrow buttons for the two carousels
$$('.pnav-btn').forEach(btn => {
  const trackEl = document.getElementById(btn.dataset.track);
  if (!trackEl) return;
  btn.addEventListener('click', () => {
    const card = trackEl.querySelector('.pcard, .film:not(.film-intro)');
    const step = card ? card.getBoundingClientRect().width + 16 : trackEl.clientWidth * 0.8;
    trackEl.scrollBy({ left: +btn.dataset.dir * step, behavior: reduce ? 'auto' : 'smooth' });
  });
});
// project screenshots: a bigger preview on hover, the full size on click or tap
initLightbox($$('.pcard img.pcard-img'));

function syncPnav(trackEl) {
  const max = trackEl.scrollWidth - trackEl.clientWidth - 2;
  $$(`.pnav-btn[data-track="${trackEl.id}"]`).forEach(b => { b.disabled = +b.dataset.dir < 0 ? trackEl.scrollLeft <= 2 : trackEl.scrollLeft >= max; });
}
$$('.ptrack, .before-track').forEach(t => {
  let raf = 0;
  t.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; syncPnav(t); }); }, { passive: true });
  new ResizeObserver(() => syncPnav(t)).observe(t);
});

// ------------------------------------------------------------------ studio video: play only while on screen
const video = $('#studio-video');
if (video && !reduce) {
  new IntersectionObserver(([en]) => {
    if (en.isIntersecting) { video.preload = 'auto'; video.play().catch(() => {}); }
    else video.pause();
  }, { threshold: 0.35 }).observe(video);
} else if (video) {
  video.controls = true;
}

// ------------------------------------------------------------------ sound
initAudio({ toast });

// ------------------------------------------------------------------ easter eggs
console.log('%cokay, cool.', 'font: italic 42px Georgia, serif; background: linear-gradient(90deg,#ff5ca8,#4c8dff); -webkit-background-clip: text; color: transparent;');
console.log('%cYou opened DevTools. I like you already. %s', 'font: 14px ui-monospace, monospace; color: #b9acd4', addr);
console.log('%cPS: type "cool" anywhere on the page.', 'font: 12px ui-monospace, monospace; color: #8677a6');

let typed = '';
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, [contenteditable]')) return;
  typed = (typed + e.key.toLowerCase()).slice(-4);
  if (typed === 'cool') gummyRain();
});
function gummyRain() {
  if (reduce) { toast('okay, cool.'); return; }
  const n = innerWidth < 700 ? 18 : 34;
  for (let i = 0; i < n; i++) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 64 32');
    s.innerHTML = '<use href="#worm"/>';
    const size = 34 + Math.random() * 46;
    Object.assign(s.style, {
      position: 'fixed', zIndex: 90, pointerEvents: 'none', width: size + 'px', height: size / 2 + 'px',
      left: Math.random() * 100 + 'vw', top: '-60px', filter: `hue-rotate(${Math.random() * 60 - 30}deg)`,
    });
    document.body.appendChild(s);
    const rot = Math.random() * 720 - 360;
    s.animate([
      { transform: 'translateY(0) rotate(0)', opacity: 1 },
      { transform: `translateY(${innerHeight + 140}px) rotate(${rot}deg)`, opacity: 1 },
    ], { duration: 1800 + Math.random() * 1600, delay: Math.random() * 500, easing: 'cubic-bezier(.3,.1,.6,1)' }).onfinish = () => s.remove();
  }
  toast('okay, cool.');
}
