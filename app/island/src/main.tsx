import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { Island } from "./Island.tsx";
import { levelsStore } from "./levels.ts";
import type { IslandHost, IslandState, Levels } from "./types.ts";

declare global {
  interface Window {
    /** Provided by the Electron preload; absent when the page is opened on its own. */
    vocifyIsland?: IslandHost;
    __fixedNow?: number;
    __setIslandState?: (state: IslandState) => void;
    __setIslandLevels?: (levels: Levels) => void;
    __islandActions?: unknown[];
    __islandSizes?: { width: number; height: number }[];
  }
}

function App() {
  const [state, setState] = useState<IslandState | null>(null);
  useEffect(() => {
    window.__setIslandState = (next) => {
      levelsStore.set(next.levels);
      setState(next);
    };
    window.__setIslandLevels = (levels) => levelsStore.set(levels);
    window.__islandActions = [];
    const host = window.vocifyIsland;
    if (!host) return undefined;
    const offState = host.onState((next) => {
      levelsStore.set(next.levels);
      setState(next);
    });
    const offLevels = host.onLevels((levels) => levelsStore.set(levels));
    return () => {
      offState();
      offLevels();
    };
  }, []);
  if (!state) return null;
  const act: IslandHost["act"] = (action) => {
    if (window.vocifyIsland) window.vocifyIsland.act(action);
    else window.__islandActions?.push(action);
  };
  return <Island state={state} act={act} />;
}

createRoot(document.getElementById("root")!).render(<App />);
