// Preload of the dashboard window (sandboxed: only `electron` may be required). It builds `window.vocifyDesktop`, the
// object the dashboard talks to the desktop shell through (the same surface as the Mac app's bridge.js). Calls go to
// the main process; events come back on one channel and are handed to whoever subscribed.
import { contextBridge, ipcRenderer } from "electron";

type Listener = (payload: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

const on = (channel: string) => (callback: Listener) => {
  const set = listeners.get(channel) ?? new Set<Listener>();
  listeners.set(channel, set);
  set.add(callback);
  return () => void set.delete(callback);
};

ipcRenderer.on("vocify:emit", (_event, channel: string, payload: unknown) => {
  for (const callback of listeners.get(channel) ?? []) callback(payload);
});

const call = (op: string, args: Record<string, unknown> = {}): Promise<unknown> => ipcRenderer.invoke("vocify", op, args);

// The platform name the dashboard is told is decided by the main process (config.ts) and passed as an argument.
const told = process.argv.find((a) => a.startsWith("--vocify-platform="))?.slice("--vocify-platform=".length);
const platform = told === "win32" || told === "darwin" ? told : process.platform === "win32" ? "win32" : "darwin";

contextBridge.exposeInMainWorld("vocifyDesktop", {
  platform,
  systemAudio: {
    start: () => call("system-audio:start"),
    stop: () => call("system-audio:stop"),
    onPcm: on("system-audio:pcm"),
    onLost: on("system-audio:lost"),
  },
  permissions: {
    status: () => call("permissions:status"),
    request: (type: string) => call("permissions:request", { type }),
    open: (type: string) => call("permissions:open", { type }),
    guide: (type: string) => call("permissions:guide", { type }),
    appInfo: () => call("permissions:appInfo"),
    onChanged: on("permissions:changed"),
  },
  shell: {
    // Levels arrive about ten times a second: fire and forget, no promise to resolve.
    setState: (state: Record<string, unknown>) => ipcRenderer.send("vocify:state", state),
    resize: (size: string) => call("shell:resize", { size }),
    showOverlay: () => call("overlay:show"),
    hideOverlay: () => call("overlay:hide"),
    openExternal: (url: string) => call("shell:open-external", { url }),
    command: (name: string) => void call("shell:command", { name }),
    onCommand: on("shell:command"),
    onCallType: on("call:type"),
    onPostCallAction: on("postcall:action"),
  },
  saas: { request: (payload: Record<string, unknown>) => call("saas:request", { payload }) },
  crm: {
    pages: (options: Record<string, unknown> = {}) => call("crm:pages", options),
    openAutomationSettings: () => call("crm:open-automation-settings"),
    onCallPages: on("call:pages"),
    onCallEnded: on("call:ended"),
    onCallSource: on("call:source"),
  },
  shortcut: {
    get: () => call("shortcut:get"),
    set: (combo: Record<string, unknown>) => call("shortcut:set", combo),
    clear: () => call("shortcut:clear"),
  },
  drafts: {
    save: (draft: object) => call("drafts:save", { draft }),
    list: () => call("drafts:list"),
    remove: (id: string) => call("drafts:remove", { id }),
  },
  // No `recorder` and no `capture`: without a native recorder the dashboard records in its own page, which is what
  // this shell relies on.
});
