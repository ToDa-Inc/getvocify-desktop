// Call source detection: apps and pages for calls vs meetings
export type CallKind = "call" | "meeting";

export class CallSource {
  name: string;
  kind: CallKind | null;

  constructor(name: string, kind: CallKind | null) {
    this.name = name;
    this.kind = kind;
  }

  private static readonly apps: Array<[string, CallSource]> = [
    ["us.zoom.xos", new CallSource("Zoom", "meeting")],
    ["com.microsoft.teams", new CallSource("Microsoft Teams", "meeting")],
    ["Cisco-Systems.Spark", new CallSource("Webex", "meeting")],
    ["com.tinyspeck.slackmacgap", new CallSource("Slack", "meeting")],
    ["com.hnc.Discord", new CallSource("Discord", "meeting")],
    ["net.whatsapp.WhatsApp", new CallSource("WhatsApp", "call")],
    ["ru.keepcoder.Telegram", new CallSource("Telegram", "call")],
    ["com.apple.FaceTime", new CallSource("FaceTime", null)],
  ];

  static app(bundleID?: string): CallSource | null {
    if (!bundleID) return null;
    const entry = this.apps.find((e) => bundleID.startsWith(e[0]));
    return entry ? entry[1] : null;
  }

  static page(urls: string[]): CallSource | null {
    for (const url of urls) {
      const result = this.pageImpl(url);
      if (result) return result;
    }
    return null;
  }

  static pageImpl(url: string): CallSource | null {
    let components: URL;
    try {
      components = new URL(url.trim());
    } catch {
      return null;
    }
    if (components.protocol !== "https:") return null;
    const host = components.hostname?.toLowerCase();
    if (!host) return null;
    const path = components.pathname.toLowerCase();

    const on = (domain: string): boolean => host === domain || host.endsWith("." + domain);

    if (host === "meet.google.com") return new CallSource("Google Meet", "meeting");
    if (host === "teams.microsoft.com" || host === "teams.live.com")
      return new CallSource("Microsoft Teams", "meeting");
    if (on("zoom.us") && (path.startsWith("/wc") || path.startsWith("/j/") || host === "app.zoom.us"))
      return new CallSource("Zoom", "meeting");
    if (on("webex.com")) return new CallSource("Webex", "meeting");
    if (on("whereby.com")) return new CallSource("Whereby", "meeting");
    if (on("hubspot.com") && host.startsWith("app") && path.includes("calling-integration-popup"))
      return new CallSource("HubSpot", "call");
    if (host === "phone.aircall.io") return new CallSource("Aircall", "call");
    if (host === "app.ringover.com") return new CallSource("Ringover", "call");
    if (on("dialpad.com")) return new CallSource("Dialpad", "call");
    if (host === "app.justcall.io") return new CallSource("JustCall", "call");
    if (host === "web.whatsapp.com") return new CallSource("WhatsApp", "call");
    return null;
  }

  get json(): { name: string; kind: string | null } {
    return {
      name: this.name,
      kind: this.kind,
    };
  }
}
