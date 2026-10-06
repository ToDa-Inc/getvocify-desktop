import { strict as assert } from "node:assert";
import { test } from "node:test";

import { CallWording, CrmScreenChange, CrmTabsAccess, decodeDial, decodeOnScreen, isVocifyCallUp, PhoneFormat } from "./callIsland.ts";

// Same checks as the Mac app (apps/macos/Sources/VocifyCoreChecks/main.swift), so both islands say the same.

test("CRM screen changes are sent once", () => {
  const screen = new CrmScreenChange();
  assert.deepEqual(screen.next(["a"]), ["a"]);
  assert.equal(screen.next(["a"]), null);
  assert.deepEqual(screen.next([]), []);
  assert.equal(screen.next([]), null);
});

test("CRM tab access, from each browser's answer", () => {
  assert.equal(CrmTabsAccess.aggregate(["denied", "granted"]), "authorized");
  assert.equal(CrmTabsAccess.aggregate([]), "unavailable");
  assert.equal(CrmTabsAccess.aggregate(["not_asked", "denied"]), "denied");
  assert.equal(CrmTabsAccess.aggregate(["not_asked", "unavailable"]), "never_requested");
});

test("phones read like the dashboard", () => {
  assert.equal(PhoneFormat.grouped("+34600111222"), "+34 600 11 12 22");
  assert.equal(PhoneFormat.grouped("+447700900123"), "+447700900123");
});

const ana = decodeOnScreen({ provider: "hubspot", crmLabel: "HubSpot", name: "Ana Ruiz", phone: "+34600111222", callerId: "+34910000000", state: "callable" });

test("the contact on screen", () => {
  assert.equal(ana?.state, "callable");
  assert.equal(decodeOnScreen(null), null);
  assert.equal(decodeOnScreen({ state: "weird" }), null);
  assert.deepEqual(CallWording.confirm(ana!), { title: "Ana Ruiz", line: "+34 600 11 12 22 · from +34 910 00 00 00", button: "Call" });
  assert.equal(CallWording.glyphHelp(ana!), "Call Ana Ruiz");
  const noPhone = decodeOnScreen({ provider: "hubspot", crmLabel: "HubSpot", name: "Ana Ruiz", state: "no_phone" })!;
  assert.equal(CallWording.glyphHelp(noPhone), "No phone in HubSpot");
  assert.equal(CallWording.confirm(noPhone).button, null);
  const noCaller = decodeOnScreen({ provider: "hubspot", crmLabel: "HubSpot", name: "Ana Ruiz", phone: "+34600111222", state: "no_caller_id" })!;
  assert.deepEqual(CallWording.confirm(noCaller), { title: "Ana Ruiz", line: "Add a caller ID to call", button: "Add caller ID" });
  const several = decodeOnScreen({ provider: "hubspot", crmLabel: "HubSpot", state: "needs_contact" })!;
  assert.deepEqual(CallWording.confirm(several), { title: "HubSpot record with several contacts", line: "Open the contact to call", button: null });
});

test("the call in progress", () => {
  const ringing = decodeDial({ phase: "ringing", name: "Ana Ruiz", phone: "+34600111222", muted: false })!;
  assert.equal(CallWording.dialing(ringing), "Calling Ana Ruiz…");
  assert.equal(CallWording.dialing(decodeDial({ phase: "connecting", phone: "+34600111222", muted: false })!), "Calling +34 600 11 12 22…");
  const missed = decodeDial({ phase: "ended", phone: "+34600111222", muted: false, message: "Busy" })!;
  assert.equal(CallWording.ended(missed), "Busy");
  assert.equal(CallWording.ended(decodeDial({ phase: "ended", phone: "+34600111222", muted: false })!), "Call ended");
  const live = decodeDial({ phase: "active", phone: "+34600111222", muted: true, answeredAt: 1_700_000_000_000 })!;
  assert.equal(live.muted, true);
  assert.equal(live.answeredAt, 1_700_000_000_000);
  assert.equal(decodeDial({ phase: "active" }), null);
  assert.equal(isVocifyCallUp(live), true);
  assert.equal(isVocifyCallUp(missed), false);
  assert.equal(isVocifyCallUp(null), false);
});
