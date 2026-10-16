import { useEffect, useState } from "react";

/** The clock in ms; tests pin it (`window.__fixedNow`) so screenshots are repeatable. */
export const nowMs = (): number => (window as unknown as { __fixedNow?: number }).__fixedNow ?? Date.now();

/** `now` in ms, again every `intervalMs` while `active`. */
export function useNow(intervalMs: number, active: boolean): number {
  const fixed = (window as unknown as { __fixedNow?: number }).__fixedNow;
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (!active || fixed !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active, fixed]);
  return fixed ?? now;
}
