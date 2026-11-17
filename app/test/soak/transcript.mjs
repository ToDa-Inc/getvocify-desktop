// The scripted call: the words the speech engine would send, for both sides, at the rate of a real sales call. Each
// utterance is about four seconds, alternating rep and prospect (about 15 finals a minute), and it arrives as interim
// results every 400 ms while it is said, then one final. The words come from a fixed seed, so every run sends the same call.

const WORDS = ("the team we are looking at pricing for next quarter and the migration of our contacts needs someone to own it "
  + "we already use a spreadsheet for follow ups but nobody updates it after the call so deals stall about the budget "
  + "could you send the proposal before friday and let us check it with finance how long does onboarding take for a team "
  + "of ten reps we had a bad experience with the last vendor so trust matters more than the demo that works for us").split(" ");

/** A small seeded generator, so the words do not change between runs. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * The call's messages for `minutes` of conversation, each with the moment it is sent, in call time (ms).
 * Message shapes match what the dashboard reads from the live transcription socket (Results, audio_channel).
 */
export function buildCall({ minutes, seed = 7 }) {
  const next = rng(seed);
  const events = [];
  const UTTERANCE_MS = 4000;
  const INTERIM_MS = 400;
  let at = 0;
  let index = 0;
  const end = minutes * 60000;
  while (at < end) {
    const side = index % 2 === 0 ? "rep" : "prospect";
    const count = 7 + Math.floor(next() * 7);
    const words = [];
    for (let i = 0; i < count; i++) words.push(WORDS[Math.floor(next() * WORDS.length)]);
    const start = at / 1000;
    for (let t = INTERIM_MS; t < UTTERANCE_MS; t += INTERIM_MS) {
      const shown = Math.max(1, Math.round((t / UTTERANCE_MS) * count));
      events.push({ at: at + t, msg: result(side, words.slice(0, shown).join(" "), false, start, start + t / 1000) });
    }
    const text = words.join(" ");
    const capitalised = text.charAt(0).toUpperCase() + text.slice(1) + ".";
    events.push({ at: at + UTTERANCE_MS, msg: result(side, capitalised, true, start, (at + UTTERANCE_MS) / 1000) });
    at += UTTERANCE_MS + 200;
    index += 1;
  }
  return events.sort((a, b) => a.at - b.at);
}

function result(side, transcript, isFinal, start, end) {
  return {
    type: "Results",
    audio_channel: side,
    is_final: isFinal,
    speech_final: isFinal,
    start,
    end,
    channel: { alternatives: [{ transcript, confidence: 0.97 }] },
  };
}
