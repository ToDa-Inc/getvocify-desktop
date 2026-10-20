import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBackground } from "../src/parse.ts";

test("the finished calls: a list is read, anything else means the dashboard does not report them", () => {
  assert.equal(parseBackground(undefined), null);
  assert.equal(parseBackground("working"), null);
  assert.equal(parseBackground({ id: "a" }), null);
  assert.deepEqual(parseBackground([]), []);
});

test("a malformed job is dropped, a blank name is no name", () => {
  assert.deepEqual(
    parseBackground([
      { id: "a", name: "Marta", state: "working" },
      { id: "", name: "x", state: "needs" },
      { id: "b", name: "  ", state: "failed" },
      { id: "c", name: "Ana", state: "bogus" },
      { name: "Toni", state: "done" },
      "nope",
    ]),
    [
      { id: "a", name: "Marta", state: "working" },
      { id: "b", name: null, state: "failed" },
    ],
  );
});
