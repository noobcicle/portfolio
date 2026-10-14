// The skills map: skills and real work as nodes, wired to what they used.
// Solid nodes I built by hand. Hollow nodes Claude Code built while I designed, directed and ran
// them. Levels are my own honest estimate out of five; work nodes have no level.

const HAND = 'hand', AI = 'ai';

const COLS = [
  { title: 'Carrier networking', how: HAND, items: [
    { id: 'mpls', name: 'MPLS', lv: 5, note: 'All day, every day at Charter: the bread and butter.' },
    { id: 'ce', name: 'Carrier Ethernet', lv: 5, note: 'Thousands of circuits turned up: point-to-point, multipoint E-LAN, cell backhaul. MEF-CECP.' },
    { id: 'juniper', name: 'Juniper MX', lv: 5, note: 'My strongest vendor. I wrote the region’s Juniper standards and a config generator for the MX960 and MX480.' },
    { id: 'cisco', name: 'Cisco ASR 9000', lv: 4, note: 'Half the region’s PE routers. CCNP Routing & Switching.' },
    { id: 'nokia', name: 'Nokia 7750 SR', lv: 3, note: 'Audited every week; I brought them up to standard in overnight maintenance windows. Nokia NRS I.' },
    { id: 'bgp', name: 'BGP + IS-IS', lv: 4, note: 'IS-IS was the IGP and BGP the peering. I changed route policies and IGP settings on production routers in overnight maintenance windows.' },
    { id: 'qos', name: 'QoS', lv: 4, note: 'Rewrote the regional QoS policy and rolled it out to every PE router.' },
    { id: 'testing', name: 'Turn-up testing', lv: 4, note: 'Every circuit tested before I called it done: EXFO, RFC 2544 and Y.1731.' },
  ] },
  { title: 'Code', how: HAND, items: [
    { id: 'python', name: 'Python', lv: 4, note: 'Picked up in 2020. Weekly audits, pre-check and post-check scripts for maintenance windows, migration MOPs, password-rotation modules, the RuneScape bot.' },
    { id: 'paramiko', name: 'Paramiko / SSH', lv: 5, note: 'I wrote the multi-vendor modules: how to log in to each vendor’s CLI and drive it, quirks and all.' },
    { id: 'vb', name: 'Visual Basic', lv: 2, note: 'My first program, written like a first-timer: mostly if statements in one giant script. It worked anyway.' },
    { id: 'js', name: 'JavaScript', lv: 2, note: 'The Juniper config generator, the Pepperpi charts and the AskChef.ai front end.' },
    { id: 'cv', name: 'Computer vision + OCR', lv: 3, note: 'OpenCV template matching and Tesseract OCR, so a bot could read a game screen.' },
    { id: 'fastapi', name: 'FastAPI', lv: 2, note: 'AskChef.ai, my first AI app, in 2023: FastAPI, OpenAI, Docker and nginx.' },
    { id: 'git', name: 'Git + GitLab', lv: 3, note: 'Daily on the DevOps team. Every script and tool lived in GitLab.' },
    { id: 'linux', name: 'Linux', lv: 3, note: 'Raspberry Pis since 2019, and the team’s Linux servers at work.' },
    { id: 'docker', name: 'Docker', lv: 1, note: 'Beginner, by my own count: I can run, inspect and restart containers.' },
    { id: 'confluence', name: 'Confluence', lv: 4, note: 'Our team’s Confluence admin. I wrote the customer circuit standards there.' },
    { id: 'micro', name: 'Raspberry Pi + Arduino', lv: 4, note: 'Garage door, plant waterer, pepper sensors, ESP32 relays over MQTT, and now the servers this site runs on.' },
  ] },
  { title: 'Work, by hand', how: HAND, items: [
    { id: 'w-tier4', name: 'Tier 4 escalations', work: true, note: 'Customer router outages at Charter, worked through to the fix: BGP, MPLS, QoS and hardware failures, with on-call rotations.' },
    { id: 'w-juniper', name: 'Config generator + standards', work: true, note: '2016–2018. Juniper configs on demand, and one set of standards the whole team could share.' },
    { id: 'w-audits', name: 'Audits + maintenance windows', work: true, note: '2020 on. My Python audits found what was out of standard across thousands of routers and other network devices; I brought them up to standard in overnight maintenance windows: pre-check, change, post-check.' },
    { id: 'w-mop', name: 'Migration MOP generator', work: true, note: 'Python. Cut sheet in, full method of procedure out, for the whole engineering team.' },
    { id: 'w-rotate', name: 'Inventory + security platform', work: true, note: '2023–2026, Python and SQL, on a team. Discovery filled a SQL inventory; security modules rotated and audited passwords on everything it found. I was a lead developer.' },
    { id: 'w-rs', name: 'RuneScape bot', work: true, note: '2019 on, Python. It read the screen, read the text, made decisions and traded.' },
    { id: 'w-garden', name: 'Garden gadgets', work: true, note: '2019–2020. The Arduino plant waterer and the Pepperpi sensors.' },
  ] },
  { title: 'AI I drive', how: HAND, items: [
    { id: 'claude', name: 'Claude Code', lv: 5, note: 'Half my day, every day. Everything in the right-hand column came out of it.' },
    { id: 'amazonq', name: 'Amazon Q', lv: 3, note: 'At Charter, in the IDE. I hooked it into our GitLab.' },
    { id: 'kiro', name: 'Kiro', lv: 3, note: 'Amazon’s AI for the terminal, at work.' },
    { id: 'llm', name: 'Local LLMs (Ollama)', lv: 3, note: 'Models up to 235B parameters on the Mac Studio, picked and tested for each job.' },
    { id: 'approvals', name: 'Approval workflows', lv: 4, note: 'My rule for agents: anything that matters waits for a human. I designed the Hub’s queue around it.' },
  ] },
  { title: 'Built with Claude', how: AI, items: [
    { id: 'w-hub', name: 'The Hub', work: true, note: 'Mission control for my AI. In progress, used daily.' },
    { id: 'w-house', name: 'House platform', work: true, note: 'The family’s app on a Pi: weather alerts, the house voice, plugs, recipes, the baby log.' },
    { id: 'w-lab', name: 'Home Lab', work: true, note: 'Monitoring, patching and deploy checks for every machine in the house.' },
    { id: 'w-ticker', name: 'Tickerscope', work: true, note: 'My portfolio’s system of record, with a morning brief for my agents.' },
    { id: 'w-grow', name: 'GrowYear', work: true, note: 'A garden planner, live at mygrowyear.com with Google sign-in, served from its own Pi.' },
    { id: 'w-site', name: 'This site', work: true, note: 'Self-hosted over Starlink, with art, music and voices from local AI.' },
    { id: 'flask', name: 'Flask', lv: 2, note: 'Every app in my house runs on it. Claude writes it; I can read it and steer it.' },
    { id: 'react', name: 'React + TypeScript', lv: 1, note: 'GrowYear’s front end. Claude’s work, start to finish.' },
    { id: 'supabase', name: 'Supabase / Postgres', lv: 1, note: 'GrowYear’s database and logins.' },
    { id: 'snmp', name: 'SNMP monitoring', lv: 2, note: 'The Home Lab’s agentless checks. I knew SNMP from work; Claude wrote the poller.' },
    { id: 'tunnel', name: 'Cloudflare Tunnel', lv: 2, note: 'How this site gets out of carrier-grade NAT. I worked out the design with Claude; Claude wrote the setup.' },
  ] },
];

// [a, b]: a used b, or they ran together
const LINKS = [
  ['mpls', 'ce'], ['mpls', 'juniper'], ['mpls', 'cisco'], ['mpls', 'nokia'], ['mpls', 'bgp'], ['python', 'paramiko'],
  ['w-tier4', 'mpls'], ['w-tier4', 'bgp'], ['w-tier4', 'qos'], ['w-tier4', 'juniper'], ['w-tier4', 'cisco'], ['w-tier4', 'nokia'],
  ['w-juniper', 'js'], ['w-juniper', 'juniper'], ['w-juniper', 'confluence'],
  ['w-audits', 'python'], ['w-audits', 'paramiko'], ['w-audits', 'juniper'], ['w-audits', 'cisco'], ['w-audits', 'nokia'], ['w-audits', 'qos'], ['w-audits', 'bgp'],
  ['w-mop', 'python'], ['w-mop', 'paramiko'], ['w-mop', 'juniper'],
  ['w-rotate', 'python'], ['w-rotate', 'paramiko'], ['w-rotate', 'git'], ['w-rotate', 'linux'],
  ['w-rs', 'python'], ['w-rs', 'cv'],
  ['w-garden', 'micro'], ['ce', 'testing'],
  ['amazonq', 'git'], ['kiro', 'git'], ['fastapi', 'docker'], ['fastapi', 'python'],
  ['claude', 'w-hub'], ['claude', 'w-house'], ['claude', 'w-lab'], ['claude', 'w-ticker'], ['claude', 'w-grow'], ['claude', 'w-site'],
  ['llm', 'w-hub'], ['llm', 'w-house'], ['llm', 'w-ticker'], ['approvals', 'w-hub'],
  ['w-hub', 'flask'], ['w-house', 'flask'], ['w-house', 'micro'], ['w-lab', 'flask'], ['w-lab', 'snmp'], ['w-lab', 'paramiko'], ['w-ticker', 'flask'],
  ['w-grow', 'react'], ['w-grow', 'supabase'], ['w-site', 'tunnel'], ['w-site', 'micro'], ['w-site', 'linux'],
];

const esc = (v) => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const bars = (lv) => Array.from({ length: 5 }, (_, i) => `<i${i < lv ? ' class="on"' : ''}></i>`).join('');
const PINK = [255, 92, 168], VIOLET = [196, 107, 255], BLUE = [76, 141, 255], SKY = [143, 211, 255];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function initSkills(root, { detail, table, reduceMotion = false } = {}) {
  if (!root) return;
  const colsEl = root.querySelector('.skillmap-cols');
  const canvas = root.querySelector('.skillmap-links');
  const ctx = canvas.getContext('2d');
  const cache = document.createElement('canvas');
  const defaultDetail = detail ? detail.innerHTML : '';

  const byId = new Map();
  COLS.forEach(col => col.items.forEach(it => byId.set(it.id, { ...it, how: col.how })));
  colsEl.innerHTML = COLS.map(col => `<div class="sk-col" data-how="${col.how}"><h3>${esc(col.title)}</h3><ul>` +
    col.items.map(it => `<li><button type="button" class="sk${it.work ? ' sk-work' : ''}" data-id="${it.id}" data-how="${col.how}"${it.lv ? ` style="--lv:${it.lv}"` : ''}>` +
      `<i class="sk-dot" aria-hidden="true"></i><span class="sk-name">${esc(it.name)}</span>` +
      (it.lv ? `<span class="sk-lv" role="img" aria-label="level ${it.lv} of 5">${bars(it.lv)}</span>` : '<span></span>') +
      `</button></li>`).join('') + '</ul></div>').join('');

  if (table) {
    // the list: each skill or piece of work and where it came from. Both columns sort;
    // until a header is clicked, it keeps the map's order
    const rows = COLS.flatMap(col => col.items.map(it => ({ name: it.name, note: it.note })));
    let sortKey = null, dir = 1;
    const head = (k, label) => {
      const on = sortKey === k;
      return `<th aria-sort="${on ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-k="${k}">${label}` +
        `<i aria-hidden="true">${on ? (dir > 0 ? '▲' : '▼') : ''}</i></button></th>`;
    };
    const render = () => {
      const list = sortKey ? [...rows].sort((a, b) => dir * a[sortKey].localeCompare(b[sortKey])) : rows;
      table.innerHTML = `<table><thead><tr>${head('name', 'Skill or work')}${head('note', 'Where it came from')}</tr></thead><tbody>` +
        list.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.note)}</td></tr>`).join('') + '</tbody></table>';
    };
    table.addEventListener('click', (e) => {
      const b = e.target.closest('th button');
      if (!b) return;
      dir = sortKey === b.dataset.k ? -dir : 1;
      sortKey = b.dataset.k;
      render();
    });
    render();
  }

  const buttons = [...colsEl.querySelectorAll('.sk')];
  const adj = new Map(buttons.map(b => [b.dataset.id, new Set()]));
  for (const [a, b] of LINKS) { adj.get(a)?.add(b); adj.get(b)?.add(a); }

  let W = 0, H = 0, dpr = 1, pos = new Map(), active = null, pinned = null;

  function measure() {
    const r = root.getBoundingClientRect();
    if (r.width < 10) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    for (const c of [canvas, cache]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); }
    pos = new Map(buttons.map(b => {
      const d = b.querySelector('.sk-dot').getBoundingClientRect();
      return [b.dataset.id, [d.left + d.width / 2 - r.left, d.top + d.height / 2 - r.top]];
    }));
    paintCache();
    draw();
  }

  function curve(g, a, b) {
    const [x1, y1] = pos.get(a), [x2, y2] = pos.get(b);
    const dx = x2 - x1;
    g.beginPath();
    g.moveTo(x1, y1);
    if (Math.abs(dx) < 20) g.bezierCurveTo(x1 - 34, y1, x2 - 34, y2, x2, y2); // same column: bow out to the left
    else g.bezierCurveTo(x1 + dx * 0.5, y1, x2 - dx * 0.5, y2, x2, y2);
  }
  const isAI = (id) => byId.get(id)?.how === AI;

  function paintCache() {
    const g = cache.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.lineCap = 'round';
    for (const [a, b] of LINKS) {
      if (!pos.has(a) || !pos.has(b)) continue;
      const lit = active && (a === active || b === active);
      const ai = isAI(a) || isAI(b);
      g.setLineDash(ai ? [3, 4] : []);
      g.lineWidth = lit ? 1.7 : 1;
      g.strokeStyle = lit ? rgba(ai ? SKY : PINK, 0.85) : rgba(ai ? BLUE : VIOLET, active ? 0.07 : 0.2);
      curve(g, a, b);
      g.stroke();
    }
    g.setLineDash([]);
  }

  // light pulses: one at a time along a random wire, only while the map is on screen
  const pulses = [];
  let raf = 0, visible = false, nextAt = 0;
  function pointOn(a, b, t) {
    const [x1, y1] = pos.get(a), [x2, y2] = pos.get(b);
    const dx = x2 - x1, same = Math.abs(dx) < 20;
    const c1 = same ? [x1 - 34, y1] : [x1 + dx * 0.5, y1], c2 = same ? [x2 - 34, y2] : [x2 - dx * 0.5, y2];
    const u = 1 - t;
    return [u * u * u * x1 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * x2,
      u * u * u * y1 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * y2];
  }
  function draw(now = performance.now()) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(cache, 0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], t = (now - p.t0) / p.dur;
      if (t >= 1) { pulses.splice(i, 1); continue; }
      if (t < 0) continue;
      const [x, y] = pointOn(p.a, p.b, t);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.3, rgba(p.c, 0.8)); g.addColorStop(1, rgba(p.c, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function frame(now) {
    raf = 0;
    if (!visible || !W) return;
    if (now >= nextAt && pulses.length < 2) {
      const pool = active ? LINKS.filter(([a, b]) => a === active || b === active) : LINKS;
      const [a, b] = pool[Math.floor(Math.random() * pool.length)];
      const flip = Math.random() < 0.5;
      pulses.push({ a: flip ? b : a, b: flip ? a : b, t0: now, dur: 1500, c: isAI(a) || isAI(b) ? SKY : PINK });
      nextAt = now + 1100 + Math.random() * 900;
    }
    draw(now);
    raf = requestAnimationFrame(frame);
  }
  if (!reduceMotion) new IntersectionObserver(([en]) => {
    visible = en.isIntersecting;
    if (visible && !raf) raf = requestAnimationFrame(frame);
  }).observe(root);

  function show(id) {
    active = id;
    for (const b of buttons) {
      const on = id && (b.dataset.id === id || adj.get(id)?.has(b.dataset.id));
      b.classList.toggle('is-on', !!id && b.dataset.id === id);
      b.classList.toggle('is-dim', !!id && !on);
    }
    if (detail) {
      const it = id && byId.get(id);
      detail.innerHTML = !it ? defaultDetail
        : `<b>${esc(it.name)}</b> · ${it.how === HAND ? 'by hand' : 'built by Claude Code, directed by me'}` +
          `${it.lv ? ` · level ${it.lv} of 5` : ''}. ${esc(it.note)}`;
    }
    paintCache();
    if (!raf) draw();
  }
  colsEl.addEventListener('pointerover', (e) => { const b = e.target.closest('.sk'); if (b && e.pointerType === 'mouse' && !pinned) show(b.dataset.id); });
  colsEl.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pinned) show(null); });
  colsEl.addEventListener('focusin', (e) => { const b = e.target.closest('.sk'); if (b) show(b.dataset.id); });
  colsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.sk');
    if (!b) return;
    pinned = pinned === b.dataset.id ? null : b.dataset.id;
    show(pinned);
  });
  document.addEventListener('click', (e) => { if (pinned && !root.contains(e.target)) { pinned = null; show(null); } });

  new ResizeObserver(measure).observe(root);
  (document.fonts?.ready || Promise.resolve()).then(measure);
}

// The map and the list are two tabs over one spot: one view at a time. Arrow keys move
// between the tabs, the way tab lists do.
export function initSkillTabs(root) {
  if (!root) return;
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const pick = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
  };
  root.addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) pick(t); });
  root.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    pick(tabs[n], true);
  });
}
