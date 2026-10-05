// Renders every island fixture in a real Electron window, checks size, overflow, scroll and clicks,
// and writes a PNG per fixture plus one contact sheet. Run: npm run test:island
import { app, BrowserWindow } from "electron";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures, interactions, NOW } from "../island/fixtures/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "../island/dist/index.html");
const out = join(here, "out");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const WALLPAPER = "linear-gradient(160deg,#27324a 0%,#5b4a6e 45%,#c98f6b 100%)";
const frame = () => new Promise((resolve) => setTimeout(resolve, 60));

async function open(fixture) {
  const width = Math.max(520, fixture.expect.width + 60);
  const height = fixture.expect.height + 40;
  const win = new BrowserWindow({
    show: false, width, height, useContentSize: true, frame: false, resizable: false,
    backgroundColor: "#27324a",
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const errors = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) errors.push(message);
  });
  win.webContents.on("render-process-gone", (_e, details) => errors.push(`renderer gone: ${details.reason}`));
  await win.loadFile(dist);
  await win.webContents.insertCSS(`html,body{background:${WALLPAPER} !important}`);
  await win.webContents.executeJavaScript(`window.__fixedNow=${NOW}; true`);
  const started = await win.webContents.executeJavaScript(`new Promise(r=>{let n=0;const t=()=>window.__setIslandState?r(true):++n>300?r(false):setTimeout(t,10);t()})`);
  if (!started) errors.push("island script never started (window.__setIslandState missing)");
  if (started) await win.webContents.executeJavaScript(`window.__setIslandState(${JSON.stringify(fixture.state)}); true`);
  await frame();
  return { win, errors };
}

const measure = (win) => win.webContents.executeJavaScript(`(() => {
  const el = document.querySelector('.island');
  if (!el) return { missing: true };
  const r = el.getBoundingClientRect();
  const overflow = [...document.querySelectorAll('.ear, .menu, .controls, .help, .lost-line')]
    .filter((e) => e.scrollWidth > e.clientWidth + 1)
    .map((e) => e.className + ' ' + e.scrollWidth + '>' + e.clientWidth);
  const t = document.querySelector('.transcript');
  const bubbles = [...document.querySelectorAll('.bubble')].map((b) => b.getBoundingClientRect());
  const clipped = t ? bubbles.filter((b) => b.left < r.left - 0.5 || b.right > r.right + 0.5).length : 0;
  return {
    width: Math.round(r.width), height: Math.round(r.height),
    inViewport: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    overflow,
    atBottom: t ? t.scrollHeight - t.scrollTop - t.clientHeight < 2 : null,
    clipped,
    title: document.querySelector('.topbar')?.title ?? '',
  };
})()`);

const failures = [];
const report = [];

// Electron emits `ready` only after an ES-module entry has finished loading, so the work runs in a function, not top-level await.
app.disableHardwareAcceleration();
app.whenReady().then(main).catch((error) => {
  console.error(error);
  app.exit(1);
});

async function main() {

for (const fixture of fixtures) {
  const { win, errors } = await open(fixture);
  for (const selector of fixture.steps ?? []) {
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
    await frame();
  }
  const m = await measure(win);
  const problems = [];
  if (m.missing) problems.push("island did not render");
  else {
    if (m.width !== fixture.expect.width || m.height !== fixture.expect.height) {
      problems.push(`size ${m.width}x${m.height}, expected ${fixture.expect.width}x${fixture.expect.height}`);
    }
    if (!m.inViewport) problems.push("island outside its window");
    if (m.overflow.length) problems.push(`content wider than its box: ${m.overflow.join("; ")}`);
    if (m.atBottom === false) problems.push("transcript not scrolled to the latest line");
    if (m.clipped) problems.push(`${m.clipped} bubble(s) cut off at the island edge`);
  }
  if (errors.length) problems.push(`console errors: ${errors.join(" | ")}`);
  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  if (png.length < 2000) problems.push("screenshot is empty");
  writeFileSync(join(out, `${fixture.name}.png`), png);
  report.push({ name: fixture.name, measured: m, problems });
  if (problems.length) failures.push(`${fixture.name}: ${problems.join("; ")}`);
  win.destroy();
}

for (const test of interactions) {
  const fixture = fixtures.find((f) => f.name === test.fixture);
  const { win } = await open(fixture);
  for (const selector of fixture.steps ?? []) {
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
    await frame();
  }
  await win.webContents.executeJavaScript(`window.__islandActions.length = 0; document.querySelector(${JSON.stringify(test.click)}).click(); true`);
  await frame();
  const actions = await win.webContents.executeJavaScript(`JSON.parse(JSON.stringify(window.__islandActions))`);
  const ok = JSON.stringify(actions) === JSON.stringify(test.expect);
  report.push({ name: `click:${test.name}`, actions, problems: ok ? [] : [`sent ${JSON.stringify(actions)}, expected ${JSON.stringify(test.expect)}`] });
  if (!ok) failures.push(`click:${test.name}: sent ${JSON.stringify(actions)}, expected ${JSON.stringify(test.expect)}`);
  win.destroy();
}

// Contact sheet: every screenshot in one image, for review.
const cells = fixtures.map((f) => `<figure><img src="${f.name}.png"><figcaption>${f.name}</figcaption></figure>`).join("");
writeFileSync(join(out, "sheet.html"), `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#101114;color:#9aa0aa;font:11px -apple-system,sans-serif;display:flex;flex-wrap:wrap;gap:10px;padding:10px;width:1620px}
figure{margin:0}figcaption{padding:3px 0}img{display:block;border:1px solid #2a2d34}</style>${cells}`);
const sheet = new BrowserWindow({ show: false, width: 1640, height: 800, useContentSize: true, webPreferences: { backgroundThrottling: false } });
await sheet.loadFile(join(out, "sheet.html"));
await frame();
const fullHeight = await sheet.webContents.executeJavaScript("document.documentElement.scrollHeight");
sheet.setContentSize(1640, Math.min(fullHeight, 12000));
await frame();
writeFileSync(join(out, "sheet.png"), (await sheet.webContents.capturePage()).toPNG());
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));

const total = report.length;
console.log(`\nisland: ${total - failures.length}/${total} checks passed`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
app.exit(failures.length ? 1 : 0);
}
