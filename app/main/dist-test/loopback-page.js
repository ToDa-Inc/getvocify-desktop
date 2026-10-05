// Runs in the hidden window. The main process calls `__vocifyLoopback.start()` with a user gesture,
// because Chromium only allows getDisplayMedia after one.
(() => {
  let context = null;
  let streams = [];

  const stopEverything = async () => {
    for (const stream of streams) for (const track of stream.getTracks()) track.stop();
    streams = [];
    if (context) await context.close().catch(() => {});
    context = null;
  };

  /** The call's audio: everything the PC plays, through Electron's loopback source. */
  const loopbackStream = async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    // Only the audio is wanted; the video track exists because getDisplayMedia requires one.
    for (const track of stream.getVideoTracks()) track.stop();
    return stream;
  };

  /** Test only: a 440 Hz sine on the left channel and silence on the right, standing in for a call. */
  const testStream = (audioContext) => {
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = 440;
    const level = audioContext.createGain();
    level.gain.value = 0.5;
    const merger = audioContext.createChannelMerger(2);
    oscillator.connect(level);
    level.connect(merger, 0, 0);
    const destination = audioContext.createMediaStreamDestination();
    destination.channelCount = 2;
    merger.connect(destination);
    oscillator.start();
    return destination.stream;
  };

  window.__vocifyLoopback = {
    async start(options) {
      await stopEverything();
      // Chromium resamples whatever the stream is to the context's rate.
      context = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
      await context.audioWorklet.addModule("./pcm-worklet.js");
      const stream = options && options.test ? testStream(context) : await loopbackStream();
      streams.push(stream);
      const source = context.createMediaStreamSource(stream);
      const framer = new AudioWorkletNode(context, "pcm-processor", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: "explicit" });
      framer.port.onmessage = (event) => {
        if (event.data && event.data.type === "frame") window.loopbackHost.frame(event.data.buffer);
      };
      // A node nobody pulls is never run, so the framer ends in a muted gain: the captured audio must not play back.
      const mute = context.createGain();
      mute.gain.value = 0;
      source.connect(framer);
      framer.connect(mute);
      mute.connect(context.destination);
      for (const track of stream.getAudioTracks()) {
        track.addEventListener("ended", () => window.loopbackHost.ended("track_ended"));
      }
      return { sampleRate: context.sampleRate, tracks: stream.getAudioTracks().length };
    },
    stop: stopEverything,
  };
})();
