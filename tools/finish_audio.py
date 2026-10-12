"""Finish the Hub's ACE-Step renders for the web.

    ~/apps/voicebox/.venv-mlx/bin/python tools/finish_audio.py theme <hub-music-job-id>
    ~/apps/voicebox/.venv-mlx/bin/python tools/finish_audio.py ambient <hub-music-job-id>

theme:   the mastered FLAC (-14 LUFS from the Hub) -> 160 kbps MP3.
ambient: crossfade the last 4 s into the first 4 s so the bed loops with no seam,
         then -> 128 kbps MP3. A Web Audio buffer source loops it in the browser.
"""
import io
import os
import ssl
import subprocess
import sys
import urllib.request

import numpy as np
import soundfile as sf

FFMPEG = "/usr/local/bin/ffmpeg"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "audio")


def fetch(job):
    ctx = ssl._create_unverified_context()  # the Hub's LAN cert is self-signed
    data = urllib.request.urlopen(f"https://127.0.0.1/api/music/file/{job}", context=ctx, timeout=120).read()
    audio, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    return audio, sr


def encode(audio, sr, dest, kbps, title):
    raw = dest + ".wav"
    sf.write(raw, audio, sr, subtype="PCM_24")
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", raw, "-c:a", "libmp3lame", "-b:a", f"{kbps}k",
                    "-metadata", f"title={title}", "-metadata", "artist=ACE-Step 1.5 on Mike Purpura's Mac Studio",
                    dest], check=True)
    os.unlink(raw)
    print(f"{os.path.basename(dest)}: {len(audio) / sr:.1f}s, {os.path.getsize(dest) // 1024} KB")


def seamless(audio, sr, xfade=4.0):
    n = int(xfade * sr)
    body = audio[: len(audio) - n].copy()
    ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)[:, None]
    # equal-power crossfade: the tail fades out over the head fading in
    body[:n] = audio[:n] * np.sin(ramp * np.pi / 2) + audio[-n:] * np.cos(ramp * np.pi / 2)
    return body


def main():
    kind, job = sys.argv[1], sys.argv[2]
    audio, sr = fetch(job)
    if kind == "theme":
        encode(audio, sr, os.path.join(OUT, "theme.mp3"), 160, "Okay, Cool")
    elif kind == "ambient":
        encode(seamless(audio, sr), sr, os.path.join(OUT, "ambient.mp3"), 128, "Fiber Light")
    else:
        sys.exit("kind must be theme or ambient")


if __name__ == "__main__":
    main()
