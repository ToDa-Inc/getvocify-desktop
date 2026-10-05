import type { IslandState } from "../../island/src/types.ts";

export type TrayItem = { id: "open" | "record" | "stop" | "quit"; label: string; enabled: boolean } | { id: "separator" };

/** The tray menu for the island's current state: Record when it can, Stop while recording, never both. */
export function trayItems(state: Pick<IslandState, "mode" | "recorderReady">): TrayItem[] {
  const kind = state.mode.kind;
  const recording = kind === "recording" || kind === "stopped";
  const canRecord = state.recorderReady && (kind === "idle" || kind === "call" || kind === "postCall");
  return [
    { id: "open", label: "Open Vocify", enabled: true },
    { id: "separator" },
    recording ? { id: "stop", label: "Stop recording", enabled: kind === "recording" } : { id: "record", label: "Record meeting", enabled: canRecord },
    { id: "separator" },
    { id: "quit", label: "Quit Vocify", enabled: true },
  ];
}
