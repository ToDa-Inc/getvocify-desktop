import { CallSource } from "../../../../core/callSource.ts";
import { CrmPages } from "../../../../core/crmPages.ts";
import type { CallDetector, DetectedCaller } from "../types.ts";
import { jsonLines, type HelperChild } from "./helper.ts";

/** One app holding a microphone, as `vocify-mac-helper mic` lists it. */
type MicApp = { bundleId: string; name: string; pid: number; path: string };

/** macOS call detection via the native helper's mic command. */
export function createMacCallDetector(deps: {
  spawn: (command: "mic") => HelperChild;
  ownBundleId: string;
}): CallDetector {
  let running = false;
  let helper: HelperChild | null = null;
  let onChange: ((caller: DetectedCaller | null) => void) | null = null;
  let currentCaller: DetectedCaller | null = null;
  let lastReportedCaller: (DetectedCaller | null) | undefined = undefined; // undefined = not yet reported
  let lastRestartTime = 0;

  const startHelper = () => {
    if (helper) return;
    const started = deps.spawn("mic");
    helper = started;
    started.stdout.on(
      "data",
      jsonLines((event) => {
        if (helper === started && event.event === "mic" && Array.isArray(event.apps)) updateCaller(event.apps as MicApp[]);
      }),
    );
    started.on("exit", () => {
      if (helper !== started) return;
      helper = null;
      if (!running) return;
      // A helper that died is restarted at most once a minute (as the Windows page reader).
      const now = Date.now();
      if (now - lastRestartTime > 60_000) {
        lastRestartTime = now;
        startHelper();
      }
    });
  };

  /** Update current caller state based on running apps. */
  const updateCaller = (apps: MicApp[]) => {
    const caller = selectCallApp(apps, deps.ownBundleId);
    const callerChanged = !callersEqual(caller, currentCaller);
    if (callerChanged || lastReportedCaller === undefined) {
      currentCaller = caller;
      lastReportedCaller = caller;
      if (onChange) onChange(caller);
    }
  };

  /** Check if two callers are equal. */
  const callersEqual = (a: DetectedCaller | null, b: DetectedCaller | null): boolean => {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.name === b.name && a.appId === b.appId && a.path === b.path && a.browser === b.browser;
  };

  return {
    start(onChangeCallback: (caller: DetectedCaller | null) => void): void {
      if (running) return;
      running = true;
      onChange = onChangeCallback;
      lastReportedCaller = undefined;
      currentCaller = null;
      lastRestartTime = Date.now();
      startHelper();
    },

    stop(): void {
      running = false;
      onChange = null;
      const stopping = helper;
      helper = null;
      stopping?.stdin.end();
      stopping?.kill();
      currentCaller = null;
    },
  };
}

/** Apps people take calls in (a browser counts for Meet and web dialers). */
const CALL_APPS = [
  "us.zoom.xos",
  "com.microsoft.teams2",
  "com.microsoft.teams",
  "com.tinyspeck.slackmacgap",
  "com.apple.FaceTime",
  "net.whatsapp.WhatsApp",
  "ru.keepcoder.Telegram",
  "com.hnc.Discord",
  "Cisco-Systems.Spark",
  "com.google.Chrome",
  "com.apple.Safari",
  "com.apple.WebKit",
  "company.thebrowser.Browser",
  "com.microsoft.edgemac",
  "org.mozilla.firefox",
  "com.brave.Browser",
];

/** Safari's pages are web content processes of WebKit: they belong to Safari. */
const OWNER_OF_WEBKIT = "com.apple.Safari";

/**
 * The call app a microphone-holding process belongs to. Chrome, Edge and the others hold the microphone from a helper
 * process ("com.google.Chrome.helper.Renderer", named "Google Chrome Helper"), never from the app itself.
 */
function owningCallApp(bundleId: string): string | null {
  const known = CALL_APPS.find((app) => bundleId === app || bundleId.startsWith(app + "."));
  if (!known) return null;
  return known === "com.apple.WebKit" ? OWNER_OF_WEBKIT : known;
}

/** Select a call app from the list of apps using the mic. */
function selectCallApp(
  apps: Array<{ bundleId: string; name: string; pid: number; path: string }>,
  ownBundleId: string
): DetectedCaller | null {
  const callApps = apps
    .filter((app) => !(app.bundleId === ownBundleId || app.bundleId.startsWith(ownBundleId + ".")))
    .flatMap((app) => {
      const owner = owningCallApp(app.bundleId);
      return owner ? [{ ...app, owner }] : [];
    });

  if (callApps.length === 0) return null;

  // Prefer named apps to browsers
  const namedApp = callApps.find((app) => !CrmPages.browser(app.owner));
  return convertToDetectedCaller(namedApp ?? callApps[0]);
}

/** A helper's own name says "Helper" ("Google Chrome Helper (Renderer)"): the app's name is what the rep knows. */
const HELPER_SUFFIX = / Helper( \([^)]*\))?$/;

/** The outermost app bundle an executable is inside ("…/Google Chrome.app" for its helper deep within), for the app's own icon. */
function appBundlePath(executable: string): string | null {
  const bundle = /^(.*?\.app)(?:\/|$)/.exec(executable);
  return bundle ? bundle[1] : executable || null;
}

/** Convert a mic-holding process to a DetectedCaller, named and identified as its app. */
function convertToDetectedCaller(app: { bundleId: string; name: string; pid: number; path: string; owner: string }): DetectedCaller {
  const browser = CrmPages.browser(app.owner);
  const name = CallSource.app(app.owner)?.name ?? browser?.name ?? app.name.replace(HELPER_SUFFIX, "");
  return {
    name,
    // The app, not whichever helper holds the microphone: a call is one call whichever process the audio is in.
    appId: app.owner,
    path: appBundlePath(app.path),
    browser: browser !== undefined,
  };
}
