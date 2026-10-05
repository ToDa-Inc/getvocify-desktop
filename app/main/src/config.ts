/**
 * Which dashboard the app loads. In order: `--dashboard=<url>` on the command line, the `VOCIFY_DASHBOARD_URL`
 * environment variable, `dashboardUrl` in `config.json` next to the app's data, then the production dashboard. Only
 * https addresses (and http on this computer) are accepted, so a typo can never point the app at an arbitrary page.
 */
export function acceptDashboardUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.href;
  return null;
}

export function resolveDashboardUrl(input: { argv: string[]; env: Record<string, string | undefined>; config: unknown; fallback: string }): string {
  const fromArgument = input.argv.find((a) => a.startsWith("--dashboard="))?.slice("--dashboard=".length);
  const fromConfig = typeof input.config === "object" && input.config !== null ? (input.config as { dashboardUrl?: unknown }).dashboardUrl : undefined;
  return acceptDashboardUrl(fromArgument) ?? acceptDashboardUrl(input.env.VOCIFY_DASHBOARD_URL) ?? acceptDashboardUrl(fromConfig) ?? input.fallback;
}

/** A Vercel preview of the dashboard is behind a Vercel sign-in; its pages stay inside the app so that sign-in can finish. */
export function signInHostsFor(dashboardUrl: string): (host: string) => boolean {
  let host = "";
  try {
    host = new URL(dashboardUrl).hostname.toLowerCase();
  } catch {
    return () => false;
  }
  if (!host.endsWith(".vercel.app")) return () => false;
  return (candidate) => {
    const h = candidate.toLowerCase();
    return h === "vercel.com" || h.endsWith(".vercel.com");
  };
}

export type ReportedPlatform = "win32" | "darwin";

/**
 * What platform the dashboard is told this is. A dashboard that already knows Windows is told "win32". The production
 * dashboard does not yet (it accepts only the Mac app), so while it is the configured one the app presents itself with
 * the identity the dashboard already understands ("darwin"): everything works, only a few permission messages use
 * Mac wording. `--platform=win32|darwin` or `"platform"` in config.json decides explicitly, and turns the compatibility
 * off once the Windows-aware dashboard is deployed.
 */
export function resolveReportedPlatform(input: { argv: string[]; config: unknown; dashboardUrl: string; production: string }): ReportedPlatform {
  const explicit = input.argv.find((a) => a.startsWith("--platform="))?.slice("--platform=".length);
  const fromConfig = typeof input.config === "object" && input.config !== null ? (input.config as { platform?: unknown }).platform : undefined;
  for (const value of [explicit, fromConfig]) if (value === "win32" || value === "darwin") return value;
  try {
    return new URL(input.dashboardUrl).hostname === new URL(input.production).hostname ? "darwin" : "win32";
  } catch {
    return "win32";
  }
}
