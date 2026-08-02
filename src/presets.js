import { safeId } from "./main.js";

// Per-decoder and per-group presets are generated from the registry, because a
// fleet's decoders and tags are its configuration.
//
// The group presets are the ones worth reading twice: "every decoder with this
// tag is playing X" is a different and much more useful claim than "this
// decoder is playing X", because the whole point of a group take is that it
// landed everywhere rather than on most of them.

const WHITE = 0xffffff;
const BLACK = 0x000000;
const GREY = 0x333333;
const RED = 0xcc0000;
const AMBER = 0xcc7a00;
const DARKGREEN = 0x003300;
const BRIGHTGREEN = 0x00ff00;

function preset({
  name,
  text,
  size = "14",
  color = WHITE,
  bgcolor = GREY,
  actions = [],
  feedbacks = [],
}) {
  return {
    type: "simple",
    name,
    style: { text, size, color, bgcolor, show_topbar: false },
    steps: [{ down: actions, up: [] }],
    feedbacks,
  };
}

export default function UpdatePresets(self) {
  const presets = {};
  const structure = [];

  // --- Fleet ---------------------------------------------------------------
  presets.fleet_online = preset({
    name: "Whole fleet online (no action)",
    text: "FLEET\n$(flock:online_count)/$(flock:device_count)",
    bgcolor: RED,
    feedbacks: [
      {
        feedbackId: "fleetAllOnline",
        options: {},
        style: { bgcolor: DARKGREEN, color: BRIGHTGREEN },
      },
    ],
  });
  presets.connected = preset({
    name: "flock is connected",
    text: "FLOCK\n$(flock:connection_status)",
    bgcolor: RED,
    actions: [{ actionId: "refresh", options: {} }],
    feedbacks: [
      {
        feedbackId: "connected",
        options: {},
        style: { bgcolor: DARKGREEN, color: BRIGHTGREEN },
      },
    ],
  });
  presets.scan = preset({
    name: "Scan the network for decoders",
    text: "SCAN",
    actions: [{ actionId: "scan", options: {} }],
  });
  presets.list_sources = preset({
    name: "Log the NDI sources flock can see",
    text: "NDI\nLIST",
    actions: [{ actionId: "listNdiSources", options: {} }],
  });

  structure.push({
    id: "fleet",
    name: "Fleet",
    definitions: [
      {
        id: "fleet-main",
        type: "simple",
        name: "Fleet",
        presets: ["fleet_online", "connected", "scan", "list_sources"],
      },
    ],
    keywords: ["fleet", "birddog", "ndi"],
  });

  // --- Per decoder ---------------------------------------------------------
  for (const d of self.devices) {
    const id = d.id;
    const key = safeId(id);
    const label = d.name ?? id;
    const refs = [];
    const add = (suffix, def) => {
      presets[`${key}_${suffix}`] = def;
      refs.push(`${key}_${suffix}`);
    };

    add(
      "status",
      preset({
        name: `${label}: status (no action)`,
        text: `${label}\n$(flock:${key}_playing)\n$(flock:${key}_resolution)`,
        size: "14",
        bgcolor: RED,
        feedbacks: [
          {
            feedbackId: "online",
            options: { id },
            style: { bgcolor: DARKGREEN, color: BRIGHTGREEN },
          },
          // Ordered after `online` so it wins: online-but-blank is a worse
          // state than offline and must not be shown as healthy green.
          {
            feedbackId: "noVideo",
            options: { id },
            style: { bgcolor: RED, color: WHITE },
          },
        ],
      }),
    );

    add(
      "take",
      preset({
        name: `${label}: play an NDI source (edit the name)`,
        text: `${label}\nTAKE`,
        bgcolor: BLACK,
        actions: [
          {
            actionId: "setNdiSource",
            options: { id, source: "STUDIO (CAM1)" },
          },
        ],
        feedbacks: [
          {
            feedbackId: "playingSource",
            options: { id, source: "STUDIO (CAM1)" },
            style: { bgcolor: RED, color: WHITE },
          },
        ],
      }),
    );

    add(
      "bitrate",
      preset({
        name: `${label}: bitrate (no action)`,
        text: `${label}\n$(flock:${key}_bitrate)\nMbps`,
        bgcolor: BLACK,
        feedbacks: [
          {
            feedbackId: "bitrateBelow",
            options: { id, mbps: 1 },
            style: { bgcolor: AMBER, color: BLACK },
          },
        ],
      }),
    );

    add(
      "reboot",
      preset({
        name: `${label}: reboot`,
        text: `${label}\nREBOOT`,
        bgcolor: BLACK,
        actions: [{ actionId: "reboot", options: { id } }],
      }),
    );

    structure.push({
      id: `device-${key}`,
      name: label,
      description: d.host ? `BirdDog Play at ${d.host}` : "BirdDog Play",
      definitions: [
        {
          id: `device-${key}-main`,
          type: "simple",
          name: label,
          presets: refs,
        },
      ],
      keywords: ["decoder", label],
    });
  }

  // --- Per tag group -------------------------------------------------------
  const groupRefs = [];
  for (const tag of self.tags()) {
    const key = safeId(tag);
    presets[`group_${key}_online`] = preset({
      name: `${tag}: every decoder online (no action)`,
      text: `${tag}\nALL UP`,
      bgcolor: RED,
      feedbacks: [
        {
          feedbackId: "groupAllOnline",
          options: { tag },
          style: { bgcolor: DARKGREEN, color: BRIGHTGREEN },
        },
      ],
    });
    presets[`group_${key}_take`] = preset({
      name: `${tag}: take an NDI source to the whole group (edit the name)`,
      text: `${tag}\nGROUP\nTAKE`,
      bgcolor: BLACK,
      actions: [
        {
          actionId: "groupNdiSource",
          options: { tag, source: "STUDIO (CAM1)" },
        },
      ],
      // Green only when EVERY member landed on it — the point of a group take.
      feedbacks: [
        {
          feedbackId: "groupAllPlaying",
          options: { tag, source: "STUDIO (CAM1)" },
          style: { bgcolor: RED, color: WHITE },
        },
      ],
    });
    groupRefs.push(`group_${key}_online`, `group_${key}_take`);
  }

  if (groupRefs.length > 0) {
    structure.push({
      id: "groups",
      name: "Tag groups",
      description:
        "The fleet operation flock exists for. A group take writes to every decoder carrying the tag — the feedback goes red only when every member actually landed on it, not when most did.",
      definitions: [
        {
          id: "groups-main",
          type: "simple",
          name: "Groups",
          presets: groupRefs,
        },
      ],
      keywords: ["group", "tag", "batch"],
    });
  }

  self.setPresetDefinitions(structure, presets);
}
