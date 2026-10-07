import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";

export type HelperCommand = "audio" | "audio-permission" | "mic" | "screen";

/** A running `vocify-mac-helper` (see native/mac-helper/PROTOCOL.md), as much of a child process as the Mac code uses. */
export type HelperChild = {
  stdout: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
  stderr: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
  stdin: { end(): void };
  on(event: "exit", listener: (code: number | null) => void): unknown;
  kill(): void;
};

/** Calls `onEvent` with each JSON line of a stream, whatever pieces the lines arrive in; other lines are ignored. */
export function jsonLines(onEvent: (event: Record<string, unknown>) => void): (chunk: Buffer) => void {
  let partial = "";
  return (chunk) => {
    partial += chunk.toString();
    const lines = partial.split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event && typeof event === "object") onEvent(event);
      } catch {
        // not a status line
      }
    }
  };
}

/**
 * Starts the helper at `path` for `command`. A helper that is missing or cannot start exits at once (code 127) instead of
 * throwing or raising an unhandled `error` event, so a Mac without it degrades to "no call audio, no call detection".
 */
export function spawnMacHelper(path: string, command: HelperCommand): HelperChild {
  if (!existsSync(path)) return exitedHelper();
  const child = spawn(path, [command], { stdio: ["pipe", "pipe", "pipe"] });
  let exited = false;
  child.on("exit", () => void (exited = true));
  child.on("error", () => {
    if (exited) return;
    exited = true;
    child.emit("exit", 127);
  });
  // A helper that already quit cannot take stdin: never let that throw.
  child.stdin.on("error", () => {});
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    stdin: { end: () => void child.stdin.end() },
    on: (event, listener) => child.on(event, listener),
    kill: () => void child.kill(),
  };
}

function exitedHelper(): HelperChild {
  const events = new EventEmitter();
  setImmediate(() => events.emit("exit", 127));
  const silent = { on: () => undefined };
  return { stdout: silent, stderr: silent, stdin: { end: () => {} }, on: (event, listener) => events.on(event, listener), kill: () => {} };
}
