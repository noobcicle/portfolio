// Sound for okay-cool.net. Nothing plays until the visitor asks.
//  - soundtrack: an ACE-Step ambient bed, looped gaplessly from an AudioBuffer
//  - tour: the wizard's narration per chapter, captions with a word-by-word sweep
//  - players: the theme song (with Lord Pemberton's intro)
// Everything routes through Web Audio gain nodes, because iOS ignores
// HTMLMediaElement.volume and we need fades and ducking.

const AMBIENT_SRC = 'assets/audio/ambient.mp3';
const TOUR_SRC = 'assets/audio/tour.json';
const AMBIENT_LEVEL = 0.34;
const DUCKED_LEVEL = 0.07;

export function initAudio({ toast, onTourChange } = {}) {
  let ac = null, master, ambGain, voiceGain;
  let ambBuffer = null, ambSource = null, ambLoading = null;
  let soundOn = false, tourOn = false;
  let tour = null, tourLoading = null;
  let voiceEl = null, current = null, played = new Set();
  let activePlayer = null, captionTimer = 0, pendingTimer = 0;

  const soundBtn = document.getElementById('sound-btn');
  const soundLabel = soundBtn?.querySelector('.sound-label');
  const caps = document.getElementById('captions');
  const capsText = document.getElementById('captions-text');

  function ctx() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 1; master.connect(ac.destination);
    ambGain = ac.createGain(); ambGain.gain.value = 0; ambGain.connect(master);
    voiceGain = ac.createGain(); voiceGain.gain.value = 1; voiceGain.connect(master);
    return ac;
  }

  function ramp(param, to, secs = 0.8) {
    const t = ac.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(to, t + secs);
  }

  // ------------------------------------------------------------ soundtrack
  async function loadAmbient() {
    if (ambBuffer) return ambBuffer;
    if (!ambLoading) {
      ambLoading = fetch(AMBIENT_SRC).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(buf => new Promise((res, rej) => ctx().decodeAudioData(buf, res, rej)))
        .then(b => (ambBuffer = b));
    }
    return ambLoading;
  }

  async function startAmbient() {
    ctx(); await ac.resume();
    try { await loadAmbient(); } catch { toast?.('The soundtrack did not load.'); setSound(false); return; }
    if (!soundOn || ambSource) return;
    ambSource = ac.createBufferSource();
    ambSource.buffer = ambBuffer;
    ambSource.loop = true;
    ambSource.connect(ambGain);
    ambSource.start();
    ramp(ambGain.gain, levelNow(), 2.5);
  }

  function stopAmbient() {
    if (!ambSource || !ac) return;
    const s = ambSource; ambSource = null;
    ramp(ambGain.gain, 0, 0.9);
    setTimeout(() => { try { s.stop(); } catch {} }, 1000);
  }

  function levelNow() { return (voiceBusy() || activePlayer) ? DUCKED_LEVEL : AMBIENT_LEVEL; }
  function voiceBusy() { return voiceEl && !voiceEl.paused && !voiceEl.ended; }
  function reduck() { if (ac && ambSource) ramp(ambGain.gain, activePlayer ? 0 : levelNow(), 0.6); }

  function setSound(on) {
    soundOn = on;
    soundBtn?.setAttribute('aria-pressed', String(on));
    if (soundLabel) soundLabel.textContent = on ? 'Sound on' : 'Sound off';
    document.querySelectorAll('[data-sound-toggle]').forEach(b => (b.textContent = on ? 'Stop the soundtrack' : 'Play the soundtrack'));
    on ? startAmbient() : stopAmbient();
  }

  // ------------------------------------------------------------ tour
  async function loadTour() {
    if (tour) return tour;
    if (!tourLoading) tourLoading = fetch(TOUR_SRC).then(r => r.json()).then(j => (tour = j));
    return tourLoading;
  }

  function sectionInView() {
    const line = innerHeight * 0.42;
    let best = null;
    for (const el of document.querySelectorAll('[data-guide]')) {
      const r = el.getBoundingClientRect();
      if (r.top <= line && r.bottom > line) best = el;
    }
    return best;
  }

  function voice() {
    if (voiceEl) return voiceEl;
    voiceEl = new Audio();
    voiceEl.preload = 'auto';
    voiceEl.crossOrigin = 'anonymous';
    ctx().createMediaElementSource(voiceEl).connect(voiceGain);
    voiceEl.addEventListener('play', reduck);
    voiceEl.addEventListener('ended', () => { reduck(); captionsDone(); });
    voiceEl.addEventListener('pause', reduck);
    return voiceEl;
  }

  async function playClip(key, force = false) {
    if (!tourOn || activePlayer) return;
    const t = await loadTour();
    const clip = t.clips[key];
    if (!clip) return;
    if (!force && (played.has(key) || current === key)) return;
    current = key; played.add(key);
    const v = voice();
    v.src = clip.src;
    try { await ac.resume(); await v.play(); } catch { return; }
    showCaptions(clip.text, clip.t);
  }

  // times: when each word starts (Whisper, from narrate.py), so the sweep waits out the
  // wizard's pauses; without them it falls back to sweeping by character count
  function showCaptions(text, times) {
    caps.hidden = false;
    const words = text.split(/\s+/);
    capsText.innerHTML = words.map(w => `<span class="unsaid">${escapeHtml(w)}</span>`).join(' ');
    const spans = [...capsText.children];
    const timed = Array.isArray(times) && times.length === words.length;
    const total = text.length;
    const offsets = []; let acc = 0;
    words.forEach(w => { offsets.push(acc / total); acc += w.length + 1; });
    let said = 0;
    cancelAnimationFrame(captionTimer);
    const tick = () => {
      if (!voiceEl || voiceEl.paused) return;
      const now = voiceEl.currentTime;
      const p = voiceEl.duration ? now / voiceEl.duration : 0;
      let n = said;
      while (n < spans.length && (timed ? times[n] <= now : offsets[n] <= p)) n++;
      for (; said < n; said++) spans[said].className = 'said';
      captionTimer = requestAnimationFrame(tick);
    };
    captionTimer = requestAnimationFrame(tick);
  }
  function captionsDone() {
    cancelAnimationFrame(captionTimer);
    [...capsText.children].forEach(s => (s.className = 'said'));
    current = null;
    // the visitor may have moved on while the last clip played
    schedule(400);
  }

  function schedule(delay = 650) {
    clearTimeout(pendingTimer);
    if (!tourOn) return;
    pendingTimer = setTimeout(() => {
      if (voiceBusy() || activePlayer) return;
      const el = sectionInView();
      if (el) playClip(el.dataset.guide);
    }, delay);
  }

  async function setTour(on, { fromStart = false } = {}) {
    tourOn = on;
    onTourChange?.(on);
    document.querySelectorAll('[data-tour-toggle]').forEach(b => (b.textContent = on ? 'Stop the tour' : 'Start the tour'));
    const tb = document.getElementById('tour-btn');
    if (tb) {
      tb.setAttribute('aria-pressed', String(on));
      const label = tb.querySelector('.tour-label');
      if (label) label.textContent = on ? 'Stop tour' : 'Audio tour';
    }
    if (!on) {
      clearTimeout(pendingTimer);
      if (voiceEl) voiceEl.pause();
      caps.hidden = true; current = null;
      reduck();
      return;
    }
    ctx(); await ac.resume();
    played = new Set();
    try { await loadTour(); } catch { toast?.('The audio tour did not load.'); setTour(false); return; }
    if (!soundOn) setSound(true);
    if (fromStart) { await playClip('intro', true); } else schedule(0);
  }

  // ------------------------------------------------------------ players (theme song)
  function initPlayer(el) {
    const btn = el.querySelector('.player-btn');
    const bar = el.querySelector('.player-bar i');
    const now = el.querySelector('.player-now');
    const time = el.querySelector('.player-time');
    const queue = [
      el.dataset.intro && { src: el.dataset.intro, label: 'Lord Pemberton, on the mic' },
      { src: el.dataset.src, label: '“Okay, Cool” · ACE-Step 1.5' },
    ].filter(Boolean);
    let idx = 0, a = null;

    function load(i) {
      idx = i;
      now.textContent = queue[i].label;
      if (!a && !ac) return; // the audio graph is built on the first click, inside the gesture
      if (!a) {
        a = new Audio(); a.preload = 'none'; a.crossOrigin = 'anonymous';
        ctx().createMediaElementSource(a).connect(master);
        a.addEventListener('timeupdate', () => {
          if (!a.duration) return;
          bar.style.width = (a.currentTime / a.duration) * 100 + '%';
          time.textContent = fmt(a.currentTime);
        });
        a.addEventListener('ended', () => {
          if (idx + 1 < queue.length) { load(idx + 1); a.play(); }
          else { done(); load(0); }
        });
      }
      a.src = queue[i].src;
    }
    function done() {
      el.classList.remove('playing');
      if (activePlayer === el) activePlayer = null;
      reduck(); schedule(800);
    }
    load(0);
    btn.addEventListener('click', async () => {
      ctx();
      if (!a) load(idx);
      await ac.resume();
      if (a.paused) {
        if (activePlayer && activePlayer !== el) activePlayer.querySelector('.player-btn').click();
        activePlayer = el;
        if (voiceEl) voiceEl.pause();
        caps.hidden = true;
        reduck();
        try { await a.play(); el.classList.add('playing'); } catch { done(); }
      } else {
        a.pause(); done();
      }
    });
    el.querySelector('.player-bar').addEventListener('click', (ev) => {
      if (!a || !a.duration) return;
      const r = ev.currentTarget.getBoundingClientRect();
      a.currentTime = ((ev.clientX - r.left) / r.width) * a.duration;
    });
  }

  // ------------------------------------------------------------ wiring
  soundBtn?.addEventListener('click', () => setSound(!soundOn));
  document.querySelectorAll('[data-sound-toggle]').forEach(b => b.addEventListener('click', () => setSound(!soundOn)));
  document.querySelectorAll('[data-tour-toggle]').forEach(b => b.addEventListener('click', () => setTour(!tourOn, { fromStart: false })));
  document.getElementById('tour-btn')?.addEventListener('click', () => setTour(!tourOn, { fromStart: true }));
  document.getElementById('tour-stop')?.addEventListener('click', () => setTour(false));
  document.querySelectorAll('[data-player]').forEach(initPlayer);
  addEventListener('scroll', () => { if (tourOn && !voiceBusy()) schedule(); }, { passive: true });

  return { setSound, setTour };
}

function fmt(s) { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
