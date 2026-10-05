import { build } from "esbuild";
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");

const common = { bundle: true, outdir: dist, sourcemap: true, logLevel: "info", external: ["electron"] };

await build({
  ...common,
  entryPoints: { main: join(here, "src/main.ts") },
  platform: "node",
  format: "esm",
  target: "node20",
  outExtension: { ".js": ".mjs" },
});
// Preloads run in a sandboxed context that only loads CommonJS.
await build({
  ...common,
  entryPoints: {
    preload: join(here, "src/preload.ts"),
    "controls-preload": join(here, "src/controls-preload.ts"),
    "loopback-preload": join(here, "src/loopback/loopback-preload.ts"),
  },
  platform: "node",
  format: "cjs",
  target: "node20",
  outExtension: { ".js": ".cjs" },
});

// The call-audio window loads these three files from next to the bundle.
for (const file of ["loopback-page.html", "loopback-page.js", "pcm-worklet.js"]) copyFileSync(join(here, "src/loopback", file), join(dist, file));
