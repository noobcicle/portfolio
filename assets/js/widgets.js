// Early projects: a small working model of each project, built from what its real code did.
// Every one is a simulation: nothing here talks to a device, a camera, a broker or anything in
// the house. Loops only run while their card is on screen, and with reduced motion nothing moves
// on its own (the buttons still work, they just skip the animation).

const tpl = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const $ = (el, s) => el.querySelector(s);
const pad2 = (n) => String(n).padStart(2, '0');

export function initWidgets(root, { reduceMotion = false } = {}) {
  const BUILD = { gns3, garage, hdmi, waterer, pepperpi, camera, mqtt, askchef, rig, radio };
  const live = new Map();
  root.querySelectorAll('[data-widget]').forEach((el) => {
    const make = BUILD[el.dataset.widget];
    if (!make) return;
    const w = make(el, reduceMotion);
    if (w?.start) live.set(el, w);
  });
  if (!live.size) return;
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const w = live.get(en.target);
      if (w) en.isIntersecting ? w.start() : w.stop();
    }
  }, { threshold: 0.25 });
  live.forEach((_, el) => io.observe(el));
}

// a timer that only ticks while the card is visible
function ticker(fn, ms) {
  let id = 0;
  return { start() { if (!id) id = setInterval(fn, ms); }, stop() { clearInterval(id); id = 0; } };
}

// ------------------------------------------------------------------ CCNP: build a lab in "GNS3"
function gns3(el) {
  const W = 300, H = 132;
  const pts = [[44, 40], [150, 30], [256, 44], [150, 104]];
  el.append(tpl(`<div class="wdg-gns3">
    <svg viewBox="0 0 ${W} ${H}" class="wdg-canvas" role="img" aria-label="A lab topology: four routers you can drag; tap two routers to link them"><g class="g-links"></g><g class="g-nodes"></g></svg>
    <p class="wdg-status" aria-live="polite"></p>
    <p class="wdg-hint">Drag the routers. Tap one, then another, to cable them.</p></div>`));
  const svg = $(el, 'svg'), linksG = $(el, '.g-links'), nodesG = $(el, '.g-nodes'), status = $(el, '.wdg-status');
  const links = new Set(['0-1']);
  let picked = -1;
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  nodesG.innerHTML = pts.map((p, i) => `<g class="g-node" data-i="${i}" tabindex="0" role="button" aria-label="Router R${i + 1}"><circle r="15"/><text dy="4">R${i + 1}</text></g>`).join('');
  const nodes = [...nodesG.children];
  function draw() {
    linksG.innerHTML = [...links].map((k) => { const [a, b] = k.split('-').map(Number); return `<line x1="${pts[a][0]}" y1="${pts[a][1]}" x2="${pts[b][0]}" y2="${pts[b][1]}"/>`; }).join('');
    nodes.forEach((n, i) => { n.setAttribute('transform', `translate(${pts[i][0]} ${pts[i][1]})`); n.classList.toggle('picked', i === picked); });
    // reachable from R1 over the cables
    const seen = new Set([0]), q = [0];
    while (q.length) { const a = q.shift(); for (const k of links) { const [x, y] = k.split('-').map(Number); const b = x === a ? y : y === a ? x : -1; if (b >= 0 && !seen.has(b)) { seen.add(b); q.push(b); } } }
    const ok = seen.size === pts.length;
    svg.classList.toggle('up', ok);
    status.textContent = ok ? `✓ ${links.size} links, every router reachable. The lab converged.`
      : `${links.size} link${links.size === 1 ? '' : 's'} · ${pts.length - seen.size} router${pts.length - seen.size === 1 ? '' : 's'} unreachable from R1`;
  }
  function tap(i) {
    if (picked < 0) picked = i;
    else if (picked === i) picked = -1;
    else { const k = key(picked, i); links.has(k) ? links.delete(k) : links.add(k); picked = -1; }
    draw();
  }
  let drag = null;
  const toSvg = (e) => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  nodes.forEach((n, i) => {
    n.addEventListener('pointerdown', (e) => { e.preventDefault(); n.setPointerCapture(e.pointerId); drag = { i, x0: e.clientX, y0: e.clientY, moved: false }; });
    n.addEventListener('pointermove', (e) => {
      if (!drag || drag.i !== i) return;
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) drag.moved = true;
      if (!drag.moved) return;
      const [x, y] = toSvg(e);
      pts[i] = [Math.min(W - 16, Math.max(16, x)), Math.min(H - 16, Math.max(16, y))];
      draw();
    });
    n.addEventListener('pointerup', () => { if (drag && !drag.moved) tap(i); drag = null; });
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(i); } });
  });
  draw();
}

// ------------------------------------------------------------------ the garage door Pi
function garage(el, still) {
  el.append(tpl(`<div class="wdg-garage">
    <svg viewBox="0 0 200 110" class="wdg-canvas" aria-hidden="true">
      <path class="gd-roof" d="M14 38 100 8l86 30"/><rect class="gd-wall" x="22" y="36" width="156" height="74"/>
      <rect class="gd-hole" x="44" y="50" width="112" height="60"/>
      <clipPath id="gd-clip"><rect x="44" y="50" width="112" height="60"/></clipPath>
      <g clip-path="url(#gd-clip)"><g class="gd-door">${[0, 1, 2, 3].map((k) => `<rect x="44" y="${50 + k * 15}" width="112" height="15"/>`).join('')}<rect class="gd-handle" x="94" y="102" width="12" height="3" rx="1.5"/></g></g>
      <circle class="gd-led" cx="170" cy="46" r="3.5"/>
    </svg>
    <div class="wdg-row"><button class="wdg-btn" type="button">Press the button</button><span class="wdg-read"></span></div>
    <p class="wdg-log" aria-live="polite"></p></div>`));
  const door = $(el, '.gd-door'), led = $(el, '.gd-led'), read = $(el, '.wdg-read'), log = $(el, '.wdg-log'), btn = $(el, 'button');
  let open = false, moving = false, auto = 0, autoT = 0;
  const show = () => { read.textContent = `pin 12: ${open ? 'Open' : 'Shut'}`; door.style.transform = open ? 'translateY(-58px)' : 'none'; };
  function press(byCron) {
    if (moving) return;
    led.classList.add('on'); setTimeout(() => led.classList.remove('on'), 150);
    log.textContent = byCron ? 'cron: the door was left open, so garagetoggle.sh pulses GPIO 7' : 'garagetoggle.sh: GPIO 7 low for 150 ms, then high';
    moving = true; open = !open; show();
    setTimeout(() => { moving = false; armAuto(); }, still ? 0 : 1800);
  }
  // the real cron job: if the door is open, toggle it and check again in 15 seconds
  function armAuto() {
    clearInterval(autoT);
    if (!open) return;
    auto = 6;
    autoT = setInterval(() => {
      auto -= 1;
      if (auto > 0) { log.textContent = `doorshutcron.py: pin 12 reads Open. Closing it in ${auto}…`; return; }
      clearInterval(autoT); press(true);
    }, 1000);
  }
  btn.addEventListener('click', () => press(false));
  show();
  log.textContent = 'Reads the door sensor on pin 12, and pulses the opener relay on GPIO 7.';
}

// ------------------------------------------------------------------ HDMI switch remote over RS-232
function hdmi(el) {
  const COLORS = ['#ff5ca8', '#4c8dff', '#59c37a', '#ffb347', '#c46bff'];
  el.append(tpl(`<div class="wdg-hdmi">
    <div class="tv"><div class="tv-screen"><span class="tv-input">HDMI 1</span></div></div>
    <div class="wdg-row hdmi-keys">${[1, 2, 3, 4, 5].map((n) => `<button class="wdg-key" type="button" data-port="${n - 1}" aria-label="Switch to HDMI ${n}">${n}</button>`).join('')}<button class="wdg-key wdg-power" type="button" aria-label="Power" aria-pressed="true">⏻</button></div>
    <p class="wdg-log mono" aria-live="polite"></p></div>`));
  const screen = $(el, '.tv-screen'), label = $(el, '.tv-input'), log = $(el, '.wdg-log'), power = $(el, '.wdg-power');
  let port = 0, on = true;
  const send = (cmd) => { log.textContent = `echo -n "${cmd}" > /dev/ttyUSB0`; };
  const paint = () => {
    screen.classList.toggle('off', !on);
    screen.style.background = on ? `radial-gradient(120% 90% at 30% 20%, ${COLORS[port]}88, #0b0716 70%)` : '#050309';
    label.textContent = on ? `HDMI ${port + 1}` : '';
    el.querySelectorAll('[data-port]').forEach((b) => b.classList.toggle('on', on && +b.dataset.port === port));
  };
  el.querySelectorAll('[data-port]').forEach((b) => b.addEventListener('click', () => { port = +b.dataset.port; on = true; power.setAttribute('aria-pressed', 'true'); send(`port${port}R`); paint(); }));
  power.addEventListener('click', () => { on = !on; power.setAttribute('aria-pressed', String(on)); send(on ? 'poweronR' : 'poweroffR'); paint(); });
  paint();
  log.textContent = 'A button per input; each one writes a command to the serial port.';
}

// ------------------------------------------------------------------ plant waterer v1 → v3.1
function waterer(el, still) {
  el.append(tpl(`<div class="wdg-water">
    <div class="ww-meters">
      <div class="ww-meter"><span>Soil</span><div class="ww-bar"><i class="ww-soil"></i><b class="ww-mark"></b></div><em class="ww-val"></em></div>
      <label class="ww-knob"><span>Threshold</span><input type="range" min="10" max="80" value="40" aria-label="Moisture threshold (the knob on the box)"><em class="ww-tval"></em></label>
    </div>
    <div class="wdg-row"><span class="ww-led ww-dry" title="dry light"></span><span class="ww-led ww-err" title="error light"></span><span class="ww-pump" aria-hidden="true"><i></i><i></i><i></i></span><button class="wdg-btn" type="button">Pull the sensor</button></div>
    <p class="wdg-log mono" aria-live="polite"></p></div>`));
  const soil = $(el, '.ww-soil'), mark = $(el, '.ww-mark'), val = $(el, '.ww-val'), knob = $(el, 'input'), tval = $(el, '.ww-tval');
  const dry = $(el, '.ww-dry'), errLed = $(el, '.ww-err'), pump = $(el, '.ww-pump'), btn = $(el, 'button'), log = $(el, '.wdg-log');
  // the real sketch's rules: water only when drier than the knob, run the pump PumpCutOffTime
  // seconds, at most once per PumpFrequencyLimiter, and a sensor out of range is an error that stops it
  let moist = 62, cooldown = 0, pumping = 0, error = false;
  function paint() {
    const t = +knob.value;
    soil.style.transform = `scaleX(${moist / 100})`; mark.style.left = `${t}%`;
    val.textContent = error ? '—' : `${Math.round(moist)}`; tval.textContent = `${t}`;
    dry.classList.toggle('on', !error && moist < t);
    errLed.classList.toggle('on', error);
    pump.classList.toggle('on', pumping > 0);
  }
  function step() {
    if (error) { paint(); return; }
    if (pumping > 0) {
      pumping -= 1; moist = Math.min(88, moist + 5);
      log.textContent = pumping ? `BEGIN PUMP CYCLE · SECONDS LEFT: ${pumping}` : 'Pump off. It waits out PumpFrequencyLimiter before it may run again.';
    } else {
      moist = Math.max(18, moist - 1.6);
      if (cooldown > 0) cooldown -= 1;
      if (moist < +knob.value && cooldown === 0) { pumping = 15; cooldown = 30; }
    }
    paint();
  }
  btn.addEventListener('click', () => {
    error = !error;
    btn.textContent = error ? 'Plug it back in' : 'Pull the sensor';
    pumping = 0;
    log.textContent = error ? 'ERROR: SOIL SENSOR 1 VALUE OUT OF RANGE · pump locked out' : 'Sensor back in range.';
    paint();
  });
  knob.addEventListener('input', paint);
  paint();
  log.textContent = 'Soil dries; below the knob the dry light comes on and the pump gets one run.';
  if (still) return null;
  return ticker(step, 400);
}

// ------------------------------------------------------------------ the Pepperpi: sensors to CSV to a chart
function pepperpi(el, still) {
  el.append(tpl(`<div class="wdg-pepper">
    <svg viewBox="0 0 300 92" class="wdg-canvas" aria-hidden="true"><path class="pp-grid" d="M0 23H300M0 46H300M0 69H300"/><path class="pp-temp"/><path class="pp-hum"/></svg>
    <div class="wdg-row"><span class="pp-key pp-k-temp">temp °F</span><span class="pp-key pp-k-hum">humidity %</span><span class="wdg-read pp-now"></span></div>
    <p class="wdg-log mono" aria-live="off"></p></div>`));
  const temp = $(el, '.pp-temp'), hum = $(el, '.pp-hum'), now = $(el, '.pp-now'), log = $(el, '.wdg-log');
  const N = 40, T = [], Hh = [];
  let t0 = new Date(2020, 6, 14, 6, 0, 0), k = 0;
  // a July day in the garden: warm afternoon, humidity falling as it warms
  const sample = () => {
    const hr = 6 + (k * 0.25) % 18;
    const tv = 66 + 22 * Math.sin(Math.PI * Math.max(0, hr - 6) / 14) + (Math.random() - 0.5) * 1.4;
    const hv = 82 - 34 * Math.sin(Math.PI * Math.max(0, hr - 6) / 14) + (Math.random() - 0.5) * 2;
    return [tv, hv, hr];
  };
  const line = (arr, lo, hi) => arr.map((v, i) => `${i ? 'L' : 'M'}${(i * 300 / (N - 1)).toFixed(1)} ${(88 - (v - lo) / (hi - lo) * 80).toFixed(1)}`).join('');
  function step() {
    const [tv, hv, hr] = sample(); k += 1;
    T.push(tv); Hh.push(hv); if (T.length > N) { T.shift(); Hh.shift(); }
    temp.setAttribute('d', line(T, 55, 95)); hum.setAttribute('d', line(Hh, 30, 95));
    const d = new Date(t0.getTime() + k * 15 * 60000);
    const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
    now.textContent = `${tv.toFixed(1)}°F · ${hv.toFixed(0)}%`;
    // the real logger's CSV row: time, temperature, gas, humidity, pressure
    log.textContent = `${stamp},${tv.toFixed(2)},${(52000 + Math.round(Math.random() * 3000))},${hv.toFixed(2)},1018.07`;
  }
  for (let i = 0; i < N; i++) step();
  if (still) return null;
  return ticker(step, 900);
}

// ------------------------------------------------------------------ the Pi security camera
function camera(el, still) {
  el.append(tpl(`<div class="wdg-cam">
    <div class="cam-feed"><span class="cam-rec">REC</span><span class="cam-name">Garage cam</span><span class="cam-time mono"></span>
      <svg viewBox="0 0 160 70" aria-hidden="true"><path class="cam-scene" d="M0 70V44l28-14 26 12V70zM62 70V36h58v34zM70 70V48h42v22zM126 70V40l34-18v48z"/></svg></div>
    <ul class="cam-files mono" aria-label="Recorded files"></ul></div>`));
  const time = $(el, '.cam-time'), files = $(el, '.cam-files');
  // recordCAM.sh: ffmpeg saves the stream in 900-second pieces, named by `date +%Y-%m-%d_%H.%M`
  let t = new Date(2020, 4, 3, 13, 58, 0).getTime();
  const name = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}.${pad2(d.getMinutes())}.mp4`; };
  const add = (ms) => { const li = document.createElement('li'); li.textContent = name(ms); files.prepend(li); while (files.children.length > 3) files.lastChild.remove(); };
  add(t - 15 * 60000 + 120000);
  function step() {
    t += 20000;  // 20 seconds of footage per tick
    const d = new Date(t);
    time.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    if (d.getMinutes() % 15 === 0 && d.getSeconds() < 20) add(t);
  }
  step();
  if (still) return null;
  return ticker(step, 160);
}

// ------------------------------------------------------------------ ESP32 relay over MQTT
function mqtt(el, still) {
  el.append(tpl(`<div class="wdg-mqtt">
    <svg viewBox="0 0 300 74" class="wdg-canvas" aria-hidden="true">
      <path class="mq-wire" d="M40 37H130M170 37H250"/>
      <g transform="translate(22 37)"><rect class="mq-box" x="-18" y="-15" width="36" height="30" rx="6"/><text dy="4">you</text></g>
      <g transform="translate(150 37)"><rect class="mq-box" x="-22" y="-15" width="44" height="30" rx="6"/><text dy="4">broker</text></g>
      <g transform="translate(268 37)"><rect class="mq-box mq-esp" x="-20" y="-15" width="40" height="30" rx="6"/><text dy="4">ESP32</text><circle class="mq-lamp" cx="0" cy="-27" r="6"/></g>
      <circle class="mq-msg" cx="40" cy="37" r="4"/>
    </svg>
    <div class="wdg-row"><button class="wdg-btn" type="button" data-v="on">Publish ON</button><button class="wdg-btn" type="button" data-v="off">Publish OFF</button></div>
    <p class="wdg-log mono" aria-live="polite"></p></div>`));
  const msg = $(el, '.mq-msg'), lamp = $(el, '.mq-lamp'), log = $(el, '.wdg-log');
  let busy = false;
  function publish(v) {
    if (busy) return;
    busy = true;
    log.textContent = `publish relay ${v} → broker → ESP32`;
    const done = () => {
      lamp.classList.toggle('on', v === 'on');
      // the real board's relay is active-low: 0 switches it on
      log.textContent = v === 'on' ? 'relay.value(0)   # on: this relay is active-low' : 'relay.value(1)   # off';
      busy = false;
    };
    if (still) { done(); return; }
    msg.classList.remove('go'); void msg.getBoundingClientRect(); msg.classList.add('go');
    setTimeout(done, 1100);
  }
  el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => publish(b.dataset.v)));
  log.textContent = 'MicroPython on the ESP32 listens to a topic and flips a relay on pin 26.';
}

// ------------------------------------------------------------------ AskChef.ai: food only, strict JSON
function askchef(el) {
  const REPLIES = {
    food: { food_related: true, reply_type: 'recipe', message: 'Fluffy pancakes, coming up.',
      recipe: { title: 'Fluffy pancakes', time_required: '20 minutes', ingredients: [['flour', '1 1/2 cups'], ['milk', '1 1/4 cups'], ['egg', '1']], step: ['Whisk the dry', 'Fold in the wet', 'Flip at the bubbles'] },
      allergens: ['wheat', 'milk', 'egg'] },
    other: { food_related: false, reply_type: 'other', message: 'Sorry, I can only help with food, cooking and baking.' },
  };
  el.append(tpl(`<div class="wdg-chef">
    <div class="wdg-row"><button class="wdg-chip" type="button" data-q="food">How do I make pancakes?</button><button class="wdg-chip" type="button" data-q="other">Who won the 1998 World Series?</button></div>
    <pre class="chef-out mono" aria-live="polite"></pre>
    <p class="wdg-hint">A made-up reply in AskChef's real reply format.</p></div>`));
  const out = $(el, '.chef-out');
  const show = (q) => {
    el.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === q));
    out.textContent = JSON.stringify(REPLIES[q], null, 1).replace(/\n\s*(?=[\]}])/g, ' ').replace(/\[\n\s+/g, '[').replace(/",\n\s+"/g, '", "');
  };
  el.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => show(b.dataset.q)));
  show('other');
}

// ------------------------------------------------------------------ the test rig: an MTU test
function rig(el) {
  el.append(tpl(`<div class="wdg-rig">
    <label class="rig-size"><span>Packet size</span><input type="range" min="64" max="9000" step="4" value="1472" aria-label="Packet size in bytes"><em class="mono"></em></label>
    <div class="wdg-row"><button class="wdg-chip on" type="button" data-mtu="1500">Link MTU 1500</button><button class="wdg-chip" type="button" data-mtu="9000">Jumbo, 9000</button></div>
    <pre class="rig-out mono" aria-live="polite"></pre></div>`));
  const size = $(el, 'input'), em = $(el, '.rig-size em'), out = $(el, '.rig-out');
  let mtu = 1500;
  function run() {
    const s = +size.value; em.textContent = `${s} B`;
    // a ping with Don't Fragment set: payload + 28 bytes of IP and ICMP header has to fit the link
    const fits = s + 28 <= mtu;
    out.textContent = `$ ping -M do -s ${s} r1.lab\n` + (fits ? `${s + 8} bytes from r1.lab: icmp_seq=1 ttl=255 time=0.42 ms` : `ping: local error: message too long, mtu=${mtu}`);
    out.classList.toggle('bad', !fits);
  }
  size.addEventListener('input', run);
  el.querySelectorAll('[data-mtu]').forEach((b) => b.addEventListener('click', () => { mtu = +b.dataset.mtu; el.querySelectorAll('[data-mtu]').forEach((x) => x.classList.toggle('on', x === b)); run(); }));
  run();
}

// ------------------------------------------------------------------ GMRS handhelds, programmed with CHIRP
function radio(el) {
  // the GMRS channel plan (FCC part 95)
  const F = ['462.5625', '462.5875', '462.6125', '462.6375', '462.6625', '462.6875', '462.7125', '467.5625', '467.5875', '467.6125', '467.6375', '467.6625', '467.6875', '467.7125',
    '462.5500', '462.5750', '462.6000', '462.6250', '462.6500', '462.6750', '462.7000', '462.7250'];
  el.append(tpl(`<div class="wdg-radio">
    <div class="rd-lcd mono"><span class="rd-ch"></span><span class="rd-f"></span><span class="rd-tx">TX</span></div>
    <div class="wdg-row"><button class="wdg-key" type="button" data-d="-1" aria-label="Channel down">▼</button><button class="wdg-key" type="button" data-d="1" aria-label="Channel up">▲</button><button class="wdg-btn rd-ptt" type="button">Hold to talk</button></div></div>`));
  const ch = $(el, '.rd-ch'), f = $(el, '.rd-f'), lcd = $(el, '.rd-lcd'), ptt = $(el, '.rd-ptt');
  let c = 0;
  const paint = () => { ch.textContent = `CH ${pad2(c + 1)}`; f.textContent = `${F[c]} MHz`; };
  el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { c = (c + +b.dataset.d + F.length) % F.length; paint(); }));
  const tx = (on) => lcd.classList.toggle('tx', on);
  ptt.addEventListener('pointerdown', (e) => { e.preventDefault(); tx(true); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => ptt.addEventListener(ev, () => tx(false)));
  ptt.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tx(true); } });
  ptt.addEventListener('keyup', () => tx(false));
  paint();
}
