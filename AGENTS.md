# AGENTS.md — bringing an LLM up to speed on this Companion module

Orientation for an AI assistant (or a new human) picking this project up cold. There is no
`CLAUDE.md` here; this is the entry point.

---

## 1. What this is

A **Bitfocus Companion connection module** for **flock**, the fleet manager for BirdDog Play
NDI/SRT decoders. It changes what any decoder is playing, does the same across a whole tag
group, and reports per-decoder health.

JavaScript, Node 22 runtime, `@companion-module/base` 2.x.

## 2. The split that shapes everything

```
/ws                        the REGISTRY: which decoders exist, and their tags.
                           Pushed (flock re-snapshots every 750 ms, sends on
                           change). FREE. Carries no live status whatsoever.

/api/devices/:id/status    live state. Each read is an HTTP request flock makes
/api/devices/:id/decode    TO THE DECODER. Not free, not pushed. Polled.
```

Do not "simplify" by polling `/api/state` — it has no status in it. Do not shorten the
status poll to feel responsive — the cost is one request per decoder per interval, against
real hardware. The default is 5 s and 0 (off) is a supported, documented choice.

## 3. Offline means offline — the opposite of the other modules here

Every other module in this fleet keeps its last known state when the far end goes quiet, so
a blip does not blank a page. **This one marks an unanswering decoder offline.** That is
deliberate: here it is real information about a real box, and a decoder showing green while
unplugged is exactly what the poll exists to catch. `connected` (the WebSocket) still covers
"the module knows nothing at all". There is a test for both halves.

## 4. Group actions write to many real devices at once

`POST /api/groups/:tag/:tab` applies a patch to every decoder carrying the tag, and answers
with a **per-device outcome list**, not one status. `api.js::applyGroup` logs every failed
member individually — collapsing them into one "failed" hides which screen is now wrong.

The `groupAllPlaying` feedback exists for the same reason: a take that reached three of four
decoders must not look like a success. **The generated group preset uses it, not the
per-decoder tally.** Do not swap that.

## 5. `playing()` is not `selected_source`

`DecodeSettings` holds NDI and SRT fields side by side and which is live depends on
`source_type`. `main.js::playing()` resolves it: `selected_source` for NDI, the SRT stream
name (falling back to `host:port`) for SRT. Reading `selected_source` directly reports a
stale NDI name on a decoder that has been switched to SRT.

## 6. Auth

Optional and off by default. With `[web].admin_password` set:

- **Sessions are a random token in an in-memory set — no persistence, no expiry.** A flock
  restart logs everyone out, so `api.js::request` re-logs-in once on a 401 and retries. A
  module that gave up there would need a manual poke mid-show.
- **The brute-force lockout (5 failures, 30 s) is PROCESS-WIDE, not per client.** A module
  retrying a wrong password in a loop locks the operator out of the web UI too. That is why
  login failure is reported and not retried automatically.

## 7. Traps already paid for

- **flock device ids are UUIDs with hyphens**, and Companion variable ids allow only
  `[a-zA-Z0-9_]`. `safeId()` sanitises; every generated preset and variable id goes through it.
- **`@companion-module/base` 2.x presets are `setPresetDefinitions(structure, definitions)`**
  with `type: 'simple'`. A 1.x `category` field loads and then never appears in the UI.
- **Feedback order matters in the generated per-decoder preset.** `noVideo` is listed after
  `online` so it wins — online-but-blank is a worse state than offline and must not render
  as healthy green.
- **NDI source is free text on the real hardware.** `available_sources` in `DecodeSettings`
  is always empty against a real device; it is kept for a future SDK-backed picker. Do not
  build a dropdown from it.

## 8. Context that matters

Every write here reaches a physical decoder feeding a screen. Reboot does what it says.
Group actions do it to many boxes at once. Prefer surfacing partial failure loudly over
reporting an aggregate success.

## 9. Conventions

- Not in the official Companion module store — installs via **Settings → Developer modules
  path**.
- `npm test` drives the real source against a fake flock (real HTTP + real WebSocket).
- Ships a user-facing AI-assisted disclaimer.
- "Commit" means commit **and** push.
