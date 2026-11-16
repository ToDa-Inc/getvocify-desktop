// Windows only: the island as a pill (Settings › Preferences › "Pill", the placement "side") with REAL mouse input. Choosing
// the pill moves the island's window to the pill's screen and puts the pill on its edge; the pill takes a real press and a
// real drag, and stays where it is let go; a real click on it opens the island out of it; clicks elsewhere reach the apps
// under the window; and the call window keeps the keyboard throughout.
// Run: node test/build-shell-test.mjs && node island/build.mjs && electron test/side-windows.mjs   (skips on other systems)
import { app, screen } from "electron";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hwndOf } from "./window-at.mjs";
import { click, drag, foregroundPid, hover, windowsAtPoints } from "./windows-input.mjs";

if (process.platform !== "win32") {
  console.log("side-windows: skipped (not Windows)");
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const close = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;

app.whenReady().then(async () => {
  setTimeout(() => {
    console.log("FAIL the run did not finish within 4 minutes");
    app.exit(1);
  }, 240000).unref();
  let call = null;
  try {
    const userDataDir = mkdtempSync(join(tmpdir(), "vocify-side-"));
    writeFileSync(join(userDataDir, "settings.json"), JSON.stringify({ recorderReady: true }));
    const { startApp } = await import(pathToFileURL(join(here, "../main/dist-shell-test/app.mjs")).href);
    const handle = await startApp({ dashboardUrl: pathToFileURL(join(here, "../main/demo/fake-dashboard.html")).href, trustFiles: true, userDataDir, releaseGraceMs: 600000 });
    const { controller, island } = handle;
    const until = async (fn, ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (fn()) return true;
        await sleep(50);
      }
      return false;
    };
    const page = (js) => island.webContents.executeJavaScript(js);
    /** The pill's centre in DIPs (the window's own coordinates plus the page's), or null when there is no pill. */
    const pill = async () => {
      const r = await page("(() => { const e = document.querySelector('.side-strip'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()");
      if (!r) return null;
      const at = handle.islandBounds();
      return { x: at.x + r.x + r.width / 2, y: at.y + r.y + r.height / 2 };
    };
    // Diagnostics: every change of click-through the app makes, and the pointer events the page receives.
    const ignoreCalls = [];
    const setIgnore = island.setIgnoreMouseEvents.bind(island);
    island.setIgnoreMouseEvents = (...args) => {
      ignoreCalls.push(`${args[0] ? "ignore" : "take"}@${Date.now() % 100000}`);
      return setIgnore(...args);
    };
    await page("window.__pointer = { down: 0, move: 0, up: 0, cancel: 0, log: [] }; for (const k of ['down','move','up','cancel']) document.addEventListener('pointer' + k, (e) => { window.__pointer[k]++; if (k !== 'move') window.__pointer.log.push(`${k}@${e.clientX},${e.clientY} type ${e.pointerType} primary ${e.isPrimary} buttons ${e.buttons} target ${e.target?.className} connected ${e.target?.isConnected} captured ${document.querySelector('.side-strip')?.hasPointerCapture?.(e.pointerId)}`); }, true)");
    const physical = (p) => screen.dipToScreenPoint({ x: Math.round(p.x), y: Math.round(p.y) });
    /** Is the island's window the top-level window a click at this DIP point reaches? */
    const islandGetsClick = async (p) => (await windowsAtPoints([physical(p)]))[0] === hwndOf(island);

    // A plain window stands in for the call: it must keep the keyboard through all of this.
    call = spawn("powershell.exe", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form; $f.Text = 'CALL'; $f.Width = 500; $f.Height = 300; $f.Add_Shown({ $f.Activate() }); [System.Windows.Forms.Application]::Run($f)"], { stdio: "ignore", windowsHide: false });
    await sleep(4000);
    const callPid = await foregroundPid();
    const ours = new Set(app.getAppMetrics().map((p) => p.pid).concat(process.pid));
    check(!ours.has(callPid), "a call window is in front");
    const work = screen.getPrimaryDisplay().workArea;
    const notchBounds = handle.islandBounds();
    check(notchBounds.width < work.width / 2, `the island starts under the notch (${notchBounds.width}x${notchBounds.height})`);

    /* ---------- switch to the pill ---------- */
    handle.choosePlacement("side");
    check(await until(() => controller.state.placement === "side", 2000), "choosing the pill switches the placement");
    for (let i = 0; i < 30 && (await pill()) === null; i++) await sleep(100);
    check((await pill()) !== null, "the pill is drawn");
    const area = handle.islandBounds();
    check(close(area.x, work.x) && close(area.y, work.y) && close(area.width, work.width) && close(area.height, work.height), `the window covers the pill's screen (${area.x},${area.y} ${area.width}x${area.height}, wanted ${work.x},${work.y} ${work.width}x${work.height})`);
    const rest = await pill();
    console.log(`      pill at ${rest ? `${Math.round(rest.x)},${Math.round(rest.y)}` : "nowhere"}, edge ${controller.state.pill.edge}, screen ${work.width}x${work.height}`);
    check(rest !== null && rest.x > work.x + work.width - 160, "the pill rests on the right edge, where it was left");
    await hover(physical(rest).x, physical(rest).y);
    console.log(`      over the pill: the island gets the click: ${await islandGetsClick(rest)}; ignore calls ${ignoreCalls.join(" ") || "none"}; page pointer events ${JSON.stringify(await page("window.__pointer"))}`);
    check(rest !== null && await islandGetsClick(rest), "the pill takes clicks (the window is not click-through over it)");
    await hover(physical({ x: work.x + work.width / 2, y: work.y + work.height / 2 }).x, physical({ x: work.x + work.width / 2, y: work.y + work.height / 2 }).y);
    check(!(await islandGetsClick({ x: work.x + work.width / 2, y: work.y + work.height / 2 })), "clicks in the middle of the screen reach the apps under the pill's window");
    await hover(physical(rest).x, physical(rest).y);

    /* ---------- a real drag ---------- */
    const target = { x: work.x + 60, y: work.y + work.height * 0.3 };
    const from = physical(rest);
    await hover(from.x, from.y);
    await drag(from.x, from.y, physical(target).x, physical(target).y);
    await sleep(900);
    console.log(`      after the drag: page pointer events ${JSON.stringify(await page("window.__pointer"))}; ignore calls ${ignoreCalls.slice(-8).join(" ")}`);
    const moved = await pill();
    console.log(`      dragged to ${Math.round(target.x)},${Math.round(target.y)}; pill now ${moved ? `${Math.round(moved.x)},${Math.round(moved.y)}` : "nowhere"}, edge ${controller.state.pill.edge}`);
    check(controller.state.pill.edge === "left", `letting go near the left edge snaps the pill to it (${controller.state.pill.edge})`);
    check(moved !== null && moved.x < work.x + 120, "the pill moved onto the left edge");
    check(moved !== null && close(moved.y, target.y, 80), "the pill stays at the height it was dropped at");
    check(close(handle.islandBounds().width, work.width) && close(handle.islandBounds().x, work.x), "the window still covers the screen after the drag");

    /* ---------- it stays where dropped, and a real click opens it ---------- */
    await sleep(1500);
    const held = await pill();
    check(moved !== null && held !== null && close(held.x, moved.x, 4) && close(held.y, moved.y, 4), "the pill is still where it was let go, after a while");
    await click(physical(held).x, physical(held).y);
    check(await until(() => controller.state.expanded, 2500), "a real click on the pill opens the island out of it");
    await sleep(700);
    // An idle pill opens in place (the pill grows to hold Record); a call, a meeting or a card opens beside it.
    check((await page("document.querySelector('.side-strip')?.dataset.inline === 'true' || !!document.querySelector('.side-panel')")) === true, "the pill opens: it grows to hold Record, or the island is drawn beside it");
    await click(physical(held).x, physical(held).y);
    check(await until(() => !controller.state.expanded, 2500), "a real click on the pill closes it again");
    await sleep(600);
    check(!(await islandGetsClick({ x: held.x - 300, y: held.y })), "once closed, the space beside the pill reaches the apps again");

    /* ---------- back under the notch ---------- */
    handle.choosePlacement("notch");
    check(await until(() => controller.state.placement === "notch" && handle.islandBounds().width < work.width / 2, 3000), "choosing the notch brings the island back to the top");
    check((await foregroundPid()) === callPid, "the call window keeps the keyboard through all of it");
  } catch (error) {
    failures.push(String(error?.stack ?? error));
    console.log(error);
  } finally {
    try {
      call?.kill();
    } catch {
      // Already gone.
    }
  }
  console.log(failures.length ? `\nside-windows: ${failures.length} failed` : "\nside-windows: all passed");
  app.exit(failures.length ? 1 : 0);
});
app.on("window-all-closed", () => {});
