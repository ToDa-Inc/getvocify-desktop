// Windows only: the system's own mouse (SetCursorPos and mouse_event), as a rep's hand, for the end-to-end tests, and the
// window a point reaches. Points are physical screen pixels (Electron's dipToScreenPoint gives them). Asynchronous, so a
// slow PowerShell never holds the app's event loop (nor the test's own timeout).
import { execFile } from "node:child_process";

const NATIVE = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
public class Hit {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  public static long At(int x, int y) { var p = new POINT { X = x, Y = y }; return GetAncestor(WindowFromPoint(p), 2).ToInt64(); }
}
'@
`;
const powershell = (script) =>
  new Promise((resolve, reject) =>
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", NATIVE + script], { encoding: "utf8", windowsHide: true, timeout: 30000 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout.trim()),
    ),
  );
const move = (x, y) => `[void][W]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}); `;
const wait = (ms) => `Start-Sleep -Milliseconds ${ms}; `;
const DOWN = "[W]::mouse_event(2,0,0,0,[UIntPtr]::Zero); ";
const UP = "[W]::mouse_event(4,0,0,0,[UIntPtr]::Zero); ";

/** A real click at (x, y). The pointer rests there first, so the window under it has a moment to notice. */
export const click = (x, y) => powershell(`${move(x, y)}${wait(250)}${DOWN}${wait(60)}${UP}${wait(300)}`);

/** The pointer moved to (x, y) and left there for a moment (a hover). */
export const hover = (x, y) => powershell(`${move(x, y)}${wait(250)}`);

/** A real press at (x0, y0), dragged in steps to (x1, y1), and let go there. */
export function drag(x0, y0, x1, y1, steps = 25) {
  const path = Array.from({ length: steps }, (_, i) => move(x0 + ((x1 - x0) * (i + 1)) / steps, y0 + ((y1 - y0) * (i + 1)) / steps) + wait(25)).join("");
  return powershell(`${move(x0, y0)}${wait(250)}${DOWN}${wait(120)}${path}${wait(120)}${UP}${wait(300)}`);
}

/** The top-level window (its HWND as a number) a click at each physical point reaches. */
export async function windowsAtPoints(points) {
  const out = await powershell(points.map((p) => `[Hit]::At(${Math.round(p.x)}, ${Math.round(p.y)})`).join("\n"));
  return out.split(/\s+/).map(Number);
}

/** The process the keyboard goes to right now. */
export async function foregroundPid() {
  return Number(await powershell(`$h = [W]::GetForegroundWindow(); $p = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$p); $p`));
}
