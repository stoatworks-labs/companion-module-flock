import { post, del, getJson, applyGroup } from "./api.js";

// Everything that writes here reaches real hardware. A decode change re-routes
// what a physical decoder is putting on its HDMI output — potentially a screen
// an audience is watching — and the group actions do it to every decoder
// carrying a tag at once. The descriptions say so; keep them saying so.

export function deviceChoices(self) {
  return self.devices.map((d) => ({
    id: d.id,
    label: `${d.name ?? d.id}${d.host ? ` (${d.host})` : ""}`,
  }));
}

export function tagChoices(self) {
  return self.tags().map((tag) => ({
    id: tag,
    label: `${tag} (${(self.groups[tag] ?? []).length} decoders)`,
  }));
}

export default function UpdateActions(self) {
  const devices = deviceChoices(self);
  const tags = tagChoices(self);

  const deviceOption = {
    id: "id",
    type: "dropdown",
    label: "Decoder",
    choices: devices,
    default: devices[0]?.id ?? "",
    allowCustom: true,
  };

  const text = async (event, key) =>
    (
      await self.parseVariablesInString(String(event.options[key] ?? ""))
    ).trim();

  const run = async (fn) => {
    try {
      await fn();
      // Decode state is only visible through the poll, so nudge it rather than
      // leaving the button's own feedback a poll-interval behind the change it
      // just made.
      await self.pollStatus();
    } catch (e) {
      self.log("error", e.message);
    }
  };

  self.setActionDefinitions({
    setNdiSource: {
      name: "Decode: play an NDI source",
      description:
        "Changes what this decoder is putting on its HDMI output. The source is a free-text NDI name — the real hardware has no discovered-source picker for this field, so 'List NDI sources' is a lookup aid, not a dropdown feed.",
      options: [
        deviceOption,
        {
          id: "source",
          type: "textinput",
          label: "NDI source name",
          default: "",
          useVariables: true,
          width: 12,
        },
      ],
      callback: async (event) =>
        run(async () => {
          const id = await text(event, "id");
          const source = await text(event, "source");
          if (!id || !source) return;
          await post(self, `/api/devices/${encodeURIComponent(id)}/decode`, {
            source_type: "NDI",
            selected_source: source,
          });
        }),
    },

    setSrtSource: {
      name: "Decode: play an SRT source",
      options: [
        deviceOption,
        {
          id: "mode",
          type: "dropdown",
          label: "Connection type",
          choices: [
            { id: "caller", label: "Caller (dial out)" },
            { id: "listener", label: "Listener (wait)" },
          ],
          default: "caller",
        },
        {
          id: "ip",
          type: "textinput",
          label: "IP address",
          default: "",
          useVariables: true,
        },
        {
          id: "port",
          type: "number",
          label: "Port",
          min: 1,
          max: 65535,
          default: 9000,
        },
        {
          id: "stream",
          type: "textinput",
          label: "Stream name (optional)",
          default: "",
          useVariables: true,
        },
        {
          id: "latency",
          type: "number",
          label: "Latency (ms)",
          min: 20,
          max: 8000,
          default: 120,
        },
      ],
      callback: async (event) =>
        run(async () => {
          const id = await text(event, "id");
          if (!id) return;
          await post(self, `/api/devices/${encodeURIComponent(id)}/decode`, {
            source_type: "SRT",
            srt_connection_type: event.options.mode,
            srt_ip_address: (await text(event, "ip")) || null,
            srt_port: Number(event.options.port),
            srt_stream_name: (await text(event, "stream")) || null,
            srt_latency_ms: Number(event.options.latency),
          });
        }),
    },

    groupNdiSource: {
      name: "Group: play an NDI source on every decoder with a tag",
      description:
        "The fleet operation flock exists for — and it writes to every decoder carrying that tag at once. Check the membership count in the dropdown before firing it. Per-decoder failures are logged individually rather than collapsing into one 'failed'.",
      options: [
        {
          id: "tag",
          type: "dropdown",
          label: "Tag",
          choices: tags,
          default: tags[0]?.id ?? "",
          allowCustom: true,
        },
        {
          id: "source",
          type: "textinput",
          label: "NDI source name",
          default: "",
          useVariables: true,
          width: 12,
        },
      ],
      callback: async (event) =>
        run(async () => {
          const tag = await text(event, "tag");
          const source = await text(event, "source");
          if (!tag || !source) return;
          await applyGroup(self, tag, "decode", {
            source_type: "NDI",
            selected_source: source,
          });
        }),
    },

    groupApply: {
      name: "Group: apply a settings patch to a tag",
      description:
        "Raw form of the group operation — the patch is JSON matching that settings tab. Writes to every decoder carrying the tag.",
      options: [
        {
          id: "tag",
          type: "dropdown",
          label: "Tag",
          choices: tags,
          default: tags[0]?.id ?? "",
          allowCustom: true,
        },
        {
          id: "tab",
          type: "dropdown",
          label: "Settings tab",
          choices: [
            { id: "decode", label: "Decode" },
            { id: "network", label: "Network" },
            { id: "system", label: "System" },
          ],
          default: "decode",
        },
        {
          id: "patch",
          type: "textinput",
          label: "Patch JSON",
          default: '{"source_type":"NDI","selected_source":"STUDIO (CAM1)"}',
          useVariables: true,
          width: 12,
        },
      ],
      callback: async (event) =>
        run(async () => {
          const tag = await text(event, "tag");
          if (!tag) return;
          const patch = JSON.parse(await text(event, "patch"));
          await applyGroup(self, tag, event.options.tab, patch);
        }),
    },

    reboot: {
      name: "Reboot a decoder",
      description:
        "Does exactly what it says, to real hardware, with whatever is on its output.",
      options: [deviceOption],
      callback: async (event) =>
        run(async () => {
          const id = await text(event, "id");
          if (!id) return;
          await post(self, `/api/devices/${encodeURIComponent(id)}/reboot`, {});
        }),
    },

    listNdiSources: {
      name: "Log the NDI sources flock can see",
      description:
        "A lookup aid for filling in a source name — the decoder itself takes free text and has no picker.",
      options: [],
      callback: async () => {
        try {
          const body = await getJson(self, "/api/ndi/sources");
          self.log("info", `NDI sources: ${JSON.stringify(body)}`);
        } catch (e) {
          self.log("error", e.message);
        }
      },
    },

    scan: {
      name: "Scan the network for decoders",
      options: [],
      callback: async () => {
        try {
          const found = await getJson(self, "/api/discovery/scan");
          self.log("info", `Discovery scan: ${JSON.stringify(found)}`);
        } catch (e) {
          self.log("error", e.message);
        }
      },
    },

    pushDiscoveryServer: {
      name: "Push the NDI discovery server address to the decoders",
      options: [],
      callback: async () => {
        try {
          await post(self, "/api/settings/push-discovery-server", {});
        } catch (e) {
          self.log("error", e.message);
        }
      },
    },

    addDevice: {
      name: "Fleet: add a decoder",
      options: [
        {
          id: "name",
          type: "textinput",
          label: "Name",
          default: "",
          useVariables: true,
        },
        {
          id: "host",
          type: "textinput",
          label: "Host",
          default: "",
          useVariables: true,
        },
        {
          id: "tags",
          type: "textinput",
          label: "Tags (comma separated)",
          default: "",
          useVariables: true,
        },
      ],
      callback: async (event) =>
        run(async () => {
          const name = await text(event, "name");
          const host = await text(event, "host");
          if (!name || !host) return;
          const tags = (await text(event, "tags"))
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          await post(self, "/api/devices", { name, host, tags });
        }),
    },

    removeDevice: {
      name: "Fleet: remove a decoder",
      options: [deviceOption],
      callback: async (event) =>
        run(async () => {
          const id = await text(event, "id");
          if (!id) return;
          await del(self, `/api/devices/${encodeURIComponent(id)}`);
        }),
    },

    refresh: {
      name: "Refresh status now",
      description:
        "Polls every decoder immediately. Useful when the poll interval is set slow, or to 0.",
      options: [],
      callback: async () => self.pollStatus(),
    },
  });
}
