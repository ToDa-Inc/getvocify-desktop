// Renders every island fixture in a real Electron window, checks size, overflow, scroll and clicks,
// and writes a PNG per fixture plus one contact sheet. Run: npm run test:island
import { app, BrowserWindow } from "electron";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures, interactions, NOW, pillDrags } from "../island/fixtures/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "../island/dist/index.html");
const out = join(here, "out");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const WALLPAPER = "linear-gradient(160deg,#27324a 0%,#5b4a6e 45%,#c98f6b 100%)";
const frame = () => new Promise((resolve) => setTimeout(resolve, 60));

async function open(fixture) {
  // As a pill the window is the screen itself (the pill and its panel are drawn inside it): it gets exactly that size.
  const width = fixture.side ? fixture.expect.width : Math.max(520, fixture.expect.width + 60);
  // A card that is as tall as its content has no fixed expected height: give its window room.
  const height = fixture.side ? fixture.expect.height : fixture.fit ? 760 : fixture.expect.height + 40;
  const win = new BrowserWindow({
    show: false, width, height, useContentSize: true, frame: false, resizable: false,
    backgroundColor: "#27324a",
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  // A hidden window produces no frames on Windows, so nothing that waits for a frame (a resize observer) would run.
  if (process.platform === "win32") win.showInactive();
  const errors = [];
  win.webContents.on("console-message", ({ level, message }) => {
    if (level === "error") errors.push(message);
  });
  win.webContents.on("render-process-gone", (_e, details) => errors.push(`renderer gone: ${details.reason}`));
  await win.loadFile(dist);
  await win.webContents.insertCSS(`html,body{background:${WALLPAPER} !important}`);
  // Each fixture starts from nothing remembered (a folded section from an earlier run must not carry over).
  await win.webContents.executeJavaScript(`try { localStorage.clear(); } catch {} window.__fixedNow=${NOW}; true`);
  const started = await win.webContents.executeJavaScript(`new Promise(r=>{let n=0;const t=()=>window.__setIslandState?r(true):++n>300?r(false):setTimeout(t,10);t()})`);
  if (!started) errors.push("island script never started (window.__setIslandState missing)");
  if (started) await win.webContents.executeJavaScript(`window.__setIslandState(${JSON.stringify(fixture.state)}); true`);
  // A card sized from its content animates to its height after it is measured; the pill's island grows out of it.
  await (fixture.fit || fixture.natural || fixture.side ? new Promise((resolve) => setTimeout(resolve, 700)) : frame());
  return { win, errors };
}

const measure = (win, fixture) => win.webContents.executeJavaScript(`(() => {
  const el = document.querySelector('.island');
  if (!el) return { missing: true };
  const r = el.getBoundingClientRect();
  const overflow = [...document.querySelectorAll('.ear, .menu, .controls, .help, .lost-line, .stop-button, .primary-action, .live-tabs, .live-bar-row, .live-peek-card, .live-now, .live-item-body, .live-todo')]
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
    briefRows: document.querySelectorAll('.before-call .recent-line').length,
    briefOpen: document.querySelector('.before-call') ? document.querySelector('.before-call').dataset.open === 'true' : null,
    briefHeight: document.querySelector('.before-call') ? Math.round(document.querySelector('.before-call').getBoundingClientRect().height) : null,
    ticked: document.querySelectorAll('.change-row .tick[data-kept="true"]').length,
    saveLabel: document.querySelector('.postcall-actions .primary-action')?.textContent.trim() ?? null,
    crmLink: [...document.querySelectorAll('.postcall-line .text-action')].map((e) => e.textContent.trim()).join('|'),
    listening: !!document.querySelector('.listening'),
    keypad: !!document.querySelector('.float-menu .dial-pad'),
    copyButtons: document.querySelectorAll('.copy-button').length,
    bubbleText: document.querySelector('.bubble')?.textContent.replace(/•+$/, '').trim() ?? null,
    repeatedLabels: (() => {
      const labels = [...document.querySelectorAll('.recent-label')].map((label) => label.textContent.trim().toLowerCase());
      return labels.filter((label, i) => labels.indexOf(label) !== i);
    })(),
    live: (() => {
      if (!document.querySelector('.live')) return null;
      const text = (el) => el?.textContent.trim() ?? null;
      const all = (sel, root = document) => [...root.querySelectorAll(sel)];
      const rect = (sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return b ? { top: Math.round(b.top * 2) / 2, height: Math.round(b.height * 2) / 2 } : null; };
      const tabs = all('.live-tab');
      const help = document.querySelector('.live-help');
      const conv = document.querySelector('.live-conv');
      const peek = document.querySelector('.live-peek');
      const actions = all('.live-action');
      return {
        tab: ['transcript', 'help', 'conversation'][tabs.findIndex((t) => t.dataset.active === 'true')] ?? null,
        tabLabels: tabs.map((t) => text(t.querySelector('span:not(.live-tab-icon):not(.tab-badge):not(.type-note-pulse)'))),
        badges: all('.live-tab .tab-badge').map(text),
        chip: text(document.querySelector('.live-chip-lead')),
        stack: { controls: rect('.controls'), tabs: rect('.live-tabs-row'), views: rect('.live-views'), bar: rect('.live-bar-row'), island: rect('.island') },
        cards: all('.live-item', help ?? document).filter((c) => !c.classList.contains('live-ask')).length,
        lines: all('.live-item-line', help ?? document).length,
        thinking: all('.help-drafting', help ?? document).length,
        caret: !!help?.querySelector('.live-caret'),
        say: text(help?.querySelector('.live-say')),
        decision: text(help?.querySelector('.live-decision')),
        gap: text(help?.querySelector('.live-gap')),
        tag: text(help?.querySelector('.live-tag')),
        folding: all('.live-item[data-phase="closing"]').length,
        earlier: all('.live-earlier-row').length,
        earlierOpen: document.querySelector('.live-earlier') ? document.querySelector('.live-earlier').dataset.open === 'true' : false,
        unanswered: text(document.querySelector('.live-unanswered-count')),
        outcomes: all('.live-outcome').map(text),
        empty: text(document.querySelector('.live-pane[data-active="true"] :is(.live-help-empty, .live-empty)')),
        name: text(conv?.querySelector('.live-path-name')),
        count: text(conv?.querySelector('.live-path-count')),
        now: text(conv?.querySelector('.live-now-label')),
        rows: all('.live-list:not(.live-done) .live-todo', conv ?? document).length,
        more: text(conv?.querySelector('.live-more')),
        doneOpen: document.querySelector('.live-done') ? document.querySelector('.live-done').dataset.open === 'true' : false,
        doneRows: all('.live-done .live-todo').length,
        askOpen: !!conv?.querySelector('.live-todo-wrap[data-open="true"]'),
        noPlaybook: text(conv?.querySelector('.live-noplaybook .lost-title')),
        offline: text(document.querySelector('.live-pane[data-active="true"] .live-offline .lost-title')),
        disabled: actions.filter((a) => a.disabled).map(text),
        on: actions.filter((a) => a.dataset.on === 'true').map(text),
        peek: !!peek,
        peekCards: peek ? all('.live-item', peek).filter((c) => !c.classList.contains('live-ask')).length : 0,
        peekNow: text(peek?.querySelector('.live-now-label')),
        peekReading: text(peek?.querySelector('.help-drafting .dim')),
        peekNothing: text(peek?.querySelector('.live-peek-empty:not(.help-drafting)')),
        peekDone: text(peek?.querySelector('.live-peek-done')),
        recapLines: peek ? all('.live-recap li:not(.live-recap-pending)', peek).length : 0,
        recapPending: text(peek?.querySelector('.live-recap-pending')),
        // Reading and writing in full: nothing the card says is cut by its box.
        cut: all('.live-say, .live-now-say, .live-todo-ask, .live-recap li').filter((e) => e.scrollHeight > e.clientHeight + 1).length,
      };
    })(),
    // As a pill: its size, the edge it rests on and how far from it; whether the island is open, which side of the pill it
    // opened on and whether it is whole on the screen; what the pill shows (the Qué decir marker, the notch's icon, its action).
    side: (() => {
      const stage = document.querySelector('.side-stage');
      if (!stage) return null;
      const strip = document.querySelector('.side-strip')?.getBoundingClientRect();
      const gaps = strip ? { left: strip.left, right: innerWidth - strip.right, top: strip.top, bottom: innerHeight - strip.bottom } : null;
      const edge = gaps ? Object.keys(gaps).reduce((a, b) => (gaps[b] < gaps[a] ? b : a)) : null;
      const panel = document.querySelector('.side-panel[data-placed="true"]')?.getBoundingClientRect();
      const where = !panel || !strip ? null
        : panel.right <= strip.left ? 'left' : panel.left >= strip.right ? 'right' : panel.bottom <= strip.top ? 'above' : panel.top >= strip.bottom ? 'below' : 'over';
      const action = document.querySelector('.side-strip .pill-action > *');
      return {
        strip: strip ? { width: Math.round(strip.width), height: Math.round(strip.height), edge, gap: Math.round(gaps[edge]) } : null,
        open: document.querySelector('.side-dock')?.dataset.open === 'true',
        view: !!document.querySelector('.side-panel .say-feed'),
        marker: !!document.querySelector('.side-strip .help-marker'),
        panel: where,
        inside: panel ? panel.left >= 0 && panel.top >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight : null,
        glyph: !!document.querySelector('.side-strip .pill-glyph')?.querySelector('svg, img'),
        action: action ? action.className.baseVal ?? action.className : null,
      };
    })(),
    // The closed island's marker in the Qué decir view: the dot, and the line around the whole island.
    marker: (() => {
      const dot = document.querySelector('.help-marker .help-dot');
      const line = document.querySelector('.help-outline-line')?.getBoundingClientRect();
      const island = document.querySelector('.island')?.getBoundingClientRect();
      if (!dot) return null;
      return { dot: true, wraps: !!(line && island && Math.abs(line.width - island.width) < 1 && Math.abs(line.height - island.height) < 1) };
    })(),
    // The Qué decir view (spec revised 2026-10-19).
    say: (() => {
      if (!document.querySelector('.say-feed')) return null;
      const text = (el) => el?.textContent.trim() ?? null;
      const all = (sel, root = document) => (root ? [...root.querySelectorAll(sel)] : []);
      const peek = document.querySelector('.say-peek');
      const cards = all('.say-card');
      const actions = all('.say-bar .live-action');
      const label = (b) => text(b.querySelector('span:not(.type-note-pulse)'));
      const rect = (sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return b ? { top: Math.round(b.top * 2) / 2, height: Math.round(b.height * 2) / 2 } : null; };
      return {
        cards: cards.length,
        kinds: cards.map((c) => text(c.querySelector('.say-kind, .say-ended'))?.replace(/ · .*$/, '') ?? null),
        text: text([...cards].reverse().find((c) => c.dataset.live === 'true')?.querySelector('.say-text')),
        faded: cards.filter((c) => c.dataset.live === 'false').length,
        caret: !!document.querySelector('.say-card .live-caret'),
        again: !!document.querySelector('.say-again'),
        otherWay: text(document.querySelector('.say-card .help-drafting .dim')),
        quiet: text(document.querySelector('.say-quiet')),
        note: text(document.querySelector('.say-note .help-drafting span') ?? document.querySelector('.say-note')),
        sources: all('.bubble[data-source="true"]').map((b) => b.closest('.turn')?.dataset.turnId ?? null),
        bar: actions.map(label),
        on: actions.filter((a) => a.dataset.on === 'true').map(label),
        disabled: actions.filter((a) => a.disabled).map(label),
        contact: text(document.querySelector('.say-contact span')),
        peek: peek?.dataset.peek ?? null,
        peekReading: text(peek?.querySelector('.help-drafting .dim')),
        title: text(peek?.querySelector('.say-panel-head')),
        facts: all('.say-fact', peek).length,
        recapLines: all('.live-recap li', peek).length,
        rows: all('.say-step', peek).length,
        hint: text(peek?.querySelector('.say-step-hint')),
        stepQ: text(peek?.querySelector('.say-step-q')),
        briefLines: all('.say-line', peek).length,
        offline: text(document.querySelector('.say-offline .lost-title')),
        // At the side the view is in the panel, not the whole window.
        stack: { feed: rect('.say-feed'), views: rect('.say-views'), bar: rect('.say-bar'), island: rect('.side-panel') ?? rect('.island') },
        spill: (() => {
          const bar = document.querySelector('.say-bar')?.getBoundingClientRect();
          const wrap = document.querySelector('.say-views .transcript-wrap')?.getBoundingClientRect();
          return bar && wrap ? Math.max(0, Math.round(wrap.bottom - bar.top)) : 0;
        })(),
        // Nothing the view writes is cut by its box (the faded history clamps on purpose).
        cut: all('.say-card[data-live="true"] .say-text, .say-step-q, .say-line, .live-recap li').filter((e) => e.scrollHeight > e.clientHeight + 1).length,
      };
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
    // Text that must show in full: which of the fixture's selectors are cut (an ellipsis keeps scrollWidth > clientWidth).
    cutText: (${JSON.stringify(fixture.expect?.noCut ?? [])}).filter((sel) => [...document.querySelectorAll(sel)].some((e) => e.scrollWidth > e.clientWidth + 1)),
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
  // A second state pushed after the scene is set (a point that ends while its card is up).
  if (fixture.next) {
    await win.webContents.executeJavaScript(`window.__setIslandState(${JSON.stringify(fixture.next)}); true`);
    await frame();
  }
  const m = await measure(win, fixture);
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
    if (m.cutText?.length) problems.push(`text cut: ${m.cutText.join(", ")}`);
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
    if (fixture.expect.briefMaxHeight !== undefined && m.briefHeight > fixture.expect.briefMaxHeight) problems.push(`the call's brief is ${m.briefHeight}px tall, expected at most ${fixture.expect.briefMaxHeight}px`);
    for (const key of ["briefOpen", "listening", "keypad", "bubbleText", "copyButtons", "ticked", "saveLabel", "crmLink", "marker", "side"]) {
      if (fixture.expect[key] !== undefined && JSON.stringify(m[key] ?? null) !== JSON.stringify(fixture.expect[key])) problems.push(`${key} is ${JSON.stringify(m[key])}, expected ${JSON.stringify(fixture.expect[key])}`);
    }
    if (m.clipped) problems.push(`${m.clipped} bubble(s) cut off at the island edge`);
    if (m.say) {
      // The stack the spec fixes: Qué decir 100 high under the controls, the bar 40 at the foot, the transcript between.
      const st = m.say.stack;
      if (st.feed?.height !== 100) problems.push(`Qué decir is ${st.feed?.height}px high, expected 100`);
      if (st.bar?.height !== 40 || st.bar?.top + st.bar?.height !== st.island?.top + st.island?.height) problems.push(`bar at ${st.bar?.top}/${st.bar?.height}, expected 40 high at the foot of the ${st.island?.height}px island`);
      if (m.say.cut) problems.push(`${m.say.cut} text(s) cut by their box`);
      // The transcript stays between Qué decir and the bar: no bubble is drawn over the bar.
      if (m.say.spill) problems.push(`the transcript reaches ${m.say.spill}px past the top of the bar`);
      for (const [key, want] of Object.entries(fixture.expect.say ?? {})) {
        if (JSON.stringify(m.say[key] ?? null) !== JSON.stringify(want)) problems.push(`say ${key} is ${JSON.stringify(m.say[key] ?? null)}, expected ${JSON.stringify(want)}`);
      }
    } else if (fixture.expect.say) problems.push("the Qué decir view did not render");
    if (m.live && !m.say) {
      // The vertical stack the spec fixes: controls 38, tabs row 34 under them, the bar 40 at the foot.
      const st = m.live.stack;
      if (st.tabs?.top !== 70 || st.tabs?.height !== 34) problems.push(`tabs row at ${st.tabs?.top}/${st.tabs?.height}, expected 70/34`);
      if (st.bar?.height !== 40 || st.bar?.top + st.bar?.height !== st.island?.height) problems.push(`bar at ${st.bar?.top}/${st.bar?.height}, expected 40 high at the foot of the ${st.island?.height}px island`);
      if (st.views?.top !== 104.5) problems.push(`views start at ${st.views?.top}, expected 104.5`);
      if (m.live.cut) problems.push(`${m.live.cut} text(s) cut by their box`);
      for (const [key, want] of Object.entries(fixture.expect.live ?? {})) {
        if (JSON.stringify(m.live[key] ?? null) !== JSON.stringify(want)) problems.push(`live ${key} is ${JSON.stringify(m.live[key] ?? null)}, expected ${JSON.stringify(want)}`);
      }
    } else if (fixture.expect.live) problems.push("the live assistant did not render");
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
  if (fixture.next) {
    await win.webContents.executeJavaScript(`window.__setIslandState(${JSON.stringify(fixture.next)}); true`);
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

// Dragging the pill: real pointer events from where it rests to a point, then where it rests and what the app was told.
for (const test of pillDrags) {
  const fixture = fixtures.find((f) => f.name === test.fixture);
  const { win } = await open(fixture);
  const got = await win.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const drops = [];
    window.vocifyIsland = { act: (a) => window.__islandActions.push(a), resize: () => {}, pillDrop: (spot) => drops.push(spot), pillDrag: () => {}, interactive: () => {} };
    window.__islandActions.length = 0;
    const el = document.querySelector('.side-strip');
    const box = el.getBoundingClientRect();
    const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 }, to = ${JSON.stringify(test.to)};
    const at = (x, y, buttons) => ({ bubbles: true, cancelable: true, pointerId: 9, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: x, clientY: y, screenX: x, screenY: y });
    el.dispatchEvent(new PointerEvent('pointerdown', at(from.x, from.y, 1)));
    for (let i = 1; i <= 10; i++) { el.dispatchEvent(new PointerEvent('pointermove', at(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10, 1))); await wait(16); }
    el.dispatchEvent(new PointerEvent('pointerup', at(to.x, to.y, 0)));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: to.x, clientY: to.y }));
    await wait(400);
    const strip = document.querySelector('.side-strip').getBoundingClientRect();
    const gaps = { left: strip.left, right: innerWidth - strip.right, top: strip.top, bottom: innerHeight - strip.bottom };
    const edge = Object.keys(gaps).reduce((a, b) => (gaps[b] < gaps[a] ? b : a));
    const drop = drops.at(-1);
    return {
      strip: { width: Math.round(strip.width), height: Math.round(strip.height), edge, gap: Math.round(gaps[edge]) },
      open: window.__islandActions.some((a) => a.name === 'toggle'),
      drop: drop ? { edge: drop.edge, at: Math.round(drop.at * 1000) / 1000 } : null,
    };
  })()`);
  const ok = JSON.stringify(got) === JSON.stringify(test.expect);
  report.push({ name: `drag:${test.name}`, measured: got, problems: ok ? [] : [`got ${JSON.stringify(got)}, expected ${JSON.stringify(test.expect)}`] });
  if (!ok) failures.push(`drag:${test.name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(test.expect)}`);
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
