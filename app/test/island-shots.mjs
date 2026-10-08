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
  // Each fixture starts from nothing remembered (a folded section from an earlier run must not carry over).
  await win.webContents.executeJavaScript(`try { localStorage.clear(); } catch {} window.__fixedNow=${NOW}; true`);
  const started = await win.webContents.executeJavaScript(`new Promise(r=>{let n=0;const t=()=>window.__setIslandState?r(true):++n>300?r(false):setTimeout(t,10);t()})`);
  if (!started) errors.push("island script never started (window.__setIslandState missing)");
  if (started) await win.webContents.executeJavaScript(`window.__setIslandState(${JSON.stringify(fixture.state)}); true`);
  // A card sized from its content animates to its height after it is measured.
  await (fixture.fit || fixture.natural ? new Promise((resolve) => setTimeout(resolve, 700)) : frame());
  return { win, errors };
}

const measure = (win) => win.webContents.executeJavaScript(`(() => {
  const el = document.querySelector('.island');
  if (!el) return { missing: true };
  const r = el.getBoundingClientRect();
  const overflow = [...document.querySelectorAll('.ear, .menu, .controls, .help, .lost-line, .stop-button, .primary-action')]
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
    briefRows: document.querySelectorAll('.call-brief .recent-line').length,
    repeatedLabels: (() => {
      const labels = [...document.querySelectorAll('.recent-label')].map((label) => label.textContent.trim().toLowerCase());
      return labels.filter((label, i) => labels.indexOf(label) !== i);
    })(),
    title: document.querySelector('.topbar')?.title ?? '',
    offer: (() => {
      const offer = document.querySelector('.offer');
      if (!offer) return null;
      const lines = [...document.querySelectorAll('.recent-line')];
      const texts = [...document.querySelectorAll('.recent-text')];
      return {
        bottom: Math.ceil(offer.getBoundingClientRect().bottom),
        cut: texts.filter((line) => line.scrollHeight > line.clientHeight + 1 || line.scrollWidth > line.clientWidth + 1).length,
        lines: lines.length,
        whens: document.querySelectorAll('.recent-when').length,
        icons: lines.filter((line) => line.querySelector('.recent-icon svg')).length,
        loading: !!document.querySelector('.recent-loading'),
        who: document.querySelectorAll('.recent-who').length,
        toggles: document.querySelectorAll('.company-toggle').length,
        sideways: document.documentElement.scrollWidth > innerWidth || offer.scrollWidth > offer.clientWidth + 1,
        reported: (window.__islandSizes || []).at(-1)?.height ?? null,
      };
    })(),
    // The meeting heads-up's row: what is cut, measured in the real layout (an ellipsis keeps scrollWidth > clientWidth).
    meeting: (() => {
      const line = document.querySelector('.meeting-line');
      if (!line) return null;
      const cut = (e) => !!e && e.scrollWidth > e.clientWidth + 1;
      const place = document.querySelector('.meeting-place');
      const who = document.querySelector('.meeting-who');
      const more = document.querySelector('.meeting-who-more');
      return {
        // The line overflowing past what the title's own ellipsis absorbs means when/where is cut.
        placeCut: cut(line) || (place && place.getBoundingClientRect().right > line.getBoundingClientRect().right + 1),
        moreCut: !!more && (cut(who) || more.getBoundingClientRect().right > who.getBoundingClientRect().right + 1),
        nameCut: cut(document.querySelector('.meeting-who-name')),
        titleCut: cut(document.querySelector('.meeting-title')),
        place: place?.textContent ?? '',
        pastIsland: [...document.querySelectorAll('.offer-row > *')].some((e) => e.getBoundingClientRect().right > r.right - 1),
      };
    })(),
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
  if (process.env.ISLAND_PROGRESS) console.log(`fixture ${fixture.name}`);
  const { win, errors } = await open(fixture);
  const problems = [];
  for (const selector of fixture.steps ?? []) {
    const clicked = await win.webContents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    if (!clicked) problems.push(`step target missing: ${selector}`);
    await (fixture.fit || fixture.natural ? new Promise((resolve) => setTimeout(resolve, 700)) : frame());
  }
  const m = await measure(win);
  if (m.missing) problems.push("island did not render");
  else {
    if (m.width !== fixture.expect.width || (!fixture.fit && !fixture.natural && m.height !== fixture.expect.height)) {
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
    if (fixture.natural) {
      // As tall as what it shows: the brief is never cut off at the bottom, and the window follows.
      if (!m.offer) problems.push("no call offer rendered");
      else {
        if (m.offer.bottom > m.height + 1) problems.push(`the brief reaches ${m.offer.bottom}px but the island is ${m.height}px: it is cut off`);
        if (m.offer.reported !== m.height) problems.push(`the window was told ${m.offer.reported}px for a ${m.height}px island`);
        // Every line in full: nothing cut, nothing hidden behind "more", nothing scrolling sideways.
        if (m.offer.cut) problems.push(`${m.offer.cut} brief line(s) cut`);
        if (m.offer.sideways) problems.push("the brief scrolls sideways");
        if (fixture.expect.lines !== undefined && m.offer.lines !== fixture.expect.lines) problems.push(`${m.offer.lines} brief line(s) shown, expected ${fixture.expect.lines}`);
        if (fixture.expect.whens !== undefined && m.offer.whens !== fixture.expect.whens) problems.push(`${m.offer.whens} brief date(s) shown, expected ${fixture.expect.whens}`);
        if (fixture.expect.icons !== undefined && m.offer.icons !== fixture.expect.icons) problems.push(`${m.offer.icons} brief icon(s) shown, expected ${fixture.expect.icons}`);
        if (fixture.expect.who !== undefined && m.offer.who !== fixture.expect.who) problems.push(`${m.offer.who} line(s) name who it was with, expected ${fixture.expect.who}`);
        if (fixture.expect.toggles !== undefined && m.offer.toggles !== fixture.expect.toggles) problems.push(`${m.offer.toggles} company toggle(s), expected ${fixture.expect.toggles}`);
        if (fixture.expect.loading !== undefined && m.offer.loading !== fixture.expect.loading) problems.push(fixture.expect.loading ? "no placeholder while the brief loads" : "a loading placeholder with the brief ready");
      }
    }
    if (m.overflow.length) problems.push(`content wider than its box: ${m.overflow.join("; ")}`);
    if (m.atBottom === false) problems.push("transcript not scrolled to the latest line");
    if (m.repeatedLabels.length) problems.push(`label shown twice: ${m.repeatedLabels.join(", ")}`);
    if (fixture.expect.meeting) {
      const e = fixture.expect.meeting;
      if (!m.meeting) problems.push("no meeting row rendered");
      else {
        if (m.meeting.placeCut) problems.push(`when and where cut ("${m.meeting.place}")`);
        if (m.meeting.moreCut) problems.push('the "+N" after the name is cut');
        if (m.meeting.pastIsland) problems.push("the meeting row runs past the island");
        if (m.meeting.nameCut !== e.nameCut) problems.push(m.meeting.nameCut ? "the name is cut" : "the name was expected to give way");
        if (m.meeting.titleCut !== e.titleCut) problems.push(m.meeting.titleCut ? "the title is cut" : "the title was expected to give way");
      }
    }
    if (fixture.expect.briefRows !== undefined && m.briefRows !== fixture.expect.briefRows) problems.push(`${m.briefRows} row(s) in the call's brief, expected ${fixture.expect.briefRows}`);
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
