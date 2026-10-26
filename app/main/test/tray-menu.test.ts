import assert from "node:assert/strict";
import { test } from "node:test";
import { micChoices } from "../src/tray-menu.ts";

const devices = [{ id: "mac", label: "MacBook Pro Microphone" }, { id: "air", label: "AirPods Pro" }];

test("the menu's Microphone list waits for the dashboard to name the mics", () => {
  assert.deepEqual(micChoices(null), []);
  assert.deepEqual(micChoices({ devices: [], defaultLabel: null, chosen: null, inUse: null, notice: false }), []);
});

test("the Microphone list: the system's default, every mic, the picked one ticked", () => {
  assert.deepEqual(micChoices({ devices, defaultLabel: "AirPods Pro", chosen: null, inUse: null, notice: false }), [
    { label: "System default (AirPods Pro)", checked: true, enabled: true, mic: null },
    { separator: true },
    { label: "MacBook Pro Microphone", checked: false, enabled: true, mic: devices[0] },
    { label: "AirPods Pro", checked: false, enabled: true, mic: devices[1] },
  ]);
  const picked = micChoices({ devices, defaultLabel: null, chosen: devices[0], inUse: null, notice: false });
  assert.equal(picked[0] && "label" in picked[0] ? picked[0].label : null, "System default");
  assert.deepEqual(picked.filter((c) => "checked" in c && c.checked).map((c) => ("label" in c ? c.label : "")), ["MacBook Pro Microphone"]);
});

test("a picked mic that is not connected stays in the list, ticked and greyed", () => {
  const away = { id: "iphone", label: "iPhone Microphone" };
  const items = micChoices({ devices, defaultLabel: "AirPods Pro", chosen: away, inUse: "AirPods Pro", notice: true });
  assert.deepEqual(items[items.length - 1], { label: "iPhone Microphone (not connected)", checked: true, enabled: false, mic: away });
});
