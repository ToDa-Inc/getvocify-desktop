import { createWindowsCallDetector } from "./windows/call-detector.ts";
import { createWindowsCrmScreenReader } from "./windows/crm-screen-reader.ts";
import { createWindowsPermissions } from "./windows/permissions.ts";
import { createWindowsSystemAudio } from "./windows/system-audio.ts";
import { createMacCrmScreenReader } from "./mac/crm-screen-reader.ts";
import { createMacPermissions } from "./mac/permissions.ts";
import { createMacSystemAudio } from "./mac/system-audio.ts";
import type { Platform } from "./types.ts";
import type { ReaderChild } from "../windows/page-reader-process.ts";
import type { Exec } from "../mac/browser-pages.ts";
import type { Status } from "./types.ts";

export type CreatePlatformDeps = {
  platform: "win32" | "darwin";
  // Windows call detector
  read?(): Promise<string>;
  every?(ms: number, fn: () => void): () => void;
  ownExePath?: string | null;
  // Windows CRM reader
  spawn?(): ReaderChild;
  // Mac CRM reader and permissions
  exec?: Exec;
  macAccess?(): "authorized" | "denied" | "never_requested";
  // Permissions
  microphoneAccess?(): "granted" | "denied" | "restricted" | "not-determined";
  askMicrophone?(): Promise<boolean>;
  openExternal?(url: string): void;
  macCrmTabs?: { get(): Status | undefined; set(value: Status): void };
};

/**
 * Creates a Platform instance for the given OS, wiring together all the OS-specific implementations.
 */
export function createPlatform(deps: CreatePlatformDeps): Platform {
  if (deps.platform === "win32") {
    return {
      systemAudio: createWindowsSystemAudio(),
      callDetector: createWindowsCallDetector({
        read: deps.read || (() => Promise.resolve("")),
        now: () => Date.now(),
        every: deps.every || ((ms, fn) => {
          const timer = setInterval(fn, ms);
          return () => clearInterval(timer);
        }),
        ownExePath: deps.ownExePath ?? null,
      }),
      crmScreenReader: createWindowsCrmScreenReader({
        spawn: deps.spawn || (() => ({ stdin: {}, stdout: {}, on: () => {}, kill: () => {} } as any)),
        now: () => Date.now(),
      }),
      permissions: createWindowsPermissions({
        microphoneAccess: deps.microphoneAccess || (() => "not-determined"),
        openExternal: deps.openExternal || (() => {}),
      }),
    };
  }

  if (deps.platform === "darwin") {
    return {
      systemAudio: createMacSystemAudio(),
      callDetector: null,
      crmScreenReader: createMacCrmScreenReader({
        exec: deps.exec || (async () => ""),
        access: deps.macAccess || (() => "never_requested"),
      }),
      permissions: createMacPermissions({
        microphoneAccess: deps.microphoneAccess || (() => "not-determined"),
        askMicrophone: deps.askMicrophone || (async () => false),
        openExternal: deps.openExternal || (() => {}),
        exec: deps.exec || (async () => ""),
        crmTabs: deps.macCrmTabs || { get: () => undefined, set: () => {} },
      }),
    };
  }

  throw new Error(`Unsupported platform: ${deps.platform}`);
}
