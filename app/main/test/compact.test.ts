import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPACT_MIN_SIZE, COMPACT_WIDTH, compactBounds } from "../src/compact.ts";

test("the compact window sits at the right edge of the screen it is on, top to bottom, a little inside", () => {
  assert.deepEqual(compactBounds({ x: 0, y: 25, width: 1512, height: 920 }), { x: 1512 - COMPACT_WIDTH - 12, y: 37, width: COMPACT_WIDTH, height: 896 });
  // A second screen to the left of the main one has negative coordinates.
  assert.deepEqual(compactBounds({ x: -1920, y: 0, width: 1920, height: 1040 }), { x: -COMPACT_WIDTH - 12, y: 12, width: COMPACT_WIDTH, height: 1016 });
});

test("on a very small screen it keeps its minimum size", () => {
  const bounds = compactBounds({ x: 0, y: 0, width: 300, height: 400 });
  assert.equal(bounds.width, COMPACT_MIN_SIZE.width);
  assert.equal(bounds.height, COMPACT_MIN_SIZE.height);
});
