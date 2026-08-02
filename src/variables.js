import { safeId } from "./main.js";

// Rebuilt only when the registry's shape changes (which decoders exist and
// their tags) — main.js's applyRegistry compares that rather than whole state,
// because flock re-pushes the registry every 750 ms.
export default function UpdateVariableDefinitions(self) {
  const defs = {
    connection_status: { name: "flock connection status" },
    device_count: { name: "Decoders in the fleet" },
    online_count: { name: "Decoders online" },
    group_count: { name: "Tag groups" },
  };
  for (const d of self.devices) {
    const p = `${safeId(d.id)}_`;
    const n = d.name ?? d.id;
    defs[`${p}name`] = { name: `${n}: name` };
    defs[`${p}host`] = { name: `${n}: host` };
    defs[`${p}online`] = { name: `${n}: online` };
    defs[`${p}playing`] = { name: `${n}: source being played` };
    defs[`${p}source_type`] = { name: `${n}: source type (NDI/SRT)` };
    defs[`${p}resolution`] = { name: `${n}: video resolution` };
    defs[`${p}frame_rate`] = { name: `${n}: frame rate` };
    defs[`${p}bitrate`] = { name: `${n}: average bitrate (Mbps)` };
    defs[`${p}firmware`] = { name: `${n}: firmware version` };
    defs[`${p}tags`] = { name: `${n}: tags` };
  }
  self.setVariableDefinitions(defs);
}
