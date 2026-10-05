/**
 * Pure function module for converting float32 audio channels to mono 16-bit PCM frames.
 * Used by both the AudioWorklet and Node tests; must produce identical output.
 *
 * Input: float32 channels (arrays of arrays), arbitrary block sizes
 * Output: 3200-byte frames (1600 samples at 16 kHz, 100 ms), with carry-over state
 *
 * The frame size is fixed: 3200 bytes = 1600 int16 samples = 100 ms at 16 kHz.
 * Samples are clamped to [-1, 1] before conversion to int16.
 */

export interface PcmFrameState {
  carryover: Float32Array;
}

/**
 * Downsample (nearest-neighbor) float32 samples to target size.
 * Used internally by frame conversion.
 */
export function downsample(samples: Float32Array, targetLength: number): Float32Array {
  if (targetLength === samples.length) return samples;
  if (targetLength === 0) return new Float32Array(0);

  const result = new Float32Array(targetLength);
  const ratio = samples.length / targetLength;
  for (let i = 0; i < targetLength; i++) {
    result[i] = samples[Math.floor(i * ratio)] || 0;
  }
  return result;
}

/**
 * Downmix stereo or multi-channel float32 to mono by averaging.
 * If input is already mono (1 channel), returns it as-is.
 */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];

  // Find the maximum length among all channels
  const length = Math.max(...channels.map((ch) => ch.length));
  const result = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) {
      sum += (channels[c][i] ?? 0);
    }
    result[i] = sum / channels.length;
  }

  return result;
}

/**
 * Convert float32 samples (range [-1, 1]) to int16 (range [-32768, 32767]).
 * Clamps values to [-1, 1] to prevent overflow.
 */
export function floatToInt16(samples: Float32Array): Int16Array {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * Create or get initial frame state.
 */
export function createFrameState(): PcmFrameState {
  return { carryover: new Float32Array(0) };
}

/**
 * Process one block of audio (multiple channels of float32 samples).
 * Returns an array of 3200-byte frames; updates state.carryover with leftover samples.
 *
 * @param channels - Array of Float32Array, one per audio channel
 * @param state - Frame state (carries partial frames across blocks)
 * @returns Array of ArrayBuffer (each exactly 3200 bytes)
 */
export function processAudioBlock(
  channels: Float32Array[],
  state: PcmFrameState
): ArrayBuffer[] {
  const FRAME_SIZE = 1600; // samples at 16 kHz for 100 ms
  const FRAME_BYTES = 3200; // 1600 * 2 bytes per int16

  // Downmix all channels to mono
  const mono = downmixToMono(channels);

  // Prepend any carryover from the previous block
  const allSamples = new Float32Array(state.carryover.length + mono.length);
  allSamples.set(state.carryover, 0);
  allSamples.set(mono, state.carryover.length);

  // Split into complete frames and remainder
  const completeFrames = Math.floor(allSamples.length / FRAME_SIZE);
  const remainderSamples = allSamples.length % FRAME_SIZE;

  // Update carryover with remainder
  state.carryover = remainderSamples > 0
    ? allSamples.slice(completeFrames * FRAME_SIZE)
    : new Float32Array(0);

  // Convert complete frames to int16 and output as ArrayBuffer
  const frames: ArrayBuffer[] = [];
  for (let i = 0; i < completeFrames; i++) {
    const frameStart = i * FRAME_SIZE;
    const frameSamples = allSamples.slice(frameStart, frameStart + FRAME_SIZE);
    const int16 = floatToInt16(frameSamples);
    const sliced = int16.buffer.slice(int16.byteOffset, int16.byteOffset + FRAME_BYTES);
    frames.push(sliced as ArrayBuffer);
  }

  return frames;
}
