import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { IslandBehaviour, IslandWindow } from "../types.ts";

type MacPanel = { preventActivation(handle: Buffer): boolean; isActive(): boolean };

/**
 * The Mac island: Electron's `type: 'panel'` is an NSWindow subclass, on which macOS ignores the non-activating flag, so
 * every click on the island activated Vocify and brought the dashboard forward. native/mac-panel asks the window not to
 * activate its app. Without the module (a development build that has not built it) the island behaves as before.
 */
export function createMacIsland(panelPath: string | null, load: (path: string) => MacPanel = loadPanel): IslandBehaviour {
  return {
    prepare(window: IslandWindow) {
      if (!panelPath || !existsSync(panelPath)) return "activating (native/mac-panel not built)";
      try {
        return load(panelPath).preventActivation(window.getNativeWindowHandle()) ? "non-activating" : "activating (macOS refused)";
      } catch (error) {
        return `activating (native/mac-panel failed: ${String(error)})`;
      }
    },
  };
}

function loadPanel(path: string): MacPanel {
  return createRequire(import.meta.url)(path) as MacPanel;
}
