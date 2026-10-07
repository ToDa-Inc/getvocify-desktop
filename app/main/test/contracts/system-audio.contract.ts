import assert from "node:assert/strict";
import { test } from "node:test";
import type { SystemAudio } from "../../src/platform/types.ts";

/** What every OS's call-audio capture must do, driven through the OS edge each implementation fakes. */
export type SystemAudioHarness = {
  audio: SystemAudio;
  /** The OS delivers `bytes` of captured audio, in whatever pieces it likes. */
  osPlays(bytes: number): Promise<void>;
  /** The OS capture ends on its own. */
  osEnds(): Promise<void>;
};

export function systemAudioContract(name: string, harness: () => SystemAudioHarness): void {
  test(`${name} system audio: capture starts, or says why not, and never throws`, async () => {
    const h = harness();
    const result = await h.audio.start();
    assert.equal(typeof result.ok, "boolean");
    if (!result.ok) assert.ok(result.reason, "a refusal says why");
    await h.audio.stop();
  });

  test(`${name} system audio: the audio arrives in exact 3200-byte chunks`, async () => {
    const h = harness();
    const sizes: number[] = [];
    h.audio.onPcm((pcm) => sizes.push(pcm.byteLength));
    const { ok } = await h.audio.start();
    if (!ok) return; // nothing to deliver on an OS that cannot capture; the test above covers the refusal
    await h.osPlays(3200 * 3 + 1000);
    assert.deepEqual(sizes, [3200, 3200, 3200]);
    await h.audio.stop();
  });

  test(`${name} system audio: one capture at a time, and nothing arrives after stop`, async () => {
    const h = harness();
    const sizes: number[] = [];
    h.audio.onPcm((pcm) => sizes.push(pcm.byteLength));
    const { ok } = await h.audio.start();
    if (!ok) return;
    assert.equal((await h.audio.start()).ok, false, "a second start while capturing is refused");
    await h.audio.stop();
    await h.osPlays(3200 * 2);
    assert.deepEqual(sizes, []);
  });

  test(`${name} system audio: a capture that ends on its own is reported once`, async () => {
    const h = harness();
    const lost: string[] = [];
    h.audio.onLost((reason) => lost.push(reason));
    const { ok } = await h.audio.start();
    if (!ok) return;
    await h.osEnds();
    assert.equal(lost.length, 1);
    assert.ok(lost[0]);
  });
}
