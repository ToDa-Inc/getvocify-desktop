// Who the meeting app shows speaking (Mac): the helper's `speakers` lines become names, and the Chrome native
// messaging manifest points the Vocify extension at the helper. The helper is a fake child process.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { HelperChild } from "../src/platform/mac/helper.ts";
import { createMacSpeakerReader, EXTENSION_IDS, hostManifest, installMeetHost, MEET_HOST } from "../src/platform/mac/speakers.ts";

function fakeHelper() {
  const events = new EventEmitter();
  const stdout = new EventEmitter();
  const child = {
    stdout: { on: (_e: "data", fn: (chunk: Buffer) => void) => stdout.on("data", fn) },
    stderr: { on: () => undefined },
    stdin: { end: () => void (child.ended = true) },
    on: (_e: "exit", fn: (code: number | null) => void) => events.on("exit", fn),
    kill: () => void (child.killed = true),
    ended: false,
    killed: false,
    write: (line: string) => stdout.emit("data", Buffer.from(line)),
    exit: () => events.emit("exit", 0),
  };
  return child;
}

test("the helper's readings become names; stop ends the helper", () => {
  const helpers: ReturnType<typeof fakeHelper>[] = [];
  const asked: boolean[] = [];
  const reader = createMacSpeakerReader({
    spawn: (ask) => {
      asked.push(ask);
      const h = fakeHelper();
      helpers.push(h);
      return h as unknown as HelperChild;
    },
  });
  const heard: string[][] = [];
  reader.start({ askAccessibility: true }, (names) => heard.push(names));
  reader.start({ askAccessibility: false }, () => {});
  assert.equal(helpers.length, 1);
  assert.deepEqual(asked, [true]);
  helpers[0].write('{"event":"speaking","source":"zoom","names":["Marta Garc');
  helpers[0].write('ía"]}\n{"event":"other"}\nnot json\n{"event":"speaking","source":"meet","names":[]}\n');
  assert.deepEqual(heard, [["Marta García"], []]);
  reader.stop();
  assert.equal(helpers[0].ended && helpers[0].killed, true);
  // A helper that went away can be started again.
  reader.start({ askAccessibility: false }, () => {});
  assert.equal(helpers.length, 2);
});

test("Chrome's manifest names the host, the helper and only real extension ids", () => {
  const manifest = JSON.parse(hostManifest("/Applications/Vocify.app/Contents/Resources/mac-helper/vocify-mac-helper", [...EXTENSION_IDS, "nope"]));
  assert.equal(manifest.name, MEET_HOST);
  assert.equal(manifest.type, "stdio");
  assert.deepEqual(manifest.allowed_origins, ["chrome-extension://eaneblbmmpgdchcejlfhiiklpcolfclb/"]);
});

test("the manifest is written only for browsers that are installed", () => {
  const home = mkdtempSync(join(tmpdir(), "vocify-home-"));
  mkdirSync(join(home, "Library/Application Support/Google/Chrome"), { recursive: true });
  installMeetHost("/x/vocify-mac-helper", home, () => {});
  const chrome = join(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts", `${MEET_HOST}.json`);
  assert.equal(JSON.parse(readFileSync(chrome, "utf8")).path, "/x/vocify-mac-helper");
  assert.equal(existsSync(join(home, "Library/Application Support/Chromium")), false);
});
