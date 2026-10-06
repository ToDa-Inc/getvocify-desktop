import type { IslandController } from "./controller.ts";
import type { Drafts } from "./drafts.ts";
import type { Loopback } from "./loopback/loopback.ts";
import { APP_INFO, MAC_SYSTEM_AUDIO_SETTINGS_URL, microphoneSettingsUrl, permissionSnapshot } from "./permissions.ts";
import { saasRequest, type SaasResult } from "./saas.ts";
import type { KeyEvent, ShortcutManager } from "./shortcut.ts";

/**
 * What the dashboard can ask of the desktop shell: the operations behind `window.vocifyDesktop`, the same set as the
 * Mac app's DesktopBridge.swift minus the native recorder (the dashboard records in the page when `recorder` is absent).
 * Everything the shell touches is injected, so every operation is tested without Electron.
 */
export type BridgeDeps = {
  platform: NodeJS.Platform;
  /** The platform name the dashboard is told (see config.ts); defaults to the real one. */
  reportedPlatform?: "win32" | "darwin";
  /** Trying the permission flow: both permissions read "not asked" until the dashboard asks for each. */
  testPermissions?: boolean;
  controller: IslandController;
  loopback: Loopback;
  drafts: Drafts;
  shortcut: ShortcutManager;
  /** To the dashboard page (`__vocifyEmit`). */
  emit(channel: string, payload: unknown): void;
  showMainWindow(): void;
  /** Electron's `getMediaAccessStatus('microphone')`. */
  microphoneAccess(): string;
  /** macOS only: shows the system's microphone prompt (once; a refusal can only be undone in System Settings). */
  askMicrophone?(): Promise<boolean>;
  openExternal(url: string): void;
  /** Quits and reopens this app (a permission that applies only after a restart). */
  relaunch(): void;
  fetch(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; text(): Promise<string> }>;
  log(line: string): void;
  /** A draft was saved or removed: the dashboard page may now be needed, or no longer. */
  onDraftsChanged?(): void;
  /** Mac: may Vocify read the CRM tab (Automation consent), as the watcher last found it. Absent where it cannot be read. */
  crmTabs?(): string;
  /** Mac: reads each running supported browser once, which makes macOS ask for Automation consent. */
  askCrmTabs?(): Promise<void>;
  /** The CRM links open in the rep's browsers (Windows: read from the address bars). Absent where it cannot be read. */
  readCrmPages?(): Promise<{ urls: string[]; browsers: { name: string; bundleId: string; access: string }[] }>;
};

type Args = Record<string, unknown>;
/** 100 ms of silence at 16 kHz mono 16-bit: the call side where it cannot be captured (see `startSystemAudio`). */
const SILENT_FRAME_BYTES = 3200;
const OPEN_URL = /^(https?:\/\/|mailto:)/i;
const MAC_AUTOMATION_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";

export function createBridge(deps: BridgeDeps): (op: string, args: Args) => Promise<unknown> {
  /** The last session state the dashboard reported (undefined until it first does), so the log shows it once per change. */
  let reportedReady: boolean | undefined;
  let unsubscribePcm: (() => void) | null = null;
  let unsubscribeLost: (() => void) | null = null;
  let silence: ReturnType<typeof setInterval> | null = null;

  const stopListening = () => {
    unsubscribePcm?.();
    unsubscribeLost?.();
    unsubscribePcm = null;
    unsubscribeLost = null;
    if (silence) clearInterval(silence);
    silence = null;
  };

  async function startSystemAudio(): Promise<unknown> {
    stopListening();
    await deps.loopback.stop();
    unsubscribePcm = deps.loopback.onPcm((pcm) => deps.emit("system-audio:pcm", pcm));
    unsubscribeLost = deps.loopback.onLost((reason) => deps.emit("system-audio:lost", { reason }));
    const started = await deps.loopback.start();
    if (started.ok) return { ok: true, backend: "wasapi-loopback" };
    stopListening();
    // Where call audio cannot be captured (not Windows) the recording carries on with the microphone alone.
    // The call side then sends silence, as a quiet call would: a transcription stream that gets no audio at all for
    // that side is closed by the provider after its timeout (Deepgram's 1011 "did not receive audio data").
    if (started.reason === "unsupported_platform") {
      silence = setInterval(() => deps.emit("system-audio:pcm", new ArrayBuffer(SILENT_FRAME_BYTES)), 100);
      return { ok: true, backend: "none" };
    }
    return { ok: false, reason: started.reason ?? "no_system_audio" };
  }

  /** In the permission test, the permissions the dashboard has asked for so far; the others read "not asked". */
  const asked = new Set<string>();
  const permissions = () => {
    // Windows reads the address bars without asking; a Mac needs the rep's Automation consent per browser.
    const crmTabs = deps.platform === "win32" ? "authorized" : deps.crmTabs?.();
    const real: Record<string, unknown> = { ...permissionSnapshot(deps.platform, deps.microphoneAccess(), deps.reportedPlatform), ...(crmTabs ? { crmTabs } : {}) };
    if (!deps.testPermissions) return real;
    return {
      ...real,
      microphone: asked.has("microphone") ? real.microphone : "never_requested",
      systemAudio: asked.has("systemAudio") ? real.systemAudio : "never_requested",
    };
  };

  return async (op, args) => {
    switch (op) {
      case "log:error":
        deps.log(`dashboard ${String(args.kind ?? "error")} at ${String(args.path ?? "")}: ${String(args.text ?? "")}`);
        return null;
      case "saas:request": {
        const result: SaasResult = await saasRequest(args.payload, deps.fetch);
        return result;
      }
      case "system-audio:start":
        return startSystemAudio();
      case "system-audio:stop":
        stopListening();
        await deps.loopback.stop();
        return { ok: true };
      case "shortcut:get":
        return deps.shortcut.state();
      case "shortcut:set":
        return deps.shortcut.set({
          code: String(args.code ?? ""),
          meta: args.meta === true,
          alt: args.alt === true,
          ctrl: args.ctrl === true,
          shift: args.shift === true,
        } satisfies KeyEvent);
      case "shortcut:clear":
        return deps.shortcut.clear();
      case "permissions:status":
        return permissions();
      case "permissions:request":
        if (deps.testPermissions && typeof args.type === "string" && !asked.has(args.type)) {
          deps.log(`permission test: the dashboard asked for ${args.type}`);
          asked.add(args.type);
          // Shows the step a rep without the permission goes through: the system's own settings page for it.
          if (args.type === "microphone") deps.openExternal(microphoneSettingsUrl(deps.platform));
          else if (args.type === "systemAudio" && deps.platform === "darwin") deps.openExternal(MAC_SYSTEM_AUDIO_SETTINGS_URL);
        }
        if (args.type === "crmTabs") {
          await deps.askCrmTabs?.();
          return permissions();
        }
        if (args.type === "microphone") {
          const status = permissions().microphone;
          if (status !== "authorized") {
            // macOS asks once, in its own prompt; Windows has no prompt, so its one switch is in Settings.
            if (deps.askMicrophone && status === "never_requested") await deps.askMicrophone();
            else deps.openExternal(microphoneSettingsUrl(deps.platform));
          }
        }
        return permissions();
      case "permissions:open":
      case "permissions:guide":
        if (args.type === "microphone") deps.openExternal(microphoneSettingsUrl(deps.platform));
        return permissions();
      case "permissions:appInfo":
        return APP_INFO;
      case "shell:state":
        if (typeof args.state === "object" && args.state !== null) {
          const state = args.state as Args;
          // Whether the dashboard says a session exists is the one fact the island's Record button depends on.
          if (typeof state.recorderReady === "boolean" && state.recorderReady !== reportedReady) {
            reportedReady = state.recorderReady;
            deps.log(`dashboard says signed ${state.recorderReady ? "in" : "out"}`);
          }
          deps.controller.applyShellState(state);
        }
        return null;
      case "shell:relaunch":
        deps.relaunch();
        return { ok: true };
      case "shell:open-external":
        if (typeof args.url === "string" && OPEN_URL.test(args.url)) deps.openExternal(args.url);
        return { ok: true };
      case "shell:command": {
        const name = String(args.name ?? "");
        if (name === "show") deps.showMainWindow();
        else deps.emit("shell:command", name);
        return null;
      }
      case "drafts:save": {
        const ok = deps.drafts.save(args.draft);
        deps.onDraftsChanged?.();
        return { ok };
      }
      case "drafts:list":
        return deps.drafts.list();
      case "drafts:remove":
        deps.drafts.remove(args.id);
        deps.onDraftsChanged?.();
        return { ok: true };
      case "overlay:show":
        deps.controller.show();
        return { ok: true };
      case "overlay:hide":
        deps.controller.hide();
        return { ok: true };
      case "crm:pages":
        // Only CRM links leave the machine; where the pages cannot be read, none are known.
        return deps.readCrmPages ? deps.readCrmPages() : { urls: [], browsers: [] };
      case "crm:open-automation-settings":
        if (deps.platform === "darwin") deps.openExternal(MAC_AUTOMATION_SETTINGS_URL);
        return { ok: true };
      default:
        return null;
    }
  };
}
