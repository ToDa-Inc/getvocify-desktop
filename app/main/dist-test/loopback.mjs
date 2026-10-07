// main/src/loopback/loopback.ts
import { BrowserWindow, desktopCapturer, ipcMain, session } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var FRAME_BYTES = 3200;
var here = dirname(fileURLToPath(import.meta.url));
function createLoopback(options = {}) {
  const pcmListeners = /* @__PURE__ */ new Set();
  const lostListeners = /* @__PURE__ */ new Set();
  let window = null;
  let partition = null;
  let running = false;
  let stopping = false;
  const notify = (listeners, value, what) => {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch (error) {
        console.error(`loopback ${what} listener failed:`, error);
      }
    }
  };
  const fromOurPage = (event) => window !== null && !window.isDestroyed() && event.sender === window.webContents;
  const onFrame = (event, data) => {
    if (!fromOurPage(event)) return;
    const bytes = data instanceof ArrayBuffer ? data : ArrayBuffer.isView(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null;
    if (bytes && bytes.byteLength === FRAME_BYTES) notify(pcmListeners, bytes, "pcm");
  };
  const onEnded = (event, reason) => {
    if (!fromOurPage(event) || stopping) return;
    lose(typeof reason === "string" && reason ? reason : "stream_ended");
  };
  function lose(reason) {
    if (!running) return;
    notify(lostListeners, reason, "lost");
    release();
  }
  function release() {
    ipcMain.off("loopback:frame", onFrame);
    ipcMain.off("loopback:ended", onEnded);
    const closing = window;
    window = null;
    running = false;
    if (partition) session.fromPartition(partition).setDisplayMediaRequestHandler(null);
    partition = null;
    if (closing && !closing.isDestroyed()) closing.destroy();
  }
  async function start() {
    if (running) return { ok: false, reason: "already_running" };
    if (process.platform !== "win32" && !options.testSource) return { ok: false, reason: "unsupported_platform" };
    running = true;
    stopping = false;
    try {
      partition = `loopback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const own = session.fromPartition(partition);
      own.setDisplayMediaRequestHandler(async (_request, callback) => {
        const screens = await desktopCapturer.getSources({ types: ["screen"] });
        const video = screens[0];
        if (video) callback({ video, audio: "loopback" });
        else callback({});
      });
      ipcMain.on("loopback:frame", onFrame);
      ipcMain.on("loopback:ended", onEnded);
      window = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: join(here, "loopback-preload.cjs"),
          session: own,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          // A hidden window must keep capturing while the user works in the call.
          backgroundThrottling: false
        }
      });
      window.webContents.on("render-process-gone", () => lose("renderer_gone"));
      await window.loadFile(join(here, "loopback-page.html"));
      await window.webContents.executeJavaScript(`window.__vocifyLoopback.start(${JSON.stringify({ test: options.testSource === true })})`, true);
      return { ok: true };
    } catch (error) {
      release();
      return { ok: false, reason: error instanceof Error && error.name ? `capture_failed:${error.name}` : "capture_failed" };
    }
  }
  async function stop() {
    stopping = true;
    const page = window;
    if (page && !page.isDestroyed()) await page.webContents.executeJavaScript("window.__vocifyLoopback.stop()").catch(() => {
    });
    release();
  }
  return {
    start,
    stop,
    onPcm(cb) {
      pcmListeners.add(cb);
      return () => void pcmListeners.delete(cb);
    },
    onLost(cb) {
      lostListeners.add(cb);
      return () => void lostListeners.delete(cb);
    }
  };
}
export {
  createLoopback
};
