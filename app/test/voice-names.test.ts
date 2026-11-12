import assert from "node:assert/strict";
import test from "node:test";
import { pickName, voiceNames } from "../island/src/voiceNames.ts";

const voices = [{ id: 1, label: "Javier" }, { id: 2, label: "Voz 2" }];

test("the menu offers the meeting's people, then names given to voices, each once and never an unnamed voice", () => {
  assert.deepEqual(voiceNames({ voices, people: ["Toni Mora", "javier", "Arnau González"] }), ["Toni Mora", "javier", "Arnau González"]);
  assert.deepEqual(voiceNames({ voices: [...voices, { id: 3, label: "Marta" }], people: [] }), ["Javier", "Marta"]);
});

test("picking a name names the voice, picking another voice's name makes them one person, and its own name does nothing", () => {
  assert.deepEqual(pickName({ voices }, 2, "Toni Mora"), { name: "voice", op: "rename", voice: 2, text: "Toni Mora" });
  assert.deepEqual(pickName({ voices }, 2, "javier "), { name: "voice", op: "merge", keep: 1, drop: 2 });
  assert.equal(pickName({ voices }, 1, "Javier"), null);
});
