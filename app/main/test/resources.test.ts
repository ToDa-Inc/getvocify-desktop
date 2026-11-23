import assert from "node:assert/strict";
import { test } from "node:test";
import { countLaunch, heaviestPrograms, launchCounts, parsePs, parseTasklist, processName, resourceLine } from "../src/resources.ts";

test("Electron's processes are named as the log shows them; a page by its window", () => {
  assert.equal(processName("Browser", undefined, undefined), "main");
  assert.equal(processName("GPU", undefined, undefined), "gpu");
  assert.equal(processName("Tab", undefined, "dashboard"), "dashboard");
  assert.equal(processName("Tab", undefined, undefined), "page");
  assert.equal(processName("Utility", "network.mojom.NetworkService", undefined), "network");
  assert.equal(processName("Utility", "video_capture.mojom.VideoCaptureService", undefined), "video_capture");
  assert.equal(processName("Utility", undefined, undefined), "utility");
});

test("tasklist's memory column is read by its digits, whatever the system's language", () => {
  const listed = parseTasklist(
    [
      '"powershell.exe","4120","Console","1","85,432 K"',
      '"powershell.exe","5200","Console","1","61.004 KB"',
      '"Vocify.exe","900","Console","1","120.512 K"',
      "",
      "INFO: something that is not a row",
    ].join("\r\n"),
  );
  assert.equal(listed.kbByPid.get(4120), 85432);
  assert.equal(listed.kbByPid.get(5200), 61004);
  assert.equal(listed.countByName.get("powershell.exe"), 2);
  assert.equal(listed.countByName.get("vocify.exe"), 1);
  assert.equal(listed.kbByName.get("powershell.exe"), 85432 + 61004, "a program's processes are added up");
});

test("the programs holding the most memory are listed largest first, each with all its processes together", () => {
  const listed = parseTasklist(
    ['"chrome.exe","10","Console","1","900,000 K"', '"chrome.exe","11","Console","1","600,000 K"', '"Teams.exe","12","Console","1","700,000 K"', '"Vocify.exe","13","Console","1","300,000 K"', '"svchost.exe","14","Services","0","20,000 K"'].join("\r\n"),
  );
  assert.deepEqual(heaviestPrograms(listed, 3), [
    { name: "chrome.exe", kb: 1_500_000, count: 2 },
    { name: "teams.exe", kb: 700_000, count: 1 },
    { name: "vocify.exe", kb: 300_000, count: 1 },
  ]);
});

test("ps lists memory by pid", () => {
  assert.deepEqual([...parsePs(" 501  20480\n 777 1024\n\n")], [[501, 20480], [777, 1024]]);
});

test("launches are counted by program name", () => {
  countLaunch("C:\\Windows\\System32\\reg.exe");
  countLaunch("reg.exe");
  assert.equal(launchCounts().find(([name]) => name === "reg.exe")?.[1], 2);
});

test("one log line says what the app costs, largest process first", () => {
  const line = resourceLine({
    mode: "idle",
    uptimeMs: (3 * 60 + 12) * 60_000,
    freeBytes: 2.1 * 1024 ** 3,
    totalBytes: 16 * 1024 ** 3,
    own: [
      { name: "island", kb: 95 * 1024, cpu: 0.4 },
      { name: "dashboard", kb: 410 * 1024, cpu: 1.5 },
      { name: "main", kb: 120 * 1024, cpu: 0.6 },
    ],
    children: [{ name: "browser reader", kb: 88 * 1024 }, { name: "audio-sessions reader", kb: null }],
    powershells: 3,
    launches: [["reg.exe", 11520], ["powershell.exe", 14]],
  });
  assert.equal(
    line,
    "resources (idle, up 3h12m): free 2.1 of 16.0 GB · Vocify 625 MB [dashboard 410, main 120, island 95] cpu 2.5% · " +
      "cpu by process: dashboard 1.5, main 0.6, island 0.4 · " +
      "running: browser reader 88 MB, audio-sessions reader ? · powershell.exe on the computer: 3 · launched since start: reg.exe 11520, powershell.exe 14",
  );
});

test("where the system does not say how much memory is free, only the total is written", () => {
  const line = resourceLine({ mode: "recording", uptimeMs: 5 * 60_000, freeBytes: null, totalBytes: 16 * 1024 ** 3, own: [{ name: "main", kb: 1024, cpu: 0 }], children: [], powershells: null, launches: [] });
  assert.equal(line, "resources (recording, up 5m): 16.0 GB memory · Vocify 1 MB [main 1] cpu 0.0%");
});

test("the line adds what is Vocify's own when Windows reports it, apart from memory shared between its processes", () => {
  const line = resourceLine({
    mode: "idle", uptimeMs: 60_000, freeBytes: null, totalBytes: 8 * 1024 ** 3, children: [], powershells: null, launches: [],
    own: [{ name: "dashboard", kb: 200 * 1024, cpu: 0, privateKb: 120 * 1024 }, { name: "gpu", kb: 180 * 1024, cpu: 0, privateKb: 60 * 1024 }],
  });
  assert.match(line, /Vocify 380 MB \(its own 180 MB\) \[dashboard 200, gpu 180\]/);
  assert.match(line, /own by process: dashboard 120, gpu 60/, "and which process holds it");
  assert.doesNotMatch(line, /cpu by process/, "no process used the CPU: nothing to list");
});

test("a computer short of memory has its heaviest programs in the line", () => {
  const line = resourceLine({
    mode: "idle", uptimeMs: 60_000, freeBytes: 0.3 * 1024 ** 3, totalBytes: 7.8 * 1024 ** 3, children: [], powershells: 0, launches: [],
    own: [{ name: "main", kb: 60 * 1024, cpu: 0 }],
    heaviest: [{ name: "chrome.exe", kb: 3120 * 1024, count: 38 }, { name: "vocify.exe", kb: 400 * 1024, count: 8 }, { name: "memcompression", kb: 900 * 1024, count: 1 }],
  });
  assert.match(line, /heaviest on the computer: chrome\.exe 3120 MB in 38, vocify\.exe 400 MB in 8, memcompression 900 MB/);
});
