import { spawn } from "node:child_process";
import { join } from "node:path";
import type { EventEmitter } from "node:events";

/** The shape of a child process for the native helper. */
export interface HelperChild extends EventEmitter {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  stdin: { end(): void };
  killed: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "exit", listener: (code: number | null, signal?: NodeJS.Signals) => void): this;
}

/**
 * Spawns vocify-mac-helper for a given command.
 * The binary path depends on the environment:
 * - In production (packaged): process.resourcesPath + /mac-helper/vocify-mac-helper
 * - In dev: app/native/mac-helper/dist/vocify-mac-helper (relative to app root)
 */
export function spawnMacHelper(command: "audio" | "audio-permission" | "mic" | "screen"): HelperChild {
  // Determine the helper binary path
  let helperPath: string;

  // Check if running in packaged mode (has __dirname and process.resourcesPath)
  if (process.resourcesPath && typeof process.resourcesPath === "string") {
    // Production: packaged app has resources
    helperPath = join(process.resourcesPath, "mac-helper", "vocify-mac-helper");
  } else {
    // Development: relative to app root
    // __dirname is app/main/src/platform/mac, so go up to app/main, then to app/
    const appRoot = join(__dirname, "..", "..", "..", "..");
    helperPath = join(appRoot, "native", "mac-helper", "dist", "vocify-mac-helper");
  }

  const child = spawn(helperPath, [command], {
    stdio: ["pipe", "pipe", "pipe"],
  }) as unknown as HelperChild;

  return child;
}
