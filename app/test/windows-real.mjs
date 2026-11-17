// Windows only: the two Windows mechanisms checked against the real system, not against made-up data.
//   1. Call detection: a fake app's entry is written into the real microphone-use record with `reg add`, read back with
//      the real `reg query`, and must be parsed as the active caller; then stopped and cleaned up.
//   2. CRM links: a real browser is opened on a local page and its address bar must be read through UI Automation.
//   3. Resources: the real `tasklist` (in the system's language) is read for the memory the log reports.
//   4. Capture sessions: a process opens the default microphone through WASAPI (a real capture stream, what Chrome or
//      Zoom does), and the capture reader (the same Core Audio code as the render reader) must list that process's PID.
//      The process is closed afterwards and must be gone from the list.
// Run on a Windows machine: node test/windows-real.mjs   (skips on other systems)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crmUrlsOf, encodePowerShell, parsePageOutput, READ_PAGES_SCRIPT } from "../main/src/windows/browser-pages.ts";
import { MIC_CONSENT_KEY, parseMicConsent, pickCaller } from "../main/src/windows/mic-use.ts";
import { AUDIO_SESSIONS_SCRIPT, CAPTURE_SESSIONS_SCRIPT } from "../main/src/windows/audio-sessions.ts";
import { parseCaptureLine } from "../main/src/windows/capture-sessions.ts";
import { parseSessionsLine } from "../main/src/call-audio-session.ts";
import { parseTasklist } from "../main/src/resources.ts";

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

/* ---------- 3. the audio sessions playing sound, through Core Audio ---------- */
// The reader a call on the rep's phone is followed with: its C# must compile under Windows PowerShell and answer.
{
  const reader = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(AUDIO_SESSIONS_SCRIPT)], { windowsHide: true });
  let out = "";
  let err = "";
  reader.stdout.on("data", (chunk) => (out += chunk));
  reader.stderr.on("data", (chunk) => (err += chunk));
  const started = Date.now();
  while (!out.includes("\n") && Date.now() - started < 60000 && reader.exitCode === null) await sleep(250);
  const first = out.split(/\r?\n/)[0] ?? "";
  console.log(`      reader said: ${JSON.stringify(first.slice(0, 300))} in ${Date.now() - started} ms${err ? `, stderr: ${JSON.stringify(err.slice(0, 500))}` : ""}`);
  check(parseSessionsLine(first) !== null, "the audio-session reader compiles under Windows PowerShell and lists the sessions playing now");
  try {
    execFileSync("taskkill", ["/PID", String(reader.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch {
    // Already closed.
  }
}

/* ---------- 4. capture sessions: a process holding the microphone is listed by the reader ---------- */
// The holder opens the default capture endpoint in shared mode and starts the stream, as a call app does. C# 5, as the
// product's reader; its interfaces list the COM methods in vtable order, of which only the used ones are called.
const HOLDER_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace VocifyCaptureHolder {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance); }

  [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioClient {
    [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
    [PreserveSig] int GetBufferSize(out uint frames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint padding);
    [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
  }

  public static class Holder {
    // Kept referenced: a released client stops its stream.
    static object kept;

    public static string Open() {
      IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
      IMMDevice device;
      int hr = enumerator.GetDefaultAudioEndpoint(1, 0, out device);
      if (hr != 0 || device == null) return "NOENDPOINT " + hr;
      Guid iid = typeof(IAudioClient).GUID;
      object client;
      hr = device.Activate(ref iid, 23, IntPtr.Zero, out client);
      if (hr != 0) return "ACTIVATE " + hr;
      IAudioClient audio = (IAudioClient)client;
      IntPtr format;
      if (audio.GetMixFormat(out format) != 0) return "MIXFORMAT";
      hr = audio.Initialize(0, 0, 10000000, 0, format, IntPtr.Zero);
      if (hr != 0) return "INITIALIZE " + hr;
      hr = audio.Start();
      if (hr != 0) return "START " + hr;
      kept = audio;
      return "OPEN";
    }
  }
}
'@
[Console]::Out.WriteLine('HOLD ' + [VocifyCaptureHolder.Holder]::Open())
[Console]::Out.Flush()
Start-Sleep -Seconds 180
`;

/** Lines of a child's stdout, as they come, to wait on. */
function linesOf(child) {
  const lines = [];
  let pending = "";
  child.stdout.on("data", (chunk) => {
    pending += chunk;
    const parts = pending.split(/\r?\n/);
    pending = parts.pop() ?? "";
    lines.push(...parts.map((p) => p.trim()).filter(Boolean));
  });
  return lines;
}

{
  const holder = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(HOLDER_SCRIPT)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const held = linesOf(holder);
  const started = Date.now();
  while (!held.some((l) => l.startsWith("HOLD ")) && Date.now() - started < 90000 && holder.exitCode === null) await sleep(250);
  const answer = held.find((l) => l.startsWith("HOLD ")) ?? "no answer";
  console.log(`      holder: ${answer} (pid ${holder.pid}) in ${Date.now() - started} ms`);
  if (answer !== "HOLD OPEN") {
    failures.push(`the microphone could not be opened on this machine (${answer})`);
    console.log(`FAIL the microphone could not be opened on this machine (${answer})`);
  } else {
    const reader = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(CAPTURE_SESSIONS_SCRIPT)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const reports = linesOf(reader);
    const holds = () => {
      const last = reports.filter((l) => l.startsWith("CAPTURE ")).at(-1);
      return last ? (parseCaptureLine(last) ?? []).some((s) => s.pid === holder.pid) : false;
    };
    const first = Date.now();
    while (!holds() && Date.now() - first < 30000 && reader.exitCode === null) await sleep(250);
    const seen = reports.filter((l) => l.startsWith("CAPTURE ")).at(-1) ?? "no report";
    console.log(`      capture reader: ${seen.slice(0, 300)} in ${Date.now() - first} ms`);
    check(holds(), `the capture reader lists the process holding the microphone (pid ${holder.pid})`);
    const mine = (parseCaptureLine(seen.startsWith("CAPTURE ") ? seen : "CAPTURE []") ?? []).find((s) => s.pid === holder.pid);
    check(Boolean(mine?.path && /powershell\.exe$/i.test(mine.path)), `and it names its executable (${mine?.path ?? "none"})`);
    try {
      execFileSync("taskkill", ["/PID", String(holder.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // Already closed.
    }
    const closed = Date.now();
    while (holds() && Date.now() - closed < 15000 && reader.exitCode === null) await sleep(250);
    check(!holds(), "once the process lets go of the microphone, the reader no longer lists it");
    try {
      execFileSync("taskkill", ["/PID", String(reader.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // Already closed.
    }
  }
  try {
    execFileSync("taskkill", ["/PID", String(holder.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch {
    // Already closed.
  }
}

/* ---------- 3. resources: what the log reports every 10 minutes ---------- */
{
  const listed = parseTasklist(execFileSync("tasklist.exe", ["/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }));
  const kb = listed.kbByPid.get(process.pid);
  check(typeof kb === "number" && kb > 1024, `the real tasklist is read: this test's own process uses ${kb ?? "?"} KB`);
  check((listed.countByName.get("node.exe") ?? 0) >= 1, "and the running programs are counted by name");
}

console.log(failures.length ? `\nwindows-real: ${failures.length} failed` : "\nwindows-real: all passed");
process.exit(failures.length ? 1 : 0);
