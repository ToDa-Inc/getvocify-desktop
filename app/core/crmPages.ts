// CRM page detection and browser automation scripts
export interface Browser {
  name: string;
  bundleID: string;
  script: string;
}

function tabScript(bundleID: string, tab: string): string {
  return `set found to {}
tell application id "${bundleID}"
\trepeat with w in windows
\t\ttry
\t\t\tset end of found to (URL of ${tab} of w)
\t\tend try
\tend repeat
end tell
set AppleScript's text item delimiters to linefeed
return found as text
`;
}

function chromium(name: string, bundleID: string): Browser {
  return {
    name,
    bundleID,
    script: tabScript(bundleID, "active tab"),
  };
}

function isCrmURL(url: string): boolean {
  let components: URL;
  try {
    components = new URL(url);
  } catch {
    return false;
  }
  if (components.protocol !== "https:") return false;
  const host = components.hostname?.toLowerCase();
  if (!host) return false;

  if (host.endsWith(".hubspot.com")) {
    const sub = host.slice(0, -(12)); // ".hubspot.com".length
    return sub === "app" || (sub.startsWith("app-") && !sub.includes("."));
  }

  if (host.endsWith(".pipedrive.com")) {
    const sub = host.slice(0, -(14)); // ".pipedrive.com".length
    return (
      sub.length > 0 &&
      !sub.includes(".") &&
      !["api", "oauth", "www", "developers", "app"].includes(sub)
    );
  }

  return false;
}

const browsers: Browser[] = [
  chromium("Google Chrome", "com.google.Chrome"),
  chromium("Arc", "company.thebrowser.Browser"),
  chromium("Microsoft Edge", "com.microsoft.edgemac"),
  chromium("Brave", "com.brave.Browser"),
  chromium("Chromium", "org.chromium.Chromium"),
  {
    name: "Safari",
    bundleID: "com.apple.Safari",
    script: tabScript("com.apple.Safari", "current tab"),
  },
];

export const CrmPages = {
  /** Every supported browser's bundle id. */
  bundleIDs(): string[] {
    return browsers.map((b) => b.bundleID);
  },

  browser(bundleID: string): Browser | undefined {
    return browsers.find((b) => b.bundleID === bundleID);
  },

  browsersToRead(running: string[], frontmost?: string): Browser[] {
    const ordered: string[] = [];
    if (frontmost && running.includes(frontmost)) ordered.push(frontmost);
    for (const id of running) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered.map((id) => this.browser(id)).filter((b) => b !== undefined) as Browser[];
  },

  crmURLs(fromScriptOutput: string): string[] {
    return fromScriptOutput
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => isCrmURL(line));
  },

  isCrmURL(url: string): boolean {
    return isCrmURL(url);
  },
};
