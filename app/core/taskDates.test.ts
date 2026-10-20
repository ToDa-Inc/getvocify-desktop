import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dayAfter, dueLabel, dueOfMoment, monthGrid } from "./taskDates.ts";

describe("task dates", () => {
  const now = new Date(2026, 9, 20, 10, 0);

  it("counts days on the rep's calendar, across a month end", () => {
    assert.equal(dayAfter(0, now), "2026-10-20");
    assert.equal(dayAfter(7, now), "2026-10-27");
    assert.equal(dayAfter(12, now), "2026-11-01");
  });

  it("reads a due day the way a rep says it", () => {
    assert.equal(dueLabel({ due: "2026-10-20" }, now), "Today");
    assert.equal(dueLabel({ due: "2026-10-21", time: "15:30" }, now), "Tomorrow 15:30");
    assert.equal(dueLabel({ due: "2026-10-30" }, now), "Fri 30 Oct");
  });

  it("takes the day and hour of a moment on the local clock", () => {
    const local = new Date(2026, 9, 30, 15, 5).toISOString();
    assert.deepEqual(dueOfMoment(local), { due: "2026-10-30", time: "15:05" });
    assert.equal(dueOfMoment("nope"), null);
    assert.equal(dueOfMoment(null), null);
  });

  it("lays a month out in six Monday-first weeks and marks the past", () => {
    const grid = monthGrid(2026, 9, "2026-10-20");
    assert.equal(grid.length, 42);
    assert.equal(grid[0].iso, "2026-09-28");
    assert.equal(grid[0].inMonth, false);
    assert.equal(grid.find((d) => d.iso === "2026-10-01")?.inMonth, true);
    assert.equal(grid.find((d) => d.iso === "2026-10-19")?.past, true);
    assert.equal(grid.find((d) => d.iso === "2026-10-20")?.past, false);
  });
});
