import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;

/** A plain log file under the user's data folder, rotated once at start when it is large. For "copy diagnostics". */
export function createLogger(file: string): (line: string) => void {
  // When whoever read the app's output has gone (a test run cut short, a closed terminal), writing to it fails with
  // EPIPE, which Node raises as an uncaught exception that stops the app. The log file still has every line: ignore it.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") throw error;
    });
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
  } catch {
    // No file yet, or the folder is not writable: logging then falls back to the console only.
  }
  return (line) => {
    const entry = `${new Date().toISOString()} ${line}`;
    console.log(entry);
    try {
      appendFileSync(file, `${entry}\n`);
    } catch {
      // Never let logging break the app.
    }
  };
}
