import assert from "node:assert/strict";
import { test } from "node:test";
import { callSourceForExe } from "../src/windows/call-sources.ts";

test("desktop call apps say what kind of conversation they are, browsers and unknown apps do not", () => {
  assert.deepEqual(callSourceForExe("Zoom.exe")?.json, { name: "Zoom", kind: "meeting" });
  assert.deepEqual(callSourceForExe("ms-teams.exe")?.json, { name: "Microsoft Teams", kind: "meeting" });
  assert.deepEqual(callSourceForExe("whatsapp.exe")?.json, { name: "WhatsApp", kind: "call" });
  assert.equal(callSourceForExe("chrome.exe"), null, "the page says what a browser call is");
  assert.equal(callSourceForExe("granola.exe"), null);
  assert.equal(callSourceForExe(null), null);
  assert.equal(callSourceForExe(undefined), null);
});
