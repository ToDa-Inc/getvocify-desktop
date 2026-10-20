import { strict as assert } from "node:assert";
import { test } from "node:test";

import { DEFAULT_SPOT, dragCentre, nearestEdge, panelBox, pillCentre, pillSize, readSpot, snap } from "./pill.ts";

const SCREEN = { width: 1440, height: 860 };

test("the pill stands on a side edge and lies on the top or bottom one", () => {
  assert.deepEqual(pillSize("right"), { width: 40, height: 104 });
  assert.deepEqual(pillSize("left"), { width: 40, height: 104 });
  assert.deepEqual(pillSize("top"), { width: 104, height: 40 });
  assert.deepEqual(pillSize("bottom"), { width: 104, height: 40 });
});

test("it rests 12 px from its edge, whole, at its place along it", () => {
  assert.deepEqual(pillCentre({ edge: "right", at: 0.5 }, SCREEN), { x: 1408, y: 430 });
  assert.deepEqual(pillCentre({ edge: "left", at: 0.25 }, SCREEN), { x: 32, y: 215 });
  assert.deepEqual(pillCentre({ edge: "top", at: 0.5 }, SCREEN), { x: 720, y: 32 });
  assert.deepEqual(pillCentre({ edge: "bottom", at: 0.1 }, SCREEN), { x: 144, y: 828 });
  // At an end of the edge it stops at the margin instead of leaving the screen.
  assert.deepEqual(pillCentre({ edge: "right", at: 0 }, SCREEN), { x: 1408, y: 64 });
  assert.deepEqual(pillCentre({ edge: "top", at: 1 }, SCREEN), { x: 1376, y: 32 });
});

test("let go, it goes to the nearest edge at the same place along it", () => {
  assert.equal(nearestEdge({ x: 1400, y: 400 }, SCREEN), "right");
  assert.equal(nearestEdge({ x: 700, y: 20 }, SCREEN), "top");
  assert.deepEqual(snap({ x: 30, y: 430 }, SCREEN), { edge: "left", at: 0.5 });
  assert.deepEqual(snap({ x: 720, y: 850 }, SCREEN), { edge: "bottom", at: 0.5 });
  // In the middle of the screen it still finds an edge.
  assert.equal(snap({ x: 720, y: 300 }, SCREEN).edge, "top");
});

test("while dragged it follows the pointer and stays whole on the screen", () => {
  assert.deepEqual(dragCentre({ x: 600, y: 300 }, "right", SCREEN), { x: 600, y: 300 });
  assert.deepEqual(dragCentre({ x: 1439, y: 2 }, "right", SCREEN), { x: 1420, y: 52 });
});

test("a remembered spot is read back, anything else is the right edge in the middle", () => {
  assert.deepEqual(readSpot({ edge: "top", at: 0.3 }), { edge: "top", at: 0.3 });
  assert.deepEqual(readSpot({ edge: "top", at: 7 }), { edge: "top", at: 1 });
  assert.deepEqual(readSpot({ edge: "middle", at: 0.3 }), DEFAULT_SPOT);
  assert.deepEqual(readSpot(undefined), DEFAULT_SPOT);
  assert.deepEqual(readSpot("right"), DEFAULT_SPOT);
});

const PANEL = { width: 460, height: 400 };

test("the island opens away from the edge, centred on the pill", () => {
  // Right edge: to its left, 8 px from it.
  assert.deepEqual(panelBox({ edge: "right", at: 0.5 }, SCREEN, PANEL), { x: 1388 - 8 - 460, y: 230, width: 460, height: 400 });
  // Left edge: to its right.
  assert.deepEqual(panelBox({ edge: "left", at: 0.5 }, SCREEN, PANEL), { x: 52 + 8, y: 230, width: 460, height: 400 });
  // Top edge: under it.
  assert.deepEqual(panelBox({ edge: "top", at: 0.5 }, SCREEN, PANEL), { x: 490, y: 52 + 8, width: 460, height: 400 });
  // Bottom edge: above it.
  assert.deepEqual(panelBox({ edge: "bottom", at: 0.5 }, SCREEN, PANEL), { x: 490, y: 808 - 8 - 400, width: 460, height: 400 });
});

test("near a corner the island slides along to stay whole on the screen", () => {
  const box = panelBox({ edge: "right", at: 0 }, SCREEN, PANEL);
  assert.equal(box.y, 12);
  const low = panelBox({ edge: "bottom", at: 1 }, SCREEN, PANEL);
  assert.equal(low.x + low.width, 1440 - 12);
});

test("on a short screen the island is never taller than the room it has", () => {
  const short = { width: 1280, height: 400 };
  assert.equal(panelBox({ edge: "right", at: 0.5 }, short, { width: 460, height: 460 }).height, 400 - 24);
  // Under a pill on the top edge there is less room still: the pill and its gap come off.
  assert.equal(panelBox({ edge: "top", at: 0.5 }, short, { width: 460, height: 460 }).height, 400 - 24 - 40 - 8);
});
