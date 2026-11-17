import { contextBridge, ipcRenderer } from "electron";
import type { IslandAction, IslandState, Levels, Turn } from "../../island/src/types.ts";
import type { PillSpot } from "../../core/pill.ts";

// Answers the app's health check from the page's own thread: a page that is hung cannot (see `reloadIsland`).
ipcRenderer.on("island:ping", () => ipcRenderer.send("island:pong"));

/**
 * The turns the island keeps. The shell sends what changed (the turns from `turnsFrom` on); the rest of the list stays as
 * it was, so the turns that did not change are the same objects and the island does not draw them again.
 */
let turns: Turn[] = [];
ipcRenderer.on("island:turns", (_event, change: { turnsFrom: number; turns: Turn[] }) => {
  turns = [...turns.slice(0, change.turnsFrom), ...change.turns];
});

/** The small lists the island is sent whole with each state: an unchanged one keeps its object (the rows that use it). */
const kept = new Map<string, { json: string; value: unknown }>();
function stable<T>(name: string, value: T): T {
  const json = JSON.stringify(value) ?? "";
  const before = kept.get(name);
  if (before && before.json === json) return before.value as T;
  kept.set(name, { json, value });
  return value;
}

contextBridge.exposeInMainWorld("vocifyIsland", {
  platform: process.platform,
  onState(callback: (state: IslandState) => void) {
    const handler = (_event: unknown, state: Omit<IslandState, "turns">) =>
      callback({ ...state, turns, voices: stable("voices", state.voices), people: stable("people", state.people) } as IslandState);
    ipcRenderer.on("island:state", handler);
    ipcRenderer.send("island:ready");
    return () => ipcRenderer.removeListener("island:state", handler);
  },
  onLevels(callback: (levels: Levels) => void) {
    const handler = (_event: unknown, levels: Levels) => callback(levels);
    ipcRenderer.on("island:levels", handler);
    return () => ipcRenderer.removeListener("island:levels", handler);
  },
  resize(size: { width: number; height: number }) {
    ipcRenderer.send("island:resize", size);
  },
  act(action: IslandAction) {
    ipcRenderer.send("island:act", action);
  },
  /** As a pill, the window covers the screen and lets clicks through to the apps under it except where the pill and its
   * panel are: the page says when the pointer is over them. */
  interactive(on: boolean) {
    ipcRenderer.send("island:interactive", on);
  },
  pillDrag(screenX: number, screenY: number) {
    ipcRenderer.send("island:pill-drag", screenX, screenY);
  },
  pillDrop(spot: PillSpot) {
    ipcRenderer.send("island:pill-drop", spot);
  },
  sideHits(hits: { boxes: { x: number; y: number; width: number; height: number }[]; hold: boolean }) {
    ipcRenderer.send("island:side-hits", hits);
  },
  copy(text: string): Promise<boolean> {
    return ipcRenderer.invoke("island:copy", text);
  },
  /** See `IslandHost.keyboard`. Resolves once the window can take the keys. */
  keyboard(mode: "available" | "over" | "now" | "release" | "off") {
    return ipcRenderer.invoke("island:keyboard", mode);
  },
});
