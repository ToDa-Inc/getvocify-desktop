// Windows only: the two Windows mechanisms checked against the real system, not against made-up data.
//   1. Call detection: a fake app's entry is written into the real microphone-use record with `reg add`, read back with
//      the real `reg query`, and must be parsed as the active caller; then stopped and cleaned up.
//   2. CRM links: a real browser is opened on a local page and its address bar must be read through UI Automation.
// Run on a Windows machine: node test/windows-real.mjs   (skips on other systems)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crmUrlsOf, encodePowerShell, parsePageOutput, READ_PAGES_SCRIPT } from "../main/src/windows/browser-pages.ts";
import { MIC_CONSENT_KEY, parseMicConsent, pickCaller } from "../main/src/windows/mic-use.ts";

if (process.platform !== "win32") {
  console.log("windows-real: skipped (not Windows)");
  process.exit(0);
}

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reg = (...args) => execFileSync("reg.exe", args, { encoding: "utf8", windowsHide: true });
const ticks = (ms) => ((BigInt(ms) + 11644473600000n) * 10000n).toString();

/* ---------- 1. call detection against the real registry ---------- */
const fakeKey = `${MIC_CONSENT_KEY}\\NonPackaged\\C:#vocify-ci#Zoom.exe`;
try {
  const started = Date.now() - 2000;
  reg("add", fakeKey, "/v", "LastUsedTimeStart", "/t", "REG_QWORD", "/d", ticks(started), "/f");
  reg("add", fakeKey, "/v", "LastUsedTimeStop", "/t", "REG_QWORD", "/d", "0", "/f");
  const output = reg("query", MIC_CONSENT_KEY, "/s");
  const uses = parseMicConsent(output);
  const mine = uses.find((u) => u.exe === "zoom.exe" && u.path === "C:\\vocify-ci\\Zoom.exe");
  check(Boolean(mine), "the real `reg query` output is parsed and the fake app is found with its path");
  check(mine?.active === true && Math.abs((mine?.started ?? 0) - started) < 1000, `it is active, started ${mine ? Math.round(Date.now() - mine.started) : "?"} ms ago`);
  const caller = pickCaller(uses, { now: Date.now(), settleMs: 300, ownExePath: null });
  check(caller?.name === "Zoom" && caller.appId === "zoom.exe", `the caller is picked (${caller?.name})`);
  reg("add", fakeKey, "/v", "LastUsedTimeStop", "/t", "REG_QWORD", "/d", ticks(Date.now()), "/f");
  const after = parseMicConsent(reg("query", MIC_CONSENT_KEY, "/s")).find((u) => u.exe === "zoom.exe");
  check(after?.active === false, "once its stop is newer, it is no longer active");
} catch (error) {
  failures.push(`registry test threw: ${error}`);
  console.log(`FAIL registry test threw: ${error}`);
} finally {
  try {
    reg("delete", fakeKey, "/f");
  } catch {
    // Already gone.
  }
}

/* ---------- 2. CRM links from a real browser's address bar ---------- */
const candidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const browserPath = candidates.find((p) => existsSync(p));
if (!browserPath) {
  failures.push("no Chrome or Edge found on this machine");
  console.log("FAIL no Chrome or Edge found on this machine");
} else {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end("<title>Vocify test page</title><p>contact record</p>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const path = "/contacts/123/contact/456";
  const profile = mkdtempSync(join(tmpdir(), "vocify-browser-"));
  const browser = spawn(browserPath, [`--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--new-window", `http://127.0.0.1:${port}${path}`], { stdio: "ignore" });
  let output = "";
  let seconds = 0;
  const started = Date.now();
  try {
    for (let i = 0; i < 12; i += 1) {
      await sleep(2500);
      try {
        output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(READ_PAGES_SCRIPT)], { encoding: "utf8", windowsHide: true, timeout: 30000 });
      } catch (error) {
        output = `script failed: ${error}`;
      }
      if (output.includes(`127.0.0.1:${port}`)) break;
    }
    seconds = Math.round((Date.now() - started) / 100) / 10;
    const pages = parsePageOutput(output);
    console.log(`      script output: ${JSON.stringify(output.trim().slice(0, 300))}`);
    check(pages.some((p) => p.url.includes(`127.0.0.1:${port}${path}`)), `the browser's address bar is read through UI Automation (${seconds} s from launch)`);
    const timed = Date.now();
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(READ_PAGES_SCRIPT)], { encoding: "utf8", windowsHide: true, timeout: 30000 });
    console.log(`      one read takes ${Date.now() - timed} ms`);
    check(crmUrlsOf([{ browser: "chrome", url: "https://app.hubspot.com/contacts/1/contact/2" }]).length === 1, "a HubSpot contact link is a CRM link");
  } finally {
    try {
      execFileSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // Already closed.
    }
    server.close();
  }
}

console.log(failures.length ? `\nwindows-real: ${failures.length} failed` : "\nwindows-real: all passed");
process.exit(failures.length ? 1 : 0);
