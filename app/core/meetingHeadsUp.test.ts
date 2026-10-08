import { strict as assert } from "node:assert";
import { test } from "node:test";

import { decodeMeeting, meetingBriefLines, MeetingWording } from "./meetingHeadsUp.ts";

// Same checks as the Mac app (apps/macos/Sources/VocifyCoreChecks/main.swift), so both islands say the same.

test("a meeting announced a minute before it starts", () => {
  const soon = decodeMeeting({
    id: "ev-1",
    who: "Marta García",
    title: "Demo Vocify",
    startsAt: "2026-10-08T09:30:00+00:00",
    url: "https://meet.google.com/abc-defg-hij",
    platform: "meet",
    brief: { state: "ready", lines: ["Asked for pricing for 12 seats."] },
  });
  assert.ok(soon);
  assert.equal(soon.who, "Marta García");
  assert.equal(new URL(soon.url ?? "").host, "meet.google.com");
  assert.equal(meetingBriefLines(soon), 1);
  assert.equal(MeetingWording.line(soon, soon.startsAt - 60_000), "Demo Vocify · in 1 min · Google Meet");
  assert.equal(MeetingWording.when(soon.startsAt, soon.startsAt + 10_000), "now");
  assert.equal(MeetingWording.when(soon.startsAt, soon.startsAt + 190_000), "started 3 min ago");
});

test("a meeting's brief reads the dashboard's lines (kind, date) and the company part, like the call offer's", () => {
  const meeting = decodeMeeting({
    id: "ev-5",
    who: "Marta García",
    startsAt: "2026-10-08T09:30:00Z",
    brief: {
      state: "ready",
      lines: [{ text: "Demo done", type: "meeting", at: "2026-10-02T04:00:00Z" }],
      company: { name: "Acme SL", latest: { type: "call", at: "2026-09-12T04:00:00Z", who: "Toni García (CFO)" }, people: 1, lines: [] },
    },
  })!;
  assert.deepEqual(meeting.brief, {
    state: "ready",
    lines: [{ text: "Demo done", type: "meeting", at: "2026-10-02T04:00:00Z" }],
    company: { name: "Acme SL", latest: { type: "call", at: "2026-09-12T04:00:00Z", who: "Toni García (CFO)" }, people: 1, lines: [] },
  });
  assert.equal(meetingBriefLines(meeting), 3);
});

test("only web links open, and a meeting needs who and a start", () => {
  assert.equal(decodeMeeting({ id: "ev-2", who: "Ana", startsAt: "2026-10-08T09:30:00.123+00:00", url: "javascript:alert(1)" })?.url, null);
  assert.equal(decodeMeeting({ id: "ev-3", who: " ", startsAt: "2026-10-08T09:30:00Z" }), null);
  assert.equal(decodeMeeting({ id: "ev-4", who: "Ana", startsAt: "tomorrow" }), null);
  assert.equal(meetingBriefLines(null), 0);
});
