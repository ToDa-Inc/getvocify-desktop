import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Check } from "./icons.tsx";

/**
 * A dropdown that floats over the island under what opened it, in the island's glass (the Swift `OptionPopup`:
 * blur, a faint fill with a sheen, the light rim). It never pushes the content below it down.
 */

/** Where the dropdown opens from, in px from the window's top-left. */
export type Anchor = { x: number; y: number; width: number; height: number };

const PADDING = 4;
const ROW = 26;
/** Past this many rows the list scrolls. */
const VISIBLE = 7;

export const anchorOf = (element: Element): Anchor => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
};

export function FloatMenu({ anchor, width, onClose, onExtent, label, children }: {
  anchor: Anchor;
  width: number;
  onClose: () => void;
  /** Where the dropdown ends (px from the window's top), so the window can grow to include it; null once it closes. */
  onExtent?: (bottom: number | null) => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The rows' text lines up under the value that opened it, inside the island's width.
  const left = Math.max(8, Math.min(anchor.x - PADDING - 8, document.documentElement.clientWidth - width - 8));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onExtent) return;
    onExtent(Math.ceil(el.getBoundingClientRect().bottom) + 8);
    return () => onExtent(null);
  }, [anchor.y, onExtent]);

  // A click anywhere else closes it, and so does the pointer leaving the island for a moment: the island never takes
  // focus, so it cannot see clicks in other apps the way the Mac app's global monitor does.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Only a real exit counts: the system can report a "leave" while the pointer is still over the window (a window
    // gaining focus elsewhere, the island resizing), and a menu must never close under the rep's pointer.
    const leave = (event: MouseEvent) => {
      const inside = event.clientX > 0 && event.clientY > 0 && event.clientX < window.innerWidth - 1 && event.clientY < window.innerHeight - 1;
      if (inside) return;
      clearTimeout(timer);
      timer = setTimeout(onClose, 600);
    };
    const enter = () => clearTimeout(timer);
    // Added after the click that opened it has finished, so that click does not close it again.
    const added = setTimeout(() => document.addEventListener("click", onClose));
    document.documentElement.addEventListener("mouseleave", leave);
    document.documentElement.addEventListener("mouseenter", enter);
    return () => {
      clearTimeout(added);
      clearTimeout(timer);
      document.removeEventListener("click", onClose);
      document.documentElement.removeEventListener("mouseleave", leave);
      document.documentElement.removeEventListener("mouseenter", enter);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="float-menu"
      role="listbox"
      aria-label={label}
      style={{ top: anchor.y + anchor.height + 4, left, width, maxHeight: VISIBLE * ROW + PADDING * 2 }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function MenuRow({ label, selected, dim = false, onPick }: { label: string; selected: boolean; dim?: boolean; onPick: () => void }) {
  return (
    <button type="button" className="option-row" role="option" aria-selected={selected} data-selected={selected} data-dim={dim} onClick={onPick}>
      <Check size={10} stroke={3} />
      <span>{label}</span>
    </button>
  );
}
