# okay-cool.net

Mike Purpura's portfolio: network engineer, then network DevOps, now an AI-first engineer, from Milton, Wisconsin.

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
| Theme song and soundtrack | ACE-Step 1.5 XL (SFT) | ComfyUI, mastered to -14 LUFS; looped with `tools/finish_audio.py`. The soundtrack's soft pad and gentle drum build are synthesized under it by `tools/layer_ambient.py` (original kept in `tools/backups/`) |
| Narrator | VoxCPM2 in the hub's Voice Studio; voice designed with VoxCPM2 from a text description | `tools/narrate.py takes`, then `pick`: six takes a chapter, best one kept; script and stage directions in `tools/tour_script.json` |
| Lord Pemberton | Kokoro-82M on MLX | `tools/narrate.py pemberton` |
| Video | MiniMax H3 | image-to-video from the gummy-fiber art, 10 steps, 31 min of GPU time; looped with `tools/finish_video.py` |

No real person's voice is cloned: the narrator was designed from a text description, and Pemberton is a Kokoro preset.
Every one of these says so on the page, where you meet it: a credit chip on each picture and on the video, a
tag when the soundtrack starts, a line in the tour's captions, and a credit on the song's player, each naming
the model and the settings that made it.

## Pieces

- `index.html`: the whole story, chapter by chapter
- `assets/js/hero.js`: the canvas network in the hero (packets are gummy worms of light)
- `assets/js/route.js`: the scroll bar, a packet routed from the visitor to me with one router per section.
  On wide screens it's a slim rail with a "traceroute · expand" tab; expanding it opens the full sidebar that
  tells the home-hosting story hop by hop (emoji per hop, simulated hops marked). The sidebar is opt-in: its
  rules live in `assets/css/sidebar.css`, linked with `media="not all"`, and the tab switches that media and
  remembers the choice. On phones it's a strip under the nav, and the same tab opens the traceroute.
  IS-IS (Dijkstra) and BGP best-path selection really run; Cloudflare AS13335 and Starlink AS14593 are
  real, while the ISP, the transit networks (RFC 5398 ASNs) and the metrics are made up. Hover it (or tap the
  strip) for the traceroute.
- `assets/js/site.js`: one scroll loop for the pinned chapters, traceroute sync, the 60 garden plots
  (one sprouts per garden year), the project carousels, and the live trip and server widgets
- `assets/js/peppers.js`: pepper plants that grow up the garden section with the scroll and end with
  big red peppers; one small SVG on its own layer
- `assets/js/widgets.js`: a small working model on each Before AI card (the GNS3 lab, the garage door, the
  HDMI remote, the plant waterer, the Pepperpi, the camera, the ESP32 relay, AskChef, the MTU test, the
  radio), each built from what that project's real code did. All simulated: nothing calls a device
- `assets/js/mission.js`: the Hub section's pipeline, one real request from Mike's voice to Claude
  thinking, in eleven steps. The gold flag, the review dialog and the terminal reuse the Hub's own
  styles; the spinner frames and colors are Claude Code's
- `assets/js/skills.js`: the skills map, skills and work wired to what they used; solid is by hand,
  hollow is Claude-built (the data lives at the top of the file)
- `assets/js/lab.js`: the wires on the lab's system map
- `assets/js/lightbox.js`: project screenshots, bigger: a larger preview on hover, the full size on click or
  tap, in a native dialog that works from the keyboard
- `assets/js/audio.js`: the opt-in soundtrack and narrated tour with live captions, all through Web Audio
- `resume/`: a printable one-page web résumé

Deploy with `bash deploy.sh "message"`.

Built with [Claude Code](https://claude.com/claude-code).
