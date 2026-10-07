/**
 * Which app is using the microphone right now, on Windows, without a driver or a helper process.
 *
 * Windows records every app's microphone use under
 *   HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone
 * (the data behind the microphone indicator in the tray). Each app has `LastUsedTimeStart` and `LastUsedTimeStop`
 * (Windows FILETIME): while an app is capturing, the start is newer than the stop (the stop is 0 or older).
 * Desktop apps are under `NonPackaged\<path with \ written as #>`, Store apps under their package family name.
 * This is the Windows counterpart of the CoreAudio per-process "is running input" flag the Mac island reads.
 */

export const MIC_CONSENT_KEY = "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";

/** One app that has used the microphone, and when (ms since the epoch; 0 when never). */
export type MicUse = { id: string; path: string | null; exe: string; started: number; stopped: number; active: boolean };

const FILETIME_EPOCH_MS = 11644473600000n;

/** A FILETIME (100 ns ticks since 1601) as ms since 1970. */
export function filetimeToMs(ticks: bigint): number {
  if (ticks === 0n) return 0;
  return Number(ticks / 10000n - FILETIME_EPOCH_MS);
}

function parseTicks(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw.trim());
  } catch {
    return 0n;
  }
}

/** The output of `reg query <MIC_CONSENT_KEY> /s` as the apps that have used the microphone. */
export function parseMicConsent(output: string): MicUse[] {
  const uses: MicUse[] = [];
  let key: string | null = null;
  let values: Record<string, string> = {};

  const flush = () => {
    if (key === null) return;
    const marker = "\\microphone\\";
    const at = key.toLowerCase().indexOf(marker);
    if (at >= 0) {
      const rest = key.slice(at + marker.length);
      const nonPackaged = /^NonPackaged\\(.+)$/i.exec(rest);
      const id = nonPackaged ? nonPackaged[1] : rest;
      // The bare "NonPackaged" key and nested keys are containers, not apps.
      if (id.length > 0 && !id.includes("\\") && rest.toLowerCase() !== "nonpackaged") {
        const path = nonPackaged ? id.replace(/#/g, "\\") : null;
        const started = filetimeToMs(parseTicks(values.LastUsedTimeStart));
        const stopped = filetimeToMs(parseTicks(values.LastUsedTimeStop));
        const exe = (path ? path.slice(path.lastIndexOf("\\") + 1) : id).toLowerCase();
        uses.push({ id: path ?? id, path, exe, started, stopped, active: started > 0 && started > stopped });
      }
    }
    key = null;
    values = {};
  };

  for (const line of output.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) {
      flush();
      key = line.trim();
      continue;
    }
    const value = /^\s+(\S+)\s+REG_\w+\s+(.*)$/.exec(line);
    if (value && key !== null) values[value[1]] = value[2];
  }
  flush();
  return uses;
}

export type CallApp = { name: string; browser: boolean };

/** Apps people take calls in, by executable (desktop) or package family prefix (Store). Browsers count for Meet and web dialers. */
const CALL_APPS: Record<string, CallApp> = {
  "zoom.exe": { name: "Zoom", browser: false },
  "teams.exe": { name: "Microsoft Teams", browser: false },
  "ms-teams.exe": { name: "Microsoft Teams", browser: false },
  "msteams_8wekyb3d8bbwe": { name: "Microsoft Teams", browser: false },
  "slack.exe": { name: "Slack", browser: false },
  "whatsapp.exe": { name: "WhatsApp", browser: false },
  "5319275a.whatsappdesktop_cv1g1gvanyjgm": { name: "WhatsApp", browser: false },
  "telegram.exe": { name: "Telegram", browser: false },
  "discord.exe": { name: "Discord", browser: false },
  "webex.exe": { name: "Webex", browser: false },
  "ciscocollabhost.exe": { name: "Webex", browser: false },
  "chrome.exe": { name: "Google Chrome", browser: true },
  "msedge.exe": { name: "Microsoft Edge", browser: true },
  "firefox.exe": { name: "Firefox", browser: true },
  "brave.exe": { name: "Brave", browser: true },
  "opera.exe": { name: "Opera", browser: true },
  "vivaldi.exe": { name: "Vivaldi", browser: true },
  "arc.exe": { name: "Arc", browser: true },
};

export function callAppFor(exeOrId: string): CallApp | null {
  const key = exeOrId.toLowerCase();
  if (CALL_APPS[key]) return CALL_APPS[key];
  // Store apps carry a version or publisher suffix that varies; match their stable prefix.
  const prefix = Object.keys(CALL_APPS).find((known) => !known.endsWith(".exe") && key.startsWith(known.split("_")[0] + "_"));
  return prefix ? CALL_APPS[prefix] : null;
}

export type DetectedCaller = { name: string; appId: string; path: string | null; browser: boolean };

const normalizePath = (value: string) => value.replace(/\//g, "\\").toLowerCase();

/**
 * The call app to offer, or null. Only call apps count (dictation tools and note-takers use the microphone too), the
 * app must have held it for `settleMs` so a blip is skipped, Vocify's own capture is ignored, and a named app wins
 * over a browser, as on the Mac.
 */
export function pickCaller(uses: MicUse[], options: { now: number; settleMs: number; ownExePath?: string | null }): DetectedCaller | null {
  const own = options.ownExePath ? normalizePath(options.ownExePath) : null;
  const candidates: DetectedCaller[] = [];
  for (const use of uses) {
    if (!use.active || options.now - use.started < options.settleMs) continue;
    if (own && use.path && normalizePath(use.path) === own) continue;
    const app = callAppFor(use.exe);
    if (!app) continue;
    candidates.push({ name: app.name, appId: use.exe, path: use.path, browser: app.browser });
  }
  candidates.sort((a, b) => Number(a.browser) - Number(b.browser));
  return candidates[0] ?? null;
}

export type MicWatcherDeps = {
  /** Runs `reg query <MIC_CONSENT_KEY> /s` and returns its output. */
  read(): Promise<string>;
  now(): number;
  /** Repeats `fn` every `ms`; returns a function that stops it. */
  every(ms: number, fn: () => void): () => void;
  ownExePath: string | null;
  onCaller(caller: DetectedCaller | null): void;
  onError?(error: unknown): void;
};

const POLL_MS = 1000;
const SETTLE_MS = 300;

/** Polls the microphone-use record and reports the caller only when it changes. */
export class MicWatcher {
  private readonly deps: MicWatcherDeps;
  private stop: (() => void) | null = null;
  private busy = false;
  private lastOutput: string | null = null;
  private reported: string | null | undefined = undefined;

  constructor(deps: MicWatcherDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.stop) return;
    void this.tick();
    this.stop = this.deps.every(POLL_MS, () => void this.tick());
  }

  halt(): void {
    this.stop?.();
    this.stop = null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const output = await this.deps.read();
      // Nothing changed in the record and the answer is settled: there is nothing new to work out.
      if (output === this.lastOutput && this.reported !== undefined && !this.hasUnsettled) return;
      this.lastOutput = output;
      const uses = parseMicConsent(output);
      const now = this.deps.now();
      const caller = pickCaller(uses, { now, settleMs: SETTLE_MS, ownExePath: this.deps.ownExePath });
      this.hasUnsettled = uses.some((u) => u.active && now - u.started < SETTLE_MS);
      const id = caller ? `${caller.appId}` : null;
      if (id !== this.reported) {
        this.reported = id;
        this.deps.onCaller(caller);
      }
    } catch (error) {
      this.deps.onError?.(error);
    } finally {
      this.busy = false;
    }
  }

  private hasUnsettled = false;
}
