import WebSocket from "ws";
import { InstanceStatus } from "@companion-module/base";

// Two very different kinds of read, and conflating them would either make the
// module useless or hammer the hardware:
//
//   /ws                the REGISTRY — which decoders exist, and their tags.
//                      Pushed (flock re-snapshots every 750 ms and sends on
//                      change). Free. Carries NO live status at all.
//
//   /api/devices/:id/status   and   /decode
//                      Live state, and each one is an HTTP request flock makes
//                      TO THE DECODER. Not free, not pushed. This module polls
//                      them on a configurable interval, and the cost is one
//                      request per decoder per interval.
//
// That is why the status poll interval defaults to something slow enough to
// leave a fleet alone (5 s) rather than to something that feels responsive.
//
// Auth: optional and off by default. With [web].admin_password set, every route
// needs a session cookie — and sessions are an in-memory set with no
// persistence and no expiry, so a flock restart logs this module out. The
// module therefore re-logs-in on a 401 rather than sitting broken.

const RECONNECT_MS = 3000;

function base(self) {
  return `http://${self.config.host}:${self.config.port}`;
}

function authHeaders(self) {
  return self.sessionCookie ? { Cookie: self.sessionCookie } : {};
}

/** Log in and remember the cookie. Called at connect and again on any 401 — a
 *  flock restart drops every session, and a module that gave up at that point
 *  would need a manual poke mid-show. */
export async function login(self) {
  const password = String(self.config.password ?? "");
  if (!password) {
    self.sessionCookie = null;
    return false;
  }
  const res = await fetch(`${base(self)}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    // flock locks out for 30 seconds after 5 failed attempts, and that lockout
    // is PROCESS-WIDE rather than per client — a module retrying a wrong
    // password in a loop would lock the operator out of the web UI too.
    throw new Error(
      res.status === 401
        ? "flock rejected the password. Note its lockout is process-wide: repeated wrong attempts lock the web UI out too."
        : `Login failed: HTTP ${res.status}`,
    );
  }
  const cookie = res.headers.get("set-cookie");
  self.sessionCookie = cookie ? cookie.split(";")[0] : null;
  return true;
}

async function request(self, method, path, body, retry = true) {
  const res = await fetch(`${base(self)}${path}`, {
    method,
    headers: {
      ...authHeaders(self),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry && self.config.password) {
    await login(self);
    return request(self, method, path, body, false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${method} ${path} failed: HTTP ${res.status} ${text}`.trim(),
    );
  }
  return res.json().catch(() => ({}));
}

export const getJson = (self, path) => request(self, "GET", path);
export const post = (self, path, body = {}) =>
  request(self, "POST", path, body);
export const put = (self, path, body = {}) => request(self, "PUT", path, body);
export const del = (self, path) => request(self, "DELETE", path);

/**
 * Apply a settings tab to every decoder carrying a tag.
 *
 * **This writes the same change to many real devices at once**, and each one
 * re-routes what a physical decoder is putting on its HDMI output — potentially
 * a screen someone is watching. flock answers with a per-device outcome list
 * rather than one status, so partial failure is visible; the module logs every
 * failed member rather than reporting overall success.
 */
export async function applyGroup(self, tag, tab, patch) {
  const outcomes = await post(
    self,
    `/api/groups/${encodeURIComponent(tag)}/${encodeURIComponent(tab)}`,
    patch,
  );
  const failed = (Array.isArray(outcomes) ? outcomes : []).filter(
    (o) => o.ok === false,
  );
  for (const f of failed) {
    self.log("warn", `${f.device_name ?? f.device_id}: ${f.error ?? "failed"}`);
  }
  return outcomes;
}

export const socket = {
  ws: null,
  reconnectTimer: null,
  closing: false,

  connect(self) {
    this.closing = false;
    let ws;
    try {
      ws = new WebSocket(`ws://${self.config.host}:${self.config.port}/ws`, {
        headers: authHeaders(self),
      });
    } catch (e) {
      self.updateStatus(InstanceStatus.ConnectionFailure, e.message);
      this.scheduleReconnect(self);
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      self.log("info", `Connected to flock at ${self.config.host}`);
      self.updateStatus(InstanceStatus.Ok);
    });

    ws.on("message", (data) => {
      let state;
      try {
        state = JSON.parse(data.toString());
      } catch {
        return;
      }
      self.applyRegistry(state);
    });

    ws.on("close", () => {
      if (this.closing) return;
      self.updateStatus(InstanceStatus.Disconnected, "flock disconnected");
      this.scheduleReconnect(self);
    });

    ws.on("error", (err) => {
      self.updateStatus(InstanceStatus.ConnectionFailure, err.message);
    });
  },

  scheduleReconnect(self) {
    if (this.closing || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // Re-login first: the commonest reason the socket dropped is that flock
      // restarted, which also invalidated the session.
      const go = () => this.connect(self);
      if (self.config.password) login(self).then(go).catch(go);
      else go();
    }, RECONNECT_MS);
  },

  close() {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // Closing a socket that never opened throws; nothing to recover.
      }
      this.ws = null;
    }
  },
};
