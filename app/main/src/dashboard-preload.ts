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

// Dev only (the app run from source): the page's raw audio of a recording, per side, kept to replay real calls offline.
const devTrace = process.argv.includes("--vocify-dev-trace")
  ? { audio: (side: string, pcm: ArrayBuffer, at: number, recording: number) => ipcRenderer.send("vocify:trace-audio", side, pcm, at, recording) }
  : undefined;

contextBridge.exposeInMainWorld("vocifyDesktop", {
  platform,
  ...(devTrace ? { devTrace } : {}),
  // The microphone the app captures with the call, when `systemAudio.start({ mic: true })` answered `mic: true`.
  nativeMic: { onPcm: on("native-mic:pcm") },
  systemAudio: {
    start: (options?: { mic?: boolean }) => call("system-audio:start", { mic: options?.mic === true }),
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
    relaunch: () => call("shell:relaunch"),
    command: (name: string) => void call("shell:command", { name }),
    onCommand: on("shell:command"),
    /** Dashboard events for the app's log (a call's steps); fire and forget. */
    log: (name: string, details?: Record<string, unknown>) => void call("log:event", { name, details: details ?? {} }),
    onCallType: on("call:type"),
    // Types by channel: the channel the rep switched to in the island ({ kind: "call" | "meeting" }).
    onCallChannel: on("call:channel"),
    onPostCallAction: on("postcall:action"),
    // The live call assistant's asks and marks from the island ({ type: "responder" | "preguntar" | "resumen" | "tick" | "untick" | "dismiss" | "tab", ... }).
    onLiveAction: on("livebrain:action"),
  },
  // Where the live call island sits during a recording ({ placement: "notch" | "side" }).
  island: {
    get: () => call("island:get"),
    setPlacement: (placement: "notch" | "side") => call("island:setPlacement", { placement }),
  },
  // Vocify calling on this computer: off, the island's Call opens on the rep's phone ({ onPhone, phoneApp }).
  calling: {
    get: () => call("calling:get"),
    set: (onPhone: boolean) => call("calling:set", { onPhone }),
    dialOnPhone: (number: string) => call("calling:phone", { number }),
    setup: () => call("calling:setup"),
    micSettings: () => call("calling:mic-settings"),
  },
  // The mic the rep picked in the island or the app's menu ({ id, label }, or null for the system's default).
  microphones: { onChoose: on("mic:choose") },
  saas: { request: (payload: Record<string, unknown>) => call("saas:request", { payload }) },
  crm: {
    pages: (options: Record<string, unknown> = {}) => call("crm:pages", options),
    openAutomationSettings: () => call("crm:open-automation-settings"),
    // The CRM pages in the frontmost browser changed: { urls } ([] = no record any more).
    onScreen: on("crm:screen"),
    onCallPages: on("call:pages"),
    onCallEnded: on("call:ended"),
    onCallSource: on("call:source"),
  },
  // Who the meeting app shows speaking while a call is recorded: { names } (Mac: Zoom, and Meet through the extension).
  speakers: { onSpeaking: on("meeting:speakers") },
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
