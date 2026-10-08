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

/** Select a call app from the list of apps using the mic. */
function selectCallApp(
  apps: Array<{ bundleId: string; name: string; pid: number; path: string }>,
  ownBundleId: string
): DetectedCaller | null {
  const callApps = [
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

  const isCallApp = (bundleId: string) =>
    callApps.some((app) => bundleId === app || bundleId.startsWith(app + "."));

  // Filter: remove Vocify's own bundles, filter to call apps only
  const callAppsList = apps.filter(
    (app) =>
      !(app.bundleId === ownBundleId || app.bundleId.startsWith(ownBundleId + ".")) &&
      isCallApp(app.bundleId)
  );

  if (callAppsList.length === 0) return null;

  // Prefer named apps to browsers
  const namedApp = callAppsList.find((app) => !CrmPages.browser(app.bundleId));
  if (namedApp) {
    return convertToDetectedCaller(namedApp);
  }

  // Fall back to a browser
  return convertToDetectedCaller(callAppsList[0]);
}

/** Convert a helper app object to a DetectedCaller. */
function convertToDetectedCaller(app: { bundleId: string; name: string; pid: number; path: string }): DetectedCaller {
  // Get the display name from CallSource
  const callSource = CallSource.app(app.bundleId);
  const name = callSource?.name || app.name;

  // Check if it's a browser
  const isBrowser = !!CrmPages.browser(app.bundleId);

  return {
    name,
    appId: app.bundleId,
    path: app.path || null,
    browser: isBrowser,
  };
}
