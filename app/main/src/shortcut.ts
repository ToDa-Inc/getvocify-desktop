import type { SettingsStore } from "./settings.ts";

/** The global record shortcut. Port of RecordShortcut.swift, on Electron's `globalShortcut`. */

type Platform = "win32" | "darwin";
export type KeyEvent = { code: string; meta: boolean; alt: boolean; ctrl: boolean; shift: boolean };
export type Combo = { accelerator: string; label: string; stored: KeyEvent };
export type ShortcutState = { label: string | null; defaultLabel: string };

const PUNCTUATION: Record<string, { accelerator: string; label: string }> = {
  Period: { accelerator: ".", label: "." },
  Comma: { accelerator: ",", label: "," },
  Slash: { accelerator: "/", label: "/" },
  Semicolon: { accelerator: ";", label: ";" },
  Quote: { accelerator: "'", label: "'" },
  BracketLeft: { accelerator: "[", label: "[" },
  BracketRight: { accelerator: "]", label: "]" },
  Backquote: { accelerator: "`", label: "`" },
  Minus: { accelerator: "-", label: "-" },
  Equal: { accelerator: "=", label: "=" },
  Space: { accelerator: "Space", label: "Space" },
};

/** `KeyboardEvent.code` to the key's accelerator and how it reads, for the keys the Swift app allows. */
export function keyFor(code: string): { accelerator: string; label: string } | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return { accelerator: letter[1], label: letter[1] };
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return { accelerator: digit[1], label: digit[1] };
  const fn = /^F([1-9]|1[0-9])$/.exec(code);
  if (fn) return { accelerator: code, label: code };
  return PUNCTUATION[code] ?? null;
}

export function isFunctionKey(code: string): boolean {
  return /^F([1-9]|1[0-9])$/.test(code);
}

/** Null when the combination cannot be a global shortcut. */
export function comboFromEvent(platform: Platform, event: KeyEvent): Combo | null {
  const key = keyFor(event.code);
  if (!key) return null;
  // The Windows key cannot be registered reliably, and a plain key would fire while typing anywhere.
  if (platform === "win32" && event.meta) return null;
  if (!isFunctionKey(event.code) && !(event.ctrl || event.alt || event.meta)) return null;
  const parts: string[] = [];
  if (platform === "darwin") {
    if (event.ctrl) parts.push("Control");
    if (event.alt) parts.push("Alt");
    if (event.shift) parts.push("Shift");
    if (event.meta) parts.push("Command");
    const symbols = `${event.ctrl ? "⌃" : ""}${event.alt ? "⌥" : ""}${event.shift ? "⇧" : ""}${event.meta ? "⌘" : ""}`;
    return { accelerator: [...parts, key.accelerator].join("+"), label: `${symbols}${key.label}`, stored: { ...event } };
  }
  if (event.ctrl) parts.push("Ctrl");
  if (event.alt) parts.push("Alt");
  if (event.shift) parts.push("Shift");
  return { accelerator: [...parts, key.accelerator].join("+"), label: [...parts, key.label].join("+"), stored: { ...event } };
}

/**
 * The default avoids combinations other software already owns: Ctrl+Shift+R reloads the browser, and Ctrl+Alt is the same
 * as AltGr on many keyboards (it types characters). On the Mac it is the same ⌥⌘R as the Swift app.
 */
export function defaultCombo(platform: Platform): Combo {
  const event: KeyEvent = platform === "darwin" ? { code: "KeyR", meta: true, alt: true, ctrl: false, shift: false } : { code: "KeyR", meta: false, alt: true, ctrl: true, shift: true };
  return comboFromEvent(platform, event) as Combo;
}

export type GlobalShortcutApi = {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
};

const KEY = "recordShortcut";

export class ShortcutManager {
  private active: Combo | null = null;
  private readonly platform: Platform;
  private readonly settings: SettingsStore;
  private readonly api: GlobalShortcutApi;
  private readonly onPress: () => void;

  constructor(platform: Platform, settings: SettingsStore, api: GlobalShortcutApi, onPress: () => void) {
    this.platform = platform;
    this.settings = settings;
    this.api = api;
    this.onPress = onPress;
  }

  private get defaultLabel(): string {
    return defaultCombo(this.platform).label;
  }

  state(): ShortcutState {
    return { label: this.active?.label ?? null, defaultLabel: this.defaultLabel };
  }

  /** Registers the saved shortcut, or the default the first time; "off" stays off. */
  activate(): void {
    const saved = this.settings.get(KEY);
    if (typeof saved === "object" && saved !== null && (saved as { off?: unknown }).off === true) return;
    const stored = saved as Partial<KeyEvent> | undefined;
    const combo =
      stored && typeof stored.code === "string"
        ? comboFromEvent(this.platform, { code: stored.code, meta: stored.meta === true, alt: stored.alt === true, ctrl: stored.ctrl === true, shift: stored.shift === true })
        : defaultCombo(this.platform);
    if (combo) this.register(combo);
  }

  private register(combo: Combo): boolean {
    if (!this.api.register(combo.accelerator, this.onPress)) return false;
    this.active = combo;
    return true;
  }

  private unregister(): void {
    if (this.active) this.api.unregister(this.active.accelerator);
    this.active = null;
  }

  set(event: KeyEvent): ShortcutState & { ok: boolean; reason?: "invalid" | "taken" } {
    const next = comboFromEvent(this.platform, event);
    if (!next) return { ...this.state(), ok: false, reason: "invalid" };
    const previous = this.active;
    this.unregister();
    if (!this.register(next)) {
      if (previous) this.register(previous);
      return { ...this.state(), ok: false, reason: "taken" };
    }
    this.settings.set(KEY, next.stored);
    return { ...this.state(), ok: true };
  }

  clear(): ShortcutState {
    this.unregister();
    this.settings.set(KEY, { off: true });
    return this.state();
  }
}
