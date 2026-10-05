// URL construction for live transcription and dashboard entry points
export const LiveURL = {
  prodAPI: "https://api.getvocify.com/api/v1",
  prodApp: "https://app.getvocify.com",

  dashboardEntry(webOrigin: string = this.prodApp, path: string = "/dashboard/record"): string {
    const origin = webOrigin.replace(/\/$/, "");
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${origin}${p}`;
  },

  apiBase(raw: string): string {
    const trimmed = raw.trim();
    const base = trimmed.length === 0 ? this.prodAPI : trimmed;
    return base.endsWith("/") ? base.slice(0, -1) : base;
  },

  transcription(apiBase: string, language: string = "multi"): URL | null {
    const http = this.apiBase(apiBase);
    const ws = http
      .replace(/^https:\/\//, "wss://")
      .replace(/^http:\/\//, "ws://")
      .replace(/\/api\/v1$/, "");

    try {
      const urlObj = new URL(`${ws}/api/v1/transcription/live`);
      urlObj.searchParams.set("language", language);
      urlObj.searchParams.set("mode", "copilot_channels");
      urlObj.searchParams.set("channel_labels", "prospect,rep");
      return urlObj;
    } catch {
      return null;
    }
  },
};
