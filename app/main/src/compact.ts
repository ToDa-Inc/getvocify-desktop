/**
 * The dashboard's compact window: during a call the rep can shrink the dashboard to a narrow window at the right of the
 * screen it is on, as tall as the screen, above the other windows, showing only the live view (the dashboard draws it).
 * Its button in the page takes it back to the size it had.
 */

export type Area = { x: number; y: number; width: number; height: number };

/** Wide enough for a card of what to say and the conversation under it; the rep may still drag it narrower or wider. */
export const COMPACT_WIDTH = 400;
export const COMPACT_MIN_SIZE = { width: 340, height: 480 };
/** The dashboard's own minimum outside the compact window. */
export const FULL_MIN_SIZE = { width: 900, height: 640 };
const MARGIN = 12;

/** Where the compact window goes on a screen's work area: its right edge, top to bottom, a little inside. */
export function compactBounds(area: Area): Area {
  const width = Math.max(COMPACT_MIN_SIZE.width, Math.min(COMPACT_WIDTH, area.width - 2 * MARGIN));
  return {
    x: Math.round(area.x + area.width - width - MARGIN),
    y: Math.round(area.y + MARGIN),
    width,
    height: Math.round(Math.max(COMPACT_MIN_SIZE.height, area.height - 2 * MARGIN)),
  };
}
