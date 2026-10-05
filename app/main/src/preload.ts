import { contextBridge, ipcRenderer } from "electron";
import type { IslandAction, IslandState } from "../../island/src/types.ts";

contextBridge.exposeInMainWorld("vocifyIsland", {
  onState(callback: (state: IslandState) => void) {
    const handler = (_event: unknown, state: IslandState) => callback(state);
    ipcRenderer.on("island:state", handler);
    return () => ipcRenderer.removeListener("island:state", handler);
  },
  act(action: IslandAction) {
    ipcRenderer.send("island:act", action);
  },
});
