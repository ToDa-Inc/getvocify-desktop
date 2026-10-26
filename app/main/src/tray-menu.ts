import type { IslandState, MicDevice, MicView } from "../../island/src/types.ts";

export type TrayItem = { id: "about" | "open" | "microphone" | "permissions" | "record" | "stop" | "update" | "quit"; label: string; enabled: boolean } | { id: "separator" };

/** The tray menu for the island's current state: Record when it can, Stop while recording, never both. */
export function trayItems(state: Pick<IslandState, "mode" | "recorderReady">, about: string, microphone: string): TrayItem[] {
  const kind = state.mode.kind;
  const recording = kind === "recording" || kind === "stopped";
  const canRecord = state.recorderReady && (kind === "idle" || kind === "call" || kind === "postCall");
  return [
    // Which build and which dashboard this is: the first thing to know when something looks out of date.
    { id: "about", label: about, enabled: false },
    { id: "separator" },
    { id: "open", label: "Open Vocify", enabled: true },
    { id: "separator" },
    // Whether the app may use the microphone, and the one place to change it.
    { id: "microphone", label: `Microphone: ${microphone}`, enabled: false },
    { id: "permissions", label: "Microphone settings…", enabled: true },
    { id: "separator" },
    recording ? { id: "stop", label: "Stop recording", enabled: kind === "recording" } : { id: "record", label: "Record", enabled: canRecord },
    { id: "separator" },
    { id: "update", label: "Check for updates", enabled: true },
    { id: "quit", label: "Quit Vocify", enabled: true },
  ];
}

/** One row of the menu's Microphone list: picking it sends `mic` (null: the system's default). */
export type MicChoiceItem = { label: string; checked: boolean; enabled: boolean; mic: MicDevice | null } | { separator: true };

/** The Microphone list, as the island's card lists it: the system's default, every mic, and the picked one while it is
 * not connected. Empty until the dashboard has named the mics (then the menu keeps its "Microphone: …" line). */
export function micChoices(mic: MicView | null | undefined): MicChoiceItem[] {
  if (!mic || mic.devices.length === 0) return [];
  const chosen = mic.chosen;
  const missing = chosen && !mic.devices.some((d) => d.id === chosen.id || d.label === chosen.label) ? chosen : null;
  return [
    { label: mic.defaultLabel ? `System default (${mic.defaultLabel})` : "System default", checked: chosen === null, enabled: true, mic: null },
    { separator: true },
    ...mic.devices.map((d) => ({ label: d.label, checked: chosen?.id === d.id, enabled: true, mic: d })),
    ...(missing ? [{ label: `${missing.label} (not connected)`, checked: true, enabled: false, mic: missing }] : []),
  ];
}
