# Companion — flock user guide

This module changes what a fleet of BirdDog Play NDI/SRT decoders is playing, from one surface,
through [flock](https://github.com/stoatworks-labs/flock).

The [README](../README.md) covers installing the module. This guide is about building a surface
with it, and what a group button actually does to the room.

> **Before you rely on this:** a group action writes to **real hardware, lots of boxes at a
> time**. Each one re-routes what a physical decoder is putting out of its HDMI, which may well be
> a screen someone's watching. There's no confirmation step. Rehearse the page.
>
> This module was built with AI assistance, directed and reviewed by a human author.

---

## Connecting

flock's web server, port **8080** by default. Leave the password blank unless flock was started
with `[web].admin_password`.

> **flock's brute-force lockout is process-wide, not per client.** Repeated wrong attempts from
> Companion lock the web UI out too, so a mistyped password here takes away the tool you'd use to
> find out what's wrong.

---

## Set the poll interval deliberately

There are **two very different kinds of read** behind this module, and only one of them is free:

| | Comes from | Cost |
| --- | --- | --- |
| Which decoders exist, and their tags | flock's WebSocket, pushed on change | free |
| Online, resolution, bitrate, what it is playing | one HTTP request from flock **to every decoder** | not free |

That's why the status poll defaults to something slow enough to leave a fleet in peace rather
than something that feels snappy.

- **5 s** suits a monitoring page.
- **0** turns polling off altogether. Actions still work, and each one refreshes once by itself,
  which makes it the right setting for a surface that fires takes rather than watches status.

A fast interval means constant traffic to real decoders, all day.

---

## Group takes are the point

flock is there to change lots of decoders at once. A group action writes to **every decoder
carrying that tag**.

**The tag dropdown shows how many decoders are in the tag. Check it before you fire.**

And use the right feedback on group buttons: **"Every decoder with a tag is playing the same
source"**, not the per-decoder one. A take that reached three decoders out of four shouldn't look
like a success. That partial landing is the failure that deserves a light of its own, and it's why
the generated group preset uses the all-members feedback.

When a group action fails on some decoders, each failure is logged on its own rather than
everything collapsing into one "failed", so the log tells you *which* box didn't take it.

---

## "Online but no picture"

This is the state an operator most wants a light for, and the one "is it online?" can't see:
**the box is up and answering, and no video is arriving.**

It has its own feedback, and the generated per-decoder preset shows it **in red over the online
green**, so a decoder that's technically fine and showing nothing doesn't look healthy.

---

## Offline means offline

Unlike my other modules, **this one marks a decoder that stops answering as offline rather than
keeping its last known value.** Here that's actual information about a physical box, and a
decoder showing green while it's unplugged is worse than no light at all.

**flock is connected** covers a different case, where the module knows nothing at all. Put both on
the page, because they send you looking in different places.

---

## NDI source names are free text

The hardware itself has no picker for discovered sources on that field, so you type the source
name rather than choosing it.

**Log the NDI sources flock can see** is there to help you look it up: run it, read the log, copy
the name. It doesn't fill a dropdown, and it can't.

---

## Building a surface that fails safe

1. **Group buttons with the all-members feedback**, never the per-decoder one.
2. **Check the tag counts** in the tag dropdown before a show.
3. **Online-but-no-picture** on every per-decoder tile.
4. **flock is connected** somewhere you can see it, so a dead module doesn't look like a healthy
   fleet.
5. **Poll interval at 0** on a takes-only surface, 5 s on a monitoring wall, and no faster.

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

- [README](../README.md): installing, and the full list of actions, feedbacks and variables
- [`companion/HELP.md`](../companion/HELP.md): the same material, in Companion's help panel
