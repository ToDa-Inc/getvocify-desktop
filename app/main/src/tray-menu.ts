import type { IslandState } from "../../island/src/types.ts";

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
    recording ? { id: "stop", label: "Stop recording", enabled: kind === "recording" } : { id: "record", label: "Record meeting", enabled: canRecord },
    { id: "separator" },
    { id: "update", label: "Check for updates", enabled: true },
    { id: "quit", label: "Quit Vocify", enabled: true },
  ];
}
