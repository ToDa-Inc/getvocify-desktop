import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A file URL, not a path: on Windows the import would read a "D:" path as a URL scheme and fail.
const logger = new URL("../src/logger.ts", import.meta.url).href;

test("logging keeps going to the file when whoever read the app's output and errors has gone away", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "vocify-logger-")), "vocify.log");
  const script = `
    import { createLogger } from ${JSON.stringify(logger)};
    const log = createLogger(${JSON.stringify(file)});
    let i = 0;
    const timer = setInterval(() => {
      log("line " + i);
      console.error("error " + i);
      if (++i === 20) clearInterval(timer);
    }, 10);
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  // The reader of the app's output closes it: every later console write hits a closed pipe (EPIPE).
  child.stdout.destroy();
  child.stderr.destroy();
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, "the app stopped");
  assert.match(readFileSync(file, "utf8"), /line 19\n$/);
});
