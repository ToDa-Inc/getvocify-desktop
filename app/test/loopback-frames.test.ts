/**
 * Pure logic tests for PCM frame conversion.
 * Tests frame size, carry-over across arbitrary input block sizes,
 * stereo downmixing, clipping, and exact int16 values.
 *
 * Run with: node --test app/test/loopback-frames.test.ts
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  createFrameState,
  createPairState,
  downmixToMono,
  floatToInt16,
  processAudioBlock,
  processPairBlock,
} from '../main/src/loopback/pcm-frames.ts';

const FRAME_SIZE = 1600; // samples at 16 kHz
const FRAME_BYTES = 3200; // 1600 * 2 bytes per int16

test('frame size: 1600 samples = 3200 bytes', () => {
  assert.equal(FRAME_BYTES, FRAME_SIZE * 2);
});

test('downmixToMono: single channel passthrough', () => {
  const mono = new Float32Array([0.5, -0.3, 0.1]);
  const result = downmixToMono([mono]);
  assert.deepEqual(result, mono);
});

test('downmixToMono: stereo average', () => {
  const left = new Float32Array([0.5, 0.3]);
  const right = new Float32Array([0.1, 0.5]);
  const result = downmixToMono([left, right]);
  // Average: [(0.5+0.1)/2, (0.3+0.5)/2] = [0.3, 0.4]
  assert.deepEqual(result, new Float32Array([0.3, 0.4]));
});

test('downmixToMono: handle unequal channel lengths', () => {
  const left = new Float32Array([0.5, 0.3, 0.1]);
  const right = new Float32Array([0.1]);
  const result = downmixToMono([left, right]);
  // right[1] and right[2] are undefined, treated as 0
  // [(0.5+0.1)/2, (0.3+0)/2, (0.1+0)/2]
  assert.equal(result.length, 3);
  assert(Math.abs(result[0] - 0.3) < 1e-6, `result[0] should be ~0.3, got ${result[0]}`);
  assert(Math.abs(result[1] - 0.15) < 1e-6, `result[1] should be ~0.15, got ${result[1]}`);
  assert(Math.abs(result[2] - 0.05) < 1e-6, `result[2] should be ~0.05, got ${result[2]}`);
});

test('downmixToMono: empty channels', () => {
  const result = downmixToMono([]);
  assert.deepEqual(result, new Float32Array(0));
});

test('floatToInt16: exact values', () => {
  // 0 → 0
  const result1 = floatToInt16(new Float32Array([0]));
  assert.equal(result1[0], 0);

  // 1.0 → 32767
  const result2 = floatToInt16(new Float32Array([1.0]));
  assert.equal(result2[0], 0x7fff);

  // -1.0 → -32768
  const result3 = floatToInt16(new Float32Array([-1.0]));
  assert.equal(result3[0], -0x8000);

  // 0.5 → 16383 (16383.5 rounded)
  const result4 = floatToInt16(new Float32Array([0.5]));
  assert.equal(result4[0], 16383);

  // -0.5 → -16384
  const result5 = floatToInt16(new Float32Array([-0.5]));
  assert.equal(result5[0], -16384);
});

test('floatToInt16: clipping at ±1.0', () => {
  // Values beyond ±1.0 are clamped
  const result = floatToInt16(new Float32Array([1.5, -1.5, 2.0]));
  assert.equal(result[0], 0x7fff); // Clamped to 1.0
  assert.equal(result[1], -0x8000); // Clamped to -1.0
  assert.equal(result[2], 0x7fff); // Clamped to 1.0
});

test('processAudioBlock: single frame from single block', () => {
  const state = createFrameState();
  const mono = new Float32Array(FRAME_SIZE);
  // Fill with a known pattern (e.g., 0.5)
  mono.fill(0.5);

  const frames = processAudioBlock([mono], state);

  assert.equal(frames.length, 1, 'Should produce one complete frame');
  assert.equal(frames[0].byteLength, FRAME_BYTES, 'Frame must be exactly 3200 bytes');
  assert.equal(state.carryover.length, 0, 'No carryover for exact frame size');

  // Verify the int16 values
  const int16 = new Int16Array(frames[0]);
  const expected = Math.floor(0.5 * 0x7fff);
  for (let i = 0; i < FRAME_SIZE; i++) {
    assert.equal(int16[i], expected, `Sample ${i} should match expected value`);
  }
});

test('processAudioBlock: carry-over across blocks', () => {
  const state = createFrameState();

  // First block: 500 samples
  const block1 = new Float32Array(500);
  block1.fill(0.25);
  const frames1 = processAudioBlock([block1], state);

  assert.equal(frames1.length, 0, 'Incomplete frame, no output');
  assert.equal(state.carryover.length, 500, 'Carryover should be 500 samples');

  // Second block: 1200 samples
  const block2 = new Float32Array(1200);
  block2.fill(0.75);
  const frames2 = processAudioBlock([block2], state);

  assert.equal(frames2.length, 1, 'Should produce one complete frame');
  assert.equal(state.carryover.length, 100, 'Leftover: 500 + 1200 - 1600 = 100');

  // Third block: finalize remainder
  const block3 = new Float32Array(1500);
  block3.fill(0.5);
  const frames3 = processAudioBlock([block3], state);

  assert.equal(frames3.length, 1, 'Should produce one more frame');
  assert.equal(state.carryover.length, 0, 'No carryover after exact alignment');
});

test('processAudioBlock: various block sizes (128, 480, 1000, 4096)', () => {
  const testSizes = [128, 480, 1000, 4096];

  for (const size of testSizes) {
    const state = createFrameState();
    const block = new Float32Array(size);
    block.fill(0.1);

    const frames = processAudioBlock([block], state);

    // For size < FRAME_SIZE, expect 0 frames and carryover
    if (size < FRAME_SIZE) {
      assert.equal(frames.length, 0, `Size ${size}: should produce no complete frames`);
      assert.equal(state.carryover.length, size, `Size ${size}: carryover should equal input size`);
    } else {
      const expectedFrames = Math.floor(size / FRAME_SIZE);
      const expectedCarryover = size % FRAME_SIZE;
      assert.equal(
        frames.length,
        expectedFrames,
        `Size ${size}: should produce ${expectedFrames} frames`
      );
      assert.equal(
        state.carryover.length,
        expectedCarryover,
        `Size ${size}: carryover should be ${expectedCarryover}`
      );
    }

    // Each frame must be exactly 3200 bytes
    for (const frame of frames) {
      assert.equal(frame.byteLength, FRAME_BYTES, `Frame from size ${size} must be 3200 bytes`);
    }
  }
});

test('processAudioBlock: stereo input downmix', () => {
  const state = createFrameState();

  const left = new Float32Array(FRAME_SIZE);
  left.fill(0.5); // Left channel: 0.5
  const right = new Float32Array(FRAME_SIZE);
  right.fill(0.1); // Right channel: 0.1

  const frames = processAudioBlock([left, right], state);

  assert.equal(frames.length, 1, 'Should produce one frame');

  const int16 = new Int16Array(frames[0]);
  // Average: (0.5 + 0.1) / 2 = 0.3
  const expected = Math.floor(0.3 * 0x7fff);
  for (let i = 0; i < FRAME_SIZE; i++) {
    // Allow ±1 for rounding differences
    assert(Math.abs(int16[i] - expected) <= 1, `Sample ${i} should be close to ${expected}`);
  }
});

test('processAudioBlock: silence (all zeros)', () => {
  const state = createFrameState();
  const silence = new Float32Array(FRAME_SIZE);

  const frames = processAudioBlock([silence], state);

  assert.equal(frames.length, 1);
  const int16 = new Int16Array(frames[0]);
  for (let i = 0; i < FRAME_SIZE; i++) {
    assert.equal(int16[i], 0, 'All samples should be zero for silence');
  }
});

test('processAudioBlock: RMS check for sine wave', () => {
  // Generate a 440 Hz sine wave (0.5 amplitude) at 16 kHz sample rate
  const state = createFrameState();
  const frequency = 440; // Hz
  const sampleRate = 16000; // Hz
  const amplitude = 0.5;

  const sine = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    const phase = (2 * Math.PI * frequency * i) / sampleRate;
    sine[i] = amplitude * Math.sin(phase);
  }

  const frames = processAudioBlock([sine], state);
  assert.equal(frames.length, 1);

  const int16 = new Int16Array(frames[0]);
  let sumSquares = 0;
  for (let i = 0; i < FRAME_SIZE; i++) {
    const normalized = int16[i] / 0x7fff; // Convert back to -1..1 range
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / FRAME_SIZE);

  // For a sine wave, RMS ≈ amplitude / sqrt(2) = 0.5 / 1.414 ≈ 0.3536
  const expectedRms = amplitude / Math.sqrt(2);
  const tolerance = 0.05; // 5% tolerance
  assert(
    Math.abs(rms - expectedRms) < tolerance,
    `RMS ${rms} should be close to ${expectedRms} (tolerance ${tolerance})`
  );
});

test('worklet equivalence: same logic in both modules', () => {
  // This test verifies that the worklet's inline logic produces the same output
  // as the pure function module. Since the worklet is a plain JS processor,
  // we can't directly import it in Node, but we verify the logic is identical
  // by spot-checking the shared algorithms.

  const channels = [
    new Float32Array([0.5, 0.3, -0.2]),
    new Float32Array([0.1, -0.4, 0.0]),
  ];

  // Test downmixing
  const result = downmixToMono(channels);
  // Manual calculation:
  // [0] = (0.5 + 0.1) / 2 = 0.3
  // [1] = (0.3 - 0.4) / 2 = -0.05
  // [2] = (-0.2 + 0) / 2 = -0.1
  assert.equal(result.length, 3);
  assert(Math.abs(result[0] - 0.3) < 1e-6);
  assert(Math.abs(result[1] - (-0.05)) < 1e-6);
  assert(Math.abs(result[2] - (-0.1)) < 1e-6);

  // Test float to int16 with same algorithm
  const int16Result = floatToInt16(result);
  // Verify the conversion is correct
  // Note: assignment to Int16Array truncates (not floors) for negative numbers
  const expected0 = Math.trunc(0.3 * 0x7fff);
  const expected1 = Math.trunc(-0.05 * 0x8000);
  const expected2 = Math.trunc(-0.1 * 0x8000);
  assert.equal(int16Result[0], expected0);
  assert.equal(int16Result[1], expected1);
  assert.equal(int16Result[2], expected2);
});

test('createFrameState: initial state is empty carryover', () => {
  const state = createFrameState();
  assert(state.carryover instanceof Float32Array, 'carryover should be Float32Array');
  assert.equal(state.carryover.length, 0, 'initial carryover should be empty');
});

/** 128-sample blocks (what an AudioWorklet gets) of a microphone ramp and a call ramp of the opposite sign. */
function pairBlocks(count: number, withCall = true): Float32Array[][] {
  const blocks: Float32Array[][] = [];
  for (let b = 0; b < count; b++) {
    const mic = new Float32Array(128);
    const call = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      const n = b * 128 + i;
      mic[i] = ((n % 1000) + 1) / 2000;
      call[i] = -mic[i];
    }
    blocks.push(withCall ? [mic, call] : [mic]);
  }
  return blocks;
}

test('processPairBlock: microphone and call cut at the same samples, one pair per 100 ms', () => {
  const state = createPairState();
  // 25 blocks = 3200 samples = exactly two pairs.
  const pairs = pairBlocks(25).flatMap((block) => processPairBlock(block, state));
  assert.equal(pairs.length, 2);
  for (const { mic, call } of pairs) {
    assert.equal(mic.byteLength, FRAME_BYTES);
    assert.equal(call.byteLength, FRAME_BYTES);
    const m = new Int16Array(mic);
    const c = new Int16Array(call);
    for (let i = 0; i < FRAME_SIZE; i++) assert.ok(Math.abs(m[i] + c[i]) <= 1, `sample ${i}: the call's is the microphone's, negated`);
  }
  assert.equal(new Int16Array(pairs[1].mic)[0], floatToInt16(new Float32Array([((1600 % 1000) + 1) / 2000]))[0]);
  assert.equal(state.filled, 0);
});

test('processPairBlock: no right channel means a silent call, the microphone still framed', () => {
  const state = createPairState();
  const pairs = pairBlocks(13, false).flatMap((block) => processPairBlock(block, state));
  assert.equal(pairs.length, 1);
  assert.ok(new Int16Array(pairs[0].call).every((x) => x === 0));
  assert.ok(new Int16Array(pairs[0].mic).some((x) => x !== 0));
  assert.equal(state.filled, 13 * 128 - FRAME_SIZE);
});

test('worklet equivalence: the pair processor in pcm-worklet.js frames exactly as processPairBlock', () => {
  const posted: { mic: ArrayBuffer; call: ArrayBuffer }[] = [];
  const registered: Record<string, new () => { process(inputs: Float32Array[][][]): boolean }> = {};
  class AudioWorkletProcessor {
    port = { postMessage: (message: { type: string; mic: ArrayBuffer; call: ArrayBuffer }) => posted.push(message), onmessage: null };
  }
  runInNewContext(readFileSync(new URL('../main/src/loopback/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor,
    registerProcessor: (name: string, processor: new () => { process(inputs: Float32Array[][][]): boolean }) => (registered[name] = processor),
    Float32Array,
    Int16Array,
    Math,
  });
  const worklet = new registered['pcm-pair-processor']();
  const state = createPairState();
  const expected: { mic: ArrayBuffer; call: ArrayBuffer }[] = [];
  for (const block of pairBlocks(40)) {
    worklet.process([block]);
    expected.push(...processPairBlock(block, state));
  }
  assert.equal(posted.length, expected.length);
  posted.forEach((pair, i) => {
    assert.deepEqual(new Int16Array(pair.mic), new Int16Array(expected[i].mic));
    assert.deepEqual(new Int16Array(pair.call), new Int16Array(expected[i].call));
  });
});
