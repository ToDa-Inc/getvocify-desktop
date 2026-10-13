// Sandboxed preload for the hidden call-audio window: only `electron` may be required.
// The page is in the main world, so the bridge must go through contextBridge.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("loopbackHost", {
  frame(buffer: ArrayBuffer): void {
    ipcRenderer.send("loopback:frame", buffer);
  },
  /** A microphone frame and the call's frame cut from the same audio blocks. */
  pair(mic: ArrayBuffer, call: ArrayBuffer): void {
    ipcRenderer.send("loopback:pair", mic, call);
  },
  ended(reason: string): void {
    ipcRenderer.send("loopback:ended", reason);
  },
});
