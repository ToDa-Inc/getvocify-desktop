import assert from "node:assert/strict";
import { test } from "node:test";
import type { CallDetector, DetectedCaller } from "../../src/platform/types.ts";

/**
 * What every OS's call detector must do, driven through the OS edge each implementation fakes:
 * which apps hold the microphone, and the passing of time.
 */
export type CallDetectorHarness = {
  detector: CallDetector;
  /** Zoom (the desktop app) starts holding the microphone now. */
  zoomStarts(): void;
  /** Zoom lets go of the microphone now. */
  zoomStops(): void;
  /** Vocify itself starts holding the microphone now (it records the rep). */
  vocifyStarts(): void;
  /** Lets `ms` pass, and the detector look again. */
  advance(ms: number): Promise<void>;
};

export function callDetectorContract(name: string, harness: () => CallDetectorHarness): void {
  const watch = (h: CallDetectorHarness) => {
    const seen: (DetectedCaller | null)[] = [];
    h.detector.start((caller) => seen.push(caller));
    return seen;
  };
  const named = (seen: (DetectedCaller | null)[]) => seen.filter((c): c is DetectedCaller => c !== null).map((c) => c.name);

  test(`${name} call detector: a call app that keeps the microphone is reported as that app`, async () => {
    const h = harness();
    const seen = watch(h);
    await h.advance(1000);
    h.zoomStarts();
    await h.advance(2000);
    assert.deepEqual(named(seen), ["Zoom"]);
    assert.equal(seen.at(-1)?.browser, false);
  });

  test(`${name} call detector: the same call is reported once, and its end once`, async () => {
    const h = harness();
    const seen = watch(h);
    h.zoomStarts();
    await h.advance(2000);
    await h.advance(2000);
    await h.advance(2000);
    assert.deepEqual(named(seen), ["Zoom"]);
    h.zoomStops();
    await h.advance(2000);
    await h.advance(2000);
    assert.equal(seen.at(-1), null);
    assert.equal(seen.filter((c, i) => c === null && seen[i - 1] !== null && i > 0).length, 1, "the end is reported once");
  });

  test(`${name} call detector: Vocify's own microphone is never a call`, async () => {
    const h = harness();
    const seen = watch(h);
    h.vocifyStarts();
    await h.advance(2000);
    await h.advance(2000);
    assert.deepEqual(named(seen), []);
  });

  test(`${name} call detector: nothing is reported after stop`, async () => {
    const h = harness();
    const seen = watch(h);
    await h.advance(1000);
    h.detector.stop();
    const before = seen.length;
    h.zoomStarts();
    await h.advance(2000);
    await h.advance(2000);
    assert.equal(seen.length, before);
  });
}
