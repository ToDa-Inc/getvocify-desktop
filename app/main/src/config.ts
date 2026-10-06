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
  return withEntryPath(acceptDashboardUrl(fromArgument) ?? acceptDashboardUrl(input.env.VOCIFY_DASHBOARD_URL) ?? acceptDashboardUrl(fromConfig) ?? input.fallback);
}

/** The site root is the marketing page. Like the Mac app, a bare address opens the dashboard (its sign-in comes first). */
export function withEntryPath(address: string): string {
  try {
    const url = new URL(address);
    if (url.pathname !== "/" || url.search || url.hash) return address;
    url.pathname = "/dashboard/record";
    return url.toString();
  } catch {
    return address;
  }
}

/** The dashboard's staging site: it has the island bridge the live site lacks, and is behind a Vercel sign-in too. */
const STAGING_HOST = "staging.getvocify.com";

/** A Vercel preview (or the staging site) of the dashboard is behind a Vercel sign-in; its pages stay inside the app so that sign-in can finish. */
export function signInHostsFor(dashboardUrl: string): (host: string) => boolean {
  let host = "";
  try {
    host = new URL(dashboardUrl).hostname.toLowerCase();
  } catch {
    return () => false;
  }
  if (!host.endsWith(".vercel.app") && host !== STAGING_HOST) return () => false;
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
    const host = new URL(input.dashboardUrl).hostname;
    return host === new URL(input.production).hostname || host === STAGING_HOST ? "darwin" : "win32";
  } catch {
    return "win32";
  }
}
