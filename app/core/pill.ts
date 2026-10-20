// The island as a pill (the rep's setting "Pill"): a small capsule resting on an edge of any screen, dragged anywhere and
// snapped to the nearest edge when let go; the open island grows out of it toward the room it has. Pure geometry, shared by
// the page (where the pill and its panel are drawn) and the app (which screen the window covers, what is remembered).

export type PillEdge = "left" | "right" | "top" | "bottom";
/** Where the pill rests: the edge, and how far along it its centre is (0 = top or left end, 1 = bottom or right end). */
export type PillSpot = { edge: PillEdge; at: number };
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Box = Point & Size;

/** The pill's short and long side: 40 x 104 standing on a side edge, 104 x 40 lying on the top or bottom one. */
export const PILL_THICK = 40;
export const PILL_LONG = 104;
/** From the screen's edge to the pill, and from the pill to its open panel. */
export const PILL_MARGIN = 12;
export const PILL_GAP = 8;

export const DEFAULT_SPOT: PillSpot = { edge: "right", at: 0.5 };

const EDGES: readonly PillEdge[] = ["left", "right", "top", "bottom"];
const clamp = (value: number, low: number, high: number) => (low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high));

/** Standing (a side edge) or lying (the top or bottom edge). */
export const lying = (edge: PillEdge) => edge === "top" || edge === "bottom";

export function pillSize(edge: PillEdge): Size {
  return lying(edge) ? { width: PILL_LONG, height: PILL_THICK } : { width: PILL_THICK, height: PILL_LONG };
}

/** A remembered spot, if it is one; anything else (an older file, a hand edit) is the default. */
export function readSpot(raw: unknown): PillSpot {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SPOT;
  const { edge, at } = raw as { edge?: unknown; at?: unknown };
  if (!EDGES.includes(edge as PillEdge) || typeof at !== "number" || !Number.isFinite(at)) return DEFAULT_SPOT;
  return { edge: edge as PillEdge, at: clamp(at, 0, 1) };
}

/** The pill's centre on a screen area (its own coordinates, from 0,0): on its edge, whole and inside the margins. */
export function pillCentre(spot: PillSpot, area: Size): Point {
  const { width, height } = pillSize(spot.edge);
  const alongX = () => clamp(spot.at * area.width, PILL_MARGIN + width / 2, area.width - PILL_MARGIN - width / 2);
  const alongY = () => clamp(spot.at * area.height, PILL_MARGIN + height / 2, area.height - PILL_MARGIN - height / 2);
  switch (spot.edge) {
    case "left":
      return { x: PILL_MARGIN + width / 2, y: alongY() };
    case "right":
      return { x: area.width - PILL_MARGIN - width / 2, y: alongY() };
    case "top":
      return { x: alongX(), y: PILL_MARGIN + height / 2 };
    case "bottom":
      return { x: alongX(), y: area.height - PILL_MARGIN - height / 2 };
  }
}

/** The edge nearest a point of the area: where the pill goes when it is let go there (and how it lies while dragged). */
export function nearestEdge(point: Point, area: Size): PillEdge {
  const distance: Record<PillEdge, number> = { left: point.x, right: area.width - point.x, top: point.y, bottom: area.height - point.y };
  return EDGES.reduce((best, edge) => (distance[edge] < distance[best] ? edge : best), "right" as PillEdge);
}

/** Let go at a point: the nearest edge, at the same place along it. */
export function snap(point: Point, area: Size): PillSpot {
  const edge = nearestEdge(point, area);
  const at = lying(edge) ? point.x / Math.max(1, area.width) : point.y / Math.max(1, area.height);
  return { edge, at: clamp(at, 0, 1) };
}

/** While dragged the pill follows the pointer but stays whole inside the area (it never disappears under an edge). */
export function dragCentre(point: Point, edge: PillEdge, area: Size): Point {
  const { width, height } = pillSize(edge);
  return { x: clamp(point.x, width / 2, area.width - width / 2), y: clamp(point.y, height / 2, area.height - height / 2) };
}

/**
 * The open island next to the pill, on the side away from the edge: left of a pill on the right edge, under one on the top
 * edge, and so on; centred on the pill and slid along to stay whole on the screen. Never taller or wider than the room there.
 */
export function panelBox(spot: PillSpot, area: Size, panel: Size): Box {
  const centre = pillCentre(spot, area);
  const pill = pillSize(spot.edge);
  const across = (lying(spot.edge) ? area.height : area.width) - PILL_MARGIN * 2 - (lying(spot.edge) ? pill.height : pill.width) - PILL_GAP;
  const width = lying(spot.edge) ? Math.min(panel.width, area.width - PILL_MARGIN * 2) : Math.min(panel.width, across);
  const height = lying(spot.edge) ? Math.min(panel.height, across) : Math.min(panel.height, area.height - PILL_MARGIN * 2);
  const alongX = clamp(centre.x - width / 2, PILL_MARGIN, area.width - PILL_MARGIN - width);
  const alongY = clamp(centre.y - height / 2, PILL_MARGIN, area.height - PILL_MARGIN - height);
  switch (spot.edge) {
    case "right":
      return { x: centre.x - pill.width / 2 - PILL_GAP - width, y: alongY, width, height };
    case "left":
      return { x: centre.x + pill.width / 2 + PILL_GAP, y: alongY, width, height };
    case "top":
      return { x: alongX, y: centre.y + pill.height / 2 + PILL_GAP, width, height };
    case "bottom":
      return { x: alongX, y: centre.y - pill.height / 2 - PILL_GAP - height, width, height };
  }
}
