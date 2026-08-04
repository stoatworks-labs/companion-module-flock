# companion-module-flock

> **AI-assisted project.** This module was built with the help of
> [Claude](https://claude.ai), Anthropic's AI assistant — including
> implementation and documentation. Review it accordingly before relying on
> it in production.

A [Bitfocus Companion](https://bitfocus.io/companion) connection module for
[flock](https://github.com/stoatworks-labs/flock) — change what a fleet of
BirdDog Play NDI/SRT decoders is playing, from one surface.

## What it does

- **Actions** — play an NDI source or an SRT endpoint on any decoder, **take a
  source to every decoder carrying a tag**, apply a raw settings patch to a tag,
  reboot, scan for decoders, list the NDI sources flock can see, push the
  discovery-server address, and add/remove decoders.
- **Feedbacks** — decoder online, playing a specific source, NDI/SRT mode,
  **online but no picture**, bitrate below a threshold, resolution matches,
  every decoder in a tag online, **every decoder in a tag playing the same
  source**, whole fleet online, flock connected.
- **Variables** — per decoder: name, host, online, what it is playing, source
  type, resolution, frame rate, bitrate, firmware, tags. Plus fleet counts.
- **Presets** — Fleet, **a section per decoder**, and **a section per tag
  group**, all generated from flock's registry.

## Two very different kinds of read

|                                                 | Comes from                                       | Cost     |
| ----------------------------------------------- | ------------------------------------------------ | -------- |
| Which decoders exist, and their tags            | flock's WebSocket, pushed on change              | free     |
| Online, resolution, bitrate, what it is playing | one HTTP request from flock **to every decoder** | not free |

That is why the status poll interval defaults to something slow enough to leave
a fleet alone (5 s) rather than something that feels responsive. Set it to **0**
to stop polling hardware entirely and use only the actions; the _Refresh status
now_ action and every write still poll once on demand.

## The group buttons are the point

flock exists to change many decoders at once. Two feedbacks are built around
that, and the distinction matters:

- **Every decoder with a tag is playing the same source** — green only when the
  take landed _everywhere_.
- A per-decoder tally is true when _that one_ landed.

A group take that reaches three of four decoders is the failure mode worth a
light of its own, so the generated group preset uses the all-members feedback.
Per-decoder failures are logged individually rather than collapsing into one
"failed".

> **A group action writes to real hardware, many boxes at a time.** Each one
> re-routes what a physical decoder is putting on its HDMI output — potentially
> a screen someone is watching. The tag dropdown shows the membership count;
> check it before firing.

## "Online but no picture"

The state an operator most wants a light for, and the one that is invisible from
"is it online": the box is up, answering, and no video is arriving. It has its
own feedback, and the generated per-decoder preset shows it in red _over_ the
online green.

## Offline means offline

Unlike the other modules in this fleet, a decoder that stops answering is marked
**offline** rather than keeping its last known value. Here that is real
information about a real box — a decoder showing green while unplugged is
exactly what the poll exists to catch. The _flock is connected_ feedback still
covers the case where flock itself is unreachable and the module knows nothing.

## Authentication

Leave the password blank unless flock was started with `[web].admin_password` —
without one it is a trusted-LAN tool with no login at all.

Two things worth knowing if you do set one:

- **Sessions are in-memory with no persistence.** A flock restart logs everyone
  out. This module re-logs-in automatically on a 401 rather than sitting broken.
- **The brute-force lockout is process-wide, not per client.** Repeated wrong
  attempts from here lock the web UI out too, for 30 seconds.

## Tests

```bash
npm test
```

Drives the module's real source against a fake flock (real HTTP + real
WebSocket): the pushed-registry/polled-status split, group takes and their
partial failures, an unreachable decoder going offline and recovering, SRT
field mapping, and session re-establishment after a restart.

## Installing

Not in the official Companion module store. Install via
**Settings → Developer modules path**.

<!-- attributions:start -->
This project is built on other people's work — see [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
<!-- attributions:end -->

## Licence

MIT — see [LICENSE](LICENSE).
