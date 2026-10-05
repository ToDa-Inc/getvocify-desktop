import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;

/** A plain log file under the user's data folder, rotated once at start when it is large. For "copy diagnostics". */
export function createLogger(file: string): (line: string) => void {
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
