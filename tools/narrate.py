"""Render the audio tour and Lord Pemberton's intro with Kokoro on the Mac Studio.

Run with the Voicebox MLX venv, which already has mlx-audio and the Kokoro weights:

    ~/apps/voicebox/.venv-mlx/bin/python tools/narrate.py

Kokoro (82M, Apache-2.0) speaks with preset voices, not clones, so no real
person's voice is used anywhere on the site. Each clip is loudness-normalised
to -16 LUFS and written as a mono MP3, and assets/audio/tour.json gets the
text (shown as captions) plus the duration of every clip.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
OUT = os.path.join(SITE, "assets", "audio")
FFMPEG = "/usr/local/bin/ffmpeg"

sys.path.insert(0, os.path.expanduser("~/apps/voicebox"))
import server as voicebox  # noqa: E402  (only its render helpers; no server is started)


# "room" adds a small hall around a voice (the wizard gets one); it's ours, not Kokoro's
ROOMS = {"hall": "aecho=0.8:0.55:45|95:0.18|0.09,"}


def render(text, values, dest):
    values = dict(values)
    room = ROOMS.get(values.pop("room", None) or "", "")
    wav, dur = voicebox._generate_kokoro(text, {**voicebox.DEFAULTS, **values})
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
        fh.write(wav)
        raw = fh.name
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", raw,
                    "-af", f"highpass=f=70,{room}loudnorm=I=-16:TP=-1.5:LRA=7",
                    "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "80k", dest],
                   check=True)
    os.unlink(raw)
    return round(dur, 2)


def main():
    script = json.load(open(os.path.join(HERE, "tour_script.json")))
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    manifest_path = os.path.join(OUT, "tour.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {"clips": {}}
    for key, text in script["clips"].items():
        if only and key not in only:
            continue
        name = f"tour-{key}.mp3"
        dur = render(text, script["voice"], os.path.join(OUT, name))
        # mp3s are cached for a week at Cloudflare's edge and in browsers, so the URL carries
        # a content hash: a re-rendered clip is a new URL, and nobody hears the old one
        ver = hashlib.sha1(open(os.path.join(OUT, name), "rb").read()).hexdigest()[:8]
        manifest["clips"][key] = {"src": f"assets/audio/{name}?v={ver}", "text": text, "seconds": dur}
        print(f"{key:<8} {dur:5.1f}s")
    for key, extra in script["extras"].items():
        if only and key not in only:
            continue
        dur = render(extra["text"], extra["voice"], os.path.join(OUT, f"{key}.mp3"))
        print(f"{key:<8} {dur:5.1f}s")
    manifest["voice"] = f"Kokoro-82M ({script['voice']['voice']}) on MLX"
    json.dump(manifest, open(manifest_path, "w"), indent=1)


if __name__ == "__main__":
    main()
