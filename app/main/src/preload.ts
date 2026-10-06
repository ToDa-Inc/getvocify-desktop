import { contextBridge, ipcRenderer } from "electron";
import type { IslandAction, IslandState, Levels } from "../../island/src/types.ts";

contextBridge.exposeInMainWorld("vocifyIsland", {
  platform: process.platform,
  onState(callback: (state: IslandState) => void) {
    const handler = (_event: unknown, state: IslandState) => callback(state);
    ipcRenderer.on("island:state", handler);
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
  /** See `IslandHost.keyboard`. Resolves once the window can take the keys. */
  keyboard(mode: "available" | "over" | "release" | "off") {
    return ipcRenderer.invoke("island:keyboard", mode);
  },
});
