import { createWriteStream, mkdirSync, renameSync, statSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";

/** Rotated to `<file>.1` once it grows past this, during the session as well as at start. */
const MAX_BYTES = 10 * 1024 * 1024;

/** A plain log file under the user's data folder, rotated by size. For "copy diagnostics". */
export function createLogger(file: string): (line: string) => void {
  // When whoever read the app's output has gone (a test run cut short, a closed terminal), writing to it fails with
  // EPIPE, which Node raises as an uncaught exception that stops the app. The log file still has every line: ignore it.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") throw error;
    });
  }
  let size = 0;
  try {
    mkdirSync(dirname(file), { recursive: true });
    size = statSync(file).size;
  } catch {
    // No file yet, or the folder is not writable: logging then falls back to the console only.
  }
  // Writes go through a stream, so a line never waits for the disk. Lines that come while the file is being moved are held.
  let out: WriteStream | null = null;
  let rotating = false;
  const held: string[] = [];
  const open = () => {
    const stream = createWriteStream(file, { flags: "a" });
    out = stream;
    // A failed write is dropped: logging never breaks the app, and the next line opens the file again.
    stream.on("error", () => {
      if (out === stream) out = null;
    });
  };
  const rotate = () => {
    rotating = true;
    const done = out;
    out = null;
    const moveAway = () => {
      try {
        renameSync(file, `${file}.1`);
      } catch {
        // Nothing to move yet, or it is locked: the file simply goes on growing.
      }
      size = 0;
      rotating = false;
      for (const entry of held.splice(0)) write(entry);
    };
    // The stream is closed first, so the file can be moved (a file still open may not be, on Windows).
    if (done) done.end(moveAway);
    else moveAway();
  };
  function write(entry: string) {
    if (rotating) return void held.push(entry);
    try {
      if (!out) open();
      out?.write(entry);
      size += Buffer.byteLength(entry);
      if (size > MAX_BYTES) rotate();
    } catch {
      // Never let logging break the app.
    }
  }
  // A file already past the limit is moved before anything is added to it.
  if (size > MAX_BYTES) rotate();
  return (line) => {
    const entry = `${new Date().toISOString()} ${line}\n`;
    console.log(entry.trimEnd());
    write(entry);
  };
}
