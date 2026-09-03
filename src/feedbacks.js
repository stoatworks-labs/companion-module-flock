import { deviceChoices, tagChoices } from "./actions.js";
import { socket } from "./api.js";

// Note the asymmetry with the other modules in this fleet: here a decoder that
// fails to answer is marked OFFLINE rather than keeping its last known value.
// "Offline" is real information about a real box, not a gap in the module's
// knowledge — a decoder showing green while unplugged is exactly the failure
// this poll exists to catch. The `connected` feedback still covers the case
// where flock itself is unreachable and the module knows nothing at all.

export default function UpdateFeedbacks(self) {
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

  self.setFeedbackDefinitions({
    online: {
      type: "boolean",
      name: "Decoder is online",
      defaultStyle: { bgcolor: 0x003300, color: 0x00ff00 },
      options: [deviceOption],
      callback: (f) => !!self.status[String(f.options.id ?? "")]?.online,
    },

    playingSource: {
      type: "boolean",
      name: "Decoder is playing a specific source",
      description:
        "The decode tally. Compared against the NDI source name, or the SRT stream name / endpoint when the decoder is in SRT mode.",
      defaultStyle: { bgcolor: 0xcc0000, color: 0xffffff },
      options: [
        deviceOption,
        {
          id: "source",
          type: "textinput",
          label: "Source",
          default: "",
          useVariables: true,
        },
      ],
      callback: (f) => {
        const wanted = String(f.options.source ?? "").trim();
        if (!wanted) return false;
        return self.playing(String(f.options.id ?? "")) === wanted;
      },
    },

    sourceType: {
      type: "boolean",
      name: "Decoder is in NDI or SRT mode",
      defaultStyle: { bgcolor: 0x0066cc, color: 0xffffff },
      options: [
        deviceOption,
        {
          id: "type",
          type: "dropdown",
          label: "Mode",
          choices: [
            { id: "NDI", label: "NDI" },
            { id: "SRT", label: "SRT" },
          ],
          default: "NDI",
        },
      ],
      callback: (f) =>
        self.decode[String(f.options.id ?? "")]?.source_type === f.options.type,
    },

    noVideo: {
      type: "boolean",
      name: "Decoder is online but has no picture",
      description:
        "Online with no resolution reported — the box is up and the source is not arriving. This is the state an operator most wants a light for, and it is invisible from 'is it online'.",
      defaultStyle: { bgcolor: 0xcc0000, color: 0xffffff },
      options: [deviceOption],
      callback: (f) => {
        const s = self.status[String(f.options.id ?? "")];
        if (!s?.online) return false;
        const res = String(s.video_resolution ?? "").trim();
        return res === "" || res === "0x0" || res.toLowerCase() === "none";
      },
    },

    bitrateBelow: {
      type: "boolean",
      name: "Decoder's bitrate is below a threshold",
      description:
        "For catching a feed that is technically arriving but starved. Reported in Mbps.",
      defaultStyle: { bgcolor: 0xcc7a00, color: 0x000000 },
      options: [
        deviceOption,
        {
          id: "mbps",
          type: "number",
          label: "Below (Mbps)",
          min: 0,
          max: 1000,
          default: 1,
        },
      ],
      callback: (f) => {
        const s = self.status[String(f.options.id ?? "")];
        if (!s?.online) return false;
        return (
          (Number(s.average_bitrate_mbps) || 0) < Number(f.options.mbps ?? 1)
        );
      },
    },

    resolutionIs: {
      type: "boolean",
      name: "Decoder is at a specific resolution",
      defaultStyle: { bgcolor: 0x003300, color: 0x00ff00 },
      options: [
        deviceOption,
        {
          id: "resolution",
          type: "textinput",
          label: "Resolution",
          default: "1920x1080",
          useVariables: true,
        },
      ],
      callback: (f) => {
        const wanted = String(f.options.resolution ?? "").trim();
        return (
          !!wanted &&
          self.status[String(f.options.id ?? "")]?.video_resolution === wanted
        );
      },
    },

    groupAllOnline: {
      type: "boolean",
      name: "Every decoder with a tag is online",
      description:
        "The pre-show check for a whole group. False when the group is empty — an empty group being 'all online' would be a green light for nothing.",
      defaultStyle: { bgcolor: 0x003300, color: 0x00ff00 },
      options: [
        {
          id: "tag",
          type: "dropdown",
          label: "Tag",
          choices: tags,
          default: tags[0]?.id ?? "",
          allowCustom: true,
        },
      ],
      callback: (f) => {
        const members = self.groups?.[String(f.options.tag ?? "")] ?? [];
        return (
          members.length > 0 && members.every((id) => self.status[id]?.online)
        );
      },
    },

    groupAllPlaying: {
      type: "boolean",
      name: "Every decoder with a tag is playing the same source",
      description:
        "Confirms a group take actually landed everywhere, rather than on most of them.",
      defaultStyle: { bgcolor: 0x003300, color: 0x00ff00 },
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
          label: "Source",
          default: "",
          useVariables: true,
        },
      ],
      callback: (f) => {
        const wanted = String(f.options.source ?? "").trim();
        const members = self.groups?.[String(f.options.tag ?? "")] ?? [];
        if (!wanted || members.length === 0) return false;
        return members.every((id) => self.playing(id) === wanted);
      },
    },

    fleetAllOnline: {
      type: "boolean",
      name: "Every decoder is online",
      defaultStyle: { bgcolor: 0x003300, color: 0x00ff00 },
      options: [],
      callback: () =>
        self.devices.length > 0 &&
        self.devices.every((d) => self.status[d.id]?.online),
    },

    connected: {
      type: "boolean",
      name: "flock is connected",
      description:
        "The registry WebSocket is open. While this is dark the module knows nothing at all — including whether the decoders are up.",
      defaultStyle: { bgcolor: 0x003300, color: 0x00ff00 },
      options: [],
      callback: () => !!socket.ws && socket.ws.readyState === 1,
    },
  });
}
