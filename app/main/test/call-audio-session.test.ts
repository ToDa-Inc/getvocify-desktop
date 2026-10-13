import assert from "node:assert/strict";
import { test } from "node:test";
import { CallAudioSession, parseSessionsLine } from "../src/call-audio-session.ts";

const music = { pid: 10, app: "Spotify", id: "spotify-1" };
const call = { pid: 20, app: "PhoneExperienceHost", id: "call-1" };
const vocify = { pid: 30, app: "Vocify", id: "vocify-1" };

function setup() {
  const events: string[] = [];
  const session = new CallAudioSession({ ownApp: "Vocify", log: () => {} });
  session.onEnded(() => void events.push("ended"));
  session.onBack(() => void events.push("back"));
  return { session, events };
}

test("the reader's line is the sessions playing sound now", () => {
  assert.deepEqual(parseSessionsLine('SESSIONS [{"pid":20,"app":"PhoneExperienceHost","id":"a\\\\b|c"}]'), [{ pid: 20, app: "PhoneExperienceHost", id: "a\\b|c" }]);
  assert.deepEqual(parseSessionsLine("SESSIONS []"), []);
  assert.equal(parseSessionsLine("ERROR something"), null);
  assert.equal(parseSessionsLine("SESSIONS {broken"), null);
});

test("the call is the session that started playing after Call, not one that already played, and never Vocify's", () => {
  const t = setup();
  t.session.update([music]);
  t.session.update([music, call, vocify]);
  assert.deepEqual(t.session.heard(), [call]);
});

test("the call's session going quiet is the hang-up, and coming back cancels it", () => {
  const t = setup();
  t.session.update([music]);
  t.session.update([music, call]);
  t.session.heard();
  t.session.update([music]);
  assert.deepEqual(t.events, ["ended"]);
  t.session.update([music, call]);
  assert.deepEqual(t.events, ["ended", "back"]);
  t.session.update([music, call]);
  assert.deepEqual(t.events, ["ended", "back"], "said once per change");
});

test("other apps starting and stopping say nothing about the call", () => {
  const t = setup();
  t.session.update([]);
  t.session.update([call]);
  t.session.heard();
  t.session.update([call, music]);
  t.session.update([call]);
  assert.deepEqual(t.events, []);
});

test("no new session when the call was heard: nothing to follow, the silence rule decides", () => {
  const t = setup();
  t.session.update([music]);
  assert.deepEqual(t.session.heard(), []);
  t.session.update([]);
  assert.deepEqual(t.events, []);
});

test("heard before the reader's first answer: what plays then (but Vocify) is the call", () => {
  const t = setup();
  assert.deepEqual(t.session.heard(), []);
  t.session.update([call, vocify]);
  assert.deepEqual(t.session.followed(), [call]);
  t.session.update([vocify]);
  assert.deepEqual(t.events, ["ended"]);
});
