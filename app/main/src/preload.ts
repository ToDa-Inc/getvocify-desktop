import { contextBridge, ipcRenderer } from "electron";
import type { IslandAction, IslandState, Levels } from "../../island/src/types.ts";

contextBridge.exposeInMainWorld("vocifyIsland", {
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
  act(action: IslandAction) {
    ipcRenderer.send("island:act", action);
  },
});
