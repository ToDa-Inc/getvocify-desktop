// The recording at the side of the screen (the rep's setting; spec 2026-10-16, revised 2026-10-19, "Where it lives"). A
// small rounded strip near the right edge keeps its size and place whatever happens: it says what the closed notch says
// (recording dot and time, the voice wave, the marker when something new waits). A tap opens the panel out of it, to its
// left and centred on it; the same tap closes it and the panel shrinks back into the strip. Dragging the strip moves both
// up or down the edge, only where the open panel fits whole, so opening never moves it.
//
// The window is a column as tall as the screen's work area that lets clicks through to the app under it: the page tells it
// when the pointer is over the strip or the open panel.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Elapsed, OpenIsland, RecordingDot, VoiceWave } from "../Island.tsx";
import type { IslandAction, IslandState } from "../types.ts";
import { HelpMarker, useHelpMarker } from "../say/Marker.tsx";

type Act = (action: IslandAction) => void;

const OPEN_HEIGHT = 460;
const MARGIN = 12;
/** A press that moves less than this is a tap (open or close), more is a drag. */
const DRAG_SLOP = 4;
/** Where the rep left the strip, as a fraction of the screen's height (a convenience of this computer only). */
const CENTRE_KEY = "vocify.sideCentre";

const openHeight = (screen: number) => Math.min(OPEN_HEIGHT, screen - MARGIN * 2);
const clampCentre = (centre: number, screen: number) => {
  const half = openHeight(screen) / 2;
  return Math.min(Math.max(centre, half + MARGIN), screen - half - MARGIN);
};
const savedFraction = (): number => {
  try {
    const value = Number(localStorage.getItem(CENTRE_KEY));
    return value > 0 && value < 1 ? value : 0.5;
  } catch {
    return 0.5;
  }
};
const saveFraction = (fraction: number) => {
  try {
    localStorage.setItem(CENTRE_KEY, String(fraction));
  } catch {
    /* the strip goes back to the middle next time */
  }
};

export function SideDock({ state, act }: { state: IslandState; act: Act }) {
  const open = state.expanded;
  const marker = useHelpMarker(state, open, act);
  const stage = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [screen, setScreen] = useState(0);
  const [centre, setCentre] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const press = useRef<{ y: number; from: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  // The screen's height, now and on every resize; the strip is put back where it fits if the screen got shorter.
  useLayoutEffect(() => {
    const measure = () => {
      const height = stage.current?.clientHeight ?? 0;
      setScreen(height);
      setCentre((c) => clampCentre(c ?? height * savedFraction(), height));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Clicks pass through the window except over the strip and the open panel (and all through a drag).
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
      return inside(strip.current) || (open && inside(panel.current));
    };
    // A menu opened from the panel (the call type) reaches past it: while one is up, the window takes the clicks.
    const onMove = (event: globalThis.PointerEvent) => setInteractive(press.current !== null || over(event.clientX, event.clientY) || document.querySelector(".float-menu") !== null);
    const onLeave = () => press.current === null && setInteractive(false);
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [open, setInteractive]);
  // Leaving the side gives the window its clicks back.
  useEffect(() => () => window.vocifyIsland?.interactive?.(true), []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || centre === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = { y: event.clientY, from: centre, moved: false };
  }, [centre]);
  const onPointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    const dy = event.clientY - p.y;
    if (!p.moved && Math.abs(dy) < DRAG_SLOP) return;
    if (!p.moved) {
      p.moved = true;
      setDragging(true);
    }
    setCentre(clampCentre(p.from + dy, screen));
  }, [screen]);
  const endPress = useCallback(() => {
    const p = press.current;
    press.current = null;
    if (!p?.moved) return;
    suppressClick.current = true;
    setDragging(false);
    setCentre((c) => {
      if (c !== null && screen > 0) saveFraction(c / screen);
      return c;
    });
  }, [screen]);
  // A drag ends with a click on the same button: that one does not open or close it.
  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    act({ name: "toggle" });
  };

  const ready = centre !== null && screen > 0;
  return (
    <div
      ref={stage}
      className="side-stage island"
      data-open={open}
      data-mode="recording"
      data-reduce-motion={state.reduceMotion}
      style={{ ["--open-h" as string]: `${openHeight(screen || OPEN_HEIGHT + MARGIN * 2)}px`, ["--radius" as string]: "22px" }}
    >
      {ready && (
        <div className="side-dock" data-open={open} data-dragging={dragging} style={{ top: `${centre}px` }}>
          <div className="side-panel" ref={panel} aria-hidden={!open}>
            <div className="side-content">{open && <OpenIsland state={state} act={act} />}</div>
          </div>
          <button
            ref={strip}
            type="button"
            className="side-strip"
            title={open ? "Close · drag to move it" : "Open Vocify · drag to move it"}
            aria-label={open ? "Close" : "Open Vocify"}
            aria-expanded={open}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPress}
            onPointerCancel={endPress}
            onClick={onClick}
          >
            {/* Dark glass with a thin metal rim: light travels slowly around it. */}
            <span className="strip-metal" aria-hidden />
            <span className="rim-light" aria-hidden />
            <span className="strip-sheen" aria-hidden />
            <RecordingDot paused={state.paused} reduceMotion={state.reduceMotion} />
            <span className="side-time"><Elapsed state={state} /></span>
            {state.paused ? <span className="side-paused">Paused</span> : <VoiceWave state={state} />}
            {/* Its place is kept when nothing is there, so the strip never changes size. */}
            <span className="help-dot-slot">{marker && !open && <HelpMarker key={marker} language={state.language} />}</span>
          </button>
        </div>
      )}
    </div>
  );
}
