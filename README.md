# okay-cool.net

Mike Purpura's portfolio: a network engineer turned AI builder, from Milton, Wisconsin.

**Live at [okay-cool.net](https://okay-cool.net).**

It's a single long scroll in plain HTML, CSS and JavaScript, with no framework and no build step. Everything that isn't code was generated locally on a Mac Studio, using the AI studios Mike built into his self-hosted Hub:

| What | Model | How |
|---|---|---|
| Art | Qwen-Image 2.1 (Q8 GGUF) | ComfyUI on Apple Silicon, ~85 s per image; prompts in `tools/art_prompts.json` |
| Theme song and soundtrack | ACE-Step 1.5 XL | ComfyUI, mastered to -14 LUFS |
| Narrator and Lord Pemberton | Kokoro-82M on MLX | `tools/narrate.py`, script in `tools/tour_script.json` |
| Video | MiniMax H3 | image-to-video from the gummy-fiber art |

All voices are synthetic presets; no real person's voice is cloned.

## Pieces

- `index.html`: the whole story, chapter by chapter
- `assets/js/hero.js`: the canvas network in the hero (packets are gummy worms of light)
- `assets/js/site.js`: one scroll loop that handles the pinned chapters, traceroute sync, the 60-gardens grid and the progress spine
- `assets/js/audio.js`: an opt-in soundtrack, the narrated tour with live captions, and ducking, all through Web Audio
- `resume/`: a printable web résumé

Deploy with `bash deploy.sh "message"`. GitHub Pages serves `main`.

Built with [Claude Code](https://claude.com/claude-code).
