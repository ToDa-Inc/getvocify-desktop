// Windows only: a REAL mouse drag over the open island's transcript must not leave text selected, and a click elsewhere
// must leave nothing selected. The island never takes the keyboard on Windows, so a selection there could never be
// copied; a drag used to run across every bubble with no way to clear it. The same drag is made once as the page was
// before (the platform mark taken off) to show what the check would catch, then as the app ships it.
// Run: node test/build-shell-test.mjs && node island/build.mjs && electron test/select-windows.mjs   (skips on other systems)
import { app, screen } from "electron";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtures } from "../island/fixtures/index.mjs";

if (process.platform !== "win32") {
  console.log("select-windows: skipped (not Windows)");
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const NATIVE = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
'@
`;
const powershell = (script) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 60000 }).trim();
/** Press at one point, move there in small steps, release: the system's own mouse input. */
const drag = (from, to) => {
  const steps = Array.from({ length: 12 }, (_, i) => {
    const x = Math.round(from.x + ((to.x - from.x) * (i + 1)) / 12);
    const y = Math.round(from.y + ((to.y - from.y) * (i + 1)) / 12);
    return `[void][W]::SetCursorPos(${x}, ${y}); Start-Sleep -Milliseconds 40;`;
  }).join(" ");
  powershell(`${NATIVE}\n[void][W]::SetCursorPos(${from.x}, ${from.y}); Start-Sleep -Milliseconds 150; [W]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; ${steps} [W]::mouse_event(4,0,0,0,[UIntPtr]::Zero)`);
};
const click = (at) => powershell(`${NATIVE}\n[void][W]::SetCursorPos(${at.x}, ${at.y}); Start-Sleep -Milliseconds 150; [W]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [W]::mouse_event(4,0,0,0,[UIntPtr]::Zero)`);

app.whenReady().then(async () => {
  try {
    const userDataDir = mkdtempSync(join(tmpdir(), "vocify-select-"));
    writeFileSync(join(userDataDir, "settings.json"), JSON.stringify({ recorderReady: true }));
    const { startApp } = await import(pathToFileURL(join(here, "../main/dist-shell-test/app.mjs")).href);
    const handle = await startApp({ dashboardUrl: pathToFileURL(join(here, "../main/demo/fake-dashboard.html")).href, trustFiles: true, userDataDir });
    await sleep(1500);
    const page = handle.island.webContents;
    const run = (code) => page.executeJavaScript(code);
    check((await run("document.documentElement.dataset.platform")) === "win32", "the island's page knows it runs on Windows");

    // The open island on a call, its transcript showing (the fixture the island's screenshots use).
    const fixture = fixtures.find((f) => f.name === "in-call-brief");
    const state = { ...fixture.state, material: "opaque", reduceMotion: true };
    const bounds = handle.island.getBounds();
    handle.island.setBounds({ x: bounds.x, y: bounds.y, width: fixture.expect.width, height: fixture.expect.height });
    await sleep(600);

    const toScreen = (point) => {
      const b = handle.island.getBounds();
      return screen.dipToScreenPoint({ x: Math.round(b.x + point.x), y: Math.round(b.y + point.y) });
    };
    const attempt = async (label) => {
      await run(`window.__setIslandState(${JSON.stringify(state)}); getSelection().removeAllRanges(); true`);
      await sleep(600);
      const where = await run(`(() => {
        const bubbles = [...document.querySelectorAll(".bubble")].map((b) => b.getBoundingClientRect());
        const rows = [...document.querySelectorAll('.turn[data-you="true"]')].map((r) => r.getBoundingClientRect());
        if (bubbles.length < 2 || rows.length === 0) return null;
        const first = bubbles[0], last = bubbles[bubbles.length - 1], row = rows[0];
        return { from: { x: first.left + 8, y: first.top + first.height / 2 }, to: { x: last.right - 8, y: last.top + last.height / 2 }, empty: { x: row.left + 6, y: row.top + row.height / 2 }, count: bubbles.length };
      })()`);
      if (!where) {
        check(false, `${label}: the transcript is on screen`);
        return null;
      }
      drag(toScreen(where.from), toScreen(where.to));
      await sleep(400);
      const dragged = await run("getSelection().toString().length");
      click(toScreen(where.empty));
      await sleep(400);
      const afterClick = await run("getSelection().toString().length");
      console.log(`      ${label}: ${where.count} bubbles; after the drag ${dragged} characters selected, after a click beside them ${afterClick}`);
      return { dragged, afterClick };
    };

    // As the page was before: the platform mark off, so the bubbles take a selection again.
    await run("delete document.documentElement.dataset.platform; true");
    const before = await attempt("as before");
    if (before) console.log(`      (as before, the drag ${before.dragged > 0 ? "selected text" : "selected nothing"}: ${before.dragged > 0 ? "the check can see it" : "this machine did not show the problem"})`);

    await run("document.documentElement.dataset.platform = 'win32'; true");
    const now = await attempt("now");
    if (now) {
      check(now.dragged === 0, "a drag over the transcript selects nothing");
      check(now.afterClick === 0, "nothing is left selected after a click");
    }
  } catch (error) {
    failures.push(`threw: ${error}`);
    console.log(`FAIL threw: ${error}`);
  }
  console.log(failures.length ? `\nselect-windows: ${failures.length} failed` : "\nselect-windows: all passed");
  app.exit(failures.length ? 1 : 0);
});
app.on("window-all-closed", () => {});
