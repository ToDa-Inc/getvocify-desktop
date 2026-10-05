import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptDashboardUrl, resolveDashboardUrl, resolveReportedPlatform, signInHostsFor } from "../src/config.ts";

const fallback = "https://app.getvocify.com";

test("only https addresses, and http on this computer, are accepted as the dashboard", () => {
  assert.equal(acceptDashboardUrl("https://getvocify-abc.vercel.app"), "https://getvocify-abc.vercel.app/");
  assert.equal(acceptDashboardUrl("http://localhost:8080"), "http://localhost:8080/");
  assert.equal(acceptDashboardUrl("http://127.0.0.1:5173/x"), "http://127.0.0.1:5173/x");
  for (const bad of ["http://evil.com", "file:///etc/passwd", "javascript:alert(1)", "ftp://x.com", "not a url", "", null, undefined, 5]) assert.equal(acceptDashboardUrl(bad), null, String(bad));
});

test("the dashboard comes from the command line, then the environment, then the config file, then production", () => {
  const base = { argv: [], env: {}, config: undefined, fallback };
  assert.equal(resolveDashboardUrl(base), fallback);
  assert.equal(resolveDashboardUrl({ ...base, config: { dashboardUrl: "https://c.example.com" } }), "https://c.example.com/");
  assert.equal(resolveDashboardUrl({ ...base, config: { dashboardUrl: "https://c.example.com" }, env: { VOCIFY_DASHBOARD_URL: "https://e.example.com" } }), "https://e.example.com/");
  assert.equal(resolveDashboardUrl({ ...base, env: { VOCIFY_DASHBOARD_URL: "https://e.example.com" }, argv: ["--dashboard=https://a.example.com"] }), "https://a.example.com/");
});

test("a bad address is ignored and the next source is used, never an unsafe page", () => {
  assert.equal(resolveDashboardUrl({ argv: ["--dashboard=http://evil.com"], env: { VOCIFY_DASHBOARD_URL: "https://e.example.com" }, config: null, fallback }), "https://e.example.com/");
  assert.equal(resolveDashboardUrl({ argv: ["--dashboard=nonsense"], env: {}, config: "oops", fallback }), fallback);
});

test("a Vercel preview may sign in on vercel.com inside the app; no other dashboard may", () => {
  const preview = signInHostsFor("https://getvocify-abc-danis-projects.vercel.app/");
  assert.equal(preview("vercel.com"), true);
  assert.equal(preview("sso.vercel.com"), true);
  assert.equal(preview("evil-vercel.com"), false);
  assert.equal(preview("vercel.com.evil.com"), false);
  const production = signInHostsFor("https://app.getvocify.com");
  assert.equal(production("vercel.com"), false);
  assert.equal(signInHostsFor("garbage")("vercel.com"), false);
});

test("the production dashboard is told the identity it already understands, anything else is told Windows", () => {
  const base = { argv: [], config: null, production: "https://app.getvocify.com" };
  assert.equal(resolveReportedPlatform({ ...base, dashboardUrl: "https://app.getvocify.com/" }), "darwin");
  assert.equal(resolveReportedPlatform({ ...base, dashboardUrl: "https://getvocify-abc.vercel.app" }), "win32");
  assert.equal(resolveReportedPlatform({ ...base, dashboardUrl: "http://localhost:8080" }), "win32");
  assert.equal(resolveReportedPlatform({ ...base, dashboardUrl: "nonsense" }), "win32");
});

test("an explicit platform wins, from the command line first, so the compatibility can be turned off", () => {
  const base = { production: "https://app.getvocify.com", dashboardUrl: "https://app.getvocify.com" };
  assert.equal(resolveReportedPlatform({ ...base, argv: ["--platform=win32"], config: null }), "win32");
  assert.equal(resolveReportedPlatform({ ...base, argv: [], config: { platform: "win32" } }), "win32");
  assert.equal(resolveReportedPlatform({ ...base, argv: ["--platform=darwin"], config: { platform: "win32" } }), "darwin");
  assert.equal(resolveReportedPlatform({ ...base, argv: ["--platform=linux"], config: { platform: 5 } }), "darwin", "an unknown value is ignored");
});
