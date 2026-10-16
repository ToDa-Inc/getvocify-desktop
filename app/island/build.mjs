import { build, context } from "esbuild";
import { cpSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
mkdirSync(dist, { recursive: true });
/** `--watch` (npm run dev): build once, then again on every save. */
const watch = process.argv.includes("--watch");
const bundle = async (options) => {
  if (!watch) return build(options);
  const ctx = await context(options);
  await ctx.rebuild();
  await ctx.watch();
};

await bundle({
  entryPoints: { island: join(here, "src/main.tsx") },
  bundle: true,
  outdir: dist,
  format: "iife",
  target: "chrome130",
  jsx: "automatic",
  loader: { ".css": "css" },
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  logLevel: "info",
});
// The stylesheet is imported by name from index.html, so bundle it as its own entry (island.css, then live.css over it).
await bundle({
  entryPoints: { island: join(here, "src/styles.css") },
  bundle: true,
  outdir: dist,
  logLevel: "silent",
  allowOverwrite: true,
});
copyFileSync(join(here, "index.html"), join(dist, "index.html"));
cpSync(join(here, "public"), dist, { recursive: true });

// Dev preview: the fixtures as a script plus frame and grid pages, so the island can be reviewed in any browser.
if (process.argv.includes("--preview")) {
  const { fixtures, interactions, NOW } = await import("./fixtures/index.mjs");
  writeFileSync(join(dist, "fixtures.js"), `window.__NOW=${NOW};window.__FIXTURES=${JSON.stringify(fixtures)};window.__INTERACTIONS=${JSON.stringify(interactions)};`);
  cpSync(join(here, "preview"), dist, { recursive: true });
}

// Tells `npm run dev` the first build is done and saves are being watched.
if (watch) process.send?.("ready");
