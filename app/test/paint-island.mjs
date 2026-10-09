// Looks for stale paint in the island's see-through window while a call streams: words left on screen after the text
// under them changed, or patches never drawn. Every so often the call is held still and the window is captured twice,
// as it is and again after everything was forced to draw afresh; the two must be the same picture.
// The page is played as the Windows app shows it (the solid glass, no blur behind the window). `--nogpu` turns hardware
// acceleration off, to tell a fault of the graphics card's drawing from one of the page's.
// Run: node island/build.mjs --preview && electron test/paint-island.mjs [--script=rally] [--nogpu] [--report]
// How to read it, and how it is run on a Windows machine: docs/WINDOWS-PAINT-CHECK.md
import { app, BrowserWindow, desktopCapturer, screen } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const script = arg("script", "");
const label = `island${script ? `-${script}` : ""}${process.argv.includes("--nogpu") ? "-nogpu" : ""}`;
const out = join(here, "out-paint");
mkdirSync(out, { recursive: true });
if (process.argv.includes("--nogpu")) app.disableHardwareAcceleration();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const BOUNDS = { x: 60, y: 60, width: 520, height: 440 };

/** How many pixels differ clearly between two captures of the same size (and where the first one is). */
function differing(a, b) {
  const sa = a.getSize();
  const sb = b.getSize();
  if (sa.width !== sb.width || sa.height !== sb.height) return { count: -1, at: null };
  const pa = a.toBitmap();
  const pb = b.toBitmap();
  let count = 0;
  let at = null;
  // The top bar has the clock and the voice wave, which move on their own: the conversation starts under it.
  for (let i = 44 * Math.round(sa.width / BOUNDS.width) * sa.width * 4; i < pa.length; i += 4) {
    if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 90) {
      count += 1;
      at ??= { x: (i / 4) % sa.width, y: Math.floor(i / 4 / sa.width) };
    }
  }
  return { count, at };
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    ...BOUNDS,
    frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, focusable: false, skipTaskbar: true,
    show: false, alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  await win.loadFile(join(here, "../island/dist/live.html"), { query: { speed: "1.5", ...(script ? { script } : {}), material: "opaque" } });
  win.showInactive();
  const run = (code) => win.webContents.executeJavaScript(code);
  const display = screen.getPrimaryDisplay();
  const factor = display.scaleFactor;
  /** The window as the screen shows it (what a person sees), cut out of a capture of the whole screen. */
  const fromScreen = async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.round(display.size.width * factor), height: Math.round(display.size.height * factor) } });
    const shot = sources[0]?.thumbnail;
    if (!shot || shot.isEmpty()) return null;
    return shot.crop({ x: Math.round(BOUNDS.x * factor), y: Math.round(BOUNDS.y * factor), width: Math.round(BOUNDS.width * factor), height: Math.round(BOUNDS.height * factor) });
  };

  const worst = { page: 0, screen: 0 };
  let checks = 0;
  let screenWorks = true;
  const until = Date.now() + 150_000;
  for (;;) {
    await sleep(650);
    const done = await run("Boolean(window.__LIVE && window.__LIVE.done)");
    if (done || Date.now() > until) break;
    // Hold the call still, let what is moving finish, and stop the dots where they are.
    await run("window.__livePause = true; document.documentElement.classList.add('held'); true");
    await win.webContents.insertCSS(".held * { animation-play-state: paused !important; transition: none !important; }");
    await sleep(700);
    const pageBefore = await win.webContents.capturePage();
    const screenBefore = screenWorks ? await fromScreen() : null;
    if (!screenBefore) screenWorks = false;
    // Everything drawn afresh: hidden for a frame, shown again, and the window told to repaint.
    await run("new Promise((r) => { const root = document.getElementById('root'); root.style.visibility = 'hidden'; requestAnimationFrame(() => requestAnimationFrame(() => { root.style.visibility = ''; requestAnimationFrame(() => requestAnimationFrame(r)); })); })");
    win.webContents.invalidate();
    await sleep(350);
    const pageAfter = await win.webContents.capturePage();
    const screenAfter = screenWorks ? await fromScreen() : null;
    checks += 1;
    const page = differing(pageBefore, pageAfter);
    const onScreen = screenBefore && screenAfter ? differing(screenBefore, screenAfter) : { count: 0, at: null };
    if (page.count > worst.page) {
      worst.page = page.count;
      writeFileSync(join(out, `${label}-page-stale.png`), pageBefore.toPNG());
      writeFileSync(join(out, `${label}-page-fresh.png`), pageAfter.toPNG());
    }
    if (onScreen.count > worst.screen) {
      worst.screen = onScreen.count;
      writeFileSync(join(out, `${label}-screen-stale.png`), screenBefore.toPNG());
      writeFileSync(join(out, `${label}-screen-fresh.png`), screenAfter.toPNG());
    }
    if (page.count > 0 || onScreen.count > 0) console.log(`${label}: check ${checks}: page ${page.count} px${page.at ? ` from ${page.at.x},${page.at.y}` : ""}, screen ${onScreen.count} px`);
    await run("document.documentElement.classList.remove('held'); window.__livePause = false; true");
  }
  const gpu = app.getGPUFeatureStatus();
  console.log(`${label}: ${checks} checks, worst stale paint: page ${worst.page} px, screen ${screenWorks ? `${worst.screen} px` : "not captured"}; compositing ${gpu.gpu_compositing}, raster ${gpu.rasterization}; scale ${factor}`);
  const clean = worst.page <= 40 && worst.screen <= 40;
  app.exit(process.argv.includes("--report") || clean ? 0 : 1);
});
