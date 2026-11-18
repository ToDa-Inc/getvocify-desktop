// A long call through the real shell with the real dashboard, on Windows: a 60-minute call's transcript is fed at a
// compressed cadence (one minute of call takes six seconds), and every simulated minute the app's processes are sampled.
// The gate: the dashboard's and the island's memory and CPU must not climb over the call (a fitted slope after warm-up).
// Under memory pressure (SOAK_PRESSURE=1: a ballast holds memory until about 1.5 GB is free) a sample more than 30
// seconds late also fails: the app stalled. SOAK_DPR=2 renders at device scale 2 (Chromium's force-device-scale-factor;
// it is not the Windows display setting, which cannot be changed on the hosted runner).
// Needs SOAK_DASHBOARD_DIST, the dashboard's built folder (built from getvocify with VITE_API_URL pointing at this host).
// Run: node test/build-shell-test.mjs && node island/build.mjs && electron test/long-call-windows.mjs
// Windows only (SOAK_ANY_PLATFORM=1 runs it elsewhere for development).
import { app } from "electron";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir, freemem, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCall } from "./soak/transcript.mjs";
import { startStandIn, fakeJwt } from "./soak/server.mjs";

if (process.platform !== "win32" && !process.env.SOAK_ANY_PLATFORM) {
  console.log("long-call-windows: skipped (not Windows)");
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const MINUTES = Number(process.env.SOAK_MINUTES ?? 60);
const COMPRESS = Number(process.env.SOAK_COMPRESS ?? 10); // call time runs this many times faster than the clock
const WARM_UP_MIN = 5;
/** The dashboard is built with its API at this port (VITE_API_URL=http://127.0.0.1:8899/api/v1). */
const STAND_PORT = 8899;
const PRESSURE = process.env.SOAK_PRESSURE === "1";
const LATE_MS = 30000;
/** A renderer that keeps growing this much per minute of call is a leak: about a quarter of the 13 MB/min measured on
 * the Windows VM before the fixes, and 165 MB over an hour, which a rep's 8 GB PC cannot spare. */
const MEM_SLOPE_MAX_MB_PER_MIN = 3;
/** CPU climbing this much per minute: the VM went from 7% to 26% in 17 minutes (about 1.1 points a minute before the
 * fixes); a quarter of that is the limit. */
const CPU_SLOPE_MAX_PTS_PER_MIN = 0.3;

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

/** Least-squares slope of y over x. */
function slope(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den ? num / den : 0;
}
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

async function startBallast() {
  if (!PRESSURE) return null;
  const child = spawn(process.execPath, [join(here, "soak/ballast.mjs")], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", TARGET_FREE_MB: "1536" }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ballast did not reach its target in 3 minutes")), 180000);
    child.stdout.on("data", (buf) => {
      const text = String(buf);
      process.stdout.write(`      ${text}`);
      if (text.includes("ballast ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => reject(new Error(`ballast exited early (${code})`)));
  });
  return child;
}

if (process.env.SOAK_DPR) app.commandLine.appendSwitch("force-device-scale-factor", process.env.SOAK_DPR);
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("use-fake-device-for-media-stream");

app.whenReady().then(async () => {
  const deadline = setTimeout(() => {
    console.log("FAIL the soak did not finish in time");
    app.exit(1);
  }, (MINUTES * 60000) / COMPRESS + 600000);
  deadline.unref();
  let ballast = null;
  let handle = null;
  let stand = null;
  const rows = [];
  try {
    const dist = process.env.SOAK_DASHBOARD_DIST;
    if (!dist) throw new Error("SOAK_DASHBOARD_DIST is not set");
    const userId = "soak-user";
    const calls = buildCall({ minutes: MINUTES });
    let pointer = 0;
    let standSend = null;
    const seen = new Set();
    let callStart = null;
    let socketCount = 0;
    stand = await startStandIn({
      port: STAND_PORT,
      dist,
      userId,
      onRequest: (method, path) => { if (!seen.has(method + path)) { seen.add(method + path); console.log("      api", method, path); } },
      onSocket: ({ send }) => {
        socketCount += 1;
        if (callStart === null) callStart = Date.now();
        else if (socketCount > 1) console.log(`      transcription socket ${socketCount} opened (the dashboard reconnected)`);
        standSend = send;
      },
    });
    const pump = setInterval(() => {
      if (!standSend || callStart === null) return;
      const simNow = (Date.now() - callStart) * COMPRESS;
      while (pointer < calls.length && calls[pointer].at <= simNow) {
        standSend(calls[pointer].msg);
        pointer += 1;
      }
    }, 20);

    ballast = await startBallast();
    if (ballast) console.log(`      memory before the app starts: ${Math.round(freemem() / MB)} MB free of ${Math.round(totalmem() / MB)} MB`);

    const userDataDir = mkdtempSync(join(tmpdir(), "vocify-soak-"));
    writeFileSync(join(userDataDir, "settings.json"), JSON.stringify({ recorderReady: true }));
    const { startApp } = await import(pathToFileURL(join(here, "../main/dist-shell-test/app.mjs")).href);
    handle = await startApp({ dashboardUrl: `http://127.0.0.1:${STAND_PORT}/dashboard`, trustFiles: false, userDataDir, releaseGraceMs: 600000 });
    const dash = handle.dashboard.contents;
    dash.on("console-message", (_e, level, message) => { if (level >= 1 && !message.includes("Electron Security")) console.log("      page", message.slice(0, 300)); });
    // The page signs in with a stored refresh token, then reloads into the signed-in dashboard.
    await dash.executeJavaScript(`localStorage.setItem("vocify_refresh", "soak-refresh"); localStorage.setItem("vocify_token", ${JSON.stringify(fakeJwt(userId))})`);
    // Recording starts only once the dashboard has loaded its screens: the stand-in sees its last start-up call. A page
    // that signs in but stays on a blank screen is reloaded, up to three times.
    let screens = false;
    for (let attempt = 1; attempt <= 3 && !screens; attempt++) {
      if (attempt > 1) {
        console.log(`      the dashboard did not load its screens; signing in again and reloading (attempt ${attempt})`);
        await dash.executeJavaScript(`localStorage.setItem("vocify_refresh", "soak-refresh"); localStorage.setItem("vocify_token", ${JSON.stringify(fakeJwt(userId))})`);
        dash.reload();
      }
      const loadedAt = Date.now();
      while (!seen.has("GET/api/v1/calls/config") && Date.now() - loadedAt < 40000) await sleep(100);
      screens = seen.has("GET/api/v1/calls/config");
    }
    if (!screens) console.log("      the dashboard's screen:", await dash.executeJavaScript(`document.body.innerText.slice(0, 400).replace(/\\n+/g, " | ") + " | url " + location.pathname`));
    check(screens, "the dashboard loaded its screens before the call");
    await sleep(2000);

    if (process.env.SOAK_DEBUG) console.log("      page state", await dash.executeJavaScript(`JSON.stringify({ url: location.href, refresh: localStorage.getItem("vocify_refresh"), body: document.body.innerText.slice(0, 300) })`));
    handle.detectCall({ name: "Zoom", appId: "zoom.exe" });
    const offered = Date.now();
    while (handle.controller.state.mode.kind !== "call" && Date.now() - offered < 20000) await sleep(100);
    handle.controller.record();
    console.log(`      after Record: mode ${handle.controller.state.mode.kind}`);
    const started = Date.now();
    while (callStart === null && Date.now() - started < 60000) await sleep(100);
    console.log(`      before Record: mode ${handle.controller.state.mode.kind}, recorderReady ${handle.controller.state.recorderReady}`);
    console.log("      permissions", JSON.stringify(await handle.permissions()).slice(0, 400));
    if (callStart === null) throw new Error("the dashboard did not open its transcription socket after Record");

    // Sampling: one row per simulated minute.
    const dashPid = dash.getOSProcessId();
    const islandPid = handle.island.webContents.getOSProcessId();
    const role = (m) => (m.pid === process.pid ? "main" : m.type === "GPU" ? "gpu" : m.pid === dashPid ? "dashboard" : m.pid === islandPid ? "island" : "other");
    const sampleNow = (minute, gapMs) => {
      const row = { minute, gapMs, freeMb: Math.round(freemem() / MB) };
      for (const m of app.getAppMetrics()) {
        const r = role(m);
        if (r === "other") continue;
        row[r] = { priv: (m.memory.privateBytes ?? m.memory.workingSetSize) / 1024, ws: m.memory.workingSetSize / 1024, cpu: m.cpu.percentCPUUsage };
      }
      rows.push(row);
      console.log(
        `      min ${String(minute).padStart(2)}  dash ${Math.round(row.dashboard?.priv ?? 0).toString().padStart(5)} MB ${(row.dashboard?.cpu ?? 0).toFixed(1).padStart(5)}%  ` +
          `island ${Math.round(row.island?.priv ?? 0).toString().padStart(5)} MB ${(row.island?.cpu ?? 0).toFixed(1).padStart(5)}%  ` +
          `main ${Math.round(row.main?.priv ?? 0).toString().padStart(5)} MB  gpu ${Math.round(row.gpu?.priv ?? 0).toString().padStart(5)} MB  ` +
          `free ${row.freeMb} MB  gap ${gapMs === null ? "-" : Math.round(gapMs / 1000) + " s"}`,
      );
    };
    let lastSample = Date.now();
    let lastMinute = 0;
    const sampler = setInterval(() => {
      if (callStart === null) return;
      const simMinute = Math.floor(((Date.now() - callStart) * COMPRESS) / 60000);
      while (lastMinute < simMinute && lastMinute < MINUTES) {
        lastMinute += 1;
        const now = Date.now();
        sampleNow(lastMinute, lastMinute === 1 ? null : now - lastSample);
        lastSample = now;
      }
    }, 100);

    // The call runs its length; the last messages are due at its very end and are given a moment to go.
    while (lastMinute < MINUTES) await sleep(200);
    const flushed = Date.now();
    while (pointer < calls.length && Date.now() - flushed < 15000) await sleep(50);
    clearInterval(sampler);
    clearInterval(pump);
    console.log(`      sent ${pointer} of ${calls.length} transcript messages`);
    check(pointer === calls.length, "the transcript source sent every message of the call");

    // Analysis: post warm-up samples only.
    const after = rows.filter((r) => r.minute >= WARM_UP_MIN);
    const fit = (who, key) => {
      const points = after.filter((r) => r[who]).map((r) => ({ x: r.minute, y: r[who][key] }));
      const s = slope(points);
      const third = Math.floor(points.length / 3);
      const first = mean(points.slice(0, third).map((p) => p.y));
      const last = mean(points.slice(-third).map((p) => p.y));
      return { slope: s, first, last };
    };
    console.log("\n  minute  slope (post warm-up, per call minute)");
    for (const who of ["dashboard", "island", "main", "gpu"]) {
      const m = fit(who, "priv");
      const c = fit(who, "cpu");
      console.log(`  ${who.padEnd(10)} memory ${m.slope.toFixed(2)} MB/min (first third ${m.first.toFixed(0)} MB, last third ${m.last.toFixed(0)} MB); cpu ${c.slope.toFixed(3)} pts/min (${c.first.toFixed(1)}% -> ${c.last.toFixed(1)}%)`);
    }
    for (const who of ["dashboard", "island"]) {
      const m = fit(who, "priv");
      const c = fit(who, "cpu");
      check(m.slope <= MEM_SLOPE_MAX_MB_PER_MIN, `${who} memory grows ${m.slope.toFixed(2)} MB per call minute, at most ${MEM_SLOPE_MAX_MB_PER_MIN}`);
      check(c.slope <= CPU_SLOPE_MAX_PTS_PER_MIN, `${who} CPU climbs ${c.slope.toFixed(3)} points per call minute, at most ${CPU_SLOPE_MAX_PTS_PER_MIN}`);
    }
    if (PRESSURE) {
      const late = rows.filter((r) => r.gapMs !== null && r.gapMs > LATE_MS);
      check(late.length === 0, `no minute sample is late by more than ${LATE_MS / 1000} s under pressure (${late.length} late${late.length ? `, longest ${Math.max(...late.map((r) => r.gapMs)) / 1000} s` : ""})`);
    }
    const gaps = rows.filter((r) => r.gapMs !== null).map((r) => r.gapMs / 1000);
    console.log(`  sample gaps: ${gaps.length} samples, largest ${Math.max(0, ...gaps).toFixed(1)} s (expected ${(60 / COMPRESS).toFixed(1)} s)`);
    if (process.env.SOAK_OUT) appendFileSync(process.env.SOAK_OUT, JSON.stringify({ pressure: PRESSURE, dpr: process.env.SOAK_DPR ?? "1", rows }) + "\n");
    handle.quit();
  } catch (error) {
    failures.push(String(error?.stack ?? error));
    console.log(error);
  } finally {
    ballast?.kill();
    stand?.server.close();
  }
  console.log(failures.length ? `\nlong-call-windows: ${failures.length} failed` : "\nlong-call-windows: all passed");
  app.exit(failures.length ? 1 : 0);
});
app.on("window-all-closed", () => {});
