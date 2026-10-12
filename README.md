# companion-module-flock

> **AI-assisted project.** This module was created with [Claude](https://claude.com/claude-code)
> (Anthropic), directed and reviewed by a human author. Check it over before you rely on it for
> a show.

A [Bitfocus Companion](https://bitfocus.io/companion) module for
[flock](https://github.com/stoatworks-labs/flock). It changes what a whole fleet
of BirdDog Play NDI/SRT decoders is playing, from one surface.

<!-- downloads:start -->

## Download

**[v1.0.5](https://github.com/stoatworks-labs/companion-module-flock/releases/tag/v1.0.5)**

This release contains:

- [`companion-module-flock-pkg.tgz`](https://github.com/stoatworks-labs/companion-module-flock/releases/latest/download/companion-module-flock-pkg.tgz) — npm package, 25 KB
- [`flock-1.0.5.tgz`](https://github.com/stoatworks-labs/companion-module-flock/releases/download/v1.0.5/flock-1.0.5.tgz) — npm package, 25 KB

All builds, checksums and release notes: [github.com/stoatworks-labs/companion-module-flock/releases](https://github.com/stoatworks-labs/companion-module-flock/releases).

<!-- downloads:end -->

## What it does

- **Actions:** play an NDI source or an SRT endpoint on any decoder, take a
  source to every decoder carrying a tag, apply a raw settings patch to a tag,
  reboot, scan for decoders, list the NDI sources flock can see, push the
  discovery-server address, and add/remove decoders.
- **Feedbacks:** decoder online, playing a specific source, NDI/SRT mode,
  online but no picture, bitrate below a threshold, resolution matches, every
  decoder in a tag online, every decoder in a tag playing the same source, whole
  fleet online, and flock connected.
- **Variables:** per decoder, the name, host, online, what it's playing, source
  type, resolution, frame rate, bitrate, firmware and tags. Plus fleet counts.
- **Presets:** Fleet, a section per decoder and a section per tag group, all
  built from flock's registry.

## Two very different kinds of read

|                                                 | Comes from                                       | Cost     |
| ----------------------------------------------- | ------------------------------------------------ | -------- |
| Which decoders exist, and their tags            | flock's WebSocket, pushed on change              | free     |
| Online, resolution, bitrate, what it is playing | one HTTP request from flock **to every decoder** | not free |

That's why the status poll interval defaults to something slow enough to leave
a fleet in peace (5 s) rather than something that feels snappy. Set it to **0**
to stop polling the hardware altogether and just use the actions; the _Refresh
status now_ action and every write still poll once, on demand.

## The group buttons are the point

flock is there to change lots of decoders at once. Two feedbacks are built
around that, and the difference between them matters:

- **Every decoder with a tag is playing the same source:** green only when the
  take landed _everywhere_.
- A per-decoder tally is true when _that one_ landed.

A group take that reaches three decoders out of four is the failure that
deserves a light of its own, so the generated group preset uses the all-members
feedback. Each decoder that fails is logged on its own, rather than everything
collapsing into one "failed".

> **A group action writes to real hardware, lots of boxes at a time.** Each one
> re-routes what a physical decoder is putting out of its HDMI, which may well be
> a screen someone's watching. The tag dropdown shows how many decoders are in
> the tag, so check it before you fire.

## "Online but no picture"

This is the state you most want a light for, and the one "is it online?" can't
see: the box is up and answering, and no video is arriving. It has its own
feedback, and the generated per-decoder preset shows it in red _over_ the online
green.

## Offline means offline

Unlike my other modules, this one marks a decoder that stops answering as
**offline** rather than keeping its last known value. Here that's actual
information about a physical box, and a decoder showing green while it's
unplugged is what the poll is there to catch. The _flock is connected_ feedback
still covers the case where flock itself can't be reached and the module knows
nothing.

## Authentication

Leave the password blank unless flock was started with `[web].admin_password`.
Without one it's a trusted-LAN tool with no login at all.

Two things worth knowing if you do set one:

- **Sessions live in memory and aren't saved.** A flock restart logs everyone
  out. This module logs back in by itself on a 401 rather than sitting there
  broken.
- **The brute-force lockout is process-wide, not per client.** Repeated wrong
  attempts from here lock the web UI out too, for 30 seconds.

## Tests

```bash
npm test
```

This runs the module's actual code against a pretend flock (over real HTTP and
a real WebSocket). It covers the split between the pushed registry and the
polled status, group takes and their partial failures, an unreachable decoder
going offline and coming back, SRT field mapping, and getting the session back
after a restart.

## Installing

It's not in the official Companion module store, so install it as a developer
module through **Settings → Developer modules path**.

<!-- attributions:start -->
This project is built on other people's work — see [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
<!-- attributions:end -->

## Licence

MIT, see [LICENSE](LICENSE).
