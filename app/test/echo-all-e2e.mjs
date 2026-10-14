// The rep's mic can cancel everything the computer plays: Chromium's `echoCancellation: "all"`. Electron 33
// (Chromium 130) silently applies plain `true` instead; Electron 44.4.5 (Chromium 152.0.7977.130) applies "all".
// A page in a real Electron window asks for it and must get it. Run: electron test/echo-all-e2e.mjs
import { app, BrowserWindow } from "electron";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Chromium's own fake microphone, so the mic opens without a real one or a prompt.
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};

app.whenReady().then(async () => {
  const dir = mkdtempSync(join(tmpdir(), "vocify-echo-all-"));
  try {
    console.log(`Electron ${process.versions.electron}, Chromium ${process.versions.chrome}`);
    // getUserMedia exists only in a secure context, which a file page is and a data: page is not.
    const page = join(dir, "page.html");
    writeFileSync(page, "<!doctype html><title>echo all</title>");
    const window = new BrowserWindow({ show: false, width: 100, height: 100 });
    await window.loadFile(page);

    const result = await window.webContents.executeJavaScript(`
      navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: { exact: "all" } } })
        .then((stream) => {
          const track = stream.getAudioTracks()[0];
          const echoCancellation = track ? track.getSettings().echoCancellation : undefined;
          stream.getTracks().forEach((t) => t.stop());
          return { echoCancellation };
        })
        .catch((error) => ({ error: error.name + ": " + error.message }))
    `);
    check(!result.error, `getUserMedia accepts echoCancellation { exact: "all" } (${result.error ?? "accepted"})`);
    check(result.echoCancellation === "all", `the mic track applied echoCancellation "all" (got ${JSON.stringify(result.echoCancellation)})`);
  } catch (error) {
    failures.push(`threw: ${error instanceof Error ? error.stack : String(error)}`);
    console.log(`FAIL threw: ${error instanceof Error ? error.stack : error}`);
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(failures.length ? `\necho-all e2e: ${failures.length} failed` : "\necho-all e2e: all passed");
  app.exit(failures.length ? 1 : 0);
});
