import assert from "node:assert/strict";
import { test } from "node:test";
import { countLaunch, launchCounts, parsePs, parseTasklist, processName, resourceLine } from "../src/resources.ts";

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
      "running: browser reader 88 MB, audio-sessions reader ? · powershell.exe on the computer: 3 · launched since start: reg.exe 11520, powershell.exe 14",
  );
});

test("where the system does not say how much memory is free, only the total is written", () => {
  const line = resourceLine({ mode: "recording", uptimeMs: 5 * 60_000, freeBytes: null, totalBytes: 16 * 1024 ** 3, own: [{ name: "main", kb: 1024, cpu: 0 }], children: [], powershells: null, launches: [] });
  assert.equal(line, "resources (recording, up 5m): 16.0 GB memory · Vocify 1 MB [main 1] cpu 0.0%");
});
