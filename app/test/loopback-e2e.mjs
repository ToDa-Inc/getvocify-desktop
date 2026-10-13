// The whole call-audio pipeline in a real Electron: hidden window, page, audio worklet, preload, IPC, main.
// A sine tone stands in for the PC's audio. Run: node test/build-loopback-test.mjs && electron test/loopback-e2e.mjs
import { app, BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Chromium's own fake microphone (a beep every second), so the microphone path runs without a real one or a prompt.
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function collect(loopback, ms) {
  const frames = [];
  const off = loopback.onPcm((pcm) => frames.push(pcm));
  await sleep(ms);
  off();
  return frames;
}

function analyse(frames) {
  const samples = [];
  for (const frame of frames) samples.push(...new Int16Array(frame));
  const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
  let crossings = 0;
  for (let i = 1; i < samples.length; i += 1) if (samples[i - 1] < 0 !== samples[i] < 0) crossings += 1;
  return { rms, hz: (crossings * 16000) / (2 * samples.length), peak: Math.max(...samples.map(Math.abs)), count: samples.length };
}

app.whenReady().then(async () => {
  const anchor = new BrowserWindow({ show: false, width: 100, height: 100 });
  await anchor.loadURL("data:text/html,<title>anchor</title>");
  const baseWindows = BrowserWindow.getAllWindows().length;
  try {
    const { createLoopback } = await import(pathToFileURL(join(here, "../main/dist-test/loopback.mjs")).href);

    // Without the test source this is not Windows, so it must refuse cleanly and never throw.
    if (process.platform !== "win32") {
      const refused = await createLoopback().start();
      check(refused.ok === false && refused.reason === "unsupported_platform", `off Windows, start() refuses cleanly (${JSON.stringify(refused)})`);
    }

    const loopback = createLoopback({ testSource: true });
    let lost = null;
    loopback.onLost((reason) => (lost = reason));
    const started = await loopback.start();
    check(started.ok === true, `start() succeeds (${JSON.stringify(started)})`);
    check((await loopback.start()).reason === "already_running", "a second start() is refused");

    await sleep(500); // let the pipeline settle
    const frames = await collect(loopback, 2000);
    check(frames.length >= 18 && frames.length <= 22, `about 20 frames in 2 s (${frames.length})`);
    check(frames.every((f) => f.byteLength === 3200), "every frame is exactly 3200 bytes");
    const a = analyse(frames);
    // Left-only 0.5 sine mixed to mono is 0.25 amplitude: RMS 0.25 / sqrt(2) of full scale.
    const expected = (0.25 / Math.SQRT2) * 32767;
    check(Math.abs(a.rms - expected) / expected < 0.08, `RMS ${a.rms.toFixed(0)} is within 8% of ${expected.toFixed(0)}`);
    check(Math.abs(a.hz - 440) < 8, `the tone is 440 Hz (measured ${a.hz.toFixed(1)}) so the 16 kHz resampling is right`);
    check(a.peak < 32767 * 0.3, `no clipping or doubled gain (peak ${a.peak})`);

    await loopback.stop();
    check(lost === null, "a deliberate stop() is not reported as lost audio");
    check(BrowserWindow.getAllWindows().length === baseWindows, "stop() leaves no window behind");
    const after = await collect(loopback, 500);
    check(after.length === 0, "no frames after stop()");

    const again = await loopback.start();
    check(again.ok === true, "can start again after a stop");
    await sleep(600);
    await loopback.stop();
    check(BrowserWindow.getAllWindows().length === baseWindows, "a second cycle also leaves no window behind");

    // With the microphone: opened in the same page, each of its frames paired with the call's of the same moment.
    const withMic = await loopback.start({ mic: true });
    check(withMic.ok === true && withMic.mic === true, `start({ mic: true }) opens the microphone too (${JSON.stringify(withMic)})`);
    await sleep(500);
    const order = [];
    const micFrames = [];
    const offMic = loopback.onMicPcm((pcm) => (order.push("mic"), micFrames.push(pcm)));
    const callFrames = await (async () => {
      const frames = [];
      const off = loopback.onPcm((pcm) => (order.push("call"), frames.push(pcm)));
      await sleep(2000);
      off();
      return frames;
    })();
    offMic();
    check(micFrames.length >= 18 && micFrames.length <= 22, `about 20 microphone frames in 2 s (${micFrames.length})`);
    check(Math.abs(micFrames.length - callFrames.length) <= 1, `as many call frames as microphone frames (${callFrames.length})`);
    check(order.every((side, i) => side === (i % 2 === 0 ? (order[0] === "mic" ? "mic" : "call") : order[0] === "mic" ? "call" : "mic")), "microphone and call frames alternate, in pairs");
    check([...micFrames, ...callFrames].every((f) => f.byteLength === 3200), "every frame is exactly 3200 bytes");
    const call = analyse(callFrames);
    check(Math.abs(call.hz - 440) < 8 && Math.abs(call.rms - expected) / expected < 0.08, `the call side is still the tone alone (${call.hz.toFixed(1)} Hz, RMS ${call.rms.toFixed(0)})`);
    check(analyse(micFrames).peak > 1000, `the microphone side carries the fake microphone's beep (peak ${analyse(micFrames).peak})`);
    await loopback.stop();
    check(BrowserWindow.getAllWindows().length === baseWindows, "the microphone cycle also leaves no window behind");
  } catch (error) {
    failures.push(`threw: ${error instanceof Error ? error.stack : String(error)}`);
    console.log(`FAIL threw: ${error instanceof Error ? error.stack : error}`);
  }
  console.log(failures.length ? `\nloopback e2e: ${failures.length} failed` : "\nloopback e2e: all passed");
  app.exit(failures.length ? 1 : 0);
});
