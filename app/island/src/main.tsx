import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { Island } from "./Island.tsx";
import type { IslandHost, IslandState } from "./types.ts";

declare global {
  interface Window {
    /** Provided by the Electron preload; absent when the page is opened on its own. */
    vocifyIsland?: IslandHost;
    __fixedNow?: number;
    __setIslandState?: (state: IslandState) => void;
    __islandActions?: unknown[];
  }
}

function App() {
  const [state, setState] = useState<IslandState | null>(null);
  useEffect(() => {
    window.__setIslandState = setState;
    window.__islandActions = [];
    const host = window.vocifyIsland;
    return host ? host.onState(setState) : undefined;
  }, []);
  if (!state) return null;
  const act: IslandHost["act"] = (action) => {
    if (window.vocifyIsland) window.vocifyIsland.act(action);
    else window.__islandActions?.push(action);
  };
  return <Island state={state} act={act} />;
}

createRoot(document.getElementById("root")!).render(<App />);
