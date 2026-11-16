// Windows only: several calls in a row with REAL mouse clicks on the island, as a rep works a call list. Each call is offered,
// recorded, hung up, its card saved and dismissed, and the next call comes. Every step's response time is measured; the
// main process's event-loop delay is read over the whole run; the child processes it keeps are counted after each call. A
// step that takes too long, a loop that stalls, or a process that piles up fails the run.
// Run: node test/build-shell-test.mjs && node island/build.mjs && electron test/calls-windows.mjs   (skips on other systems)
import { app, screen } from "electron";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { click } from "./windows-input.mjs";

if (process.platform !== "win32") {
  console.log("calls-windows: skipped (not Windows)");
  process.exit(0);
}

const CALLS = 4;
/** A step the rep waits on (a click, a call offered) answers within this. The card waits on the dashboard's save. */
const STEP_MS = 2500;
const CARD_MS = 15000;
/** The main process's event loop is never blocked this long at once (its largest delay, read over the whole run). */
const LOOP_MAX_MS = 500;

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  setTimeout(() => {
    console.log("FAIL the run did not finish within 6 minutes");
    app.exit(1);
  }, 360000).unref();
  let loop = null;
  try {
    const userDataDir = mkdtempSync(join(tmpdir(), "vocify-calls-"));
    writeFileSync(join(userDataDir, "settings.json"), JSON.stringify({ recorderReady: true }));
    const { startApp } = await import(pathToFileURL(join(here, "../main/dist-shell-test/app.mjs")).href);
    const handle = await startApp({ dashboardUrl: pathToFileURL(join(here, "../main/demo/fake-dashboard.html")).href, trustFiles: true, userDataDir, releaseGraceMs: 600000 });
    const { controller, island } = handle;
    await sleep(2000);
    loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();

    const mode = () => controller.state.mode.kind;
    /** Waits until `done` holds; the time it took, or null when it did not hold in time. */
    const waitFor = async (done, ms) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (done()) return Date.now() - start;
        await sleep(25);
      }
      return null;
    };
    /** A real click on an element of the island, and the time until the island has answered (`done`). */
    const clickOn = async (selector, done, ms, label) => {
      const at = await island.webContents.executeJavaScript(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      if (!at) return { label, ms: null, why: `${selector} not on screen` };
      const w = island.getBounds();
      const point = screen.dipToScreenPoint({ x: Math.round(w.x + at.x), y: Math.round(w.y + at.y) });
      const sent = Date.now();
      await click(point.x, point.y);
      return { label, ms: await waitFor(done, ms), sent };
    };
    const record = (result, limit, what) => {
      const ok = result.ms !== null && result.ms <= limit;
      check(ok, `${what}${result.ms === null ? " (did not happen)" : ` in ${result.ms} ms`}${result.why ? ` (${result.why})` : ""}`);
    };
    const processes = () => process.getActiveResourcesInfo().filter((type) => type === "ChildProcess").length;
    const memoryMb = () => Math.round(app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024);
    const baseline = { processes: processes(), memory: memoryMb() };
    console.log(`      before the first call: ${baseline.processes} child processes, ${baseline.memory} MB`);

    const worst = [];
    for (let n = 1; n <= CALLS; n++) {
      loop.reset();
      const offered = Date.now();
      handle.detectCall({ name: "Zoom", appId: "zoom.exe" });
      const offer = await waitFor(() => mode() === "call" && controller.state.expanded, STEP_MS);
      record({ label: "offer", ms: offer }, STEP_MS, `call ${n} is offered`);
      if (offer === null) break;
      // The island grows to the call's size after it drops down: a click before that lands outside the window.
      await sleep(1200);
      record(await clickOn(".quiet-record", () => mode() === "recording", STEP_MS, "record"), STEP_MS, `call ${n}: Record starts the recording`);
      await sleep(1500);
      handle.detectCall(null);
      record({ label: "hang-up", ms: await waitFor(() => mode() === "stopped", 6000) }, 6000, `call ${n}: the hang-up stops the recording`);
      record(await clickOn(".primary-action", () => controller.state.postCall?.stage === "ready", CARD_MS, "card"), CARD_MS, `call ${n}: Finish gives the card`);
      // The card settles after it is ready (it grows to its size), as a rep waits for it to.
      await sleep(1000);
      record(await clickOn(".postcall-header .icon-button", () => mode() === "idle" && controller.state.postCall === null, STEP_MS, "dismiss"), STEP_MS, `call ${n}: Done clears the card`);
      record({ label: "listening", ms: await waitFor(() => !controller.isListening, 6000) }, 6000, `call ${n}: the dashboard stops listening`);
      const lag = loop.max / 1e6;
      const p99 = loop.percentile(99) / 1e6;
      worst.push(lag);
      console.log(`      call ${n} done in ${Date.now() - offered} ms; event loop delay max ${lag.toFixed(0)} ms, p99 ${p99.toFixed(0)} ms; ${processes()} child processes, ${memoryMb()} MB`);
      check(lag <= LOOP_MAX_MS, `call ${n}: the main process's event loop was not blocked for more than ${LOOP_MAX_MS} ms (${lag.toFixed(0)} ms)`);
      await sleep(500);
    }
    const end = { processes: processes(), memory: memoryMb() };
    check(end.processes <= baseline.processes + 2, `child processes do not pile up (${baseline.processes} before, ${end.processes} after ${CALLS} calls)`);
    console.log(`      after ${CALLS} calls: ${end.processes} child processes, ${end.memory} MB (before: ${baseline.memory} MB); worst loop delay ${Math.max(0, ...worst).toFixed(0)} ms`);
    handle.quit();
  } catch (error) {
    failures.push(String(error?.stack ?? error));
    console.log(error);
  } finally {
    loop?.disable();
  }
  console.log(failures.length ? `\ncalls-windows: ${failures.length} failed` : "\ncalls-windows: all passed");
  app.exit(failures.length ? 1 : 0);
});
app.on("window-all-closed", () => {});
