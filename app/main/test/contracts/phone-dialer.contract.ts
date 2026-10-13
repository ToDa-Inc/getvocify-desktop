import assert from "node:assert/strict";
import { test } from "node:test";
import type { PhoneDialer } from "../../src/platform/types.ts";

/** What every OS's phone dialer must do, driven through the OS edge each implementation fakes: which app makes phone
 * calls, and the calls it was asked to open. */
export type PhoneDialerHarness = {
  dialer: PhoneDialer;
  /** The `tel:` links opened so far. */
  opened(): string[];
  /** What setting up opened (the OS's own app or settings page), in the harness's words. */
  setupOpened(): string[];
};

export function phoneDialerContract(name: string, withApp: () => PhoneDialerHarness, withoutApp: () => PhoneDialerHarness): void {
  test(`${name} phone: a number opens one call to it, in the app it names`, async () => {
    const h = withApp();
    assert.ok(h.dialer.app());
    assert.deepEqual(await h.dialer.dial("+34600111222"), { ok: true });
    assert.deepEqual(h.opened(), ["tel:+34600111222"]);
  });

  test(`${name} phone: the spaces and dashes a CRM keeps are not dialed`, async () => {
    const h = withApp();
    await h.dialer.dial("+34 600-111 222");
    assert.deepEqual(h.opened(), ["tel:+34600111222"]);
  });

  test(`${name} phone: something that is not a number opens nothing`, async () => {
    const h = withApp();
    assert.deepEqual(await h.dialer.dial("+34 600 abc"), { ok: false, reason: "invalid_number" });
    assert.deepEqual(h.opened(), []);
  });

  test(`${name} phone: without an app for calls, it says so and opens nothing`, async () => {
    const h = withoutApp();
    assert.equal(h.dialer.app(), null);
    assert.deepEqual(await h.dialer.dial("+34600111222"), { ok: false, reason: "no_dialer" });
    assert.deepEqual(h.opened(), []);
  });

  test(`${name} phone: setting up opens the OS's own place for it, and calls nobody`, async () => {
    const h = withoutApp();
    await h.dialer.setup();
    assert.equal(h.setupOpened().length, 1);
    assert.deepEqual(h.opened(), []);
  });
}
