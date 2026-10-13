# okay-cool.net

Mike Purpura's portfolio: a network engineer turned AI builder, from Milton, Wisconsin.

**Live at [okay-cool.net](https://okay-cool.net).**

It's a single long scroll in plain HTML, CSS and JavaScript, with no framework and no build step.

## Self-hosted, over Starlink

The site is served by **nginx on a Raspberry Pi 4 in Mike's basement**. Starlink puts the house
behind carrier-grade NAT, so there is no public IPv4 to point a website at, and the router drops
unsolicited inbound IPv6 too. Instead, `cloudflared` on the Pi dials *out* to Cloudflare over IPv6
and holds an encrypted tunnel open. Visitors hit Cloudflare (TLS 1.3, HTTP/3, Brotli), and requests
come down the tunnel to nginx listening on the Pi's loopback. No firewall port was opened for this site.

```
you ── Cloudflare edge ══ tunnel over Starlink IPv6 ══ Pi 4: cloudflared → nginx (127.0.0.1:8088)
                                                         ↑ git pull every 2 min
                                      Mac Studio ── git push ── GitHub
```

- `ops/pi/`: the nginx site (CSP, HSTS, caching), `deploy.sh` (GitOps pull), `status.py`
  (the live vitals on the page), `install.sh`, and the sandboxed `cloudflared.service`
- `ops/cloudflare/tunnel.py`: creates the tunnel, ingress, DNS and edge settings through the API.
  The tunnel token lives only on the Pi.
- Zero third-party requests: fonts are self-hosted and there are no trackers.

## Made locally

Everything that isn't code was generated on a Mac Studio, using the AI studios Mike built into his self-hosted Hub:

| What | Model | How |
|---|---|---|
| Art | Qwen-Image 2.1 (Q8 GGUF) | ComfyUI on Apple Silicon, ~85 s per image; prompts in `tools/art_prompts.json` |
| Theme song and soundtrack | ACE-Step 1.5 XL | ComfyUI, mastered to -14 LUFS; looped with `tools/finish_audio.py` |
| Narrator and Lord Pemberton | Kokoro-82M on MLX | `tools/narrate.py`, script in `tools/tour_script.json` |
| Video | MiniMax H3 | image-to-video from the gummy-fiber art, 10 steps, 31 min of GPU time; looped with `tools/finish_video.py` |

All voices are synthetic presets; no real person's voice is cloned.

## Pieces

- `index.html`: the whole story, chapter by chapter
- `assets/js/hero.js`: the canvas network in the hero (packets are gummy worms of light)
- `assets/js/route.js`: the scroll bar, a packet routed from the visitor to me with one router per section
  (a rail down the left on desktop, a strip under the nav on phones).
  IS-IS (Dijkstra) and BGP best-path selection really run; Cloudflare AS13335 and Starlink AS14593 are
  real, while the ISP, the transit networks (RFC 5398 ASNs) and the metrics are made up. Hover it (or tap the
  strip) for the traceroute.
- `assets/js/site.js`: one scroll loop for the pinned chapters, traceroute sync, the 60-gardens grid,
  and the live trip and server widgets
- `assets/js/audio.js`: the opt-in soundtrack and narrated tour with live captions, all through Web Audio
- `resume/`: a printable one-page web résumé

Deploy with `bash deploy.sh "message"`.

Built with [Claude Code](https://claude.com/claude-code).
