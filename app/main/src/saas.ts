export type SaasResult = { ok: boolean; status: number; data: unknown; error?: string };

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;

/** Hosts the dashboard may reach through the shell (port of SaasProxy.swift): the Vocify APIs, local development, Railway previews. */
export function isAllowedBase(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol === "https:" && (host === "api.getvocify.com" || host === "staging-api.getvocify.com")) return true;
  if ((url.protocol === "http:" || url.protocol === "https:") && (host === "localhost" || host === "127.0.0.1")) return true;
  // The Swift app accepts any host that merely contains "railway.app", which would admit railway.app.evil.com.
  return host === "railway.app" || host.endsWith(".railway.app");
}

const failure = (error: string): SaasResult => ({ ok: false, status: 0, data: {}, error });

/** The request the page asked for, sent from here so no browser rule can block it; anything off the allow-list is refused. */
export async function saasRequest(payload: unknown, fetchImpl: Fetch): Promise<SaasResult> {
  const input = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const base = typeof input.base === "string" ? input.base : "";
  if (!isAllowedBase(base)) return failure("API base is not a Vocify host");
  const path = typeof input.path === "string" ? input.path : "";
  const method = (typeof input.method === "string" ? input.method : "GET").toUpperCase();
  const root = base.trim().replace(/^\/+|\/+$/g, "");
  const url = `${root}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    new URL(url);
  } catch {
    return failure("Invalid URL");
  }
  const headers: Record<string, string> = {};
  if (typeof input.headers === "object" && input.headers !== null) {
    for (const [key, value] of Object.entries(input.headers)) if (typeof value === "string") headers[key] = value;
  }
  let body: string | undefined;
  if (input.body !== undefined && input.body !== null) {
    headers["Content-Type"] = "application/json";
    body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  }
  try {
    const response = await fetchImpl(url, { method, headers, body });
    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
    }
    if (response.status >= 200 && response.status < 300) return { ok: true, status: response.status, data };
    const detail = typeof data === "object" && data !== null ? (data as { detail?: unknown }).detail : undefined;
    return { ok: false, status: response.status, data, error: typeof detail === "string" ? detail : `HTTP ${response.status}` };
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Request failed");
  }
}
