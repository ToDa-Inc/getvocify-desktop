import assert from "node:assert/strict";
import { test } from "node:test";
import { startsPageAtLaunch } from "../src/calendar-watch.ts";

test("the dashboard page starts with the app while the calendar is watched", () => {
  assert.equal(startsPageAtLaunch({ calendarWatch: true, recorderReady: true }), true);
  assert.equal(startsPageAtLaunch({ calendarWatch: true, recorderReady: false }), true);
});

test("it also starts, once, for a signed-in rep whose calendar it has not yet asked about", () => {
  assert.equal(startsPageAtLaunch({ calendarWatch: undefined, recorderReady: true }), true);
});

test("it does not start for a rep known to have no calendar, nor for someone signed out", () => {
  assert.equal(startsPageAtLaunch({ calendarWatch: false, recorderReady: true }), false);
  assert.equal(startsPageAtLaunch({ calendarWatch: undefined, recorderReady: false }), false);
  assert.equal(startsPageAtLaunch({ calendarWatch: undefined, recorderReady: undefined }), false);
});
