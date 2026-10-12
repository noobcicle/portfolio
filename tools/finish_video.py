"""Turn the Hub's MiniMax H3 render into a small, seamlessly looping web video.

    python3 tools/finish_video.py <hub-video-job-id>

H3 renders 5.2 s at 1344x768 with its own soundtrack. The page plays it muted, so
the audio is dropped. The last half-second is crossfaded into the first so the
loop has no jump, and the result is H.264 with faststart so it streams.
"""
import os
import ssl
import subprocess
import sys
import tempfile
import urllib.request

FFMPEG = "/usr/local/bin/ffmpeg"
FFPROBE = "/usr/local/bin/ffprobe"
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(SITE, "assets", "video", "gummy_fiber.mp4")
XFADE = 0.5


def main():
    job = sys.argv[1]
    ctx = ssl._create_unverified_context()  # the Hub's LAN cert is self-signed
    raw = urllib.request.urlopen(f"https://127.0.0.1/api/video/file/{job}", context=ctx, timeout=300).read()
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "src.mp4")
        open(src, "wb").write(raw)
        dur = float(subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                                   capture_output=True, text=True, check=True).stdout.strip())
        body = dur - XFADE
        # [tail] = last XFADE seconds, [head] = first XFADE seconds; blend tail into head,
        # then play the rest of the body, so frame N-1 flows into frame 0.
        graph = (
            f"[0:v]split=3[a][b][c];"
            f"[a]trim=start={body},setpts=PTS-STARTPTS[tail];"
            f"[b]trim=end={XFADE},setpts=PTS-STARTPTS[head];"
            f"[c]trim=start={XFADE}:end={body},setpts=PTS-STARTPTS[mid];"
            f"[tail][head]xfade=transition=fade:duration={XFADE}:offset=0[seam];"
            f"[seam][mid]concat=n=2:v=1:a=0,scale=1280:-2:flags=lanczos,format=yuv420p[out]"
        )
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", src, "-filter_complex", graph, "-map", "[out]",
                        "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-profile:v", "high",
                        "-movflags", "+faststart", DEST], check=True)
    print(f"{os.path.basename(DEST)}: {os.path.getsize(DEST) // 1024} KB (source {dur:.2f}s)")


if __name__ == "__main__":
    main()
