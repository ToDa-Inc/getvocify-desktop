// Bundles the call-audio module on its own, into main/dist-test, so the real app bundle is never touched.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "../main/src/loopback");
const out = join(here, "../main/dist-test");
mkdirSync(out, { recursive: true });

const common = { bundle: true, outdir: out, logLevel: "warning", external: ["electron"], target: "node20" };
await build({ ...common, entryPoints: { loopback: join(source, "loopback.ts") }, platform: "node", format: "esm", outExtension: { ".js": ".mjs" } });
await build({ ...common, entryPoints: { "loopback-preload": join(source, "loopback-preload.ts") }, platform: "node", format: "cjs", outExtension: { ".js": ".cjs" } });
for (const file of ["loopback-page.html", "loopback-page.js", "pcm-worklet.js"]) copyFileSync(join(source, file), join(out, file));
