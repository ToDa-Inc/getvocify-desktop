// The island as a pill (the rep's setting): a small capsule resting on an edge of any screen, standing on the left and
// right edges and lying on the top and bottom ones. It says what the closed notch says (the Vocify mark at rest, the caller
// on a detected call, the recording's dot, time and voice wave, the marker when something new waits). A tap opens the island
// out of it, away from its edge and kept whole on the screen; the same tap closes it. Dragged, it follows the pointer
// anywhere, onto any screen; let go, it glides to the nearest edge and is remembered there. Geometry: core/pill.ts.
//
// The window covers the pill's screen and lets clicks through to the apps under it: the page tells it when the pointer is
// over the pill or the open island.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { DEFAULT_SPOT, dragCentre, lying, nearestEdge, panelBox, pillCentre, snap, type PillEdge, type PillSpot, type Point, type Size } from "../../../core/pill.ts";
import { waveTitle } from "../MicCard.tsx";
import { BlockedGlyph, CallGlyph, Elapsed, HangUpDot, LeftEar, NotchIsland, RecordDot, RecordingDot, VoiceWave } from "../Island.tsx";
import type { IslandAction, IslandState } from "../types.ts";
import { HelpMarker, useHelpMarker } from "../say/Marker.tsx";

type Act = (action: IslandAction) => void;

/** A press that moves less than this is a tap (open or close), more is a drag. */
const DRAG_SLOP = 4;

export function SideDock({ state, act }: { state: IslandState; act: Act }) {
  const kind = state.mode.kind;
  const open = state.expanded && kind !== "starting";
  const marker = useHelpMarker(state, open, act);
  const stage = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<Size | null>(null);
  // Where it rests: the app's (remembered) spot, or the one it was just let go at until the app says it back.
  const remembered = state.pill ?? DEFAULT_SPOT;
  const [spot, setSpot] = useState<PillSpot>(remembered);
  useEffect(() => setSpot(remembered), [remembered.edge, remembered.at]);
  const [drag, setDrag] = useState<{ centre: Point; edge: PillEdge } | null>(null);
  const press = useRef<{ x: number; y: number; grabX: number; grabY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [panelSize, setPanelSize] = useState<Size | null>(null);

  // The screen's size, now and whenever it changes (another screen, a resolution, the Dock).
  useLayoutEffect(() => {
    const measure = () => {
      const el = stage.current;
      if (el) setArea({ width: el.clientWidth, height: el.clientHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // The open island's own size (it changes with what it shows): where it goes depends on it.
  useLayoutEffect(() => {
    const el = panel.current?.firstElementChild as HTMLElement | null | undefined;
    if (!open || !el) {
      setPanelSize(null);
      return;
    }
    const measure = () => setPanelSize({ width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, kind]);

  // Clicks pass through the window except over the pill and the open island (and all through a drag).
  const interactive = useRef<boolean | null>(null);
  const setInteractive = useCallback((on: boolean) => {
    if (interactive.current === on) return;
    interactive.current = on;
    window.vocifyIsland?.interactive?.(on);
  }, []);
  useEffect(() => {
    const over = (x: number, y: number) => {
      const inside = (el: HTMLElement | null) => {
        const box = el?.getBoundingClientRect();
        return Boolean(box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
      };
      return inside(pill.current) || (open && inside(panel.current));
    };
    // A menu opened from the island (the call type) reaches past it: while one is up, the window takes the clicks.
    const onMove = (event: globalThis.PointerEvent) => setInteractive(press.current !== null || over(event.clientX, event.clientY) || document.querySelector(".float-menu") !== null);
    const onLeave = () => press.current === null && setInteractive(false);
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [open, setInteractive]);
  // Leaving the pill gives the window its clicks back.
  useEffect(() => () => window.vocifyIsland?.interactive?.(true), []);

  const rest = area ? pillCentre(spot, area) : null;
  // In the window's own coordinates: when a drag takes the window onto another screen they are that screen's at once.
  const local = (event: PointerEvent<HTMLDivElement>, grabX: number, grabY: number): Point => ({ x: event.clientX - grabX, y: event.clientY - grabY });

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !rest) return;
    // A press on one of the pill's own buttons (record, call, hang up) is that button's.
    if ((event.target as HTMLElement).closest("button")) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that cannot be captured (a synthetic one) still drags while it stays over the window.
    }
    press.current = { x: event.clientX, y: event.clientY, grabX: event.clientX - rest.x, grabY: event.clientY - rest.y, moved: false };
  }, [rest]);
  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || !area) return;
    if (!p.moved && Math.hypot(event.clientX - p.x, event.clientY - p.y) < DRAG_SLOP) return;
    p.moved = true;
    // Where the pointer is on the whole desktop: the app moves the window onto the screen under it.
    window.vocifyIsland?.pillDrag?.(event.screenX, event.screenY);
    const point = local(event, p.grabX, p.grabY);
    const edge = nearestEdge(point, area);
    setDrag({ centre: dragCentre(point, edge, area), edge });
  }, [area]);
  const endPress = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    if (!p?.moved || !area) return;
    suppressClick.current = true;
    const point = local(event, p.grabX, p.grabY);
    const next = snap(dragCentre(point, nearestEdge(point, area), area), area);
    setSpot(next);
    setDrag(null);
    window.vocifyIsland?.pillDrop?.(next);
  }, [area]);
  // A drag ends with a click on the same element: that one does not open or close it.
  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    act({ name: "toggle" });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    act({ name: "toggle" });
  };

  const edge = drag?.edge ?? spot.edge;
  const centre = drag?.centre ?? rest;
  const box = area && panelSize && !drag ? panelBox(spot, area, panelSize) : null;
  // The open island is the notch's own, with no notch to sit around and rounded on every corner.
  const panelState: IslandState = { ...state, geometry: { ...state.geometry, notchWidth: 0 } };
  return (
    <div ref={stage} className="side-stage island" data-open={open} data-mode={kind} data-reduce-motion={state.reduceMotion}>
      {area && centre && (
        <div className="side-dock" data-open={open} data-dragging={drag !== null} data-edge={edge} style={{ left: `${centre.x}px`, top: `${centre.y}px` }}>
          <div
            ref={pill}
            role="button"
            tabIndex={0}
            className="side-strip"
            data-axis={lying(edge) ? "h" : "v"}
            title={open ? "Close · drag to move it" : "Open Vocify · drag to move it"}
            aria-label={open ? "Close" : "Open Vocify"}
            aria-expanded={open}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPress}
            onPointerCancel={endPress}
            onPointerEnter={() => act({ name: "pointer", inside: true })}
            onPointerLeave={() => press.current === null && act({ name: "pointer", inside: false })}
            onClick={onClick}
            onKeyDown={onKeyDown}
          >
            {/* Dark glass with a thin metal rim: light travels slowly around it. */}
            <span className="strip-metal" aria-hidden />
            <span className="rim-light" aria-hidden />
            <span className="strip-sheen" aria-hidden />
            <PillFace state={state} act={act} open={open} marker={marker} />
          </div>
        </div>
      )}
      {open && (
        <div
          ref={panel}
          className="side-panel"
          data-edge={spot.edge}
          data-placed={box !== null}
          style={box ? { left: `${box.x}px`, top: `${box.y}px`, ["--panel-max-h" as string]: `${box.height}px` } : undefined}
        >
          <NotchIsland state={panelState} act={act} />
        </div>
      )}
    </div>
  );
}

/** What the closed pill shows: the recording's dot, time and voice; else the notch's icon for what the island is doing,
 * and its one quick action (record a detected call, call the contact on screen, hang up). */
function PillFace({ state, act, open, marker }: { state: IslandState; act: Act; open: boolean; marker: string | null }) {
  const mode = state.mode;
  if (mode.kind === "recording") {
    return (
      <>
        <RecordingDot paused={state.paused} reduceMotion={state.reduceMotion} />
        <span className="side-time"><Elapsed state={state} /></span>
        {state.paused ? <span className="side-paused">Paused</span> : <VoiceWave state={state} title={waveTitle(state, false)} />}
        {/* Its place is kept when nothing is there, so the pill never changes size. */}
        <span className="help-dot-slot">{marker && !open && <HelpMarker key={marker} language={state.language} />}</span>
      </>
    );
  }
  const action = (() => {
    if (open) return null;
    if (mode.kind === "call") {
      return (
        <RecordDot
          ready={state.recorderReady}
          title={state.recorderReady ? (mode.caller.name ? `Record this ${mode.caller.name} call` : "Record this call") : "Sign in to record"}
          onClick={() => act({ name: "record" })}
        />
      );
    }
    if (mode.kind === "idle" && state.onScreen) return <CallGlyph onScreen={state.onScreen} onClick={() => act({ name: "openDialConfirm" })} />;
    if (mode.kind === "idle" && state.crmBlocked) return <BlockedGlyph browser={state.crmBlocked.browser} onClick={() => act({ name: "toggle" })} />;
    if (mode.kind === "dialing" && state.dial?.phase !== "ended") return <HangUpDot onClick={() => act({ name: "hangup" })} />;
    return null;
  })();
  return (
    <>
      <span className="pill-glyph"><LeftEar state={state} open={false} lifted /></span>
      {action && <span className="pill-action">{action}</span>}
    </>
  );
}
