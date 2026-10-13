import { initHero } from './hero.js';
import { initAudio } from './audio.js';
import { initRoute } from './route.js';

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

// ------------------------------------------------------------------ thesis: split into words
const thesis = $('#thesis');
const thesisText = $('#thesis-text');
const KEYS = new Set(['complain', 'computer', 'doesnt']);
thesisText.innerHTML = thesisText.textContent.trim().split(/\s+/).map(w => {
  const bare = w.toLowerCase().replace(/[^a-z]/g, '');
  return `<span class="w${KEYS.has(bare) ? ' key' : ''}">${w}</span>`;
}).join(' ');
const thesisWords = $$('.w', thesisText);

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

// ------------------------------------------------------------------ lab: sticky media follows the item in view
const slides = $$('.media-slide');
const flow = $('#flow-demo');
let flowTimer = 0, flowOn = false;
function runFlow() {
  if (!flowOn) return;
  const steps = [[1, 0], [2, 1300], [3, 2900], [4, 4300]];
  for (const [s, at] of steps) setTimeout(() => flowOn && (flow.dataset.step = s), at);
  flowTimer = setTimeout(() => { if (!flowOn) return; flow.dataset.step = 0; setTimeout(runFlow, 500); }, 8200);
}
function setFlow(on) {
  if (on === flowOn) return;
  flowOn = on;
  clearTimeout(flowTimer);
  if (on) { if (reduce) flow.dataset.step = 4; else runFlow(); }
}
function setSlide(key) {
  slides.forEach(s => s.classList.toggle('is-active', s.dataset.slide === key));
}
const labIO = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) setSlide(en.target.dataset.slide);
}, { rootMargin: '-45% 0px -45% 0px' });
$$('.lab-item').forEach(el => labIO.observe(el));
new IntersectionObserver(([en]) => setFlow(en.isIntersecting), { threshold: 0.25 }).observe(flow);

// ------------------------------------------------------------------ before AI: pinned horizontal strip
const before = $('#before');
const track = $('#before-track');
const pinStrip = () => !reduce && innerWidth > 760;
function sizeBefore() {
  if (!pinStrip()) { before.style.height = ''; track.style.transform = ''; return; }
  const travel = Math.max(0, track.scrollWidth - innerWidth);
  before.style.height = (innerHeight + travel) + 'px';
}

// ------------------------------------------------------------------ garden: 60 squares
const sixty = $('#sixty');
const sixtyN = $('#sixty-n');
const garden = $('#garden');
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
if (reduce || innerWidth <= 860) { setGardens(60); garden.classList.add('day'); garden.style.setProperty('--g', 1); }

// ------------------------------------------------------------------ marquee (speeds up with scroll)
const marquee = $('#marquee-track');
marquee.innerHTML += marquee.innerHTML;
let mx = 0, mlast = 0, vel = 0, lastY = scrollY;

// ------------------------------------------------------------------ scroll progress: a packet routed to me
const topFill = $('#topbar-fill');
const chapters = $$('[data-chapter]');
const route = initRoute($('#route'), { chapters, reduceMotion: reduce });
let docH = 1;
function measure() {
  sizeBefore();
  docH = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  route.measure();
}

// ------------------------------------------------------------------ the one scroll loop
const bands = $$('.chapter-band');
let ticking = false, scrolled = false;
function progressOf(el) {
  const r = el.getBoundingClientRect();
  return { p: clamp(-r.top / Math.max(1, r.height - innerHeight)), r };
}
function update() {
  ticking = false;
  const y = scrollY;
  // read
  const tp = progressOf(thesis).p;
  const bp = progressOf(before).p;
  const gp = progressOf(garden).p;
  const hr = hero.getBoundingClientRect();
  const bandTops = bands.map(b => b.getBoundingClientRect().top);
  // write
  nav.classList.toggle('scrolled', y > 20);
  heroCtl.setFade(clamp(1 + hr.top / (hr.height * 0.9)));

  if (!reduce) {
    const lit = Math.floor(tp * 1.15 * (thesisWords.length + 1));
    thesisWords.forEach((w, i) => w.classList.toggle('lit', i < lit));
  }
  if (pinStrip()) track.style.transform = `translate3d(${-bp * Math.max(0, track.scrollWidth - innerWidth)}px,0,0)`;

  if (!reduce && innerWidth > 860) {
    const g = clamp((gp - 0.03) / 0.16);
    garden.style.setProperty('--g', g.toFixed(3));
    garden.classList.toggle('day', g > 0.62);
    setGardens(Math.round(clamp((gp - 0.12) / 0.72) * 60));
  }
  bands.forEach((b, i) => b.style.setProperty('--p', clamp(1 - bandTops[i] / innerHeight, 0, 2).toFixed(3)));

  const p = clamp(y / docH);
  topFill.style.transform = `scaleX(${p})`;
  route.update(p, scrolled);
  scrolled = false;

  // nav highlight by section
  let activeId = null;
  for (const id of linkFor.keys()) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.top <= innerHeight * 0.35 && r.bottom > innerHeight * 0.35) activeId = id;
  }
  navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + activeId));
}
function onScroll() {
  vel = scrollY - lastY; lastY = scrollY;
  scrolled = true;
  if (!ticking) { ticking = true; requestAnimationFrame(update); }
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', () => { measure(); update(); });
new ResizeObserver(() => { measure(); update(); }).observe(document.body);

function marqueeLoop(t) {
  const dt = Math.min(0.05, (t - (mlast || t)) / 1000); mlast = t;
  const half = marquee.scrollWidth / 2;
  const speed = 46 + Math.min(600, Math.abs(vel) * 9);
  vel *= 0.9;
  mx = (mx - speed * dt) % half;
  marquee.style.transform = `translate3d(${mx}px,0,0)`;
  requestAnimationFrame(marqueeLoop);
}
if (!reduce) requestAnimationFrame(marqueeLoop);

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
    $('#live-text').textContent = `Live from my basement: Raspberry Pi 4 over Starlink · up ${up}${temp ? ` · ${temp}` : ''}`;
    $('#live-badge').hidden = false;
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
