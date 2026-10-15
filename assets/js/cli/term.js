// The terminal on /lab/: an output log, a prompt and a real text input (so phones get a keyboard).
// Enter runs a line, ? lists what can come next (without Enter, like the real CLIs), Tab completes,
// the arrows walk the history, Ctrl+C clears the line, Ctrl+Z leaves config mode on the Cisco boxes,
// Ctrl+L clears the screen. A device answers with text, or with steps to print over time (a reload,
// a ping), or with a question to answer first ("Proceed with reload? [confirm]").
const MAX_BLOCKS = 600;

export class Term {
  constructor(root, dev) {
    this.root = root;
    this.out = root.querySelector('.lab-out');
    this.screen = root.querySelector('.lab-screen');
    this.promptEl = root.querySelector('.lab-prompt');
    this.input = root.querySelector('.lab-input');
    this.ask = null;
    this.busy = false;
    this.hist = [];
    this.hi = 0;
    this.escaped = false;
    this.listeners = { run: [], before: [] };
    this.bind(dev, { silent: true });
    this.wire();
  }
  on(type, fn) { this.listeners[type].push(fn); return () => { this.listeners[type] = this.listeners[type].filter((f) => f !== fn); }; }

  // ---------------------------------------------------------------- a device on the line
  bind(dev, { silent = false } = {}) {
    if (this.dev) this.dev.onLog = null;
    this.dev = dev;
    this.hist = dev.history;
    this.hi = this.hist.length;
    this.ask = null;
    dev.onLog = (text) => { this.print(text, 'log'); };
    if (!silent) this.showPrompt();
  }
  print(text, cls = '') {
    if (text == null) return;
    const pre = document.createElement('pre');
    pre.className = 'lab-blk' + (cls ? ' lab-' + cls : '');
    pre.textContent = text;
    this.out.appendChild(pre);
    while (this.out.childElementCount > MAX_BLOCKS) this.out.firstElementChild.remove();
    this.scroll();
    return pre;
  }
  echo(prompt, line) {
    const pre = document.createElement('pre');
    pre.className = 'lab-blk lab-echo';
    const p = document.createElement('span');
    p.className = 'lab-p';
    p.textContent = prompt;
    pre.append(p, document.createTextNode(line));
    this.out.appendChild(pre);
    this.scroll();
  }
  clear() { this.out.textContent = ''; }
  scroll() { this.screen.scrollTop = this.screen.scrollHeight; }
  showPrompt() {
    if (this.ask) { this.promptEl.textContent = this.ask.q; return; }
    const pre = this.dev.pre();
    if (pre.length) this.print(pre.join('\n'), 'pre');
    this.promptEl.textContent = this.dev.prompt();
    this.scroll();
  }
  setBusy(b) {
    this.busy = b;
    this.root.classList.toggle('is-busy', b);
    this.input.readOnly = b;
  }

  // ---------------------------------------------------------------- running a line
  run(line) {
    if (this.busy) return;
    if (this.ask) {
      const a = this.ask;
      this.ask = null;
      this.echo(a.q, line);
      this.handle(this.safe(() => a.then(line)), line);
      return;
    }
    this.echo(this.dev.prompt(), line);
    if (line.trim()) {
      if (this.hist[this.hist.length - 1] !== line) this.hist.push(line);
      if (this.hist.length > 100) this.hist.shift();
    }
    this.hi = this.hist.length;
    for (const f of this.listeners.before) f(line);
    this.handle(this.safe(() => this.dev.exec(line)), line);
  }
  safe(fn) {
    try { return fn(); } catch (e) {
      console.error(e);
      return '% The simulator tripped over that command. (A bug on our side, not yours.)';
    }
  }
  handle(res, line) {
    const done = () => {
      for (const f of this.listeners.run) f(line, res);
      if (res && res.relogin) this.print(`\n--- session closed; reconnected to ${this.dev.host()} (simulated) ---\n`, 'note');
      this.showPrompt();
    };
    if (res == null || typeof res === 'string') {
      if (res) this.print(res.replace(/\n$/, ''));
      return done();
    }
    if (res.out) this.print(res.out.replace(/\n$/, ''));
    const steps = res.steps || [];
    if (!steps.length) {
      if (res.ask) this.ask = res.ask;
      return done();
    }
    this.setBusy(true);
    this.promptEl.textContent = '';
    let i = 0;
    const next = () => {
      if (i >= steps.length) {
        this.setBusy(false);
        if (res.ask) this.ask = res.ask;
        done();
        this.input.focus({ preventScroll: true });
        return;
      }
      const s = steps[i++];
      const go = () => { this.print(s.t); next(); };
      if (s.ms && !this.fast) setTimeout(go, s.ms); else go();
    };
    next();
  }

  // ---------------------------------------------------------------- keys
  key(k) {
    const inp = this.input;
    if (k === 'tab') return this.complete();
    if (k === 'help') return this.help();
    if (k === 'up' || k === 'down') {
      if (this.ask || this.busy) return;
      if (k === 'up' && this.hi > 0) this.hi--;
      if (k === 'down' && this.hi < this.hist.length) this.hi++;
      inp.value = this.hist[this.hi] || '';
      requestAnimationFrame(() => inp.setSelectionRange(inp.value.length, inp.value.length));
      return;
    }
    if (k === 'ctrlc') {
      if (this.busy) return;
      this.echo(this.ask ? this.ask.q : this.dev.prompt(), inp.value + '^C');
      inp.value = '';
      if (this.ask) { const a = this.ask; this.ask = null; this.handle(this.safe(() => a.then('n')), ''); return; }
      this.showPrompt();
      return;
    }
    if (k === 'ctrlz') {
      if (this.busy || this.ask || !this.dev.ctrlZ) return;
      const line = inp.value;
      const res = this.safe(() => this.dev.ctrlZ());
      if (res == null) return;
      this.echo(this.promptEl.textContent, line + '^Z');
      inp.value = '';
      this.handle(res, '^Z');
      return;
    }
    if (k === 'clear') { this.clear(); this.showPrompt(); }
  }
  help() {
    if (this.busy || this.ask) return;
    const inp = this.input;
    const upto = inp.value.slice(0, inp.selectionStart ?? inp.value.length);
    this.echo(this.dev.prompt(), upto + '?');
    const out = this.safe(() => this.dev.help(upto));
    if (out) this.print(out);
    this.promptEl.textContent = this.dev.prompt();
    inp.value = upto;
    this.scroll();
  }
  complete() {
    if (this.busy || this.ask) return;
    const inp = this.input;
    const r = this.safe(() => this.dev.complete(inp.value));
    if (!r || typeof r !== 'object') return;
    if (r.show) { this.echo(this.dev.prompt(), inp.value); this.print(r.show); }
    if (r.bell) { this.root.classList.remove('is-bell'); void this.root.offsetWidth; this.root.classList.add('is-bell'); }
    inp.value = r.line;
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }
  wire() {
    const inp = this.input;
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.escaped = true; return; }
      if (e.key === 'Tab') {
        if (e.shiftKey || this.escaped || !inp.value.trim()) { this.escaped = false; return; }
        e.preventDefault();
        this.complete();
        return;
      }
      this.escaped = false;
      if (this.busy) { if (e.key !== 'c' || !e.ctrlKey) e.preventDefault(); return; }
      if (e.key === 'Enter') { e.preventDefault(); const v = inp.value; inp.value = ''; this.run(v); return; }
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); this.help(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.key('up'); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); this.key('down'); return; }
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'c' && !inp.value.slice(inp.selectionStart, inp.selectionEnd)) { e.preventDefault(); this.key('ctrlc'); }
        else if (k === 'z') { e.preventDefault(); this.key('ctrlz'); }
        else if (k === 'l') { e.preventDefault(); this.key('clear'); }
      }
    });
    // phones: the ? key often arrives as text, not as a key press
    inp.addEventListener('beforeinput', (e) => {
      if (e.data === '?' && e.cancelable) { e.preventDefault(); this.help(); }
    });
    inp.addEventListener('input', () => {
      const i = inp.value.indexOf('?');
      if (i >= 0) {
        inp.value = inp.value.slice(0, i) + inp.value.slice(i + 1);
        inp.setSelectionRange(i, i);
        this.help();
      }
    });
    // a tap on the screen puts you on the command line, unless you're selecting text to copy
    this.screen.addEventListener('click', () => {
      const sel = getSelection();
      if (sel && sel.toString()) return;
      inp.focus({ preventScroll: true });
    });
  }
}
