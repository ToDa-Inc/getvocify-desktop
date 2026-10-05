"use strict";

// main/src/loopback/loopback-preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("loopbackHost", {
  frame(buffer) {
    import_electron.ipcRenderer.send("loopback:frame", buffer);
  },
  ended(reason) {
    import_electron.ipcRenderer.send("loopback:ended", reason);
  }
});
