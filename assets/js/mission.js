// The Hub, one real request from start to finish: eleven steps, played in order while the section
// is on screen. A step is one attribute on the scene (data-step) and CSS does the rest. The only
// timers are the prompt being typed and Claude's spinner, and they run on their own steps only.
// The spinner's frames and colors are Claude Code's own (·✢✳✶✻✽, forward then back).

const CAPS = [
  'Mike talks an idea through, out loud, with Get A Job Bot: an agent that runs on Grok.',
  'The bot listens. His voice arrives as a waveform.',
  'The waveform flows into Grok, which works out what he actually wants.',
  'Grok writes it up as one precise prompt.',
  'The prompt goes to the Mac Studio through the Hub’s API, on the bot’s own key. That key can only reach the bot’s own sessions.',
  'The Hub parks it on the session’s terminal: a pseudo-terminal (PTY) running Claude Code. Nothing has been typed.',
  'It lands as a bright gold flag on that session: Prompt waiting for review.',
  'The flag is a candidate prompt, and the sessions list shows an amber ring. If Mike is still talking, the bot revises it in place.',
  'A human reads it, then says yes: send to Claude.',
  'Only then is it typed into Claude Code.',
  'Claude thinks, then works. The finished diff still waits for Mike before anything ships.',
];
const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽'];
const SPIN = [...FRAMES, ...FRAMES.slice().reverse()];
const VERBS = ['Clauding', 'Cogitating', 'Combobulating', 'Brewing'];
const HOLD = [2600, 2400, 2600, 3600, 2800, 2800, 3000, 3600, 3200, 3200, 5200];

export function initMission(root, { reduceMotion = false } = {}) {
  if (!root) return;
  const $ = (s) => root.querySelector(s);
  const steps = [...root.querySelectorAll('.mc-steps button')];
  const cap = $('#mc-cap'), count = $('#mc-count'), playBtn = $('#mc-play');
  const prompt = $('#mc-prompt'), typed = $('#mc-typed'), glyph = $('#mc-glyph'), verb = $('#mc-verb');
  const FULL = prompt.textContent;
  const TYPED = 'GrowYear is now a finished, live product at https://mygrowyear.com (Google sign-in). Update Mike’s portfolio…';
  let i = 0, playing = !reduceMotion, visible = false, holdT = 0, typeT = 0, spinT = 0, verbT = 0;

  function type(el, text, ms) {
    clearInterval(typeT);
    if (reduceMotion) { el.textContent = text; return; }
    let n = 0;
    const step = Math.max(1, Math.round(text.length / (ms / 30)));
    el.textContent = '';
    typeT = setInterval(() => { n = Math.min(text.length, n + step); el.textContent = text.slice(0, n); if (n >= text.length) clearInterval(typeT); }, 30);
  }
  function spin(on) {
    clearInterval(spinT); clearInterval(verbT);
    if (!on || reduceMotion) { glyph.textContent = '✻'; return; }
    let f = 0, v = 0;
    spinT = setInterval(() => { glyph.textContent = SPIN[f = (f + 1) % SPIN.length]; }, 120);
    verbT = setInterval(() => { verb.textContent = `${VERBS[v = (v + 1) % VERBS.length]}…`; }, 2600);
  }
  function show(n) {
    i = (n + CAPS.length) % CAPS.length;
    root.dataset.step = String(i);
    // geK: "at step K or later", so CSS can say what stays once it has happened
    for (let k = 1; k < CAPS.length; k++) root.classList.toggle(`ge${k}`, i >= k);
    steps.forEach((b, k) => { b.classList.toggle('on', k === i); b.classList.toggle('done', k < i); if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    cap.textContent = CAPS[i];
    count.textContent = `Step ${i + 1} of ${CAPS.length}`;
    // Grok's prompt appears as it's written, and stays written
    if (i === 3) type(prompt, FULL, 1800); else if (i > 3) { clearInterval(typeT); prompt.textContent = FULL; } else prompt.textContent = '';
    // after the yes, the same words are typed into Claude Code
    if (i === 9) type(typed, TYPED, 1600); else if (i > 9) typed.textContent = TYPED; else if (i < 9) typed.textContent = '';
    spin(i === 10);
    schedule();
  }
  function schedule() {
    clearTimeout(holdT);
    if (!playing || !visible) return;
    holdT = setTimeout(() => show(i + 1), HOLD[i]);
  }
  function setPlaying(on) {
    playing = on;
    playBtn.setAttribute('aria-pressed', String(on));
    playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
    playBtn.classList.toggle('paused', !on);
    schedule();
  }
  steps.forEach((b, k) => b.addEventListener('click', () => { setPlaying(false); show(k); }));
  $('#mc-prev').addEventListener('click', () => { setPlaying(false); show(i - 1); });
  $('#mc-next').addEventListener('click', () => { setPlaying(false); show(i + 1); });
  playBtn.addEventListener('click', () => setPlaying(!playing));
  new IntersectionObserver(([en]) => {
    visible = en.isIntersecting;
    root.classList.toggle('live', visible);
    if (!visible) { clearTimeout(holdT); spin(false); } else { if (i === 10) spin(true); schedule(); }
  }, { threshold: 0.35 }).observe(root);
  if (reduceMotion) playBtn.classList.add('paused'), playBtn.setAttribute('aria-pressed', 'false'), playBtn.setAttribute('aria-label', 'Play');
  show(0);
}
