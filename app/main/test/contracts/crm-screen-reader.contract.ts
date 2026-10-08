import assert from "node:assert/strict";
import { test } from "node:test";
import type { CrmScreenReader } from "../../src/platform/types.ts";

export const HUBSPOT_CONTACT = "https://app-eu1.hubspot.com/contacts/147506535/record/0-1/879829962968";
export const HUBSPOT_DEAL = "https://app-eu1.hubspot.com/contacts/147506535/record/0-3/525154115832";
export const NOT_CRM = "https://mail.google.com/mail/u/0/#inbox";

/** What every OS's CRM reader must do, driven through the OS edge each implementation fakes (what is on screen). */
export type CrmScreenReaderHarness = {
  reader: CrmScreenReader;
  /** This OS's id for Google Chrome ("chrome" on Windows, "com.google.Chrome" on a Mac). */
  chrome: string;
  /** This OS's id for a desktop app that is not a browser. */
  notABrowser: string;
  /** Chrome is in front, its front tab showing `url`. */
  chromeShows(url: string): void;
  /** The non-browser app is in front. */
  otherAppInFront(): void;
  /** The OS cannot be asked right now (the reader process died, the script timed out). */
  osCannotAnswer(): void;
};

export function crmScreenReaderContract(name: string, harness: () => CrmScreenReaderHarness): void {
  test(`${name} CRM reader: the app in front is named, browsers are told apart from other apps`, async () => {
    const h = harness();
    h.chromeShows(HUBSPOT_CONTACT);
    assert.equal(await h.reader.front(), h.chrome);
    assert.equal(h.reader.isBrowser(h.chrome), true);
    assert.equal(h.reader.isBrowser(h.notABrowser), false);
    h.otherAppInFront();
    assert.equal(await h.reader.front(), h.notABrowser);
  });

  test(`${name} CRM reader: the record in Chrome's front tab is read`, async () => {
    const h = harness();
    h.chromeShows(HUBSPOT_CONTACT);
    assert.deepEqual(await h.reader.read(h.chrome), [HUBSPOT_CONTACT]);
    h.chromeShows(HUBSPOT_DEAL);
    assert.deepEqual(await h.reader.read(h.chrome), [HUBSPOT_DEAL], "a new tab is read anew, never the last answer");
  });

  test(`${name} CRM reader: a page that is not a CRM record reads as no record`, async () => {
    const h = harness();
    h.chromeShows(NOT_CRM);
    assert.deepEqual(await h.reader.read(h.chrome), []);
  });

  test(`${name} CRM reader: when the OS cannot answer, nothing is read and the last record is never repeated`, async () => {
    const h = harness();
    h.chromeShows(HUBSPOT_CONTACT);
    assert.deepEqual(await h.reader.read(h.chrome), [HUBSPOT_CONTACT]);
    h.osCannotAnswer();
    const urls = await h.reader.read(h.chrome);
    assert.ok(urls === null || urls.length === 0, `got ${JSON.stringify(urls)}`);
    assert.equal(await h.reader.front(), null);
  });
}
