import { contextBridge, ipcRenderer } from "electron";
import type { IslandAction, IslandState, Levels } from "../../island/src/types.ts";
import type { PillSpot } from "../../core/pill.ts";

// Answers the app's health check from the page's own thread: a page that is hung cannot (see `reloadIsland`).
ipcRenderer.on("island:ping", () => ipcRenderer.send("island:pong"));

contextBridge.exposeInMainWorld("vocifyIsland", {
  platform: process.platform,
  onState(callback: (state: IslandState) => void) {
    const handler = (_event: unknown, state: IslandState) => callback(state);
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
  copy(text: string): Promise<boolean> {
    return ipcRenderer.invoke("island:copy", text);
  },
  /** See `IslandHost.keyboard`. Resolves once the window can take the keys. */
  keyboard(mode: "available" | "over" | "now" | "release" | "off") {
    return ipcRenderer.invoke("island:keyboard", mode);
  },
});
