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
  // A card that is as tall as its content has no fixed expected height: give its window room.
  const height = fixture.fit ? 760 : fixture.expect.height + 40;
  const win = new BrowserWindow({
    show: false, width, height, useContentSize: true, frame: false, resizable: false,
    backgroundColor: "#27324a",
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  // A hidden window produces no frames on Windows, so nothing that waits for a frame (a resize observer) would run.
  if (process.platform === "win32") win.showInactive();
  const errors = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) errors.push(message);
  });
  win.webContents.on("render-process-gone", (_e, details) => errors.push(`renderer gone: ${details.reason}`));
  await win.loadFile(dist);
  await win.webContents.insertCSS(`html,body{background:${WALLPAPER} !important}`);
  await win.webContents.executeJavaScript(`window.__fixedNow=${NOW}; true`);
  const started = await win.webContents.executeJavaScript(`new Promise(r=>{let n=0;const t=()=>window.__setIslandState?r(true):++n>300?r(false):setTimeout(t,10);t()})`);
  if (!started) errors.push("island script never started (window.__setIslandState missing)");
  if (started) await win.webContents.executeJavaScript(`window.__setIslandState(${JSON.stringify(fixture.state)}); true`);
  // A card sized from its content animates to its height after it is measured.
  await (fixture.fit ? new Promise((resolve) => setTimeout(resolve, 700)) : frame());
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
    card: (() => {
      const card = document.querySelector('.postcall-card');
      if (!card) return null;
      return { overflow: card.scrollHeight - card.clientHeight, cardHeight: Math.round(card.getBoundingClientRect().height), bar: document.querySelector('.topbar').getBoundingClientRect().height };
    })(),
    popup: (() => {
      const popup = document.querySelector('.float-menu');
      if (!popup) return null;
      const sizes = window.__islandSizes || [];
      return { bottom: Math.ceil(popup.getBoundingClientRect().bottom), reported: sizes.length ? sizes[sizes.length - 1].height : Math.round(r.bottom), expectPick: !!document.querySelector('.postcall-card'), selected: popup.querySelectorAll('[data-selected="true"]').length, right: Math.ceil(popup.getBoundingClientRect().right), islandRight: Math.ceil(r.right) };
    })(),
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
  // Destroying the last live window makes the next window's renderer fail to start in some environments,
  // so one hidden window stays open for the whole run.
  const anchor = new BrowserWindow({ show: false, width: 100, height: 100 });
  await anchor.loadURL("data:text/html,<title>anchor</title>");

for (const fixture of fixtures) {
  const { win, errors } = await open(fixture);
  const problems = [];
  for (const selector of fixture.steps ?? []) {
    const clicked = await win.webContents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    if (!clicked) problems.push(`step target missing: ${selector}`);
    await (fixture.fit ? new Promise((resolve) => setTimeout(resolve, 700)) : frame());
  }
  const m = await measure(win);
  if (m.missing) problems.push("island did not render");
  else {
    if (m.width !== fixture.expect.width || (!fixture.fit && m.height !== fixture.expect.height)) {
      problems.push(`size ${m.width}x${m.height}, expected ${fixture.expect.width}x${fixture.expect.height}`);
    }
    if (!m.inViewport) problems.push("island outside its window");
    if (m.popup) {
      if (m.popup.reported < m.popup.bottom) problems.push(`the window is ${m.popup.reported}px tall but a dropdown reaches ${m.popup.bottom}px: its end would be cut off`);
      if (m.popup.right > m.popup.islandRight) problems.push("a dropdown reaches past the island's right edge");
      // The after-call card always has a value picked; the call-type list while recording may only show a proposal.
      if (m.popup.expectPick && m.popup.selected < 1) problems.push("the dropdown does not show which option is picked");
    }
    if (fixture.fit) {
      if (!m.card) problems.push("no after-call card rendered");
      else {
        if (m.card.overflow > 1) problems.push(`card content ${m.card.overflow}px taller than its box`);
        if (Math.abs(m.height - (m.card.bar + m.card.cardHeight)) > 1) problems.push(`island ${m.height}px but bar + card is ${m.card.bar + m.card.cardHeight}px`);
      }
    }
    if (m.overflow.length) problems.push(`content wider than its box: ${m.overflow.join("; ")}`);
    if (m.atBottom === false) problems.push("transcript not scrolled to the latest line");
    if (m.clipped) problems.push(`${m.clipped} bubble(s) cut off at the island edge`);
  }
  if (errors.length) problems.push(`console errors: ${errors.join(" | ")}`);
  // A hidden window can hand back a blank frame the first time; ask again before calling it empty.
  let png = (await win.webContents.capturePage()).toPNG();
  for (let attempt = 0; attempt < 3 && png.length < 2000; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    png = (await win.webContents.capturePage()).toPNG();
  }
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
  // Clicks that set the scene first (untick a change...), then the click whose action is checked.
  for (const selector of test.before ?? []) {
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
