// The closed island's marker in the Qué decir view: one signal with one meaning only, "there is something new in Qué
// decir that you have not seen". A solid beige dot where the sparkle was, and a warm metal line around the whole closed
// island, both lit together: one glow when it arrives, then calm until the island is opened. No macOS notification, no
// opening by itself (closing it means "not now"), no kinds. Something that ends before the rep looks takes it with it.
import { useEffect, useRef } from "react";
import { LiveWording } from "../../../core/liveWording.ts";
import type { Language } from "../../../core/typeProposal.ts";
import type { IslandAction, IslandState } from "../types.ts";
import { openIds, unseen } from "./memory.ts";

/** The id of the newest open card the rep has not seen, while the island is closed; null: nothing to mark. Each new one is
 * logged once. */
export function useHelpMarker(state: IslandState, open: boolean, act: (action: IslandAction) => void): string | null {
  const live = state.live;
  const key = !open && state.mode.kind === "recording" && live?.view === "say" ? unseen(state, openIds(live, state.liveHelp !== false)) : null;
  const logged = useRef<string | null>(null);
  useEffect(() => {
    if (!key || logged.current === key) return;
    logged.current = key;
    act({ name: "liveEvent", event: "marker_shown", id: key });
  }, [key, act]);
  return key;
}

/** Drawn inside the ear; the line is absolute, so it wraps the closed island (or the side strip) it sits in. Keyed by the
 * card, so a new one glows again. */
export function HelpMarker({ language }: { language: Language }) {
  return (
    <span className="help-marker">
      <span className="help-dot" title={LiveWording.strings(language).say.newHelp} />
      <span className="help-outline" aria-hidden>
        <span className="help-outline-glow" />
        <span className="help-outline-line" />
        <span className="rim-light" />
      </span>
    </span>
  );
}
