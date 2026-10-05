import { strict as assert } from "node:assert";
import { test } from "node:test";

import { LiveURL } from "./liveUrl.ts";
import { ChannelAudio } from "./channelAudio.ts";
import { AssistLine } from "./assistLine.ts";
import { LiveNote } from "./liveNote.ts";
import { PhraseFit } from "./phraseFit.ts";
import { CrmPages } from "./crmPages.ts";
import { LiveTranscript } from "./liveTranscript.ts";
import { CallSource } from "./callSource.ts";
import { SpeakerTimeline, ZoomTile } from "./speakerTimeline.ts";
import { StopGrace } from "./stopGrace.ts";
import { TypeMenu, LiveHelpSwitch } from "./typeMenu.ts";
import { WaveSide } from "./waveSide.ts";
import { LostAudio } from "./islandWording.ts";

test("LiveURL transcription", async (t) => {
  const url = LiveURL.transcription("https://api.getvocify.com/api/v1/");
  await t.test("scheme", () => assert.strictEqual(url?.protocol, "wss:"));
  await t.test("mode", () => assert.ok(url?.href.includes("mode=copilot_channels")));
  await t.test("labels", () => assert.ok(url?.href.includes("channel_labels") && url?.href.includes("prospect") && url?.href.includes("rep")));
});

test("ChannelAudio frame", async (t) => {
  const frame = ChannelAudio.frame("rep", Buffer.from([1, 2]));
  await t.test("frame type", () => assert.ok(frame.includes("AddChannelAudio")));
  await t.test("frame channel", () => assert.ok(frame.includes('"channel":"rep"')));
});

test("ChannelAudio transcriptText", async (t) => {
  const event = {
    type: "Results",
    is_final: true,
    channel: { alternatives: [{ transcript: "hola" }] },
  };
  const parsed = ChannelAudio.transcriptText(event);
  await t.test("transcript", () => assert.strictEqual(parsed?.text, "hola"));
  await t.test("final", () => assert.strictEqual(parsed?.isFinal, true));
});

test("AssistLine visibility", async (t) => {
  let line = new AssistLine(true);
  line = line.present("Di esto ahora", 1, true, 0);
  await t.test("visible", () => assert.strictEqual(line.visible(1, false), "Di esto ahora"));
  await t.test("rep hidden", () => assert.strictEqual(line.visible(1, true), null));
  await t.test("expired", () => assert.strictEqual(line.visible(11, false), null));
});

test("AssistLine no evidence", async (t) => {
  const silent = new AssistLine(true).present("Di esto", 0, true, 0);
  await t.test("no evidence", () => assert.strictEqual(silent.visible(0, false), null));
});

test("LiveNote same speaker", async (t) => {
  const note = new LiveNote();
  note.apply("hola", false, "prospect");
  note.apply("hola mundo", true, "prospect");
  note.apply("otra", true, "prospect");
  await t.test("same speaker stays one paragraph", () => assert.strictEqual(note.turns.length, 1));
  await t.test("chunks join", () => assert.strictEqual(note.turns[0].text, "hola mundo otra"));
});

test("LiveNote speaker change", async (t) => {
  const note = new LiveNote();
  note.apply("hola", false, "prospect");
  note.apply("hola mundo", true, "prospect");
  note.apply("sí", true, "rep");
  await t.test("speaker change opens a paragraph", () => assert.strictEqual(note.turns.length, 2));
});

test("LiveNote short finals", async (t) => {
  const chunks = new LiveNote();
  for (const word of ["hola", "qué", "tal"]) {
    chunks.apply(word, true, "");
  }
  await t.test("short finals stay one paragraph", () => assert.strictEqual(chunks.turns.length, 1));
  await t.test("short finals join", () => assert.strictEqual(chunks.turns[0].text, "hola qué tal"));
});

test("PhraseFit candidates", async (t) => {
  const tails = PhraseFit.candidates("Perfecto, tío. Pues os paso esto.");
  await t.test("whole phrase first", () => assert.strictEqual(tails[0], "Perfecto, tío. Pues os paso esto."));
  await t.test("then the last sentence", () => assert.strictEqual(tails[1], "Pues os paso esto."));
  await t.test("then whole words only", () => assert.strictEqual(tails[tails.length - 1], "…esto."));
  await t.test("no dangling space", () => assert.ok(tails.every((t) => !t.startsWith("…") || !t.slice(1).startsWith(" "))));
});

test("PhraseFit empty", async (t) => {
  await t.test("empty", () => assert.strictEqual(PhraseFit.candidates("   ").length, 0));
});

test("CrmPages isCrmURL", async (t) => {
  await t.test("hubspot eu record", () => assert.ok(CrmPages.isCrmURL("https://app-eu1.hubspot.com/contacts/147506535/record/0-1/879829962968")));
  await t.test("hubspot list", () => assert.ok(CrmPages.isCrmURL("https://app.hubspot.com/contacts/1/objects/0-1/views/all/list")));
  await t.test("pipedrive person", () => assert.ok(CrmPages.isCrmURL("https://acme.pipedrive.com/person/42")));
  await t.test("hubspot marketing site", () => assert.ok(!CrmPages.isCrmURL("https://www.hubspot.com/pricing")));
  await t.test("hubspot docs", () => assert.ok(!CrmPages.isCrmURL("https://knowledge.hubspot.com/a")));
  await t.test("lookalike host", () => assert.ok(!CrmPages.isCrmURL("https://evil.app.hubspot.com.example.com/x")));
  await t.test("pipedrive api", () => assert.ok(!CrmPages.isCrmURL("https://api.pipedrive.com/v1/persons/1")));
  await t.test("plain http", () => assert.ok(!CrmPages.isCrmURL("http://app.hubspot.com/contacts/1/record/0-1/2")));
  await t.test("other sites stay local", () => assert.ok(!CrmPages.isCrmURL("https://mail.google.com/mail/u/0")));
});

test("CrmPages crmURLs", async (t) => {
  const output = `https://mail.google.com/mail/u/0/#inbox
https://app-eu1.hubspot.com/calling-integration-popup-ui/147506535
  https://app-eu1.hubspot.com/contacts/147506535/record/0-1/879829962968
missing value

`;
  const urls = CrmPages.crmURLs(output);
  await t.test("script output keeps CRM URLs in window order", () => {
    assert.deepStrictEqual(urls, [
      "https://app-eu1.hubspot.com/calling-integration-popup-ui/147506535",
      "https://app-eu1.hubspot.com/contacts/147506535/record/0-1/879829962968",
    ]);
  });
});

test("CrmPages browsersToRead", async (t) => {
  const order = CrmPages.browsersToRead(
    ["com.apple.finder", "com.apple.Safari", "com.google.Chrome", "com.example.Other"],
    "com.google.Chrome"
  ).map((b) => b.bundleID);
  await t.test("front-most browser first, unsupported apps skipped", () => {
    assert.deepStrictEqual(order, ["com.google.Chrome", "com.apple.Safari"]);
  });
});

test("CrmPages empty", async (t) => {
  await t.test("nothing running, nothing read", () => {
    assert.strictEqual(CrmPages.browsersToRead([], "com.google.Chrome").length, 0);
  });
});

test("CrmPages browser", async (t) => {
  await t.test("safari tab term", () => {
    assert.ok(CrmPages.browser("com.apple.Safari")?.script.includes("current tab"));
  });
  await t.test("addressed by bundle id", () => {
    assert.ok(CrmPages.browser("com.google.Chrome")?.script.includes('tell application id "com.google.Chrome"'));
  });
});

test("LiveTranscript tail bubble", async (t) => {
  const live = new LiveTranscript();
  live.apply("hola", true, "rep", 1, 2);
  live.apply("buenas", false, "prospect", 2, null);
  const rows = live.rows();
  await t.test("tail has its own bubble", () => {
    assert.deepStrictEqual(
      rows.map((r) => [r.key, r.text, r.pending]),
      [["u0", "hola", ""], ["u1", "", "buenas"]]
    );
  });
});

test("LiveTranscript final keeps tail", async (t) => {
  const live = new LiveTranscript();
  live.apply("hola", true, "rep", 1, 2);
  live.apply("buenas", false, "prospect", 2, null);
  live.apply("buenas tardes", true, "prospect", 2, 3);
  const rows = live.rows();
  await t.test("final keeps the tail's bubble", () => {
    assert.deepStrictEqual(
      rows.map((r) => [r.key, r.text]),
      [["u0", "hola"], ["u1", "buenas tardes"]]
    );
  });
});

test("LiveTranscript late final", async (t) => {
  const late = new LiveTranscript();
  late.apply("Which", true, "prospect", 10, 11);
  late.apply("is it", false, "prospect", 12, null);
  late.apply("is it?", true, "prospect", 12, 13);
  late.apply("Yes.", true, "rep", 11, 12);
  await t.test("a late final never splits a bubble", () => {
    assert.deepStrictEqual(
      late.rows().map((r) => [r.key, r.text]),
      [["u0", "Which is it?"], ["u2", "Yes."]]
    );
  });
});

test("LiveTranscript echo", async (t) => {
  const echo = new LiveTranscript();
  echo.apply("This was much better than the last one.", true, "prospect", 20, 22);
  echo.apply("much better than", true, "rep", 21, 21.6);
  const rows = echo.rows();
  await t.test("mic echo of the call is hidden", () => {
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].speaker, "prospect");
  });
});

test("LiveTranscript reset", async (t) => {
  const restarted = new LiveTranscript();
  restarted.apply("Hola", true, "rep", 1, 2);
  restarted.apply("Bon dia Jordi", true, "prospect", 2, 3);
  restarted.apply("Gracias per", false, "prospect", 4, null);
  await t.test("reset changes the side", () => assert.ok(restarted.reset("prospect", 0)));
  await t.test("reset drops only that side", () => {
    assert.deepStrictEqual(restarted.rows().map((r) => r.text), ["Hola"]);
    assert.ok(!restarted.reset("prospect", 0));
  });
});

test("LiveTranscript json", async (t) => {
  const restarted = new LiveTranscript();
  restarted.apply("Hola", true, "rep", 1, 2);
  restarted.apply("Bon dia Jordi", true, "prospect", 2, 3);
  const json = restarted.json();
  await t.test("json carries seen", () => {
    assert.strictEqual((json.segments as any[])[0].seen, 0);
  });
  await t.test("json carries the counter", () => {
    assert.strictEqual(json.nextSeen, 2);
  });
});

test("LiveTranscript joinChunks", async (t) => {
  await t.test("chunks join", () => {
    assert.strictEqual(LiveTranscript.joinChunks("hola", ", qué tal"), "hola, qué tal");
  });
});

test("CallSource app", async (t) => {
  await t.test("zoom is a meeting", () => assert.strictEqual(CallSource.app("us.zoom.xos")?.kind, "meeting"));
  await t.test("new teams", () => assert.strictEqual(CallSource.app("com.microsoft.teams2")?.name, "Microsoft Teams"));
  await t.test("whatsapp is a call", () => assert.strictEqual(CallSource.app("net.whatsapp.WhatsApp")?.kind, "call"));
  await t.test("facetime claims nothing", () => assert.strictEqual(CallSource.app("com.apple.FaceTime")?.kind, null));
  await t.test("browsers go by their page", () => assert.strictEqual(CallSource.app("com.google.Chrome"), null));
});

test("CallSource page", async (t) => {
  await t.test("meet tab", () => {
    assert.strictEqual(CallSource.pageImpl("https://meet.google.com/abc-defg-hij")?.name, "Google Meet");
  });
});

test("CallSource more pages", async (t) => {
  await t.test("hubspot calling window", () => {
    assert.strictEqual(CallSource.pageImpl("https://app-eu1.hubspot.com/calling-integration-popup-ui/147506535")?.kind, "call");
  });
  await t.test("a contact page is not a call", () => {
    assert.strictEqual(CallSource.pageImpl("https://app-eu1.hubspot.com/contacts/147506535/record/0-1/1"), null);
  });
  await t.test("zoom web client", () => {
    assert.strictEqual(CallSource.pageImpl("https://us02web.zoom.us/wc/123/join")?.kind, "meeting");
  });
  await t.test("zoom marketing site is not a meeting", () => {
    assert.strictEqual(CallSource.pageImpl("https://zoom.us/pricing"), null);
  });
  await t.test("https only", () => {
    assert.strictEqual(CallSource.pageImpl("http://meet.google.com/x"), null);
  });
});

test("LiveTranscript hearing echo tail", async (t) => {
  const hearing = new LiveTranscript();
  hearing.apply("departamentos de captación", false, "prospect", 40, null);
  hearing.apply("departamentos de", false, "rep", 40.2, null);
  const rows1 = hearing.rows();
  await t.test("an echo tail is not shown as the rep", () => {
    assert.deepStrictEqual(rows1.map((r) => r.speaker), ["prospect"]);
  });
  hearing.apply("te paso la propuesta", false, "rep", 41, null);
  const rows2 = hearing.rows();
  await t.test("the rep's own words still show", () => {
    assert.deepStrictEqual(rows2.map((r) => r.speaker), ["prospect", "rep"]);
  });
});

test("LiveTranscript interjection", async (t) => {
  const talk = new LiveTranscript();
  talk.apply("Lo que hacemos es escuchar la llamada", true, "rep", 10, 12);
  talk.apply("Vale.", true, "prospect", 11.5, 11.8);
  talk.apply("y proponer los cambios en el CRM.", true, "rep", 12.2, 14);
  await t.test("interjection keeps the paragraph whole", () => {
    assert.deepStrictEqual(talk.rows().map((r) => r.text), ["Lo que hacemos es escuchar la llamada y proponer los cambios en el CRM.", "Vale."]);
  });
});

test("LiveTranscript answer", async (t) => {
  const answer = new LiveTranscript();
  answer.apply("¿Quedamos el martes?", true, "rep", 10, 11);
  answer.apply("Sí.", true, "prospect", 12.5, 12.8);
  answer.apply("Perfecto, te mando la invitación.", true, "rep", 13.5, 15);
  await t.test("an answer stays in order", () => assert.strictEqual(answer.rows().length, 3));
});

test("LiveTranscript overlap order", async (t) => {
  const overlap = new LiveTranscript();
  overlap.apply("lo que te decía es que", false, "prospect", 20, null);
  overlap.apply("Ajá, vale", false, "rep", 21, null);
  overlap.apply("Ajá, vale.", true, "rep", 21, 21.5);
  const before = overlap.rows().map((r) => r.key);
  overlap.apply("lo que te decía es que funciona.", true, "prospect", 20, 23);
  const after = overlap.rows().map((r) => r.key);
  await t.test("order is the same before and after the tail settles", () => {
    assert.deepStrictEqual(before, after);
  });
  await t.test("the earlier speaker stays above", () => {
    assert.deepStrictEqual(overlap.rows().map((r) => r.speaker), ["prospect", "rep"]);
  });
});

test("LiveTranscript partial final", async (t) => {
  const partial = new LiveTranscript();
  partial.apply("hola qué tal estás", false, "rep", 1, 2.4);
  partial.apply("Hola, qué tal", true, "rep", 1, 2);
  const rows1 = partial.rows();
  await t.test("the rest of the tail stays", () => {
    assert.deepStrictEqual(
      rows1.map((r) => [r.key, r.text, r.pending]),
      [["u0", "Hola, qué tal", "estás"]]
    );
  });
  partial.apply("estás?", true, "rep", 2, 2.5);
  const rows2 = partial.rows();
  await t.test("and settles in the same bubble", () => {
    assert.deepStrictEqual(
      rows2.map((r) => [r.key, r.text, r.pending]),
      [["u0", "Hola, qué tal estás?", ""]]
    );
  });
});

test("LiveTranscript remainder", async (t) => {
  await t.test("nothing left, no tail", () => {
    assert.strictEqual(LiveTranscript.remainder("a b c", "a b c."), null);
  });
});

test("LiveTranscript dropped word", async (t) => {
  const revised = new LiveTranscript();
  revised.apply("vale vale perfecto", false, "rep", 1, 2);
  revised.apply("Vale, perfecto.", true, "rep", 1, 2);
  const rows = revised.rows();
  await t.test("no stale words", () => {
    assert.deepStrictEqual(
      rows.map((r) => [r.text, r.pending]),
      [["Vale, perfecto.", ""]]
    );
  });
});

test("SpeakerTimeline", async (t) => {
  const shown = new SpeakerTimeline();
  shown.record(0, ["Marta"]);
  shown.record(4, ["Juan"]);
  shown.record(6, []);
  await t.test("named by who was shown", () => assert.strictEqual(shown.name(0.5, 3.5), "Marta"));
  await t.test("the one shown longest wins", () => assert.strictEqual(shown.name(3.5, 5.8), "Juan"));
  await t.test("nobody shown, no name", () => assert.strictEqual(shown.name(8, 9), null));
});

test("LiveTranscript with names", async (t) => {
  const guests = new LiveTranscript();
  guests.apply("Hola, soy Marta.", true, "prospect", 1, 2, "Marta");
  guests.apply("Y yo Juan.", true, "prospect", 3, 4, "Juan");
  guests.apply("Encantado.", true, "rep", 5, 6);
  const rows = guests.rows();
  await t.test("names on the other side", () => {
    assert.deepStrictEqual(rows.map((r) => r.label ?? ""), ["Marta", "Juan", "You"]);
  });
  await t.test("a new person starts a paragraph", () => assert.strictEqual(rows.length, 3));
});

test("ZoomTile speakingName", async (t) => {
  await t.test("zoom tile name", () => {
    assert.strictEqual(ZoomTile.speakingName("Marta García, Computer audio, Active speaker"), "Marta García");
  });
  await t.test("not speaking, no name", () => {
    assert.strictEqual(ZoomTile.speakingName("Juan, Computer audio"), null);
  });
  await t.test("no audio marker", () => {
    assert.strictEqual(ZoomTile.speakingName("Ana Pérez, Active speaker"), "Ana Pérez");
  });
});

test("LiveTranscript long call", async (t) => {
  const hour = new LiveTranscript();
  const expected: string[] = [];
  for (let i = 0; i < 300; i++) {
    const channel = i % 2 === 0 ? "rep" : "prospect";
    const text = `frase número ${i} del cliente ${i % 7}`;
    const start = i * 10;
    hour.apply(text, false, channel, start, null);
    hour.apply(text, true, channel, start, start + 3);
    expected.push(text);
  }
  const got = hour.rows().map((r) => r.text);
  await t.test("frozen paragraphs keep their text and order", () => {
    assert.deepStrictEqual(got, expected);
  });
  await t.test("keys stay unique", () => {
    assert.strictEqual(new Set(hour.rows().map((r) => r.key)).size, 300);
  });
  hour.apply("y una más", true, "prospect", 2995, 2996);
  await t.test("the newest paragraph still grows", () => {
    const last = hour.rows()[hour.rows().length - 1];
    assert.strictEqual(last.text, "frase número 299 del cliente 5 y una más");
  });
});

test("StopGrace manual", async (t) => {
  const manual = new StopGrace(false, false);
  await t.test("stopping a live recording pauses it first", () => {
    assert.deepStrictEqual(manual.onStop, ["pause"]);
  });
  await t.test("resume carries on recording", () => {
    assert.deepStrictEqual(manual.onResume, ["resume"]);
  });
  await t.test("a manual stop ends without a hang-up", () => {
    assert.deepStrictEqual(manual.onFinish, ["stop"]);
  });
  await t.test("a manual stop says so", () => {
    assert.strictEqual(manual.title, "Recording stopped");
  });
});

test("StopGrace paused", async (t) => {
  const alreadyPaused = new StopGrace(false, true);
  await t.test("a paused recording stays paused on resume", () => {
    assert.ok(alreadyPaused.onStop.length === 0 && alreadyPaused.onResume.length === 0);
  });
});

test("StopGrace hangup", async (t) => {
  const hungUp = new StopGrace(true, false);
  await t.test("a hang-up reports the call ended only once it finishes", () => {
    assert.deepStrictEqual(hungUp.onFinish, ["callEnded", "stop"]);
  });
  await t.test("a hang-up says the call ended", () => {
    assert.strictEqual(hungUp.title, "Call ended");
  });
  const manual = new StopGrace(false, false);
  await t.test("a hang-up starts the analysis at once; only a manual stop waits for Resume", () => {
    assert.ok(hungUp.immediate && !manual.immediate);
  });
});

test("LostAudio", async (t) => {
  await t.test("lost while recording opens the island", () => {
    assert.ok(LostAudio.opensIsland(false, true, true, false));
  });
  await t.test("only when it changes", () => {
    assert.ok(!LostAudio.opensIsland(true, true, true, false));
  });
  await t.test("only while recording", () => {
    assert.ok(!LostAudio.opensIsland(false, true, false, false));
  });
  await t.test("already open stays as is", () => {
    assert.ok(!LostAudio.opensIsland(false, true, true, true));
  });
});

test("TypeMenu proposal", async (t) => {
  const typeOptions = [
    { key: "discovery", label: "Discovery" },
    { key: "closing", label: "Demo y cierre" },
  ];
  const proposedMenu = new TypeMenu(typeOptions, "discovery", true);
  await t.test("a proposal shows its type with the sparkle", () => {
    assert.strictEqual(proposedMenu.title, "Discovery");
    assert.strictEqual(proposedMenu.sparkle, true);
  });
  await t.test("while Vocify proposes, 'Let Vocify decide' is ticked", () => {
    assert.ok(proposedMenu.rows[0].key === null && proposedMenu.rows[0].checked === true);
  });
  await t.test("the proposed type is marked in the list", () => {
    assert.ok(proposedMenu.rows.find((r) => r.key === "discovery")?.suggested === true);
  });
  await t.test("a proposal is not the rep's pick", () => {
    assert.ok(proposedMenu.rows.find((r) => r.key === "discovery")?.checked === false);
  });
});

test("TypeMenu pick", async (t) => {
  const typeOptions = [
    { key: "discovery", label: "Discovery" },
    { key: "closing", label: "Demo y cierre" },
  ];
  const pickedMenu = new TypeMenu(typeOptions, "closing", false);
  await t.test("the rep's pick shows without the sparkle", () => {
    assert.strictEqual(pickedMenu.title, "Demo y cierre");
    assert.strictEqual(pickedMenu.sparkle, false);
  });
  await t.test("the pick is ticked", () => {
    assert.ok(pickedMenu.rows.find((r) => r.key === "closing")?.checked === true && pickedMenu.rows[0].checked === false);
  });
});

test("TypeMenu empty", async (t) => {
  const typeOptions = [
    { key: "discovery", label: "Discovery" },
    { key: "closing", label: "Demo y cierre" },
  ];
  const emptyMenu = new TypeMenu(typeOptions, null, false);
  await t.test("nothing known yet reads Call type", () => {
    assert.strictEqual(emptyMenu.title, "Call type");
    assert.strictEqual(emptyMenu.placeholder, true);
    assert.strictEqual(emptyMenu.sparkle, false);
  });
});

test("LiveHelpSwitch", async (t) => {
  await t.test("switch commands", () => {
    assert.strictEqual(LiveHelpSwitch.command(false), "assist-off");
    assert.strictEqual(LiveHelpSwitch.command(true), "assist-on");
  });
});

test("WaveSide", async (t) => {
  await t.test("silence keeps the colour", () => {
    assert.strictEqual(WaveSide.next(0.01, 0.02, "you"), "you");
  });
  await t.test("the rep clearly louder turns it beige", () => {
    assert.strictEqual(WaveSide.next(0.5, 0.1, "them"), "you");
  });
  await t.test("them clearly louder turns it white", () => {
    assert.strictEqual(WaveSide.next(0.1, 0.6, "you"), "them");
  });
  await t.test("a near tie keeps the colour", () => {
    assert.strictEqual(WaveSide.next(0.32, 0.3, "them"), "them");
  });
});
