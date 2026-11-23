import { spawn } from "node:child_process";
import { countLaunch } from "../resources.ts";
import { encodePowerShell } from "./browser-pages.ts";

/** A long-lived reader: what it is asked for (the helper's command) and the PowerShell script that does the same. */
export type ReaderKind = { command: "capture" | "sessions" | "pages"; script: string };

/**
 * Starts the readers: the native helper (native/win-helper, a few MB, starts at once) when the app ships one, else
 * PowerShell running the same code as a script (tens of MB each, seconds to start, compiled at every launch). The lines
 * both print are the same. A helper that cannot start, or ends at once with an error (blocked by the PC's policy, a
 * missing .NET Framework), is given up for this run and PowerShell takes over, with a line in the log.
 */
export function createReaderSource(deps: { helperPath: string | null; log(line: string): void; now(): number; spawnProcess?: typeof spawn }) {
  const run = deps.spawnProcess ?? spawn;
  let helper = deps.helperPath;
  const giveUp = (why: string) => {
    if (helper === null) return;
    helper = null;
    deps.log(`windows helper: ${why}; the PowerShell readers are used instead`);
  };
  return {
    usesHelper: () => helper !== null,
    /** `onHelperFailed` runs when the helper started here turned out not to work: the caller starts the reader again. */
    start(kind: ReaderKind, stdio: ("ignore" | "pipe")[], onHelperFailed?: () => void) {
      if (helper === null) {
        countLaunch("powershell.exe");
        return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(kind.script)], { windowsHide: true, stdio });
      }
      countLaunch("vocify-win-helper.exe");
      const startedAt = deps.now();
      const child = run(helper, [kind.command, "--parent", String(process.pid)], { windowsHide: true, stdio });
      let failed = false;
      const fail = (why: string) => {
        if (failed) return;
        failed = true;
        giveUp(why);
        onHelperFailed?.();
      };
      child.on("error", (error) => fail(`could not start (${error.message})`));
      child.on("exit", (code) => {
        if (code !== null && code !== 0 && deps.now() - startedAt < 5000) fail(`ended at start with code ${code}`);
      });
      return child;
    },
  };
}
export type ReaderSource = ReturnType<typeof createReaderSource>;
