"""Layer a soft synth pad and a gentle drum build under the "Fiber Light" soundtrack.

    ~/apps/models-eval/.venv/bin/python tools/layer_ambient.py

The original (ACE-Step 1.5, looped) is left exactly as it was: the new parts are mixed under it.
It reads tools/backups/ambient-original-2026-10-12.mp3 and writes assets/audio/ambient.mp3.

- The beat grid comes from the track itself (librosa's beat tracker, then a straight-line fit so
  the grid doesn't wobble), and the bar's chord from its chroma, matched against the D major
  triads the song was generated in.
- Pad: two detuned saws per chord tone, low-passed and slow to swell, following the chords.
- Drums: a soft kick, a rim click and closed hats, all synthesized. They build in gently over
  the first half of the loop, hold, and fall away before the end.
- Both layers are silent at the loop point, so the original's seamless loop is still the seam.
- The mix is matched to the original's integrated loudness (measured, then a fixed gain and a
  gentle peak limiter for the kick's transients), so the volume doesn't change.
"""
import json
import os
import subprocess
import tempfile

import librosa
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "backups", "ambient-original-2026-10-12.mp3")
DEST = os.path.join(os.path.dirname(HERE), "assets", "audio", "ambient.mp3")
FFMPEG = "/usr/local/bin/ffmpeg"
SR = 48000
rng = np.random.default_rng(84)

PAD_DB = -21.0     # pad level against the original's RMS
DRUM_DB = -19.0    # drums at their fullest, same reference
EDGE = 4.0         # seconds of silence-in and silence-out for the layers at the loop point


def db(x):
    return 10 ** (x / 20)


def lowpass(x, hz, order=2):
    return sosfilt(butter(order, hz, btype="low", fs=SR, output="sos"), x)


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)


def beat_grid(mono):
    y = librosa.resample(mono, orig_sr=SR, target_sr=22050)
    _, frames = librosa.beat.beat_track(y=y, sr=22050, start_bpm=84, tightness=200)
    t = librosa.frames_to_time(frames, sr=22050)
    k = np.arange(len(t))
    period, t0 = np.polyfit(k, t, 1)              # a straight grid through the tracker's beats
    first = t0 - np.ceil(t0 / period) * period
    grid = np.arange(first, len(mono) / SR, period)
    # which beat of four is the downbeat: the one with the most low-end attack
    low = lowpass(mono, 150)
    hop = 256
    env = np.sqrt(np.convolve(low ** 2, np.ones(hop) / hop, mode="same"))[::hop]
    on = np.maximum(0, np.diff(env, prepend=env[0]))
    score = [sum(on[int(b * SR / hop)] for b in grid[p::4] if int(b * SR / hop) < len(on)) for p in range(4)]
    phase = int(np.argmax(score))
    return grid, period, phase


TRIADS = {"D": [2, 6, 9], "Em": [4, 7, 11], "F#m": [6, 9, 1], "G": [7, 11, 2], "A": [9, 1, 4], "Bm": [11, 2, 6]}


def bar_chords(mono, bars):
    y = librosa.resample(mono, orig_sr=SR, target_sr=22050)
    chroma = librosa.feature.chroma_cqt(y=y, sr=22050, hop_length=512)
    times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=22050, hop_length=512)
    out = []
    for a, b in bars:
        m = (times >= a) & (times < b)
        c = chroma[:, m].mean(axis=1) if m.any() else np.ones(12)
        best = max(TRIADS, key=lambda n: sum(c[i] for i in TRIADS[n]) + 0.35 * c[TRIADS[n][0]])
        out.append(best)
    return out


def pad(bars, chords, n):
    """Two detuned saws per chord tone, voiced D3-A4, crossfaded bar to bar."""
    out = np.zeros((n, 2))
    t_all = np.arange(n) / SR
    for (a, b), name in zip(bars, chords):
        s, e = int(max(0, a - 0.25) * SR), int(min(n / SR, b + 0.6) * SR)
        if e <= s:
            continue
        t = t_all[s:e]
        seg = np.zeros((e - s, 2))
        for pc in TRIADS[name]:
            midi = 50 + ((pc - 2) % 12)                  # D3 upward
            for octave, gain in ((0, 0.55), (12, 0.30)):
                f = librosa.midi_to_hz(midi + octave)
                for ch, cents in ((0, -6), (1, 7)):
                    ff = f * 2 ** (cents / 1200)
                    ph = rng.uniform(0, 1)
                    saw = 2 * ((ff * t + ph) % 1.0) - 1
                    seg[:, ch] += gain * saw
        # slow swell in, gentle release into the next bar
        L = e - s
        att, rel = int(0.35 * SR), int(0.6 * SR)
        env = np.ones(L)
        env[:att] = np.sin(np.linspace(0, np.pi / 2, att)) ** 2
        env[-rel:] *= np.cos(np.linspace(0, np.pi / 2, rel)) ** 2
        seg *= env[:, None]
        out[s:e] += seg
    for ch in range(2):
        out[:, ch] = lowpass(lowpass(out[:, ch], 1400), 2600, order=1)
    # a slow, breathing movement so it never sits dead still
    out *= (0.85 + 0.15 * np.sin(2 * np.pi * t_all / 9.0))[:, None]
    return out


def kick(n):
    t = np.arange(int(0.42 * SR)) / SR
    f = 46 + 40 * np.exp(-t / 0.035)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)
    click = lowpass(rng.normal(0, 1, len(t)), 3000) * np.exp(-t / 0.004) * 0.08
    return body + click


def hat(open_=False):
    t = np.arange(int((0.16 if open_ else 0.05) * SR)) / SR
    x = bandpass(rng.normal(0, 1, len(t)), 5500, 10000)
    return x * np.exp(-t / (0.05 if open_ else 0.012))


def rim():
    t = np.arange(int(0.09 * SR)) / SR
    tone = np.sin(2 * np.pi * 1650 * t) * np.exp(-t / 0.012)
    noise = bandpass(rng.normal(0, 1, len(t)), 1800, 5000) * np.exp(-t / 0.02)
    return 0.6 * tone + 0.5 * noise


def place(buf, sample, at, gain, pan=0.0):
    s = int(at * SR)
    if s < 0 or s >= len(buf):
        return
    e = min(len(buf), s + len(sample))
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[s:e, 0] += sample[: e - s] * gain * l
    buf[s:e, 1] += sample[: e - s] * gain * r


def build(x):
    """0 to 1 over the loop: silent, a slow climb, a held peak, then away before the loop point."""
    return np.interp(x, [0.0, 0.12, 0.30, 0.48, 0.62, 0.84, 0.95, 1.0], [0, 0, 0.35, 0.75, 1, 1, 0, 0])


def drums(grid, period, phase, n):
    out = np.zeros((n, 2))
    K, R, H, HO = kick(n), rim(), hat(), hat(open_=True)
    total = n / SR
    for i, b in enumerate(grid):
        x = b / total
        lvl = build(x)
        if lvl <= 0.001:
            continue
        pos = (i - phase) % 4
        # hats on the eighths, first in, a touch of swing on the off-beat
        hat_gain = 0.28 * min(1, lvl * 1.6)
        place(out, H, b, hat_gain * (1.0 if pos % 2 == 0 else 0.8), pan=0.25)
        place(out, H, b + period * 0.54, hat_gain * 0.62, pan=0.25)
        if pos == 3 and lvl > 0.7:
            place(out, HO, b + period * 0.54, hat_gain * 0.5, pan=0.3)
        # kick enters second, on 1 (then 1 and 3)
        if lvl > 0.3 and (pos == 0 or (pos == 2 and lvl > 0.7)):
            place(out, K, b, 0.9 * lvl)
        # rim on 2 and 4 only at the top of the build
        if lvl > 0.7 and pos in (1, 3):
            place(out, R, b, 0.22 * lvl, pan=-0.15)
    return out


def loudness(path):
    p = subprocess.run([FFMPEG, "-hide_banner", "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True, check=True).stderr
    return json.JSONDecoder().raw_decode(p[p.rindex("{"):])[0]


def main():
    orig, sr = librosa.load(SRC, sr=SR, mono=False)
    orig = orig.T.astype(np.float64)                       # (n, 2)
    n = len(orig)
    mono = orig.mean(axis=1)
    grid, period, phase = beat_grid(mono)
    bar_starts = grid[phase::4]
    bars = [(a, a + 4 * period) for a in bar_starts]
    chords = bar_chords(mono, bars)

    ref = np.sqrt(np.mean(mono ** 2))
    p = pad(bars, chords, n)
    p *= db(PAD_DB) * ref / (np.sqrt(np.mean(p ** 2)) + 1e-12)
    d = drums(grid, period, phase, n)
    peak = np.sqrt(np.mean(d[int(0.62 * n): int(0.84 * n)] ** 2))   # the held top of the build
    d *= db(DRUM_DB) * ref / (peak + 1e-12)
    # the pad follows the same arc, softer, so the new parts arrive together
    arc = 0.45 + 0.55 * build(np.arange(n) / n)
    p *= arc[:, None]

    # both layers silent at the loop point: the original carries the seam on its own
    edge = int(EDGE * SR)
    ramp = np.sin(np.linspace(0, np.pi / 2, edge)) ** 2
    for layer in (p, d):
        layer[:edge] *= ramp[:, None]
        layer[-edge:] *= ramp[::-1, None]

    mix = orig + p + d
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "mix.wav")
        sf.write(raw, mix.astype(np.float32), SR, subtype="FLOAT")
        target = loudness(SRC)
        gain = float(target["input_i"]) - float(loudness(raw)["input_i"])
        for _ in range(3):  # a fixed gain, then a soft limiter for the kick; nudge until the loudness matches
            af = f"volume={gain:.2f}dB,alimiter=limit=0.71:attack=2:release=80:level=false"
            subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", raw, "-af", af, "-ar", "48000", "-c:a", "libmp3lame",
                            "-b:a", "128k", "-metadata", "title=Fiber Light",
                            "-metadata", "artist=ACE-Step 1.5 on Mike Purpura's Mac Studio, with a pad and drums layered in Python",
                            DEST], check=True)
            out = loudness(DEST)
            miss = float(target["input_i"]) - float(out["input_i"])
            if abs(miss) < 0.15:
                break
            gain += miss
    print(f"tempo {60 / period:.2f} bpm, downbeat phase {phase}, {len(bars)} bars")
    print("chords:", " ".join(chords))
    print(f"original {target['input_i']} LUFS, tp {target['input_tp']}  ->  new {out['input_i']} LUFS, tp {out['input_tp']}")


if __name__ == "__main__":
    main()
