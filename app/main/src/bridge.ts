import type { IslandController } from "./controller.ts";
import type { Drafts } from "./drafts.ts";
import type { Loopback } from "./loopback/loopback.ts";
import { APP_INFO, MICROPHONE_SETTINGS_URL, permissionSnapshot } from "./permissions.ts";
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
  controller: IslandController;
  loopback: Loopback;
  drafts: Drafts;
  shortcut: ShortcutManager;
  /** To the dashboard page (`__vocifyEmit`). */
  emit(channel: string, payload: unknown): void;
  showMainWindow(): void;
  /** Electron's `getMediaAccessStatus('microphone')`. */
  microphoneAccess(): string;
  openExternal(url: string): void;
  fetch(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; text(): Promise<string> }>;
  log(line: string): void;
  /** A draft was saved or removed: the dashboard page may now be needed, or no longer. */
  onDraftsChanged?(): void;
  /** The CRM links open in the rep's browsers (Windows: read from the address bars). Absent where it cannot be read. */
  readCrmPages?(): Promise<{ urls: string[]; browsers: { name: string; bundleId: string; access: string }[] }>;
};

type Args = Record<string, unknown>;
const OPEN_URL = /^(https?:\/\/|mailto:)/i;

export function createBridge(deps: BridgeDeps): (op: string, args: Args) => Promise<unknown> {
  let unsubscribePcm: (() => void) | null = null;
  let unsubscribeLost: (() => void) | null = null;

  const stopListening = () => {
    unsubscribePcm?.();
    unsubscribeLost?.();
    unsubscribePcm = null;
    unsubscribeLost = null;
  };

  async function startSystemAudio(): Promise<unknown> {
    stopListening();
    await deps.loopback.stop();
    unsubscribePcm = deps.loopback.onPcm((pcm) => deps.emit("system-audio:pcm", pcm));
    unsubscribeLost = deps.loopback.onLost((reason) => deps.emit("system-audio:lost", { reason }));
    const started = await deps.loopback.start();
    if (started.ok) return { ok: true, backend: "wasapi-loopback" };
    stopListening();
    return { ok: false, reason: started.reason ?? "no_system_audio" };
  }

  const permissions = () => permissionSnapshot(deps.platform, deps.microphoneAccess(), deps.reportedPlatform);

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
        // No prompt exists on Windows: if microphone access is off, the one place to turn it on is Settings.
        if (args.type === "microphone" && permissions().microphone !== "authorized") deps.openExternal(MICROPHONE_SETTINGS_URL);
        return permissions();
      case "permissions:open":
      case "permissions:guide":
        if (args.type === "microphone") deps.openExternal(MICROPHONE_SETTINGS_URL);
        return permissions();
      case "permissions:appInfo":
        return APP_INFO;
      case "shell:state":
        if (typeof args.state === "object" && args.state !== null) {
          const state = args.state as Args;
          // Whether the dashboard says a session exists is the one fact the island's Record button depends on.
          if (typeof state.recorderReady === "boolean" && state.recorderReady !== deps.controller.state.recorderReady) deps.log(`dashboard says signed ${state.recorderReady ? "in" : "out"}`);
          deps.controller.applyShellState(state);
        }
        return null;
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
        return { ok: true };
      default:
        return null;
    }
  };
}
