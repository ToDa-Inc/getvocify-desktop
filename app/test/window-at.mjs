// Windows only: which top-level window a mouse click at each screen point would reach, asked of Windows itself
// (WindowFromPoint honours a window's clip region, so this is the window's real click area).
import { execFileSync } from "node:child_process";

const NATIVE = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public class Hit {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  public static long At(int x, int y) { var p = new POINT { X = x, Y = y }; return GetAncestor(WindowFromPoint(p), 2).ToInt64(); }
}
'@
`;

/** The top-level window under each point (physical screen pixels), as a number. */
export function windowsAt(points) {
  const script = `${NATIVE}\n${points.map((p) => `[Hit]::At(${Math.round(p.x)}, ${Math.round(p.y)})`).join("\n")}`;
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 60000 });
  return out.trim().split(/\s+/).map(Number);
}

/** A BrowserWindow's HWND, as the same number. */
export function hwndOf(win) {
  const handle = win.getNativeWindowHandle();
  return handle.length === 8 ? Number(handle.readBigUInt64LE()) : handle.readUInt32LE();
}

/**
 * Where the island takes clicks, measured: its centre, just under its bar, and just left of the island the page draws.
 * `drawn` is the page's island rect inside the window (CSS px = DIP).
 */
export function islandClickArea(screen, island, barHeight, drawn) {
  const bounds = island.getBounds();
  const toScreen = (x, y) => screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) });
  const centreX = bounds.x + drawn.x + drawn.width / 2;
  const [centre, below, left] = windowsAt([
    toScreen(centreX, bounds.y + barHeight / 2),
    toScreen(centreX, bounds.y + barHeight + 4),
    toScreen(bounds.x + drawn.x - 10, bounds.y + barHeight / 2),
  ]);
  const own = hwndOf(island);
  return { window: bounds, centre: centre === own, below: below === own, left: left === own };
}
