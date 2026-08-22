# Companion — flock user guide

This module changes **what a fleet of BirdDog Play NDI/SRT decoders is playing**, from one
surface, through [flock](https://github.com/stoatworks-labs/flock).

The [README](../README.md) covers installing the module. This is how to build a surface with it,
and what a group button actually does to the room.

> **Before you rely on this:** a group action writes to **real hardware, many boxes at a time**.
> Each one re-routes what a physical decoder is putting on its HDMI output — potentially a screen
> someone is watching. There is no confirmation step. Rehearse the page.
>
> This module was built with AI assistance, directed and reviewed by a human author.

---

## Connecting

flock's web server, port **8080** by default. Leave the password blank unless flock was started
with `[web].admin_password`.

> **flock's brute-force lockout is process-wide, not per client.** Repeated wrong attempts from
> Companion lock the web UI out too — so a mistyped password here takes away the tool you would
> use to investigate.

---

## Set the poll interval deliberately

There are **two very different kinds of read** behind this module, and only one of them is free:

| | Comes from | Cost |
| --- | --- | --- |
| Which decoders exist, and their tags | flock's WebSocket, pushed on change | free |
| Online, resolution, bitrate, what it is playing | one HTTP request from flock **to every decoder** | not free |

That is why the status poll defaults to something slow enough to leave a fleet alone rather than
something that feels responsive.

- **5 s** suits a monitoring page.
- **0** turns polling off entirely. Actions still work, and each one refreshes once on its own —
  which is the right setting for a surface that fires takes rather than watches status.

A fast interval means constant traffic to real decoders, all day.

---

## Group takes are the point

flock exists to change many decoders at once. A group action writes to **every decoder carrying
that tag**.

**The tag dropdown shows the membership count. Check it before firing.**

And use the right feedback: **"Every decoder with a tag is playing the same source"**, not the
per-decoder one, on group buttons. A take that reached three of four decoders should not look like
a success — that partial landing is the failure worth a light of its own, and it is why the
generated group preset uses the all-members feedback.

Per-decoder failures inside a group action are logged individually rather than collapsing into one
"failed", so the log tells you *which* box did not take it.

---

## "Online but no picture"

This is the state an operator most wants a light for, and the one that is invisible from "is it
online": **the box is up, answering, and no video is arriving.**

It has its own feedback, and the generated per-decoder preset shows it **in red over the online
green** — so a decoder that is technically fine and showing nothing does not read as healthy.

---

## Offline means offline

Unlike the other modules in this fleet, **a decoder that stops answering is marked offline rather
than keeping its last known value.** Here that is real information about a real box: a decoder
showing green while unplugged is worse than useless.

**flock is connected** covers the different case, where the module knows nothing at all. Both
belong on the page, because they send you to different places.

---

## NDI source names are free text

The real hardware has no discovered-source picker for that field, so the source name is typed
rather than chosen.

**Log the NDI sources flock can see** is the lookup aid — run it, read the log, copy the name. It
does not feed a dropdown, and cannot.

---

## Building a surface that fails safe

1. **Group buttons with the all-members feedback**, never the per-decoder one.
2. **Membership counts checked** before a show, from the tag dropdown.
3. **Online-but-no-picture** on every per-decoder tile.
4. **flock is connected** somewhere visible, so a dead module does not read as a healthy fleet.
5. **Poll interval at 0** on a takes-only surface, 5 s on a monitoring wall — not faster.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| **A group button went green but one screen is wrong** | The per-decoder feedback is on the button. Use the all-members one. |
| **Status never updates** | Polling is off (interval 0). Actions still refresh once each; add *Refresh status now*. |
| **Constant traffic to the decoders** | The poll interval is too fast. Each poll hits every box. |
| **A decoder shows online with a black screen** | That is the online-but-no-picture state — add its feedback. |
| **The web UI locked me out after using Companion** | The lockout is process-wide. Fix the password in the connection config. |
| **Source name does nothing** | It is free text and must match exactly. Run *Log the NDI sources flock can see*. |

---

## See also

- [README](../README.md) — installing, and the full action/feedback/variable list
- [`companion/HELP.md`](../companion/HELP.md) — the same material, in Companion's help panel
