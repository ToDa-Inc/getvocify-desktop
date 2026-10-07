import { BrowserWindow, desktopCapturer, ipcMain, session, type IpcMainEvent } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The call's audio on Windows: everything the PC plays, captured by Electron's loopback source in a hidden window
 * and delivered as mono 16 kHz signed 16-bit little-endian PCM in exact 3200-byte (100 ms) chunks.
 * Electron 33 supports `audio: 'loopback'` on Windows only; elsewhere `start()` reports `unsupported_platform`.
 */

const FRAME_BYTES = 3200;
const here = dirname(fileURLToPath(import.meta.url));

export type LoopbackOptions = {
  /** Test only: a sine tone replaces the PC's audio so the whole pipeline runs on any OS. Never read from the environment. */
  testSource?: boolean;
};

export type Loopback = {
  start(): Promise<{ ok: boolean; reason?: string }>;
  stop(): Promise<void>;
  onPcm(cb: (pcm: ArrayBuffer) => void): () => void;
  onLost(cb: (reason: string) => void): () => void;
};

export function createLoopback(options: LoopbackOptions = {}): Loopback {
  const pcmListeners = new Set<(pcm: ArrayBuffer) => void>();
  const lostListeners = new Set<(reason: string) => void>();
  let window: BrowserWindow | null = null;
  let partition: string | null = null;
  let running = false;
  // A deliberate stop is not "the call's audio was lost".
  let stopping = false;

  const notify = <T>(listeners: Set<(value: T) => void>, value: T, what: string) => {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch (error) {
        console.error(`loopback ${what} listener failed:`, error);
      }
    }
  };

  const fromOurPage = (event: IpcMainEvent): boolean => window !== null && !window.isDestroyed() && event.sender === window.webContents;

  const onFrame = (event: IpcMainEvent, data: unknown) => {
    if (!fromOurPage(event)) return;
    const bytes = data instanceof ArrayBuffer ? data : ArrayBuffer.isView(data) ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer) : null;
    if (bytes && bytes.byteLength === FRAME_BYTES) notify(pcmListeners, bytes, "pcm");
  };

  const onEnded = (event: IpcMainEvent, reason: unknown) => {
    if (!fromOurPage(event) || stopping) return;
    lose(typeof reason === "string" && reason ? reason : "stream_ended");
  };

  /** The audio ended on its own: say so once, then release everything. */
  function lose(reason: string): void {
    if (!running) return;
    notify(lostListeners, reason, "lost");
    release();
  }

  function release(): void {
    ipcMain.off("loopback:frame", onFrame);
    ipcMain.off("loopback:ended", onEnded);
    const closing = window;
    window = null;
    running = false;
    if (partition) session.fromPartition(partition).setDisplayMediaRequestHandler(null);
    partition = null;
    if (closing && !closing.isDestroyed()) closing.destroy();
  }

  async function start(): Promise<{ ok: boolean; reason?: string }> {
    if (running) return { ok: false, reason: "already_running" };
    if (process.platform !== "win32" && !options.testSource) return { ok: false, reason: "unsupported_platform" };
    running = true;
    stopping = false;
    try {
      // Its own in-memory session, so this never touches the dashboard's cookies or permissions.
      partition = `loopback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const own = session.fromPartition(partition);
      own.setDisplayMediaRequestHandler(async (_request, callback) => {
        const screens = await desktopCapturer.getSources({ types: ["screen"] });
        const video = screens[0];
        // getDisplayMedia needs a video source even though only the audio is used.
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
          backgroundThrottling: false,
        },
      });
      window.webContents.on("render-process-gone", () => lose("renderer_gone"));
      await window.loadFile(join(here, "loopback-page.html"));
      // `true` runs it as a user gesture, which getDisplayMedia requires.
      await window.webContents.executeJavaScript(`window.__vocifyLoopback.start(${JSON.stringify({ test: options.testSource === true })})`, true);
      return { ok: true };
    } catch (error) {
      release();
      return { ok: false, reason: error instanceof Error && error.name ? `capture_failed:${error.name}` : "capture_failed" };
    }
  }

  async function stop(): Promise<void> {
    stopping = true;
    const page = window;
    if (page && !page.isDestroyed()) await page.webContents.executeJavaScript("window.__vocifyLoopback.stop()").catch(() => {});
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
    },
  };
}
