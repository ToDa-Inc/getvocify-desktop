/**
 * AudioWorklet processor for loopback audio capture.
 * Runs in the AudioWorklet thread; inlines frame conversion logic (must match pcm-frames.ts).
 * Downmixes to mono, converts float32 to int16, and posts 3200-byte (1600-sample) frames.
 */

class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameSize = 1600; // samples at 16 kHz = 100 ms
    this.carryover = new Float32Array(0);
    this.port.onmessage = (event) => {
      // Optional: receive commands (e.g., to flush or stop)
    };
  }

  /**
   * Downmix stereo or multi-channel to mono by averaging.
   */
  downmixToMono(channels) {
    if (channels.length === 0) return new Float32Array(0);
    if (channels.length === 1) return channels[0];

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
  floatToInt16(samples) {
    const int16 = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  }

  /**
   * Process one 128-sample block from the audio input.
   * The WebAudio API calls this for every 128 samples (very frequently).
   * Accumulate samples, emit 1600-sample (100 ms) frames.
   */
  process(inputs, outputs) {
    if (inputs.length === 0 || inputs[0].length === 0) {
      return true; // Keep processing
    }

    const channels = inputs[0]; // Array of Float32Array

    // Downmix to mono
    const mono = this.downmixToMono(channels);

    // Combine carryover with new samples
    const allSamples = new Float32Array(this.carryover.length + mono.length);
    allSamples.set(this.carryover, 0);
    allSamples.set(mono, this.carryover.length);

    // Extract complete frames
    const completeFrames = Math.floor(allSamples.length / this.frameSize);
    const remainderSamples = allSamples.length % this.frameSize;

    // Update carryover for next block
    this.carryover = remainderSamples > 0
      ? allSamples.slice(completeFrames * this.frameSize)
      : new Float32Array(0);

    // Post each complete frame (3200 bytes)
    for (let i = 0; i < completeFrames; i++) {
      const frameStart = i * this.frameSize;
      const frameSamples = allSamples.slice(frameStart, frameStart + this.frameSize);
      const int16 = this.floatToInt16(frameSamples);

      // Extract 3200 bytes and transfer ownership to main thread
      const buffer = int16.buffer.slice(int16.byteOffset, int16.byteOffset + 3200);
      this.port.postMessage({ type: 'frame', buffer }, [buffer]);
    }

    return true; // Keep processing
  }
}

registerProcessor('pcm-processor', PcmProcessor);
