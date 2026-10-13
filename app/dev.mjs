// `npm run dev [-- --dashboard=<url>]`: the app from source, rebuilt and relaunched on every save. Both bundles are
// watched (island, main process); when one changes, Electron restarts, which takes about two seconds. Quit the
// installed Vocify first: only one Vocify runs at a time (single-instance lock in its settings folder).
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const electron = createRequire(import.meta.url)("electron");
const appArgs = process.argv.slice(2);

let ready = 0;
const watchers = ["island/build.mjs", "main/build.mjs"].map((script) => {
  const child = spawn(process.execPath, [join(here, script), "--watch"], { cwd: here, stdio: ["inherit", "inherit", "inherit", "ipc"] });
  // Both first builds done: launch, then follow changes.
  child.on("message", (message) => message === "ready" && ++ready === 2 && begin());
  child.on("exit", (code) => code && stop(code));
  return child;
});

let app = null;
let restarting = false;
const launch = () => {
  // `.` (package.json's main), not the bundle's path: then the app is "Vocify", with the installed app's settings
  // folder, sign-in and one-at-a-time lock.
  app = spawn(electron, [".", ...appArgs], { cwd: here, stdio: "inherit" });
  app.on("exit", (code) => {
    app = null;
    // Quit by the rep (not by a rebuild): stop watching too.
    if (!restarting) stop(code ?? 0);
  });
};
const restart = () => {
  if (!app) return launch();
  restarting = true;
  app.once("exit", () => {
    restarting = false;
    launch();
  });
  app.kill();
};

let timer = null;
const changed = () => {
  clearTimeout(timer);
  // A save rewrites several files (bundle, map, preloads): one restart for all of them.
  timer = setTimeout(restart, 300);
};

const stop = (code) => {
  for (const child of watchers) child.kill();
  app?.kill();
  process.exit(code);
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

function begin() {
  launch();
  for (const dir of ["main/dist", "island/dist"]) watch(join(here, dir), (_event, file) => file && /\.(m?js|cjs|css|html)$/.test(file) && changed());
}
