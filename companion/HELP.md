# flock

Controls a fleet of BirdDog Play decoders through
[flock](https://github.com/stoatworks-labs/flock).

## Connection

flock's web server, port 8080 by default. Leave the password blank unless flock
was started with `[web].admin_password`.

**flock's brute-force lockout is process-wide, not per client** — repeated wrong
attempts from here lock the web UI out too.

## The poll interval matters

The decoder list arrives pushed and free. **Live status does not**: each poll is
one HTTP request from flock to _every_ decoder. A fast interval means constant
traffic to real hardware.

- **5 s** suits a monitoring page.
- **0** turns polling off entirely — actions still work, and each one refreshes
  once on its own.

## Group takes

The reason flock exists. A group action writes to **every decoder carrying that
tag**, and each one re-routes what a physical decoder is putting on its output.
The tag dropdown shows the membership count; check it before firing.

Use the **Every decoder with a tag is playing the same source** feedback, not
the per-decoder one, for group buttons. A take that reached three of four
decoders should not look like a success.

Per-decoder failures inside a group action are logged individually.

## "Online but no picture"

The box is up and answering, and no video is arriving. Invisible from "is it
online", and usually the thing you actually want to know. The generated
per-decoder preset shows it in red over the online green.

## Offline means offline

A decoder that stops answering is marked offline rather than holding its last
value — that is real information here. **flock is connected** covers the
different case where the module knows nothing at all.

## NDI source names are free text

The real hardware has no discovered-source picker for that field, so **Log the
NDI sources flock can see** is a lookup aid rather than a dropdown feed.
