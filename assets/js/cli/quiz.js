// Quiz mode for one lab. Every question gets its own throwaway copy of the device (your saved lab
// is never touched): setup breaks it or puts you in the right mode, you type into the same terminal,
// and each line is graded as it runs. Syntax answers are compared by what they parse to, so "sh ip
// int br" counts. Config and troubleshooting answers are graded on the device's state afterward.
// The heat meter warms as you go (right mode, a good place to look, part of a task done, a correct
// answer, a streak) and cools on a miss.
import { BANKS, KINDS } from './banks.js';
import { store } from './engine.js';

const BEST_KEY = 'okay-cool.lab.quiz';
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// run lines on a device without a terminal, answering any question with its default
export function quietly(d, lines = []) {
  for (const line of lines) {
    let r = d.exec(line);
    for (let guard = 0; r && typeof r === 'object' && r.ask && guard < 4; guard++) r = r.ask.then('');
  }
  d.stopTimers();
}

export class Quiz {
  constructor({ id, term, make, panel, heat, onState }) {
    this.id = id;
    this.term = term;
    this.make = make;
    this.panel = panel;
    this.heat = heat;
    this.onState = onState || (() => {});
    this.bank = BANKS[id];
    this.active = false;
    this.renderPicker();
  }
  bests() { return store.get(BEST_KEY) || {}; }
  count(kind) { return this.bank[kind].length; }

  // ---------------------------------------------------------------- the panel
  renderPicker() {
    const p = this.panel;
    p.textContent = '';
    p.append(el('h3', 'quiz-h', 'Quiz mode'), el('p', 'quiz-lede', 'Pick a quiz. Each question runs on a scratch copy of this device, so your saved config stays as it is.'));
    const list = el('div', 'quiz-picks');
    const best = this.bests();
    for (const [kind, k] of Object.entries(KINDS)) {
      const b = el('button', 'quiz-pick');
      b.type = 'button';
      const n = Math.min(k.take, this.count(kind));
      const rec = best[`${this.id}:${kind}`];
      b.append(el('b', '', k.name), el('span', '', k.blurb), el('small', '', `${n} questions from a bank of ${this.count(kind)}${rec ? ` · best ${rec.best}/${rec.of}` : ''}`));
      b.addEventListener('click', () => this.start(kind));
      list.append(b);
    }
    p.append(list);
  }
  renderQuestion() {
    const p = this.panel, q = this.q, K = KINDS[this.kind];
    p.textContent = '';
    const head = el('div', 'quiz-top');
    head.append(el('span', 'quiz-count', `${K.name} · ${this.i + 1} of ${this.list.length}`), el('span', 'quiz-score', `Score ${this.score}`));
    const streak = el('span', 'quiz-streak', this.streak > 1 ? `Streak ${this.streak}` : '');
    head.append(streak);
    p.append(head);
    if (q.title) p.append(el('h3', 'quiz-title', q.title));
    p.append(el('p', 'quiz-q', q.q));
    if (q.goals && q.goals.length > 1) {
      const ul = el('ul', 'quiz-goals');
      ul.setAttribute('aria-label', 'What it takes');
      q.goals.forEach(([label], gi) => { const li = el('li', this.st.goals.has(gi) ? 'is-done' : '', label); ul.append(li); });
      p.append(ul);
    }
    const fb = el('p', 'quiz-fb' + (this.st.fbKind ? ` is-${this.st.fbKind}` : ''), this.st.fb || (this.kind === 'syntax' ? 'Type it in the terminal and press Enter.' : this.kind === 'fix' ? 'Use show commands to find it, then fix it.' : 'Make the change in the terminal.'));
    fb.setAttribute('role', 'status');
    p.append(fb);
    if (this.st.hintsShown.length) {
      const h = el('ul', 'quiz-hints');
      for (const t of this.st.hintsShown) h.append(el('li', '', t));
      p.append(h);
    }
    if (this.st.revealed) {
      const pre = el('pre', 'quiz-answer', this.answerText());
      p.append(el('p', 'quiz-k', 'One answer'), pre);
    }
    const row = el('div', 'quiz-btns');
    const btn = (label, fn, cls = '') => { const b = el('button', 'quiz-btn ' + cls, label); b.type = 'button'; b.addEventListener('click', fn); row.append(b); return b; };
    if (this.st.done) {
      const nb = btn(this.i + 1 < this.list.length ? 'Next question' : 'See my score', () => this.next(), 'is-go');
      requestAnimationFrame(() => { if (this.panel.contains(document.activeElement) || document.activeElement === document.body) nb.focus({ preventScroll: true }); });
    } else {
      const hints = this.hints();
      if (this.st.hintsShown.length < hints.length) btn(`Hint (${hints.length - this.st.hintsShown.length})`, () => this.hint());
      btn('Show answer', () => this.reveal());
      btn('Skip', () => this.skip());
    }
    btn('Quit quiz', () => this.finish(true), 'is-quiet');
    p.append(row);
  }
  renderEnd(early) {
    const p = this.panel, K = KINDS[this.kind];
    const of = this.list.length * K.points;
    const key = `${this.id}:${this.kind}`;
    const best = this.bests();
    const prev = best[key];
    const isBest = !early && (!prev || this.score > prev.best || (this.score === prev.best && of < prev.of));
    if (isBest) { best[key] = { best: this.score, of, at: Date.now() }; store.set(BEST_KEY, best); }
    p.textContent = '';
    p.append(el('h3', 'quiz-h', early ? 'Quiz stopped' : 'Quiz done'));
    const big = el('p', 'quiz-final');
    big.append(el('b', '', `${this.score}`), document.createTextNode(` / ${of}`));
    p.append(big);
    const right = this.results.filter((r) => r.pts > 0).length;
    p.append(el('p', 'quiz-lede', `${right} of ${this.results.length} answered${isBest ? ' · a new best for this quiz' : prev ? ` · your best is ${prev.best}/${prev.of}` : ''}.`));
    const ul = el('ol', 'quiz-results');
    for (const r of this.results) {
      const li = el('li', r.pts > 0 ? 'is-ok' : 'is-miss');
      li.append(el('span', 'quiz-pts', r.pts > 0 ? `+${r.pts}` : '0'), el('span', '', r.title));
      if (r.answer) li.append(el('code', '', r.answer));
      ul.append(li);
    }
    p.append(ul);
    const row = el('div', 'quiz-btns');
    const again = el('button', 'quiz-btn is-go', 'Same quiz again');
    again.type = 'button';
    again.addEventListener('click', () => this.start(this.kind));
    const other = el('button', 'quiz-btn', 'Pick another quiz');
    other.type = 'button';
    other.addEventListener('click', () => this.renderPicker());
    row.append(again, other);
    p.append(row);
  }

  // ---------------------------------------------------------------- flow
  start(kind) {
    this.kind = kind;
    this.list = shuffle(this.bank[kind]).slice(0, KINDS[kind].take);
    this.i = 0;
    this.score = 0;
    this.streak = 0;
    this.results = [];
    if (!this.active) {
      this.home = this.term.dev;
      this.offRun = this.term.on('run', (line, res) => this.onRun(line, res));
      this.offBefore = this.term.on('before', (line) => this.onBefore(line));
    }
    this.active = true;
    this.heat.reset();
    this.heat.show(true);
    this.onState(true);
    this.term.print(`\n=== Quiz: ${KINDS[kind].name} (${this.list.length} questions). Your own lab is paused, untouched. ===`, 'quiz');
    this.ask();
  }
  ask() {
    const q = (this.q = this.list[this.i]);
    this.st = { tries: 0, hintsShown: [], revealed: false, done: false, goals: new Set(), looked: new Set(), configSeen: false, fb: '', fbKind: '', staged: false };
    const d = this.make();
    quietly(d, q.setup);
    quietly(d, q.start || (this.id === 'catalyst' || this.id === 'me3600x' ? ['enable'] : []));
    this.dev = d;
    if (this.kind === 'syntax' && q.a) {
      this.want = q.a.map((a) => { const t = this.make(); quietly(t, q.start || (this.id === 'catalyst' || this.id === 'me3600x' ? ['enable'] : [])); return t.canon(a); }).filter(Boolean);
    }
    for (const [gi, [, fn]] of (q.goals || []).entries()) if (this.safe(fn, d)) this.st.goals.add(gi);
    this.term.print(`\n--- Question ${this.i + 1} of ${this.list.length}${q.title ? `: ${q.title}` : ''} ---\n${q.q}`, 'quiz');
    this.term.bind(d);
    this.renderQuestion();
  }
  safe(fn, d) { try { return !!fn(d); } catch { return false; } }
  hints() {
    const q = this.q;
    if (q.hints) return q.hints;
    const a = (q.a && q.a[0]) || q.tip || '';
    const words = a.split(' ');
    return words.length > 2 ? [`It starts with: ${words.slice(0, Math.ceil(words.length / 2)).join(' ')} …`] : [`It's ${words.length === 1 ? 'one word' : 'two words'}.`];
  }
  answerText() {
    const q = this.q;
    if (q.answer) return q.answer.join('\n');
    if (q.a) return q.a.join('\n   or  ');
    return q.tip || '';
  }
  // the syntax answer is judged on how the line parses in the mode it was typed in
  onBefore(line) { this.pending = this.kind === 'syntax' && this.dev ? this.dev.canon(line) : null; }
  onRun(line, res) {
    if (!this.active || !this.dev || this.term.dev !== this.dev) return;
    if (this.st.done) { if (!line.trim()) this.next(); return; }
    if (!line.trim()) return;
    if (this.kind === 'syntax') return this.gradeSyntax(line);
    this.gradeTask(line);
  }
  feedback(text, kind) { this.st.fb = text; this.st.fbKind = kind; this.renderQuestion(); }
  gradeSyntax(line) {
    const q = this.q, got = this.pending;
    this.st.tries++;
    const ok = q.ok ? this.safe(q.ok, this.dev) : !!got && this.want.includes(got);
    if (ok) return this.solved();
    if (!got) {
      this.heat.miss();
      this.streak = 0;
      return this.feedback("That didn't parse. Check the error in the terminal and try again.", 'miss');
    }
    const w = got.split(' ');
    const close = this.want.some((x) => { const v = x.split(' '); let n = 0; while (n < w.length && n < v.length && w[n] === v[n]) n++; return n >= 2 || (n === 1 && v.length <= 2); });
    if (close) {
      this.heat.nudge(0.03);
      return this.feedback(`Close: that ran "${got}". Keep going.`, 'close');
    }
    this.heat.miss();
    this.streak = 0;
    this.feedback(`That ran "${got}", a real command but not this one.`, 'miss');
  }
  gradeTask(line) {
    const q = this.q, d = this.dev;
    const canon = d.canon(line) || '';
    let warmed = false;
    if (!this.st.configSeen && d.inConfig()) {
      this.st.configSeen = true;
      this.heat.nudge(0.04);
      warmed = true;
      this.st.fb = 'In config mode. Good.';
      this.st.fbKind = 'close';
    }
    if (q.look) {
      const hit = q.look.find((l) => (canon.startsWith(l) || canon.startsWith('do ' + l) || canon.startsWith('run ' + l)) && !this.st.looked.has(l));
      if (hit) { this.st.looked.add(hit); this.heat.nudge(0.05); warmed = true; this.st.fb = 'Good place to look.'; this.st.fbKind = 'close'; }
    }
    const before = this.st.goals.size;
    const now = new Set();
    q.goals.forEach(([, fn], gi) => { if (this.safe(fn, d)) now.add(gi); });
    this.st.goals = now;
    if (now.size === q.goals.length) return this.solved();
    if (now.size > before) {
      this.heat.nudge(0.07 * (now.size - before));
      this.st.fb = `${now.size} of ${q.goals.length} done.`;
      this.st.fbKind = 'close';
    } else if (now.size < before) {
      this.heat.miss(0.08);
      this.st.fb = 'That undid part of it.';
      this.st.fbKind = 'miss';
    } else if (this.staged(d) && !warmed) {
      this.st.fb = this.id === 'junos' ? 'Looks right in the candidate config. Now commit it.' : 'Looks right in the target config. Now commit it.';
      this.st.fbKind = 'close';
      if (!this.st.staged) { this.st.staged = true; this.heat.nudge(0.05); }
    }
    this.renderQuestion();
  }
  // would the goals pass if the uncommitted changes were committed? (Junos and IOS XR)
  staged(d) {
    const swap = this.id === 'junos' ? ['committed', d.candidate] : this.id === 'iosxr' ? ['running', d.target] : null;
    if (!swap || !swap[1]) return false;
    const saved = d[swap[0]];
    d[swap[0]] = swap[1];
    try { return this.q.goals.every(([, fn]) => this.safe(fn, d)); } finally { d[swap[0]] = saved; }
  }
  points() {
    const K = KINDS[this.kind];
    if (this.st.revealed) return 0;
    let p = K.points - this.st.hintsShown.length * (this.kind === 'syntax' ? 4 : 5);
    if (this.kind === 'syntax') p -= Math.max(0, this.st.tries - 1) * 2;
    return Math.max(this.kind === 'syntax' ? 2 : 5, p);
  }
  solved() {
    const pts = this.points();
    this.st.done = true;
    this.streak = this.st.hintsShown.length || this.st.tries > 1 ? 1 : this.streak + 1;
    this.score += pts;
    this.results.push({ title: this.q.title || this.q.q, pts, answer: null });
    this.heat.hit(this.streak);
    this.st.fb = `Correct. +${pts}${this.streak > 2 ? ` · streak ${this.streak}` : ''}`;
    this.st.fbKind = 'ok';
    this.term.print(`✓ Correct (+${pts}). Press Enter on an empty line, or use the Next button.`, 'quiz-ok');
    this.renderQuestion();
  }
  hint() {
    const hints = this.hints();
    if (this.st.hintsShown.length >= hints.length) return;
    this.st.hintsShown.push(hints[this.st.hintsShown.length]);
    this.heat.nudge(-0.04);
    this.renderQuestion();
  }
  reveal() {
    this.st.revealed = true;
    this.st.done = true;
    this.streak = 0;
    this.results.push({ title: this.q.title || this.q.q, pts: 0, answer: this.answerText().split('\n')[0] + (this.answerText().includes('\n') ? ' …' : '') });
    this.heat.miss(0.3);
    this.st.fb = this.kind === 'syntax' ? 'Here it is. Try typing it anyway.' : 'Here is one way. Try it in the terminal; it still works on this scratch device.';
    this.st.fbKind = 'miss';
    this.term.print(`Answer:\n${this.answerText()}`, 'quiz');
    this.renderQuestion();
  }
  skip() {
    this.results.push({ title: this.q.title || this.q.q, pts: 0, answer: this.answerText().split('\n')[0] });
    this.streak = 0;
    this.heat.miss(0.2);
    this.next(true);
  }
  next(skipped) {
    if (!skipped && !this.st.done) return;
    this.i++;
    if (this.i >= this.list.length) return this.finish(false);
    this.ask();
  }
  finish(early) {
    if (!this.active) return this.renderPicker();
    this.active = false;
    this.offRun && this.offRun();
    this.offBefore && this.offBefore();
    if (this.dev) this.dev.stopTimers();
    this.dev = null;
    this.term.print(`\n=== Quiz ${early ? 'stopped' : 'done'}: ${this.score} points. Back to your own lab. ===`, 'quiz');
    this.term.bind(this.home);
    this.heat.show(false);
    this.onState(false);
    this.renderEnd(early);
  }
}
