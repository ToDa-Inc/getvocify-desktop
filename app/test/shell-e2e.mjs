// The real shell in real windows, from a click on Record to the call's update being dismissed.
// The dashboard is the demo page, which speaks the real bridge. Run: node test/build-shell-test.mjs && electron test/shell-e2e.mjs
import { app, BrowserWindow } from "electron";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let describe = () => "";
async function until(predicate, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await sleep(100);
  }
  console.log(`      (timed out waiting for ${what}; ${describe()})`);
  return false;
}

app.whenReady().then(async () => {
  const anchor = new BrowserWindow({ show: false, width: 100, height: 100 });
  await anchor.loadURL("data:text/html,<title>anchor</title>");
  try {
    const { startApp } = await import(pathToFileURL(join(here, "../main/dist-shell-test/app.mjs")).href);
    // A returning user: the island remembers that someone is signed in, so Record works before the dashboard has loaded.
    const userDataDir = mkdtempSync(join(tmpdir(), "vocify-e2e-"));
    writeFileSync(join(userDataDir, "settings.json"), JSON.stringify({ recorderReady: true, calendarWatch: false }));
    const handle = await startApp({
      dashboardUrl: pathToFileURL(join(here, "../main/demo/fake-dashboard.html")).href,
      trustFiles: true,
      userDataDir,
      islandOffsetY: 200,
      releaseGraceMs: 1500,
      // The compatibility identity the production dashboard needs today: the page must be told "darwin".
      reportedPlatform: "darwin",
    });
    const { controller, dashboard, island } = handle;
    const mode = () => controller.state.mode.kind;
    describe = () => `mode ${mode()}, expanded ${controller.state.expanded}, listening ${controller.isListening}, postCall ${controller.state.postCall?.stage ?? "none"}, countdown ${JSON.stringify(controller.state.countdown)}`;
    const islandHeight = () => island.webContents.executeJavaScript("Math.round(document.querySelector('.island').getBoundingClientRect().height)");

    // --- at rest
    await sleep(800);
    check(mode() === "idle" && !controller.state.expanded, "starts idle and closed");
    check(!dashboard.exists, "no dashboard window exists while idle (nothing to pay for)");
    check(island.isAlwaysOnTop() && !island.isFocusable(), "the island is always on top and cannot take focus");
    const idleBounds = handle.islandBounds();
    check(idleBounds.height === controller.state.geometry.barHeight, `the idle island is one bar high (${idleBounds.height}px)`);

    // --- Record from the island: the dashboard starts hidden and the call starts
    controller.act({ name: "record" });
    check(mode() === "starting", "Record shows 'starting'");
    check(await until(() => mode() === "recording", 15000, "recording"), "the hidden dashboard starts the recording and the island follows");
    check(dashboard.exists && !dashboard.visible, "the dashboard runs hidden while recording");
    check((await dashboard.contents.executeJavaScript("window.vocifyDesktop.platform")) === "darwin", "the dashboard page is told the platform it already understands (compatibility mode)");
    check(await until(() => controller.state.turns.length >= 2, 10000, "transcript"), "the transcript streams into the island");
    check(controller.state.clock !== null && controller.state.liveHelp === true, "clock and live help arrive from the dashboard");
    check(controller.state.typeMenu?.title === "Discovery call" && controller.state.typeMenu.proposed, "the call type is Vocify's proposal");
    const levelAt = controller.state.levels.at;
    await sleep(600);
    check(controller.state.levels.at > levelAt, "voice levels keep flowing");

    // --- pause and resume round-trip through the dashboard
    controller.act({ name: "togglePause" });
    check(await until(() => controller.state.paused && controller.state.clock?.pausedAt !== null, 4000, "pause"), "Pause reaches the dashboard and comes back as a paused clock");
    controller.act({ name: "togglePause" });
    check(await until(() => !controller.state.paused, 4000, "resume"), "Resume does too");

    // --- the call type chosen in the island reaches the dashboard and comes back final
    controller.act({ name: "pickCallType", key: "demo" });
    check(await until(() => controller.state.typeMenu?.title === "Demo" && !controller.state.typeMenu.proposed, 4000, "type"), "a picked call type is final");

    // --- the open island is sized to its shape
    controller.act({ name: "toggle" });
    await sleep(900);
    const open = handle.islandBounds();
    check(controller.state.expanded && open.width >= 460 && open.height >= 300, `the open island window is ${open.width}x${open.height}`);

    // --- Stop: grace, then the call's update
    controller.act({ name: "stop" });
    check(mode() === "stopped", "Stop pauses and shows Resume for 5 s");
    check(await until(() => mode() === "finishing" && controller.state.finish?.step === "stopping", 9000, "finishing"), "after the grace the island holds on a spinner while the dashboard finishes the transcript");
    check(await until(() => controller.state.finish?.step === "uploading", 4000, "uploading"), "then says the call is being sent");
    check(await until(() => mode() === "postCall", 6000, "post-call"), "once the memo is being written the call's update appears");
    check(await until(() => controller.state.postCall?.stage === "ready" && controller.state.expanded, 8000, "ready"), "the update opens when it is ready");
    await sleep(900);
    const card = handle.islandBounds();
    const domHeight = await islandHeight();
    check(card.height >= domHeight && card.height - domHeight < 8, `the window follows the card's own height (window ${card.height}px, card ${domHeight}px)`);
    check(dashboard.exists, "the dashboard stays alive while a call's update waits");

    // --- Save to the CRM, with the undo window, then it dismisses itself
    controller.act({ name: "postCall", type: "approve", details: { omit: [], edits: {} } });
    check(await until(() => controller.state.postCall?.stage === "applying", 4000, "applying"), "Save sends 'approve' and the dashboard answers 'applying'");
    check(await until(() => controller.state.postCall?.stage === "done", 9000, "done"), "the write finishes");
    // With an email and a meeting still waiting, the card does not dismiss itself (the Swift rule): the rep does.
    controller.act({ name: "postCall", type: "dismiss" });
    check(await until(() => controller.state.postCall === null && mode() === "idle", 6000, "dismissal"), "Dismissing the card clears the update and the island returns to idle");
    check(await until(() => !dashboard.exists, 6000, "dashboard released"), "the hidden dashboard is given back once nothing needs it");

    // --- the meeting heads-up reads the calendar in the dashboard page: while it does, the page is not given back
    dashboard.ensureHidden();
    check(await until(() => dashboard.exists, 4000, "dashboard started"), "the dashboard page can be started hidden");
    await sleep(800);
    await dashboard.contents.executeJavaScript("window.vocifyDesktop.shell.setState({ calendarWatch: true })");
    await sleep(3500);
    check(dashboard.exists && !dashboard.visible, "the hidden dashboard stays alive while the calendar heads-up is on");
    await dashboard.contents.executeJavaScript("window.vocifyDesktop.shell.setState({ calendarWatch: false })");
    check(await until(() => !dashboard.exists, 6000, "dashboard released after the heads-up is off"), "and is given back when the heads-up is off");

    // --- a detected call, by hand: the helper's job
    // A recording marks the call as handled until the mic goes quiet, so the first call app to let go ends it (the Swift rule).
    handle.detectCall({ name: "Zoom", appId: "zoom.exe" });
    check(mode() === "idle", "the call just recorded is not offered again while its app still holds the mic");
    handle.detectCall(null);
    handle.detectCall({ name: "Zoom", appId: "zoom.exe" });
    check(mode() === "call" && controller.state.expanded, "a call app taking the mic drops the island down to offer Record");
    handle.detectCall(null);
    check(mode() === "idle", "the call app letting go returns it to idle");

    // --- permissions, as the dashboard reads them
    const permissions = await handle.permissions();
    check(["authorized", "denied", "never_requested"].includes(permissions.microphone) && ["win32", "darwin"].includes(permissions.platform), `permissions report a platform and a microphone state (${JSON.stringify(permissions)})`);
    if (process.platform === "win32") check(permissions.systemAudio === "authorized", "on Windows call audio needs no permission");

    // --- the app's own icon, as the Swift island shows it (the same Electron call reads an .exe on Windows)
    const iconPath = process.platform === "darwin" ? "/System/Applications/Calculator.app" : process.platform === "win32" ? process.env.ComSpec : null;
    if (iconPath) {
      const icon = await handle.iconFor(iconPath);
      check(typeof icon === "string" && icon.startsWith("data:image/png;base64,") && icon.length > 500, `an app's real icon is read as a small image (${icon ? icon.length : 0} chars)`);
      check((await handle.iconFor(iconPath)) === icon, "and kept, not read again");
    }
    check((await handle.iconFor(join(tmpdir(), "no-such-app.exe"))) === null, "an app with no icon gives none, never an error");

    // --- the dashboard may be opened and closed on its own
    dashboard.show();
    check(await until(() => dashboard.visible, 5000, "dashboard visible"), "Open Vocify shows the dashboard");
    handle.quit();
  } catch (error) {
    failures.push(`threw: ${error instanceof Error ? error.stack : String(error)}`);
    console.log(`FAIL threw: ${error instanceof Error ? error.stack : error}`);
  }
  console.log(failures.length ? `\nshell e2e: ${failures.length} failed` : "\nshell e2e: all passed");
  app.exit(failures.length ? 1 : 0);
});
app.on("window-all-closed", () => {});
