// Bundles the app entry (`startApp`) and its preloads into main/dist-shell-test, so the end-to-end test can drive the
// real shell without the real app's auto-start. The paths inside the bundle match main/dist, so assets resolve the same.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../main/src");
const out = join(here, "../main/dist-shell-test");
mkdirSync(out, { recursive: true });
const common = { bundle: true, outdir: out, logLevel: "warning", external: ["electron"], target: "node20", platform: "node", sourcemap: true };
await build({ ...common, entryPoints: { app: join(src, "app.ts") }, format: "esm", outExtension: { ".js": ".mjs" } });
await build({
  ...common,
  entryPoints: { preload: join(src, "preload.ts"), "dashboard-preload": join(src, "dashboard-preload.ts"), "loopback-preload": join(src, "loopback/loopback-preload.ts"), "controls-preload": join(src, "controls-preload.ts") },
  format: "cjs",
  outExtension: { ".js": ".cjs" },
});
for (const file of ["loopback-page.html", "loopback-page.js", "pcm-worklet.js"]) copyFileSync(join(src, "loopback", file), join(out, file));
