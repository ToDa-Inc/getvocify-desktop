import assert from "node:assert/strict";
import { test } from "node:test";
import type { Permissions, Status } from "../../src/platform/types.ts";

/**
 * What every OS's permissions must do, driven through the OS edge each implementation fakes: what the OS reports for
 * the microphone, its prompts, its settings pages, and the rep's answer to the browser-reading prompt.
 */
export type PermissionsHarness = {
  permissions: Permissions;
  platform: "win32" | "darwin";
  /** What the OS reports for the microphone: Electron's getMediaAccessStatus values. */
  microphoneIs(raw: "granted" | "denied" | "restricted" | "not-determined"): void;
  /** The rep will allow reading the browsers when asked. */
  repAllowsBrowsers(): void;
  /** OS prompts shown so far ("microphone", "crmTabs"). */
  prompts(): string[];
  /** Settings pages opened so far. */
  opened(): string[];
};

const STATUSES: Status[] = ["authorized", "denied", "never_requested"];

export function permissionsContract(name: string, harness: () => PermissionsHarness): void {
  test(`${name} permissions: the status names this OS and only uses the three states`, () => {
    const h = harness();
    const status = h.permissions.status();
    assert.equal(status.platform, h.platform);
    for (const kind of ["microphone", "systemAudio", "crmTabs"] as const) {
      assert.ok(STATUSES.includes(status[kind]), `${kind}: ${status[kind]}`);
    }
  });

  test(`${name} permissions: the microphone status is what the OS reports`, () => {
    const h = harness();
    const cases = [
      ["granted", "authorized"],
      ["denied", "denied"],
      ["restricted", "denied"],
      ["not-determined", "never_requested"],
    ] as const;
    for (const [raw, expected] of cases) {
      h.microphoneIs(raw);
      assert.equal(h.permissions.status().microphone, expected, raw);
    }
  });

  test(`${name} permissions: asking for a microphone never asked shows one way to allow it`, async () => {
    const h = harness();
    h.microphoneIs("not-determined");
    await h.permissions.request("microphone");
    assert.equal(h.prompts().filter((p) => p === "microphone").length + h.opened().length, 1, "a prompt or a settings page, once");
  });

  test(`${name} permissions: a denied microphone sends the rep to the OS settings page`, async () => {
    const h = harness();
    h.microphoneIs("denied");
    await h.permissions.request("microphone");
    assert.deepEqual(h.prompts(), []);
    assert.deepEqual(h.opened(), [h.permissions.settingsUrl("microphone")]);
    assert.ok(h.permissions.settingsUrl("microphone"));
  });

  test(`${name} permissions: an allowed microphone asks nothing`, async () => {
    const h = harness();
    h.microphoneIs("granted");
    await h.permissions.request("microphone");
    assert.deepEqual([h.prompts(), h.opened()], [[], []]);
  });

  test(`${name} permissions: browser reading is allowed once the rep allows it`, async () => {
    const h = harness();
    h.repAllowsBrowsers();
    await h.permissions.request("crmTabs");
    assert.equal(h.permissions.status().crmTabs, "authorized");
  });
}
