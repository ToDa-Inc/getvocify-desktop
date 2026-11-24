// Windows only: what each thing the island shows costs in CPU, per process. The real app shell runs with the island as
// the reps have it (VOCIFY_PLACEMENT=side, the pill; or notch) and is put through what a working day shows: at rest, a
// call being written up, calls to review, a contact on screen, a call offered, a recording closed and open, a transcript
// that moves. Each is measured for 30 s, then again with every CSS animation switched off, so the table says what the
// animations cost and what the redraws cost. It measures only.
import { app } from "electron";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.platform !== "win32") {
  console.log("island-cpu: skipped (not Windows)");
  process.exit(0);
}
const SETTLE_MS = 8_000;
const MEASURE_MS = 30_000;
const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const placement = process.env.VOCIFY_PLACEMENT === "notch" ? "notch" : "side";

app.whenReady().then(async () => {
  setTimeout(() => {
    console.log("FAIL the measurement did not finish within 25 minutes");
    app.exit(1);
  }, 25 * 60_000).unref();
  try {
    const userDataDir = mkdtempSync(join(tmpdir(), "vocify-island-cpu-"));
    writeFileSync(join(userDataDir, "settings.json"), JSON.stringify({ recorderReady: true, calendarWatch: true, ...(placement === "side" ? { islandPlacement: "side" } : {}) }));
    const { startApp } = await import(pathToFileURL(join(here, "../main/dist-shell-test/app.mjs")).href);
    const handle = await startApp({ dashboardUrl: pathToFileURL(join(here, "../main/demo/fake-dashboard.html")).href, trustFiles: true, userDataDir, releaseGraceMs: 3_600_000 });
    const { controller, island } = handle;
    await sleep(20_000);
    const { screen } = await import("electron");
    const display = screen.getPrimaryDisplay();
    console.log(`island-cpu: ${placement}, screen ${display.size.width}x${display.size.height} at scale ${display.scaleFactor}, island window ${JSON.stringify(handle.islandBounds())}`);

    const mode = () => controller.state.mode.kind;
    const waitFor = async (done, ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until && !done()) await sleep(50);
      return done();
    };
    const open = async (want) => {
      if (controller.state.expanded !== want) controller.act({ name: "toggle" });
      await sleep(300);
    };
    const rows = [];
    let feed = null;
    const stopFeed = () => {
      if (feed) clearInterval(feed);
      feed = null;
    };
    /** The transcript as a call writes it: the current line grows every 400 ms, a new line every 4 s. */
    const startFeed = () => {
      let n = 0;
      let words = 0;
      handle.shellState({ overlay: { turns: [] } });
      feed = setInterval(() => {
        words += 1;
        if (words > 10) {
          n += 1;
          words = 1;
        }
        const text = Array.from({ length: words }, (_, i) => `word${i}`).join(" ");
        handle.shellState({ overlay: { from: n, turns: [{ key: `t-${n}`, you: n % 2 === 0, label: n % 2 === 0 ? null : "Ana Ruiz", text: "", pending: text }] } });
      }, 400);
    };
    const measure = async (name) => {
      await sleep(SETTLE_MS);
      await handle.measureResources(false);
      await sleep(MEASURE_MS);
      const sample = await handle.measureResources(false);
      const cpu = (process) => sample.own.filter((p) => p.name === process).reduce((sum, p) => sum + p.cpu, 0);
      const total = sample.own.reduce((sum, p) => sum + p.cpu, 0);
      const row = { name, island: cpu("island"), gpu: cpu("gpu"), main: cpu("main"), total, mode: mode(), open: controller.state.expanded };
      rows.push(row);
      console.log(`island-cpu: ${name} | island ${row.island.toFixed(1)} gpu ${row.gpu.toFixed(1)} main ${row.main.toFixed(1)} total ${total.toFixed(1)} | ${row.mode}${row.open ? ", open" : ", closed"}`);
    };
    const ana = { provider: "hubspot", crmLabel: "HubSpot", name: "Ana Ruiz", phone: "+34600111222", callerId: "+34910000000", state: "callable" };
    const record = async () => {
      controller.act({ name: "record" });
      if (!(await waitFor(() => mode() === "recording", 5000))) controller.show();
      await waitFor(() => mode() === "recording", 3000);
    };
    const endRecording = async () => {
      stopFeed();
      controller.act({ name: "stop" });
      await sleep(500);
      controller.act({ name: "discard" });
      await waitFor(() => mode() === "idle", 8000);
      if (mode() !== "idle") controller.hide();
      handle.shellState({ postCall: null, finish: null, overlay: { turns: [] } });
      await sleep(1000);
    };

    const pass = async (label) => {
      handle.shellState({ background: [], onScreen: null, postCall: null });
      await open(false);
      await measure(`${label}rest: the mark alone`);
      handle.shellState({ background: [{ id: "d1", name: "Marta Ruiz", state: "working" }] });
      await measure(`${label}rest: a call being written up (spinner)`);
      handle.shellState({ background: [{ id: "d1", name: "Marta Ruiz", state: "needs" }, { id: "d2", name: "Ana Ruiz", state: "needs" }, { id: "d3", name: "Pau", state: "needs" }] });
      await measure(`${label}rest: three calls to review (badge)`);
      handle.shellState({ background: [], onScreen: ana });
      await measure(`${label}rest: a contact on screen`);
      handle.shellState({ onScreen: null });
      handle.detectCall({ name: "Zoom", appId: "zoom.exe" });
      await sleep(10_000);
      await open(false);
      await measure(`${label}call offered, closed`);
      await record();
      await open(false);
      await measure(`${label}recording, closed`);
      await open(true);
      await measure(`${label}recording, open, transcript still`);
      startFeed();
      await measure(`${label}recording, open, transcript moving`);
      await open(false);
      await measure(`${label}recording, closed, transcript moving`);
      await endRecording();
      handle.detectCall(null);
      await sleep(1000);
    };

    await pass("");
    // The same again with every CSS animation and transition off: what is left is the cost of redrawing changes.
    await island.webContents.insertCSS("*, *::before, *::after { animation: none !important; transition: none !important; }");
    await pass("no animations · ");

    const report = [
      `## Island CPU on Windows, ${placement === "side" ? "side pill" : "notch island"} (screen ${display.size.width}x${display.size.height} at scale ${display.scaleFactor}, 30 s each)`,
      "",
      "| what the island shows | island % | gpu % | main % | all Vocify % |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...rows.map((r) => `| ${r.name} (${r.mode}${r.open ? ", open" : ""}) | ${r.island.toFixed(1)} | ${r.gpu.toFixed(1)} | ${r.main.toFixed(1)} | ${r.total.toFixed(1)} |`),
      "",
    ].join("\n");
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
    app.exit(0);
  } catch (error) {
    console.log(`FAIL island-cpu: ${error instanceof Error ? error.stack : String(error)}`);
    app.exit(1);
  }
});
