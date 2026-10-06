import { parsePageOutput, type BrowserPage } from "./browser-pages.ts";

/**
 * One long-lived PowerShell for the 1.5 s CRM watcher: starting PowerShell for every read costs more than the read.
 * Commands are lines on stdin (`front`, `read`); each answer ends with a `<<END>>` line. A reader that dies is
 * restarted at most once a minute; meanwhile every question gets no answer (the island shows no phone).
 */
export type ReaderChild = {
  stdin: { write(chunk: string): boolean };
  stdout: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown };
  on(event: "exit", listener: () => void): unknown;
  kill(): void;
};

const END = "<<END>>";
const RESTART_GAP_MS = 60_000;
const ANSWER_TIMEOUT_MS = 10_000;

export function createPageReaderProcess(spawn: () => ReaderChild, now: () => number) {
  let child: ReaderChild | null = null;
  let startedAt = Number.NEGATIVE_INFINITY;
  let buffer = "";
  const waiting: ((output: string | null) => void)[] = [];

  const ensure = (): ReaderChild | null => {
    if (child) return child;
    if (now() - startedAt < RESTART_GAP_MS) return null;
    startedAt = now();
    let started: ReaderChild;
    try {
      started = spawn();
    } catch {
      return null;
    }
    child = started;
    started.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      for (let end = buffer.indexOf(END); end >= 0; end = buffer.indexOf(END)) {
        const output = buffer.slice(0, end);
        buffer = buffer.slice(end + END.length).replace(/^\r?\n/, "");
        waiting.shift()?.(output);
      }
    });
    started.on("exit", () => {
      if (child === started) child = null;
      buffer = "";
      waiting.splice(0).forEach((answer) => answer(null));
    });
    return started;
  };

  const ask = (command: "front" | "read") =>
    new Promise<string | null>((resolve) => {
      const reader = ensure();
      if (!reader) return resolve(null);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        // A hung reader is replaced (after the restart gap) rather than queued behind.
        reader.kill();
      }, ANSWER_TIMEOUT_MS);
      waiting.push((output) => {
        settled = true;
        clearTimeout(timer);
        resolve(output);
      });
      reader.stdin.write(`${command}\n`);
    });

  return {
    /** The foreground window's process name, lower case ("chrome", "msedge"…), or null. */
    async front(): Promise<string | null> {
      const name = (await ask("front"))?.trim().toLowerCase();
      return name || null;
    },
    async read(): Promise<BrowserPage[]> {
      const output = await ask("read");
      return output === null ? [] : parsePageOutput(output);
    },
    dispose(): void {
      child?.kill();
      child = null;
    },
  };
}
