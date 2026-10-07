import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("demo", {
  send(name: string) {
    ipcRenderer.send("demo:cmd", name);
  },
  onLog(callback: (line: string) => void) {
    ipcRenderer.on("demo:log", (_event, line: string) => callback(line));
  },
});
