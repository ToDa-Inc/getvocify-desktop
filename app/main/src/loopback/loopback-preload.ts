// Sandboxed preload for the hidden call-audio window: only `electron` may be required.
// The page is in the main world, so the bridge must go through contextBridge.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("loopbackHost", {
  frame(buffer: ArrayBuffer): void {
    ipcRenderer.send("loopback:frame", buffer);
  },
  ended(reason: string): void {
    ipcRenderer.send("loopback:ended", reason);
  },
});
