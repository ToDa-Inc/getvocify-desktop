"use strict";

// main/src/loopback/loopback-preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("loopbackHost", {
  frame(buffer) {
    import_electron.ipcRenderer.send("loopback:frame", buffer);
  },
  /** A microphone frame and the call's frame cut from the same audio blocks. */
  pair(mic, call) {
    import_electron.ipcRenderer.send("loopback:pair", mic, call);
  },
  ended(reason) {
    import_electron.ipcRenderer.send("loopback:ended", reason);
  }
});
