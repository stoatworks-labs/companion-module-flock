import { InstanceBase, Regex, InstanceStatus } from "@companion-module/base";
import { UpgradeScripts } from "./upgrades.js";
import UpdateActions from "./actions.js";
import UpdateFeedbacks from "./feedbacks.js";
import UpdateVariableDefinitions from "./variables.js";
import UpdatePresets from "./presets.js";
import { socket, login, getJson } from "./api.js";

/** Companion variable ids allow only [a-zA-Z0-9_]. flock device ids are UUIDs
 *  with hyphens, so every one of them needs sanitising. */
export function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_");
}

export default class ModuleInstance extends InstanceBase {
  constructor(internal) {
    super(internal);
    this.devices = [];
    this.groups = {};
    this.status = {}; // deviceId -> DeviceStatus, from the poll
    this.decode = {}; // deviceId -> DecodeSettings, from the poll
    this.sessionCookie = null;
    this.pollTimer = null;
    this.lastShape = "";
  }

  async init(config) {
    this.config = config;
    this.updateStatus(InstanceStatus.Connecting);
    this.rebuild();
    try {
      if (this.config.password) await login(this);
    } catch (e) {
      this.log("error", e.message);
    }
    socket.connect(this);
    this.startPolling();
  }

  async destroy() {
    this.stopPolling();
    socket.close();
  }

  async configUpdated(config) {
    this.config = config;
    this.stopPolling();
    socket.close();
    this.devices = [];
    this.groups = {};
    this.status = {};
    this.decode = {};
    this.sessionCookie = null;
    this.lastShape = "";
    this.updateStatus(InstanceStatus.Connecting);
    try {
      if (this.config.password) await login(this);
    } catch (e) {
      this.log("error", e.message);
    }
    socket.connect(this);
    this.startPolling();
  }

  getConfigFields() {
    return [
      {
        type: "static-text",
        id: "info",
        width: 12,
        label: "Connection",
        value:
          "flock's web server. Leave the password blank unless flock was started with <code>[web].admin_password</code> — with no password it is a trusted-LAN tool with no login at all. Note flock's brute-force lockout is <b>process-wide, not per client</b>: repeated wrong attempts from here lock the web UI out too.",
      },
      {
        type: "textinput",
        id: "host",
        label: "flock host",
        width: 8,
        default: "127.0.0.1",
        regex: Regex.HOSTNAME,
      },
      {
        type: "textinput",
        id: "port",
        label: "Port",
        width: 4,
        default: "8080",
        regex: Regex.PORT,
      },
      {
        type: "textinput",
        id: "password",
        label: "Admin password (blank if flock has none)",
        width: 12,
        default: "",
      },
      {
        type: "number",
        id: "pollinterval",
        label: "Status poll interval (seconds, 0 = off)",
        width: 6,
        min: 0,
        max: 300,
        default: 5,
      },
      {
        type: "static-text",
        id: "pollinfo",
        width: 12,
        label: "",
        value:
          "The decoder list arrives pushed and free. <b>Live status does not</b> — each poll is one HTTP request from flock to <i>every</i> decoder, so a fast interval means constant traffic to real hardware. 5 s suits a monitoring page. Set 0 to leave the hardware alone and use only the actions.",
      },
    ];
  }

  startPolling() {
    const seconds = Number(this.config.pollinterval);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.pollTimer = setInterval(() => this.pollStatus(), seconds * 1000);
    this.pollStatus();
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /**
   * The registry — decoders and tag groups. Pushed, free, and carries no live
   * status whatsoever.
   *
   * Rebuilt only when the shape changes (which decoders exist, and their tags),
   * because that is what the dropdowns and per-device presets are built from.
   */
  applyRegistry(state) {
    this.devices = Array.isArray(state?.devices) ? state.devices : [];
    this.groups = state?.groups ?? {};
    this.updateStatus(InstanceStatus.Ok);

    const shape = JSON.stringify([
      this.devices.map((d) => [d.id, d.name, d.tags]),
      Object.keys(this.groups),
    ]);
    if (shape !== this.lastShape) {
      this.lastShape = shape;
      this.rebuild();
    } else {
      this.refreshVariableValues();
      this.checkAllFeedbacks();
    }
  }

  /**
   * One status sweep: every decoder, in parallel.
   *
   * A decoder that does not answer is recorded as offline rather than left at
   * its previous value. That is the opposite of what the other modules in this
   * fleet do with stale state, and deliberately so: here "offline" is real
   * information about a real box, not a gap in the module's knowledge. A
   * decoder showing green while unplugged is the failure this poll exists to
   * catch.
   */
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
    this.checkAllFeedbacks();
  }

  rebuild() {
    UpdateActions(this);
    UpdateFeedbacks(this);
    UpdateVariableDefinitions(this);
    UpdatePresets(this);
    this.refreshVariableValues();
    this.checkAllFeedbacks();
  }

  device(id) {
    return this.devices.find((d) => d.id === String(id ?? "")) ?? null;
  }

  /** What this decoder is playing — the NDI source name, or the SRT endpoint.
   *  These are two different fields in DecodeSettings and which one is live
   *  depends on source_type, so a caller must not just read selected_source. */
  playing(id) {
    const d = this.decode[id];
    if (!d) return "";
    if (d.source_type === "SRT") {
      const host = d.srt_ip_address ?? "";
      const port = d.srt_port ?? "";
      return d.srt_stream_name || (host ? `${host}:${port}` : "SRT");
    }
    return d.selected_source ?? "";
  }

  tags() {
    return Object.keys(this.groups ?? {}).sort();
  }

  refreshVariableValues() {
    const online = this.devices.filter((d) => this.status[d.id]?.online);
    const values = {
      device_count: this.devices.length,
      online_count: online.length,
      group_count: this.tags().length,
      connection_status:
        socket.ws && socket.ws.readyState === 1 ? "Connected" : "Disconnected",
    };
    for (const d of this.devices) {
      const p = `${safeId(d.id)}_`;
      const s = this.status[d.id] ?? {};
      values[`${p}name`] = d.name ?? d.id;
      values[`${p}host`] = d.host ?? "";
      values[`${p}online`] = s.online ? "Online" : "Offline";
      values[`${p}playing`] = this.playing(d.id) || "Nothing";
      values[`${p}source_type`] = this.decode[d.id]?.source_type ?? "";
      values[`${p}resolution`] = s.video_resolution ?? "";
      values[`${p}frame_rate`] = s.video_frame_rate ?? "";
      values[`${p}bitrate`] = s.average_bitrate_mbps ?? 0;
      values[`${p}firmware`] = s.firmware_version ?? "";
      values[`${p}tags`] = (d.tags ?? []).join(", ");
    }
    this.setVariableValues(values);
  }
}

export { UpgradeScripts };
