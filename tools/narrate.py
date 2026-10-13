"""Render the audio tour and Lord Pemberton's intro on the Mac Studio.

The narrator is performed by VoxCPM2 in the hub's Voice Studio from the voice profile
"Okay Cool Narrator (designed)". The voice was designed, not cloned: VoxCPM2 generated it from a
text description (a woman in her mid thirties with a warm, natural, mid-pitched American voice,
expressive and unhurried), and the chosen design take became the profile's reference. No real
person's audio went into it. Lord Pemberton is a Kokoro preset (bm_lewis).

VoxCPM2 isn't deterministic, so every chapter is a casting call:

    PY=~/apps/models-eval/.venv/bin/python             # torch + transformers + mlx-whisper
    $PY tools/narrate.py takes [keys...]                # N takes each: half plain, half with the chapter's direction
    $PY tools/narrate.py pick [keys...]                 # keep the best take, master it, update tour.json
    ~/apps/voicebox/.venv-mlx/bin/python tools/narrate.py pemberton

Casting rules: Whisper has to hear the script back word for word, and WavLM has to hear the same
narrator as the reference, at her usual pitch. Then Praat drops the raspiest takes, the rushed
ones, and any that crack into another register; the most animated of what's left gets the part.
Takes live in tools/takes/, which isn't in git.
"""
import difflib
import hashlib
import json
import math
import os
import re
import ssl
import subprocess
import sys
import tempfile
import urllib.request
import uuid

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
OUT = os.path.join(SITE, "assets", "audio")
TAKES = os.path.join(HERE, "takes")
FFMPEG = "/usr/local/bin/ffmpeg"
STUDIO = "https://127.0.0.1:3900"  # the hub's Voice Studio; LAN-only
TLS = ssl._create_unverified_context()  # its certificate names the hub's LAN host, not 127.0.0.1
WHISPER = "mlx-community/whisper-small-mlx"  # judges takes
WHISPER_WORDS = "mlx-community/whisper-large-v3-mlx"  # times the captions on the finished clip

# Whisper writes numbers as digits and hears "Pi" as "pie"; compare like with like
CANON = [(r"\btwo thousand\b", "2000"), (r"\bthirteen\b", "13"), (r"\bsixty\b", "60"), (r"\bsix\b", "6"),
         (r"\bfive\b", "5"), (r"\bthree\b", "3"), (r"\bpie\b", "pi"), (r"\bok\b", "okay"),
         (r"\bgrow year\b", "growyear"), (r"\bdevops\b", "dev ops"), (r"(\d),(\d)", r"\1\2")]


def words(text):
    text = text.lower().replace("’", "'").replace("-", " ")
    for pattern, repl in CANON:
        text = re.sub(pattern, repl, text)
    return re.findall(r"[a-z0-9']+", text)


def studio(path, fields=None, method="POST"):
    headers, body = {"Origin": STUDIO}, None
    if fields is not None:
        b = uuid.uuid4().hex
        body = b"".join(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
                        for k, v in fields.items()) + f"--{b}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={b}"
    req = urllib.request.Request(STUDIO + path, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req, context=TLS, timeout=900) as r:
        return r.read(), r.headers


# ---- judging a take -------------------------------------------------------------------------

_wavlm = {}


def speaker(path):
    """WavLM x-vector, unit length; the model card puts "same speaker" at about 0.86 cosine."""
    import librosa
    import torch
    from transformers import AutoFeatureExtractor, WavLMForXVector
    if not _wavlm:
        _wavlm["fe"] = AutoFeatureExtractor.from_pretrained("microsoft/wavlm-base-plus-sv")
        _wavlm["model"] = WavLMForXVector.from_pretrained("microsoft/wavlm-base-plus-sv").eval()
    y, _ = librosa.load(path, sr=16000, mono=True)
    with torch.no_grad():
        e = _wavlm["model"](**_wavlm["fe"](y, sampling_rate=16000, return_tensors="pt")).embeddings[0]
    return torch.nn.functional.normalize(e, dim=-1).numpy()


def judge(path, text, ref):
    import mlx_whisper
    import parselmouth
    heard = mlx_whisper.transcribe(path, path_or_hf_repo=WHISPER, language="en")["text"].strip()
    said, got = words(text), words(heard)
    sm = difflib.SequenceMatcher(a=said, b=got, autojunk=False)
    hits = sum(block.size for block in sm.get_matching_blocks())
    # Praat, not pyin: pyin slips octaves on a gravelly or breathy voice and calls it acting
    snd = parselmouth.Sound(path)
    f0 = snd.to_pitch_ac(time_step=0.01, pitch_floor=60, pitch_ceiling=400).selected_array["frequency"]
    f0 = f0[f0 > 0]
    semis = 12 * np.log2(f0 / np.median(f0))
    hnr = snd.to_harmonicity_cc(time_step=0.01, minimum_pitch=60).values
    return {
        "heard": heard,
        "match": round(hits / len(said), 3),  # share of the script's words that came back, in order
        "extra": len(got) - hits,             # words Whisper heard that aren't in the script
        "sim": round(float(ref @ speaker(path)), 3),
        "f0": round(float(np.median(f0)), 1),
        "range": round(float(np.percentile(semis, 90) - np.percentile(semis, 10)), 1),  # semitones
        "hnr": round(float(hnr[hnr != -200].mean()), 1),  # harmonics-to-noise, dB: lower is raspier
        "wpm": round(len(got) / sf.info(path).duration * 60),
    }


def cast(takes, voice):
    """Right words and the same narrator first; then the clearest, unhurried, most animated take."""
    pool = [t for t in takes if t["match"] == 1 and t["extra"] == 0 and t["sim"] >= 0.93
            and abs(12 * math.log2(t["f0"] / voice["f0"])) <= 2.5]
    # her livelier takes run a little breathier (lower HNR) without any rasp, so the clarity
    # floor is loose; it only drops a take that's audibly rough next to her usual sound
    for keep in (lambda t: t["hnr"] >= voice["hnr"] - 1.5,  # not the roughest
                 lambda t: t["wpm"] <= 195,                   # not rushed
                 lambda t: t["range"] <= 18):                 # wider is a voice crack, not acting
        pool = [t for t in pool if keep(t)] or pool
    return max(pool, key=lambda t: t["range"]) if pool else None


# ---- finishing --------------------------------------------------------------------------------

def stretch_pauses(y, sr, extra=0.5, cap=0.3, lead=0.12, tail=0.45):
    """Give every pause half again its length (up to 0.3 s more): the drama is in the gaps."""
    hop = sr // 100
    n = len(y) // hop
    db = 20 * np.log10(np.sqrt(np.mean(y[:n * hop].reshape(n, hop) ** 2, axis=1)) + 1e-9)
    loud = np.flatnonzero(db > db.max() - 40)
    first, last = loud[0], loud[-1] + 1
    pieces, cursor, run = [np.zeros(int(lead * sr), np.float32)], first * hop, 0
    for i in range(first, last + 1):
        if i < last and db[i] <= db.max() - 40:
            run += 1
            continue
        if run >= 12:  # 120 ms or longer is a pause, not a consonant
            mid = (i - run // 2) * hop
            pieces += [y[cursor:mid], np.zeros(int(min(extra * run / 100, cap) * sr), np.float32)]
            cursor = mid
        run = 0
    pieces += [y[cursor:last * hop], np.zeros(int(tail * sr), np.float32)]
    return np.concatenate(pieces)


def master(take, dest):
    y, sr = sf.read(take, dtype="float32")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
        tmp = fh.name
    sf.write(tmp, stretch_pauses(y, sr), sr)
    # two-pass, linear loudness: the whole clip moves to -16 LUFS without squashing the theatrics
    probe = subprocess.run([FFMPEG, "-hide_banner", "-i", tmp, "-af",
                            "highpass=f=60,loudnorm=I=-16:TP=-1.5:LRA=20:print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True, check=True).stderr
    m = json.JSONDecoder().raw_decode(probe[probe.rindex("{"):])[0]  # ffmpeg keeps talking after it
    loudnorm = (f"loudnorm=I=-16:TP=-1.5:LRA=20:measured_I={m['input_i']}:measured_TP={m['input_tp']}"
                f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}"
                f":offset={m['target_offset']}:linear=true")
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", tmp, "-af", f"highpass=f=60,{loudnorm}",
                    "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "96k", dest], check=True)
    os.unlink(tmp)


def word_times(path, text):
    """When each word of the caption starts, so the sweep keeps pace with the pauses."""
    import mlx_whisper
    result = mlx_whisper.transcribe(path, path_or_hf_repo=WHISPER_WORDS, language="en", word_timestamps=True)
    heard = [(w["word"], w["start"]) for seg in result["segments"] for w in seg["words"]]
    key = lambda w: re.sub(r"[^a-z0-9]", "", w.lower())
    script = text.split()
    times = [None] * len(script)
    sm = difflib.SequenceMatcher(a=[key(w) for w in script], b=[key(w) for w, _ in heard], autojunk=False)
    for a, b, size in sm.get_matching_blocks():
        for k in range(size):
            times[a + k] = heard[b + k][1]
    known = [i for i, t in enumerate(times) if t is not None]
    for i, t in enumerate(times):  # words Whisper wrote differently ("13") fall between their neighbours
        if t is None:
            before = max((k for k in known if k < i), default=None)
            after = min((k for k in known if k > i), default=None)
            if before is None:
                times[i] = 0.0
            elif after is None:
                times[i] = times[before] + 0.3 * (i - before)
            else:
                times[i] = times[before] + (times[after] - times[before]) * (i - before) / (after - before)
    for i in range(1, len(times)):
        times[i] = max(times[i], times[i - 1])
    return [round(t, 2) for t in times]


# ---- commands --------------------------------------------------------------------------------

def take_path(key, kind, seed):
    return os.path.join(TAKES, f"{key}_{kind}_s{seed}.wav")


def cmd_takes(script, only):
    voice = script["voice"]
    os.makedirs(TAKES, exist_ok=True)
    ref_wav = os.path.join(TAKES, "reference.wav")
    if not os.path.exists(ref_wav):
        open(ref_wav, "wb").write(studio(f"/profiles/{voice['studio_profile']}/audio", method="GET")[0])
    ref = speaker(ref_wav)
    seeds = range(1, voice["takes"] // 2 + 1)
    for key, clip in script["clips"].items():
        if only and key not in only:
            continue
        for kind, direction in (("plain", ""), ("directed", clip["mood"])):
            for seed in seeds:
                dest = take_path(key, kind, seed)
                fields = {"text": clip["text"], "profile_id": voice["studio_profile"], "engine": "voxcpm2",
                          "effect_preset": "raw", "language": "English", "seed": str(seed)}
                if direction:
                    fields["instruct"] = direction
                wav, headers = studio("/generate", fields)
                open(dest, "wb").write(wav)
                studio(f"/history/{headers['X-Audio-Id']}", method="DELETE")  # the Studio's history is Mike's
                row = {"key": key, "file": os.path.basename(dest), "direction": direction, "seed": seed,
                       **judge(dest, clip["text"], ref)}
                with open(os.path.join(TAKES, "scores.jsonl"), "a") as fh:
                    fh.write(json.dumps(row) + "\n")
                print(f"{key:<8} {kind:<8} s{seed}  match {row['match']:.2f}  same {row['sim']:.2f}  "
                      f"{row['f0']:5.1f} Hz  range {row['range']:4.1f}  hnr {row['hnr']:4.1f}  {row['wpm']} wpm", flush=True)


def cmd_pick(script, only):
    rows = [json.loads(line) for line in open(os.path.join(TAKES, "scores.jsonl"))]
    # the narrator's own voice, across every take: her speaking pitch and how clear she usually is
    voice = {k: float(np.median([r[k] for r in rows])) for k in ("f0", "hnr")}
    manifest_path = os.path.join(OUT, "tour.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {"clips": {}}
    for key, clip in script["clips"].items():
        if only and key not in only:
            continue
        mine = [r for r in rows if r["key"] == key and os.path.exists(os.path.join(TAKES, r["file"]))]
        best = cast(mine, voice)
        if not best:
            sys.exit(f"{key}: no take passed (best match {max(r['match'] for r in mine):.2f}); run more takes")
        name = f"tour-{key}.mp3"
        dest = os.path.join(OUT, name)
        master(os.path.join(TAKES, best["file"]), dest)
        # mp3s are cached for a week at Cloudflare's edge and in browsers, so the URL carries
        # a content hash: a re-rendered clip is a new URL, and nobody hears the old one
        ver = hashlib.sha1(open(dest, "rb").read()).hexdigest()[:8]
        seconds = round(sf.info(dest).duration, 2)
        manifest["clips"][key] = {"src": f"assets/audio/{name}?v={ver}", "text": clip["text"],
                                  "seconds": seconds, "t": word_times(dest, clip["text"])}
        print(f"{key:<8} {best['file']:<24} of {len(mine)}  {best['f0']:5.1f} Hz  range {best['range']:4.1f}  {seconds:5.1f}s", flush=True)
    manifest["voice"] = f"VoxCPM2 in Voice Studio, {script['voice']['name']}"
    json.dump(manifest, open(manifest_path, "w"), indent=1)


def cmd_pemberton(script):
    sys.path.insert(0, os.path.expanduser("~/apps/voicebox"))
    import server as voicebox  # only its render helpers; no server is started
    extra = script["extras"]["pemberton"]
    wav, dur = voicebox._generate_kokoro(extra["text"], {**voicebox.DEFAULTS, **extra["voice"]})
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
        fh.write(wav)
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", fh.name,
                    "-af", "highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=7",
                    "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "80k",
                    os.path.join(OUT, "pemberton.mp3")], check=True)
    os.unlink(fh.name)
    print(f"pemberton {dur:5.1f}s")


def main():
    script = json.load(open(os.path.join(HERE, "tour_script.json")))
    command, only = (sys.argv[1:2] or ["help"])[0], set(sys.argv[2:])
    if command == "takes":
        cmd_takes(script, only)
    elif command == "pick":
        cmd_pick(script, only)
    elif command == "pemberton":
        cmd_pemberton(script)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
