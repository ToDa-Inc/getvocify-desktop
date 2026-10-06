// The whole island flow with REAL input: the system's own mouse clicks and key presses (not page events), through every
// interaction a rep has, against the stand-in dashboard. After each step it checks the island's state, what the dashboard
// was sent, and that the call window kept focus where it must. A screenshot of each step goes to test/out-real/.
// Run: node test/build-shell-test.mjs && node island/build.mjs && electron test/real-input.mjs   (macOS or Windows)
import { app, BrowserWindow, ipcMain } from "electron";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out-real");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const failures = [];
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s`;
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${elapsed()} ${ok ? "ok  " : "FAIL"} ${message}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- the system's own input ---------- */

const mac = process.platform === "darwin";
let macTool = null;
const POWERSHELL_NATIVE = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
'@
`;
const powershell = (script) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", POWERSHELL_NATIVE + script], { encoding: "utf8", windowsHide: true, timeout: 60000 }).trim();

/** A real click at screen point (x, y), then optionally real key presses typing `text`. */
function input(x, y, text = "") {
  if (mac) return execFileSync(macTool, [String(x), String(y), text]);
  const keys = text.replace(/[+^%~(){}[\]]/g, "{$&}");
  powershell(`[void][W]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}); Start-Sleep -Milliseconds 150; [W]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [W]::mouse_event(4,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 400; ${keys ? `[System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}')` : ""}`);
}
/** The process the system sends the keyboard to right now. */
function foregroundPid() {
  if (mac) return Number(execFileSync("osascript", ["-e", 'tell application "System Events" to get unix id of first process whose frontmost is true'], { encoding: "utf8" }).trim());
  return Number(powershell(`$h = [W]::GetForegroundWindow(); $p = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$p); $p`));
}

app.whenReady().then(async () => {
  // Never hang: a stuck step fails the run.
  setTimeout(() => {
    console.log("FAIL the run did not finish within 5 minutes");
    app.exit(1);
  }, 300000).unref();
  let callWindow = null;
  try {
    if (mac) {
      // Compiled once per version of the source, so a run does not wait on the compiler.
      const source = join(here, "tools/mac-input.swift");
      macTool = join(tmpdir(), `vocify-mac-input-${statSync(source).mtimeMs}`);
      if (!existsSync(macTool)) execFileSync("swiftc", ["-O", source, "-o", macTool]);
    }
    const userDataDir = mkdtempSync(join(tmpdir(), "vocify-real-"));
    writeFileSync(join(userDataDir, "settings.json"), JSON.stringify({ recorderReady: true }));
    const { startApp } = await import(pathToFileURL(join(here, "../main/dist-shell-test/app.mjs")).href);
    const handle = await startApp({ dashboardUrl: pathToFileURL(join(here, "../main/demo/fake-dashboard.html")).href, trustFiles: true, userDataDir, islandOffsetY: mac ? 0 : 0, releaseGraceMs: 600000 });
    const { controller, island } = handle;
    const actions = [];
    ipcMain.on("island:act", (_event, action) => actions.push(action));
    const mode = () => controller.state.mode.kind;
    const until = async (fn, ms, what) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (fn()) return true;
        await sleep(50);
      }
      console.log(`      (waited ${ms} ms for ${what}; ${describe()})`);
      return false;
    };
    const describe = () => `mode ${mode()}, expanded ${controller.state.expanded}, paused ${controller.state.paused}, postCall ${controller.state.postCall?.stage ?? "none"}`;
    const page = (js) => island.webContents.executeJavaScript(js);
    let shot = 0;
    const snap = async (name) => {
      await sleep(350);
      const image = await island.webContents.capturePage();
      writeFileSync(join(out, `${String(++shot).padStart(2, "0")}-${name}.png`), image.toPNG());
    };
    /** Where an element of the island is on the screen (its centre, or a point inside it). */
    const point = async (selector, fx = 0.5, fy = 0.5, index = 0) => {
      const r = await page(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width * ${fx}, y: b.top + b.height * ${fy} }; })()`);
      if (!r) return null;
      const w = island.getBounds();
      return { x: w.x + r.x, y: w.y + r.y };
    };
    const click = async (selector, options = {}) => {
      await sleep(250);
      const p = await point(selector, options.fx ?? 0.5, options.fy ?? 0.5, options.index ?? 0);
      if (!p) {
        check(false, `${selector} is on screen to click`);
        return false;
      }
      input(p.x, p.y, options.type ?? "");
      await sleep(options.settle ?? 450);
      return true;
    };
    const text = (selector, index = 0) => page(`document.querySelectorAll(${JSON.stringify(selector)})[${index}]?.${selector.includes("textarea") || selector.includes("note-text") ? "value" : "textContent"} ?? null`);

    // A plain window stands in for the call: it is in front and must stay there while the island is used.
    callWindow = mac
      ? spawn("osascript", ["-e", 'tell application "Finder" to activate'], { stdio: "ignore" })
      : spawn("powershell.exe", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form; $f.Text = 'CALL'; $f.Width = 500; $f.Height = 300; $f.Add_Shown({ $f.Activate() }); [System.Windows.Forms.Application]::Run($f)"], { stdio: "ignore", windowsHide: false });
    await sleep(mac ? 2500 : 4000);
    const ours = new Set(app.getAppMetrics().map((p) => p.pid).concat(process.pid));
    const callPid = foregroundPid();
    check(!ours.has(callPid), "a call window other than the island is in front");
    // Windows: the island window never activates (WS_EX_NOACTIVATE). A Mac run cannot promise it: macOS gives the keyboard to
    // the app whose window is clicked unless that window is a non-activating panel, which Electron 33 does not make (the
    // Mac ships the native app). So it is checked on Windows and only reported on a Mac.
    const callKeepsFocus = (step) => {
      const kept = foregroundPid() === callPid;
      if (mac) console.log(`${elapsed()} info ${step}: the call window ${kept ? "keeps" : "loses"} the keyboard (not checked on a Mac)`);
      else check(kept, `${step}: the call window keeps the keyboard`);
    };

    /* ---------- idle ---------- */
    await click(".topbar");
    check(await until(() => mode() === "idle" && controller.state.expanded, 2000, "idle open"), "clicking the idle island opens it on the first press");
    callKeepsFocus("opening the island");
    await snap("idle-open");
    await click(".quiet-record");
    check(await until(() => mode() === "recording", 6000, "recording"), "Record meeting starts the recording");
    callKeepsFocus("Record");

    /* ---------- recording ---------- */
    await sleep(1500);
    await click(".topbar");
    check(await until(() => controller.state.expanded, 2000, "recording open"), "clicking the closed recording island opens the transcript");
    await snap("recording-open");
    await click(".circle-button");
    check(await until(() => controller.state.paused, 2000, "paused"), "Pause pauses");
    await snap("recording-paused");
    await click(".circle-button");
    check(await until(() => !controller.state.paused, 2000, "resumed"), "Resume resumes");
    callKeepsFocus("Pause and Resume");
    await click(".type-tag-button");
    check((await page(`!!document.querySelector('.float-menu')`)) === true, "the call-type list floats open");
    await sleep(1200);
    check((await page(`!!document.querySelector('.float-menu')`)) === true, "and stays open under the pointer");
    await snap("type-menu");
    const pickedType = await text(".float-menu .option-row span", 2);
    await click(".float-menu .option-row", { index: 2 });
    check(await until(() => controller.state.typeMenu?.title === pickedType, 2000, `type ${pickedType}`), `picking ${pickedType} sets the call type`);
    check((await page(`!document.querySelector('.float-menu')`)) === true, "the list closes after the pick");
    await click(".type-tag-button");
    await click(".hairline", { settle: 500 });
    check((await page(`!document.querySelector('.float-menu')`)) === true, "a click elsewhere closes the list");
    const helpBefore = controller.state.liveHelp;
    await click(".live-help-toggle");
    check(await until(() => controller.state.liveHelp === !helpBefore, 2000, "live help"), "the live help switch switches");
    await click(".live-help-toggle");
    callKeepsFocus("the call-type list and live help");

    /* ---------- stop, resume, finish ---------- */
    await click(".stop-button");
    check(await until(() => mode() === "stopped", 2000, "stopped"), "Stop pauses and offers Resume and Finish");
    await snap("stopped");
    await click(".text-action");
    check(await until(() => mode() === "recording", 2000, "resumed"), "Resume carries on the recording");
    await click(".topbar");
    await until(() => controller.state.expanded, 1500, "open");
    await click(".stop-button");
    await until(() => mode() === "stopped", 2000, "stopped");
    await click(".primary-action");
    check(await until(() => mode() === "finishing", 2000, "finishing"), "Finish ends the call at once and the island holds a spinner");
    await snap("finishing");
    check(await until(() => mode() === "postCall" && controller.state.postCall?.stage === "ready" && controller.state.expanded, 15000, "card ready"), "the call's card opens when its update is ready");
    callKeepsFocus("Stop, Resume and Finish");
    await snap("card-ready");

    /* ---------- the after-call card ---------- */
    await click(".change-toggle");
    check((await page(`document.querySelector('.tick').dataset.kept`)) === "false", "a tick unticks a change");
    await click(".change-toggle");
    check((await page(`document.querySelector('.tick').dataset.kept`)) === "true", "and ticks it again");
    await click(".change-value");
    check((await page(`!!document.querySelector('.float-menu')`)) === true, "a value with options opens its list");
    await sleep(1200);
    check((await page(`!!document.querySelector('.float-menu')`)) === true, "and it stays open under the pointer");
    await snap("card-options");
    await click(".float-menu .option-row", { index: 0 });
    check((await text(".value-text")).startsWith("Manager"), `picking an option shows it (${await text(".value-text")})`);
    check((await page(`!document.querySelector('.float-menu')`)) === true, "a single-choice list closes on the pick");
    await click(".change-value", { index: 1, fx: 0.3, type: " and SaaS" });
    await click(".postcall-title");
    check((await page(`document.querySelectorAll('.value-text')[1].firstElementChild.textContent`)) === "Software and SaaS", `a free-text value is typed in place (${await text(".value-text", 1)})`);
    await snap("card-edited");
    // A free-text value the dashboard does not write as typed is not offered for typing: a click ticks it, as on the Mac.
    await click(".change-value", { index: 2, fx: 0.3 });
    check((await page(`!document.querySelector('.value-input') && document.querySelectorAll('.tick')[2].dataset.kept === 'false'`)) === true, "a value that can't be typed toggles its tick instead");
    await click(".change-value", { index: 2, fx: 0.3 });
    await click(".postcall-header .type-tag");
    const cardType = await text(".float-menu .option-row span", 1);
    await click(".float-menu .option-row", { index: 1 });
    check(await until(() => controller.state.postCall?.type?.label === cardType, 2000, "card type"), `the card's call type changes to ${cardType}`);
    await click(".postcall-tab", { index: 1 });
    check((await page(`!!document.querySelector('.email-box')`)) === true, "the Email tab shows the draft");
    await click(".postcall-actions .text-action");
    check(await until(() => controller.state.postCall?.email?.state === "skipped", 2000, "skipped"), "Skip skips the email");
    await click(".small-action");
    check(await until(() => controller.state.postCall?.email?.state === "ready", 2000, "unskipped"), "Undo brings the email back");
    await click(".postcall-tab", { index: 2 });
    // After the last word, as a rep adds to the note.
    await click(".note-text", { fx: 0.97, fy: 0.9, type: " Follow up Thursday." });
    check((await text(".note-text")).endsWith("Follow up Thursday."), `the note is typed in (${JSON.stringify(await text(".note-text"))})`);
    await snap("card-note");
    await click(".postcall-tab", { index: 0 });
    actions.length = 0;
    await click(".postcall-actions .primary-action");
    const approve = actions.find((a) => a.type === "approve");
    check(!!approve, "Save sends the update");
    check(approve?.details?.edits?.["contact:jobtitle"] === "manager" && approve?.details?.edits?.["company:industry"] === "Software and SaaS", `Save sends the picked and the typed value (${JSON.stringify(approve?.details?.edits)})`);
    check(typeof approve?.details?.note === "string" && approve.details.note.endsWith("Follow up Thursday."), "Save sends the note as written");
    check(await until(() => controller.state.postCall?.stage === "applying", 2000, "applying"), "the card shows the update going in with Undo");
    await snap("card-applying");
    check(await until(() => controller.state.postCall?.stage === "done", 8000, "done"), "the update finishes");
    await click(".postcall-header .icon-button");
    check(await until(() => mode() === "idle" && controller.state.postCall === null, 4000, "dismissed"), "Done clears the card and the island rests");
    check(!island.isFocusable(), "the island gives the keyboard back once the card is gone");

    /* ---------- a detected call ---------- */
    // Call detection reports "no call" first, as the Windows watcher does at start.
    handle.detectCall(null);
    handle.detectCall({ name: "Zoom", appId: "zoom.exe" });
    check(await until(() => mode() === "call" && controller.state.expanded, 2000, "call"), "a call app taking the mic drops the island down");
    await snap("call");
    await click(".quiet-record");
    check(await until(() => mode() === "recording", 6000, "recording the call"), "Record on the call records it");
    callKeepsFocus("recording a detected call");
    handle.detectCall(null);
    check(await until(() => mode() === "stopped", 6000, "hang-up"), "hanging up pauses and waits for Resume");
    check(await until(() => mode() === "finishing" || mode() === "postCall", 8000, "after the grace"), "the grace runs out into finishing");
    handle.quit();
  } catch (error) {
    failures.push(String(error?.stack ?? error));
    console.log(error);
  } finally {
    callWindow?.kill();
  }
  console.log(failures.length ? `\nreal input: ${failures.length} failed` : "\nreal input: all passed");
  app.exit(failures.length ? 1 : 0);
});
app.on("window-all-closed", () => {});
