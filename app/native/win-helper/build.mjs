// Builds vocify-win-helper.exe with the C# compiler every Windows already has (.NET Framework 4.x), so no SDK is needed
// and the program needs nothing installed to run. Windows only: elsewhere it says so and exits 0.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("win-helper: skipped (not Windows)");
  process.exit(0);
}
const here = dirname(fileURLToPath(import.meta.url));
const framework = join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319");
const csc = join(framework, "csc.exe");
if (!existsSync(csc)) {
  console.error(`win-helper: no C# compiler at ${csc}`);
  process.exit(1);
}
const out = join(here, "dist");
mkdirSync(out, { recursive: true });
const sources = readdirSync(join(here, "src")).filter((name) => name.endsWith(".cs")).map((name) => join(here, "src", name));
const wpf = join(framework, "WPF");
execFileSync(
  csc,
  [
    "/nologo",
    "/optimize+",
    "/warnaserror-",
    "/platform:anycpu",
    // No console window of its own, whoever starts it; its output still goes to the pipe the app gives it.
    "/target:winexe",
    `/out:${join(out, "vocify-win-helper.exe")}`,
    `/r:${join(wpf, "UIAutomationClient.dll")}`,
    `/r:${join(wpf, "UIAutomationTypes.dll")}`,
    `/r:${join(wpf, "WindowsBase.dll")}`,
    ...sources,
  ],
  { stdio: "inherit" },
);
console.log(`win-helper: built ${join(out, "vocify-win-helper.exe")}`);
