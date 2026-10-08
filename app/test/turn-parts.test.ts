import assert from "node:assert/strict";
import { test } from "node:test";
import { turnParts } from "../island/src/helpers.ts";

const turn = (text: string, pending: string) => ({ id: "t", you: false, label: null, text, pending });

test("a single word still arriving is shown, not hidden behind the dots", () => {
  const parts = turnParts(turn("", "Hola"));
  assert.equal(parts.tail, "Hola");
  assert.equal(parts.dots, true);
});

test("pending words follow the settled ones, joined to closing punctuation", () => {
  assert.deepEqual(turnParts(turn("Hola", "?")), { text: "Hola", tail: "?", joined: true, dots: true });
  assert.deepEqual(turnParts(turn("Hola", "qué tal")), { text: "Hola", tail: "qué tal", joined: false, dots: true });
});

test("a settled turn has no tail and no dots", () => {
  assert.deepEqual(turnParts(turn("Hola, qué tal", "")), { text: "Hola, qué tal", tail: "", joined: false, dots: false });
});
