// Windows only: a REAL mouse click on the island must act on the first press and must not take focus from the window the
// rep is in (the call). A plain window is put in front, the island is clicked with the system's own mouse input, and the
// foreground window must be the same one afterwards.
// Run: node test/build-shell-test.mjs && electron test/focus-windows.mjs   (skips on other systems)
import { app, screen } from "electron";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.platform !== "win32") {
  console.log("focus-windows: skipped (not Windows)");
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
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
'@
`;
const powershell = (script) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 60000 }).trim();
const foreground = () => {
  const out = powershell(`${NATIVE}\n$h = [W]::GetForegroundWindow(); $p = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$p); "$($h.ToInt64()) $p"`);
  const [hwnd, pid] = out.split(/\s+/).map(Number);
  return { hwnd, pid };
};
const click = (x, y) => powershell(`${NATIVE}\n[void][W]::SetCursorPos(${x}, ${y}); Start-Sleep -Milliseconds 150; [W]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [W]::mouse_event(4,0,0,0,[UIntPtr]::Zero)`);

app.whenReady().then(async () => {
  let target = null;
  try {
    const userDataDir = mkdtempSync(join(tmpdir(), "vocify-focus-"));
    writeFileSync(join(userDataDir, "settings.json"), JSON.stringify({ recorderReady: true }));
    const { startApp } = await import(pathToFileURL(join(here, "../main/dist-shell-test/app.mjs")).href);
    const handle = await startApp({ dashboardUrl: pathToFileURL(join(here, "../main/demo/fake-dashboard.html")).href, trustFiles: true, userDataDir });
    await sleep(1500);

    // A plain window stands in for the call window.
    target = spawn("powershell.exe", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form; $f.Text = 'FOCUS-TARGET'; $f.Width = 500; $f.Height = 300; $f.Add_Shown({ $f.Activate() }); [System.Windows.Forms.Application]::Run($f)"], { stdio: "ignore", windowsHide: false });
    await sleep(4000);
    const before = foreground();
    const ours = new Set(app.getAppMetrics().map((p) => p.pid).concat(process.pid));
    console.log(`      foreground before the click: window ${before.hwnd}, process ${before.pid}`);
    check(!ours.has(before.pid), "the window in front is not the island's app");

    const bounds = handle.islandBounds();
    const point = screen.dipToScreenPoint({ x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + handle.controller.state.geometry.barHeight / 2) });
    click(point.x, point.y);
    await sleep(900);
    const after = foreground();
    console.log(`      foreground after the click: window ${after.hwnd}, process ${after.pid}`);
    check(handle.controller.state.expanded === true, "the first click acts: the island opened");
    check(after.hwnd === before.hwnd, "the click did not take focus from the window the rep was in");
    check(!ours.has(after.pid), "the island's app is still not in front");

    // The same must hold for a button inside the open island.
    const open = handle.islandBounds();
    check(open.height > handle.controller.state.geometry.barHeight, `the open island is ${open.height}px tall`);
  } catch (error) {
    failures.push(`threw: ${error}`);
    console.log(`FAIL threw: ${error}`);
  } finally {
    try {
      if (target?.pid) execFileSync("taskkill", ["/PID", String(target.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // Already gone.
    }
  }
  console.log(failures.length ? `\nfocus-windows: ${failures.length} failed` : "\nfocus-windows: all passed");
  app.exit(failures.length ? 1 : 0);
});
app.on("window-all-closed", () => {});
