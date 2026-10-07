// The Mac implementations against the shared contracts, with macOS faked at its edge: `osascript` (the app in front and
// the browser's tabs), Electron's microphone status and prompt, the settings pages, and the rep's answer to "Vocify wants
// to control Google Chrome". Call detection on a Mac comes with the native helper (Phase 2): until then there is none.
import { createMacCrmScreenReader } from "../src/platform/mac/crm-screen-reader.ts";
import { createMacPermissions } from "../src/platform/mac/permissions.ts";
import { createMacSystemAudio } from "../src/platform/mac/system-audio.ts";
import type { Status } from "../src/platform/types.ts";
import { crmScreenReaderContract } from "./contracts/crm-screen-reader.contract.ts";
import { permissionsContract } from "./contracts/permissions.contract.ts";
import { systemAudioContract } from "./contracts/system-audio.contract.ts";

const FRONT_APP = "id of application (path to frontmost application as text)";

/** `osascript` answering from what the test says is on screen. */
function fakeOsascript(screen: { front: string | null; url: string | null; dead: boolean; consent: "granted" | "denied" }) {
  return async (_file: string, args: string[]): Promise<string> => {
    if (screen.dead) throw new Error("osascript timed out");
    const script = args[1] ?? "";
    if (script === FRONT_APP) return `${screen.front ?? ""}\n`;
    if (/ is running$/.test(script)) return "true\n";
    if (screen.consent === "denied") throw new Error("Not authorized to send Apple events to Google Chrome. (-1743)");
    return screen.front === "com.google.Chrome" && screen.url ? `${screen.url}\n` : "\n";
  };
}

crmScreenReaderContract("Mac", () => {
  const screen = { front: null as string | null, url: null as string | null, dead: false, consent: "granted" as const };
  const reader = createMacCrmScreenReader({ exec: fakeOsascript(screen), access: () => "authorized" });
  return {
    reader,
    chrome: "com.google.Chrome",
    notABrowser: "com.microsoft.Excel",
    chromeShows: (url) => Object.assign(screen, { front: "com.google.Chrome", url, dead: false }),
    otherAppInFront: () => Object.assign(screen, { front: "com.microsoft.Excel", url: null }),
    osCannotAnswer: () => void (screen.dead = true),
  };
});

permissionsContract("Mac", () => {
  let microphone = "not-determined";
  let crmTabs: Status | undefined;
  const screen = { front: "com.google.Chrome", url: null, dead: false, consent: "denied" as "granted" | "denied" };
  const prompts: string[] = [];
  const opened: string[] = [];
  return {
    permissions: createMacPermissions({
      microphoneAccess: () => microphone,
      askMicrophone: async () => {
        prompts.push("microphone");
        return true;
      },
      openExternal: (url) => void opened.push(url),
      exec: async (file, args, timeout) => {
        if (args[1] !== FRONT_APP && !/ is running$/.test(args[1] ?? "")) prompts.push("crmTabs");
        return fakeOsascript(screen)(file, args);
      },
      crmTabs: { get: () => crmTabs, set: (value) => void (crmTabs = value) },
    }),
    platform: "darwin",
    microphoneIs: (raw) => void (microphone = raw),
    repAllowsBrowsers: () => void (screen.consent = "granted"),
    prompts: () => prompts.filter((p) => p === "microphone"),
    opened: () => opened,
  };
});

systemAudioContract("Mac (until the native helper)", () => ({
  audio: createMacSystemAudio(),
  osPlays: async () => {},
  osEnds: async () => {},
}));
