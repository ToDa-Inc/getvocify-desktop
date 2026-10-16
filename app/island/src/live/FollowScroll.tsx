// A scroll that stays put, follows the end when the reader is there, and fades at its edges only while there is more.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const FOLLOW_SLACK = 80;
/** The glide covers what is left on this time constant (ms), like the transcript's. */
const GLIDE_MS = 60;

export function FollowScroll({ children, follow, still }: { children: ReactNode; follow: boolean; still: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const glide = useRef<number | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const next = { top: el.scrollTop > 2, bottom: el.scrollHeight - el.clientHeight - el.scrollTop > 2 };
    setEdges((e) => (e.top === next.top && e.bottom === next.bottom ? e : next));
  };
  const toEnd = () => {
    const el = ref.current;
    if (!el || glide.current !== null) return;
    // Reduced motion, a pinned clock (tests) or a window nobody paints: straight to the end.
    if (still || document.visibilityState !== "visible") {
      el.scrollTop = el.scrollHeight;
      return;
    }
    let at = el.scrollTop;
    let last = performance.now();
    const step = (now: number) => {
      const rest = el.scrollHeight - el.clientHeight - at;
      if (rest < 0.5) {
        glide.current = null;
        measure();
        return;
      }
      at += rest * (1 - Math.exp(-(now - last) / GLIDE_MS));
      last = now;
      // Whole pixels only: text drawn between two pixels is redrawn blurred on every step.
      el.scrollTop = Math.round(at);
      glide.current = requestAnimationFrame(step);
    };
    glide.current = requestAnimationFrame(step);
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (follow && atEnd.current) toEnd();
      measure();
    });
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (glide.current !== null) cancelAnimationFrame(glide.current);
      glide.current = null;
    };
  }, [follow, still]);
  return (
    <div
      ref={ref}
      className="live-scroll"
      data-fade-top={edges.top}
      data-fade-bottom={edges.bottom}
      onScroll={() => {
        const el = ref.current!;
        if (glide.current === null) atEnd.current = el.scrollHeight - el.clientHeight - el.scrollTop <= FOLLOW_SLACK;
        measure();
      }}
      onWheel={(event) => {
        if (event.deltaY < 0 && glide.current !== null) {
          cancelAnimationFrame(glide.current);
          glide.current = null;
        }
      }}
    >
      <div>{children}</div>
    </div>
  );
}
