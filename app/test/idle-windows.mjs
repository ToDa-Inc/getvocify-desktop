// Windows only: what Vocify costs the computer while it sits idle between calls. The real app shell runs (the island, the
// hidden dashboard page kept for the calendar heads-up, the call readers), settles for a minute, then is sampled every
// 15 s for 4 minutes: each of its processes (memory, private memory, CPU), the long-lived programs it keeps running, and
// the programs it launches (reg.exe, powershell.exe…) per minute. Prints a table, and writes it to the CI step summary.
// It measures only; it fails when the app cannot start or the measurement cannot be taken.
// Run on a Windows machine: node test/build-shell-test.mjs && node island/build.mjs && electron test/idle-windows.mjs
import { app } from "electron";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.platform !== "win32") {
  console.log("idle-windows: skipped (not Windows)");
  process.exit(0);
}

const SETTLE_MS = 60_000;
const WINDOW_MS = 4 * 60_000;
const EVERY_MS = 15_000;

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mb = (kb) => Math.round(kb / 1024);
const mean = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);

/** Name -> { kb[], privateKb[], cpu[] } over the samples. */
function byName(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const seen = new Map();
    for (const p of sample.own) {
      const g = seen.get(p.name) ?? { kb: 0, privateKb: 0, cpu: 0, count: 0 };
      g.kb += p.kb;
      g.privateKb += p.privateKb ?? 0;
      g.cpu += p.cpu;
      g.count += 1;
      seen.set(p.name, g);
    }
    for (const [name, g] of seen) {
      const all = groups.get(name) ?? [];
      all.push({ kb: g.kb, privateKb: g.privateKb, cpu: g.cpu });
      groups.set(name, all);
    }
  }
  return groups;
}

app.whenReady().then(async () => {
  const failed = (message) => {
    console.log(`FAIL ${message}`);
    app.exit(1);
  };
  setTimeout(() => failed("the measurement did not finish within 10 minutes"), 600_000).unref();
  try {
    const userDataDir = mkdtempSync(join(tmpdir(), "vocify-idle-"));
    // A rep whose calendar is connected: the hidden dashboard page stays for the meeting heads-up.
    writeFileSync(join(userDataDir, "settings.json"), JSON.stringify({ recorderReady: true, calendarWatch: true }));
    const { startApp } = await import(pathToFileURL(join(here, "../main/dist-shell-test/app.mjs")).href);
    const handle = await startApp({
      dashboardUrl: pathToFileURL(join(here, "../main/demo/fake-dashboard.html")).href,
      trustFiles: true,
      userDataDir,
      releaseGraceMs: 600_000,
    });
    console.log(`idle: started, settling for ${SETTLE_MS / 1000} s`);
    await sleep(SETTLE_MS);

    const samples = [];
    const start = await handle.measureResources();
    const launchesAtStart = new Map(start.launches);
    const began = Date.now();
    samples.push(start);
    while (Date.now() - began < WINDOW_MS) {
      await sleep(EVERY_MS);
      const sample = await handle.measureResources();
      samples.push(sample);
      console.log(`idle: ${Math.round((Date.now() - began) / 1000)} s, ${mb(sample.own.reduce((s, p) => s + p.kb, 0))} MB in ${sample.own.length} processes`);
    }
    const end = samples.at(-1);
    const minutes = (Date.now() - began) / 60_000;
    // The first sample's CPU is since the app started, not idle: left out of the CPU averages.
    const measured = samples.slice(1);

    const rows = [];
    const cpuByName = byName(measured);
    for (const [name, list] of [...byName(samples)].sort((a, b) => mean(b[1].map((x) => x.kb)) - mean(a[1].map((x) => x.kb)))) {
      const kbs = list.map((x) => x.kb);
      const cpus = cpuByName.get(name)?.map((x) => x.cpu) ?? [];
      const privates = list.map((x) => x.privateKb);
      rows.push(`| ${name} | ${mb(mean(kbs))} | ${mb(Math.max(...kbs))} | ${mb(mean(privates))} | ${mean(cpus).toFixed(1)} |`);
    }
    const total = samples.map((s) => s.own.reduce((sum, p) => sum + p.kb, 0));
    const totalPrivate = samples.map((s) => s.own.reduce((sum, p) => sum + (p.privateKb ?? 0), 0));
    const cpuTotal = mean(measured.map((s) => s.own.reduce((sum, p) => sum + p.cpu, 0)));

    const childNames = new Map();
    for (const sample of samples) for (const c of sample.children) childNames.set(c.name, [...(childNames.get(c.name) ?? []), c.kb ?? 0]);
    const helperRows = [...childNames].map(([name, kbs]) => `| ${name} | ${mb(mean(kbs))} |`);

    const perMinute = [];
    for (const [name, count] of end.launches) {
      const before = launchesAtStart.get(name) ?? 0;
      perMinute.push([name, ((count - before) / minutes).toFixed(1)]);
    }
    const launchRows = perMinute.length ? perMinute.map(([name, rate]) => `| ${name} | ${rate} |`) : ["| (none) | 0 |"];

    const report = [
      `## Idle cost on Windows (${(WINDOW_MS / 60_000).toFixed(0)} min, ${samples.length} samples, free ${(end.freeBytes / 1024 ** 3).toFixed(1)} GB of ${(end.totalBytes / 1024 ** 3).toFixed(1)} GB)`,
      "",
      "| process | working set mean MB | working set max MB | own (private) mean MB | CPU mean % |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...rows,
      `| **all Vocify processes** | **${mb(mean(total))}** | **${mb(Math.max(...total))}** | **${mb(mean(totalPrivate))}** | **${cpuTotal.toFixed(1)}** |`,
      "",
      "Long-lived programs the app keeps running (working set mean MB):",
      "",
      "| program | MB |",
      "| --- | ---: |",
      ...(helperRows.length ? helperRows : ["| (none) | 0 |"]),
      "",
      `Programs launched per minute, from the app's own count (${minutes.toFixed(1)} min):`,
      "",
      "| program | per minute |",
      "| --- | ---: |",
      ...launchRows,
      "",
    ].join("\n");
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
    app.exit(0);
  } catch (error) {
    failed(`idle measurement: ${error instanceof Error ? error.stack : String(error)}`);
  }
});
