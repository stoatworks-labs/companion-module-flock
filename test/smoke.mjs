// Drives the flock module's real source against a fake flock: a real HTTP
// server for status/decode/group endpoints and session auth, plus a real
// WebSocket pushing the registry. The cases that matter are the split between
// the pushed registry and the polled hardware status, group-wide takes, and a
// decoder that stops answering being marked offline rather than left green.
import http from "node:http";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";

const watchdog = setTimeout(() => {
  console.error("\nTIMED OUT — no completion within 30s.");
  process.exit(2);
}, 30000);
watchdog.unref?.();

const MOD = new URL("../src/", import.meta.url).pathname;
const UpdateActions = (await import(`${MOD}actions.js`)).default;
const UpdateFeedbacks = (await import(`${MOD}feedbacks.js`)).default;
const UpdateVariables = (await import(`${MOD}variables.js`)).default;
const UpdatePresets = (await import(`${MOD}presets.js`)).default;
const { socket, login, getJson } = await import(`${MOD}api.js`);
const { safeId } = await import(`${MOD}main.js`);

const PASSWORD = "letmein";
const COOKIE = "flock_session=abc123";

const world = {
  devices: [
    {
      id: "dev-a",
      name: "Stage L",
      host: "10.0.0.11",
      tags: ["stage"],
      discovered: false,
    },
    {
      id: "dev-b",
      name: "Stage R",
      host: "10.0.0.12",
      tags: ["stage"],
      discovered: false,
    },
    {
      id: "dev-c",
      name: "Foyer",
      host: "10.0.0.13",
      tags: ["foyer"],
      discovered: true,
    },
  ],
  groups: { stage: ["dev-a", "dev-b"], foyer: ["dev-c"] },
};
const hw = {
  "dev-a": {
    status: {
      online: true,
      video_resolution: "1920x1080",
      video_frame_rate: "50",
      average_bitrate_mbps: 120,
      firmware_version: "3.1",
    },
    decode: { source_type: "NDI", selected_source: "STUDIO (CAM1)" },
  },
  "dev-b": {
    status: {
      online: true,
      video_resolution: "",
      video_frame_rate: "",
      average_bitrate_mbps: 0,
      firmware_version: "3.1",
    },
    decode: { source_type: "NDI", selected_source: "STUDIO (CAM2)" },
  },
  "dev-c": {
    status: {
      online: true,
      video_resolution: "1920x1080",
      video_frame_rate: "25",
      average_bitrate_mbps: 0.4,
      firmware_version: "3.0",
    },
    decode: {
      source_type: "SRT",
      srt_ip_address: "10.9.0.1",
      srt_port: 9000,
      srt_stream_name: "foyer-feed",
    },
  },
};
const unreachable = new Set();
const calls = [];

const body = (req) =>
  new Promise((r) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => r(b));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === "/api/login") {
    const payload = JSON.parse((await body(req)) || "{}");
    if (payload.password !== PASSWORD) return send(401, { error: "no" });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": `${COOKIE}; Path=/; HttpOnly`,
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  // Everything else needs the session.
  if (req.headers.cookie !== COOKIE) return send(401, { error: "no session" });

  const parts = url.pathname.split("/").filter(Boolean);
  const payload =
    req.method === "POST" || req.method === "PUT"
      ? JSON.parse((await body(req)) || "{}")
      : {};

  if (url.pathname === "/api/state") return send(200, world);
  if (url.pathname === "/api/ndi/sources")
    return send(200, { sources: ["STUDIO (CAM1)", "STUDIO (CAM2)"] });
  if (url.pathname === "/api/discovery/scan") return send(200, { found: [] });

  if (parts[0] === "api" && parts[1] === "devices" && parts[2]) {
    const id = decodeURIComponent(parts[2]);
    const verb = parts[3];
    if (unreachable.has(id)) return send(502, { error: "decoder unreachable" });
    if (verb === "status") return send(200, hw[id]?.status ?? {});
    if (verb === "decode" && req.method === "GET")
      return send(200, hw[id]?.decode ?? {});
    if (verb === "decode" && req.method === "POST") {
      calls.push({ id, payload });
      hw[id].decode = { ...hw[id].decode, ...payload };
      return send(200, { ok: true });
    }
    if (verb === "reboot") {
      calls.push({ id, reboot: true });
      return send(200, { ok: true });
    }
    if (req.method === "DELETE") {
      world.devices = world.devices.filter((d) => d.id !== id);
      for (const t of Object.keys(world.groups))
        world.groups[t] = world.groups[t].filter((x) => x !== id);
      pushRegistry();
      return send(200, { ok: true });
    }
  }

  if (url.pathname === "/api/devices" && req.method === "POST") {
    const id = `dev-${world.devices.length + 1}`;
    world.devices.push({ id, ...payload, discovered: false });
    hw[id] = { status: { online: true }, decode: { source_type: "NDI" } };
    for (const t of payload.tags ?? []) {
      world.groups[t] = [...(world.groups[t] ?? []), id];
    }
    pushRegistry();
    return send(200, { ok: true });
  }

  if (parts[0] === "api" && parts[1] === "groups" && parts[2] && parts[3]) {
    const tag = decodeURIComponent(parts[2]);
    const tab = parts[3];
    const members = world.groups[tag] ?? [];
    const outcomes = members.map((id) => {
      if (unreachable.has(id))
        return {
          device_id: id,
          device_name: id,
          ok: false,
          error: "unreachable",
        };
      if (tab === "decode") hw[id].decode = { ...hw[id].decode, ...payload };
      calls.push({ id, group: tag, payload });
      return { device_id: id, device_name: id, ok: true };
    });
    return send(200, outcomes);
  }

  if (url.pathname === "/api/settings/push-discovery-server")
    return send(200, { ok: true });

  send(404, { error: "not found" });
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

const wss = new WebSocketServer({ server, path: "/ws" });
const clients = new Set();
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify(world));
  ws.on("close", () => clients.delete(ws));
});
const pushRegistry = () => {
  for (const ws of clients) ws.send(JSON.stringify(world));
};

// --- the fake instance -----------------------------------------------------
let actions = {};
let feedbacks = {};
let variables = {};
let presetStructure = null;
let presetDefs = null;
const variableValues = {};
let lastError = "";
let lastWarn = "";

const self = {
  config: {
    host: "127.0.0.1",
    port: String(PORT),
    password: PASSWORD,
    pollinterval: 0,
  },
  devices: [],
  groups: {},
  status: {},
  decode: {},
  sessionCookie: null,
  lastShape: "",
  log: (level, msg) => {
    if (level === "error") lastError = msg;
    if (level === "warn") lastWarn = msg;
  },
  updateStatus: () => {},
  checkFeedbacks: () => {},
  checkAllFeedbacks: () => {},
  setActionDefinitions: (d) => (actions = d),
  setFeedbackDefinitions: (d) => (feedbacks = d),
  setVariableDefinitions: (d) => (variables = d),
  setPresetDefinitions: (s, p) => {
    presetStructure = s;
    presetDefs = p;
  },
  setVariableValues: (v) => Object.assign(variableValues, v),
  parseVariablesInString: async (s) => s,
  device(id) {
    return this.devices.find((d) => d.id === String(id ?? "")) ?? null;
  },
  playing(id) {
    const d = this.decode[id];
    if (!d) return "";
    if (d.source_type === "SRT") {
      const host = d.srt_ip_address ?? "";
      const port = d.srt_port ?? "";
      return d.srt_stream_name || (host ? `${host}:${port}` : "SRT");
    }
    return d.selected_source ?? "";
  },
  tags() {
    return Object.keys(this.groups ?? {}).sort();
  },
  rebuild() {
    UpdateActions(this);
    UpdateFeedbacks(this);
    UpdateVariables(this);
    UpdatePresets(this);
    this.refreshVariableValues();
  },
  refreshVariableValues() {
    const values = {
      device_count: this.devices.length,
      online_count: this.devices.filter((d) => this.status[d.id]?.online)
        .length,
      group_count: this.tags().length,
      connection_status:
        socket.ws && socket.ws.readyState === 1 ? "Connected" : "Disconnected",
    };
    for (const d of this.devices) {
      const p = `${safeId(d.id)}_`;
      const s = this.status[d.id] ?? {};
      values[`${p}online`] = s.online ? "Online" : "Offline";
      values[`${p}playing`] = this.playing(d.id) || "Nothing";
      values[`${p}resolution`] = s.video_resolution ?? "";
      values[`${p}bitrate`] = s.average_bitrate_mbps ?? 0;
    }
    this.setVariableValues(values);
  },
  applyRegistry(state) {
    this.devices = state?.devices ?? [];
    this.groups = state?.groups ?? {};
    this.rebuild();
  },
  async pollStatus() {
    const results = await Promise.allSettled(
      this.devices.map(async (d) => {
        const [status, decode] = await Promise.all([
          getJson(this, `/api/devices/${encodeURIComponent(d.id)}/status`),
          getJson(this, `/api/devices/${encodeURIComponent(d.id)}/decode`),
        ]);
        return { id: d.id, status, decode };
      }),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const id = this.devices[i]?.id;
      if (!id) continue;
      if (r.status === "fulfilled") {
        this.status[id] = r.value.status;
        this.decode[id] = r.value.decode;
      } else {
        this.status[id] = { ...(this.status[id] ?? {}), online: false };
      }
    }
    this.refreshVariableValues();
  },
};

await login(self);
socket.connect(self);
await new Promise((r) => setTimeout(r, 400));
await self.pollStatus();

let failures = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${label}\n       ${e.message}`);
  }
};
const fire = (id, options = {}) => actions[id].callback({ options });
const fb = (id, options = {}) =>
  feedbacks[id].callback(
    { options },
    { parseVariablesInString: async (s) => s },
  );

console.log("\n== connection ==");
await check("logged in and got a session cookie", () =>
  assert.match(self.sessionCookie ?? "", /flock_session/),
);
await check("the registry arrived pushed", () => {
  assert.equal(self.devices.length, 3);
  assert.deepEqual(self.tags(), ["foyer", "stage"]);
});
await check("live status came from the poll, not the push", () => {
  assert.equal(self.status["dev-a"].video_resolution, "1920x1080");
  assert.equal(self.playing("dev-a"), "STUDIO (CAM1)");
});
await check(
  "an SRT decoder's 'playing' is its stream name, not selected_source",
  () => assert.equal(self.playing("dev-c"), "foyer-feed"),
);

console.log("\n== definitions ==");
await check("11 actions registered", () =>
  assert.equal(Object.keys(actions).length, 11),
);
await check("10 feedbacks registered", () =>
  assert.equal(Object.keys(feedbacks).length, 10),
);
await check("a variable per decoder, with hyphens sanitised", () => {
  assert.ok(variables.dev_a_playing, "dev_a_playing");
  assert.ok(!variables["dev-a_playing"]);
});

console.log("\n== presets ==");
await check("a section per decoder and one for the tag groups", () => {
  const ids = presetStructure.map((s) => s.id);
  assert.ok(ids.includes("device-dev_a"), ids.join(","));
  assert.ok(ids.includes("groups"));
});
await check("every preset is 2.x 'simple' and cross-references resolve", () => {
  for (const [id, p] of Object.entries(presetDefs)) {
    assert.equal(p.type, "simple", `${id} type`);
    for (const st of p.steps)
      for (const a of st.down)
        assert.ok(actions[a.actionId], `${id} -> action ${a.actionId}`);
    for (const f of p.feedbacks)
      assert.ok(feedbacks[f.feedbackId], `${id} -> feedback ${f.feedbackId}`);
  }
});
await check("nothing orphaned or dangling in the structure", () => {
  const referenced = new Set(
    presetStructure.flatMap((s) => s.definitions.flatMap((g) => g.presets)),
  );
  for (const s of presetStructure)
    for (const g of s.definitions)
      for (const ref of g.presets)
        assert.ok(presetDefs[ref], `${s.id} -> ${ref}`);
  for (const id of Object.keys(presetDefs))
    assert.ok(referenced.has(id), `${id} defined but in no section`);
});
await check("the group take preset lights on ALL members, not any", () => {
  const p = presetDefs.group_stage_take;
  assert.equal(p.feedbacks[0].feedbackId, "groupAllPlaying");
});

console.log("\n== feedbacks ==");
await check("online / playingSource / sourceType", async () => {
  assert.equal(fb("online", { id: "dev-a" }), true);
  assert.equal(
    await fb("playingSource", { id: "dev-a", source: "STUDIO (CAM1)" }),
    true,
  );
  assert.equal(
    await fb("playingSource", { id: "dev-a", source: "STUDIO (CAM2)" }),
    false,
  );
  assert.equal(fb("sourceType", { id: "dev-c", type: "SRT" }), true);
});
await check("noVideo catches online-but-blank", () => {
  assert.equal(fb("noVideo", { id: "dev-b" }), true, "online, no resolution");
  assert.equal(fb("noVideo", { id: "dev-a" }), false);
});
await check("bitrateBelow catches a starved feed", () => {
  assert.equal(fb("bitrateBelow", { id: "dev-c", mbps: 1 }), true);
  assert.equal(fb("bitrateBelow", { id: "dev-a", mbps: 1 }), false);
});
await check("groupAllOnline is false for an empty group", () => {
  assert.equal(fb("groupAllOnline", { tag: "stage" }), true);
  assert.equal(fb("groupAllOnline", { tag: "nonexistent" }), false);
});

console.log("\n== taking ==");
await check("setNdiSource changes what a decoder plays", async () => {
  await fire("setNdiSource", { id: "dev-a", source: "STUDIO (CAM2)" });
  assert.equal(self.playing("dev-a"), "STUDIO (CAM2)");
});
await check("a group take lands on every member", async () => {
  await fire("groupNdiSource", { tag: "stage", source: "SLATE" });
  assert.equal(self.playing("dev-a"), "SLATE");
  assert.equal(self.playing("dev-b"), "SLATE");
  assert.equal(
    await fb("groupAllPlaying", { tag: "stage", source: "SLATE" }),
    true,
  );
});
await check(
  "a partly-failed group take is logged per member, not collapsed",
  async () => {
    unreachable.add("dev-b");
    lastWarn = "";
    await fire("groupNdiSource", { tag: "stage", source: "BARS" });
    assert.match(lastWarn, /unreachable/);
    assert.equal(
      await fb("groupAllPlaying", { tag: "stage", source: "BARS" }),
      false,
      "not every member landed on it",
    );
  },
);
await check(
  "an unreachable decoder is marked OFFLINE, not left green",
  async () => {
    await self.pollStatus();
    assert.equal(fb("online", { id: "dev-b" }), false);
    assert.equal(variableValues.dev_b_online, "Offline");
    unreachable.delete("dev-b");
    await self.pollStatus();
    assert.equal(fb("online", { id: "dev-b" }), true, "and recovers");
  },
);
await check("setSrtSource sends the SRT fields", async () => {
  calls.length = 0;
  await fire("setSrtSource", {
    id: "dev-c",
    mode: "listener",
    ip: "10.9.0.2",
    port: 9100,
    stream: "new-feed",
    latency: 200,
  });
  const sent = calls.find((c) => c.id === "dev-c")?.payload;
  assert.equal(sent.source_type, "SRT");
  assert.equal(sent.srt_connection_type, "listener");
  assert.equal(sent.srt_port, 9100);
  assert.equal(self.playing("dev-c"), "new-feed");
});

console.log("\n== session recovery ==");
await check(
  "a dropped session is re-established rather than failing",
  async () => {
    self.sessionCookie = "flock_session=stale";
    const body = await getJson(self, "/api/state");
    assert.equal(body.devices.length, self.devices.length);
    assert.match(self.sessionCookie, /abc123/, "re-logged in");
  },
);

console.log("\n== fleet membership ==");
await check("adding a decoder rebuilds the presets", async () => {
  await fire("addDevice", { name: "Bar", host: "10.0.0.14", tags: "foyer" });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(self.devices.length, 4);
  assert.ok(presetDefs.dev_4_status, Object.keys(presetDefs).join(","));
});

console.log("\n== teardown ==");
await check("close() settles", async () => {
  socket.close();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(socket.ws, null);
});

wss.close();
server.close();
console.log("\n== the checkFeedbacks trap ==");
// InstanceBase.checkFeedbacks(type, ...rest) requires AT LEAST ONE type: with no
// arguments it forwards [undefined] to the host, which checks a feedback type
// called "undefined" — i.e. nothing at all. Every feedback then sits frozen at
// whatever it last evaluated to, with no error anywhere. checkAllFeedbacks() is
// the correct call for "re-evaluate everything".
await check("no bare checkFeedbacks() survives in src/", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../src/", import.meta.url).pathname;
  const offenders = [];
  for (const f of readdirSync(dir)) {
    if (!/\.(js|ts)$/.test(f)) continue;
    const body = readFileSync(dir + f, "utf8");
    if (/[^A-Za-z]checkFeedbacks\(\s*\)/.test(body)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], "use checkAllFeedbacks() instead");
});

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} CHECK(S) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
