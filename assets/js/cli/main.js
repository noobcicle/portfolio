// /lab/: four practice CLIs behind a tab bar. Each device keeps its own terminal, history and saved
// config (this browser's localStorage only), and its own quiz. Nothing here talks to a network.
import { Junos } from './junos.js';
import { IosXr } from './iosxr.js';
import { Me3600 } from './me3600.js';
import { Catalyst } from './catalyst.js';
import { Term } from './term.js';
import { Quiz } from './quiz.js';
import { Heat } from './heat.js';
import { store } from './engine.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const MAKE = { junos: () => new Junos(), iosxr: () => new IosXr(), me3600x: () => new Me3600(), catalyst: () => new Catalyst() };
const KEY = (id) => `okay-cool.lab.${id}`;
const LAST = 'okay-cool.lab.tab';

// ------------------------------------------------------------------ the commands each lab knows (click one to type it)
const REF = {
  junos: [
    ['Look around', ['show interfaces terse', 'show route', 'show bgp summary', 'show ospf neighbor', 'show vlans', 'show lldp neighbors', 'show ethernet-switching table', 'show configuration', 'show configuration | display set', 'show system commit', 'show version']],
    ['Configure', ['configure', 'set system host-name lab-qfx9', 'set interfaces xe-0/0/3 unit 0 family inet address 10.0.14.1/30', 'delete interfaces xe-0/0/3', 'edit protocols ospf area 0.0.0.0', 'up', 'top', 'show | compare', 'run show bgp summary']],
    ['Save and undo', ['commit check', 'commit', 'commit confirmed 5', 'commit and-quit', 'rollback 1', 'exit']],
    ['Pipes', ['show configuration | match host', 'show route | count', 'show interfaces terse | except down']],
  ],
  iosxr: [
    ['Look around', ['show ipv4 interface brief', 'show bgp summary', 'show bgp', 'show route', 'show ospf neighbor', 'show mpls ldp neighbor', 'show l2vpn xconnect', 'show running-config', 'show configuration commit list', 'show platform']],
    ['Configure', ['configure', 'hostname lab-asr9k-2', 'interface gi0/1/0/3', 'description spare', 'no shutdown', 'router bgp 64500', 'neighbor 192.0.2.1', 'show configuration', 'do show bgp summary']],
    ['Save and undo', ['commit', 'show configuration commit changes last 1', 'abort', 'end', 'rollback configuration last 1']],
    ['Pipes', ['show running-config | include hostname', 'show route | begin Gateway']],
  ],
  me3600x: [
    ['Look around', ['enable', 'show ethernet service instance', 'show ethernet service instance detail', 'show bridge-domain', 'show ip interface brief', 'show interfaces status', 'show vlan brief', 'show spanning-tree', 'show running-config interface gi0/2', 'show version']],
    ['Configure', ['configure terminal', 'interface gi0/4', 'service instance 150 ethernet', 'encapsulation dot1q 150', 'encapsulation dot1q 200 second-dot1q 10-20', 'rewrite ingress tag pop 1 symmetric', 'bridge-domain 150', 'exit', 'end']],
    ['Save and reload', ['write memory', 'copy running-config startup-config', 'show startup-config', 'reload']],
    ['Pipes', ['show running-config | section interface', 'show running-config | include encapsulation']],
  ],
  catalyst: [
    ['Look around', ['enable', 'show ip interface brief', 'show vlan brief', 'show interfaces status', 'show interfaces trunk', 'show mac address-table', 'show cdp neighbors', 'show spanning-tree vlan 10', 'show interfaces gi1/0/3 switchport', 'show running-config', 'show logging']],
    ['Configure', ['configure terminal', 'vlan 40', 'name GUEST', 'interface gi1/0/9', 'switchport mode access', 'switchport access vlan 40', 'spanning-tree portfast', 'interface range gi1/0/10 - 12', 'switchport trunk allowed vlan add 40', 'shutdown', 'no shutdown', 'end']],
    ['Save and reload', ['write memory', 'copy running-config startup-config', 'show startup-config', 'reload', 'erase startup-config']],
    ['Pipes', ['show running-config | section interface', 'show running-config | include hostname', 'show vlan brief | count Gi']],
  ],
};
const SAVING = {
  junos: 'set and delete change the candidate. commit makes it the active config and saves it here, keeping the last few versions for rollback. Leave without committing and the changes are gone.',
  iosxr: 'Config mode edits a target config. commit applies it and saves it here, with a commit ID. end or exit with changes pending asks first; abort throws them away.',
  me3600x: 'Changes apply the moment you type them, to the running config. write memory (or copy running-config startup-config) saves to startup. reload, or reloading this page, brings back what you saved.',
  catalyst: 'Changes apply the moment you type them, to the running config. write memory (or copy running-config startup-config) saves to startup. reload, or reloading this page, brings back what you saved.',
};

// ------------------------------------------------------------------ nav (this page has no home-page script)
const menuBtn = $('#menu-btn'), menu = $('#mobile-menu');
menuBtn.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') !== 'true';
  menuBtn.setAttribute('aria-expanded', String(open));
  menu.hidden = !open;
});
for (const a of $$('.js-email')) {
  a.href = `mailto:${a.dataset.u}@${a.dataset.d}?subject=${encodeURIComponent('Hello from okay-cool.net')}`;
  a.title = `${a.dataset.u}@${a.dataset.d}`;
}

// ------------------------------------------------------------------ the labs
const tpl = $('#lab-tpl');
const labs = {};
for (const panel of $$('.lab-panel')) {
  const id = panel.dataset.dev;
  panel.textContent = '';   // the "Loading the lab" note
  panel.append(tpl.content.cloneNode(true));
  const dev = MAKE[id]();
  const saved = store.get(KEY(id));
  if (saved) {
    dev.restore(saved.cfg);
    if (Array.isArray(saved.hist)) dev.history.push(...saved.hist.slice(-50).filter((h) => typeof h === 'string'));
  }
  const save = () => store.set(KEY(id), { v: 1, cfg: dev.persist(), hist: dev.history.slice(-50) });
  dev.onSave = save;
  const termEl = $('.lab-term', panel);
  const input = $('.lab-input', termEl);
  input.id = `lab-in-${id}`;
  input.setAttribute('aria-label', `Command line for ${dev.label()}`);
  input.setAttribute('aria-describedby', `lab-help-${id}`);
  $('.lab-help', panel).id = `lab-help-${id}`;
  $('.lab-title', termEl).textContent = `${dev.label()} · simulated`;
  $('.lab-dev-name', panel).textContent = dev.label();
  $('.lab-save-text', panel).textContent = SAVING[id];
  if (id === 'junos') $('[data-key="ctrlz"]', panel).hidden = true;
  const term = new Term(termEl, dev);
  term.print(dev.motd(), 'note');
  term.showPrompt();
  // history is saved as you go, but only for your own lab, never a quiz's scratch device
  term.on('run', () => { if (term.dev === dev) save(); });
  const heat = new Heat(termEl, $('.lab-heat', termEl));
  const quiz = new Quiz({ id, term, make: MAKE[id], panel: $('.quiz', panel), heat, onState: (on) => panel.classList.toggle('in-quiz', on) });
  labs[id] = { dev, term, quiz, panel, save };

  // the reference: a click types the command for you (it doesn't run it)
  const ref = $('.lab-ref-body', panel);
  for (const [title, cmds] of REF[id]) {
    const g = document.createElement('div');
    g.className = 'lab-ref-group';
    const h = document.createElement('p');
    h.className = 'lab-ref-k';
    h.textContent = title;
    g.append(h);
    for (const c of cmds) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lab-chip';
      b.textContent = c;
      b.addEventListener('click', () => { input.value = c; input.focus({ preventScroll: true }); input.setSelectionRange(c.length, c.length); });
      g.append(b);
    }
    ref.append(g);
  }

  // the on-screen keys (phones have no Tab, arrows or Ctrl); they never take focus from the line
  for (const k of $$('.lab-keys button', panel)) {
    k.addEventListener('pointerdown', (e) => e.preventDefault());
    k.addEventListener('click', () => { term.key(k.dataset.key); if (matchMedia('(pointer: coarse)').matches || document.activeElement === k) input.focus({ preventScroll: true }); });
  }

  // the toolbar
  $('[data-act="quiz"]', panel).addEventListener('click', () => {
    const q = $('.quiz', panel);
    q.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const first = $('button', q);
    if (first) first.focus({ preventScroll: true });
  });
  $('[data-act="clear"]', panel).addEventListener('click', () => { term.clear(); term.showPrompt(); });
  $('[data-act="export"]', panel).addEventListener('click', () => {
    const blob = new Blob([dev.configText()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${dev.host()}-config.txt`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    term.print(`(saved ${dev.host()}'s ${id === 'junos' ? 'committed' : id === 'iosxr' ? 'committed running' : 'running'} config as ${a.download})`, 'note');
  });
  $('[data-act="import"]', panel).addEventListener('click', () => openImport(id));
  $('[data-act="reset"]', panel).addEventListener('click', () => {
    if (!confirm(`Reset ${dev.host()} to its factory lab config? This erases what you saved for this device in this browser.`)) return;
    if (quiz.active) quiz.finish(true);
    dev.resetFactory();
    store.del(KEY(id));
    dev.history.length = 0;
    term.clear();
    term.print(dev.motd(), 'note');
    term.print('(reset to factory: the saved config for this device is gone)', 'note');
    term.showPrompt();
  });
}

// ------------------------------------------------------------------ import
const dlg = $('#lab-import');
let importFor = null;
function openImport(id) {
  importFor = id;
  const d = labs[id].dev;
  $('#lab-import-title').textContent = `Import a config into ${d.host()}`;
  $('#lab-import-text').value = '';
  $('#lab-import-note').textContent = id === 'junos' ? 'Paste set commands or the curly-brace format. It loads into the candidate config; commit to apply.'
    : id === 'iosxr' ? 'Paste an IOS XR running config. It loads into the target config; commit to apply.'
      : 'Paste a running config. It replaces the running config; write memory to keep it.';
  dlg.showModal();
  $('#lab-import-text').focus();
}
$('#lab-import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f && f.size < 512 * 1024) $('#lab-import-text').value = await f.text();
  e.target.value = '';
});
$('#lab-import-go').addEventListener('click', () => {
  const lab = labs[importFor];
  const text = $('#lab-import-text').value;
  if (!lab || !text.trim()) { dlg.close(); return; }
  const r = lab.dev.importConfig(text);
  dlg.close();
  lab.term.print(`(import: ${r.msg})`, 'note');
  lab.term.showPrompt();
  lab.term.input.focus({ preventScroll: true });
});
$('#lab-import-cancel').addEventListener('click', () => dlg.close());

// ------------------------------------------------------------------ tabs
const tabs = $$('.lab-tab');
function select(id, { focus = false, push = true } = {}) {
  if (!labs[id]) id = 'junos';
  for (const t of tabs) {
    const on = t.dataset.dev === id;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  }
  for (const [k, lab] of Object.entries(labs)) lab.panel.hidden = k !== id;
  labs[id].term.scroll();
  try { localStorage.setItem(LAST, id); } catch { /* private window */ }
  if (push && location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(t.dataset.dev));
  t.addEventListener('keydown', (e) => {
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    select(tabs[(to + tabs.length) % tabs.length].dataset.dev, { focus: true });
  });
});
let first = location.hash.slice(1);
if (!labs[first]) { try { first = localStorage.getItem(LAST) || 'junos'; } catch { first = 'junos'; } }
select(first, { push: !!location.hash });
addEventListener('hashchange', () => { const id = location.hash.slice(1); if (labs[id]) select(id, { push: false }); });
