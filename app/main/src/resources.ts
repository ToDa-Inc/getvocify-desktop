/**
 * What Vocify costs the computer, written to the log every 10 minutes so a rep's "copy diagnostics" shows it: memory
 * and CPU of each of the app's own processes (main, the dashboard, the island, the GPU…), memory of the long-lived
 * programs it keeps running (the PowerShell readers on Windows, the helper on the Mac), how much free memory the
 * computer has, and how many programs the app has launched since it started (`reg.exe` once a second, for one).
 * Nothing here changes what the app does; it only measures.
 */

/** Programs launched since the app started, by file name ("reg.exe", "powershell.exe"). */
const launched = new Map<string, number>();
/** Long-lived programs the app keeps running, by pid, while they run. */
const running = new Map<number, string>();

export function countLaunch(file: string): void {
  const name = (file.split(/[\\/]/).pop() ?? file).toLowerCase();
  launched.set(name, (launched.get(name) ?? 0) + 1);
}

/** A program that keeps running alongside the app: measured until it exits. */
export function trackChild(name: string, child: { pid?: number; on(event: "exit", listener: () => void): unknown }): void {
  const pid = child.pid;
  if (!pid) return;
  running.set(pid, name);
  child.on("exit", () => running.delete(pid));
}

export const trackedChildren = (): { pid: number; name: string }[] => [...running].map(([pid, name]) => ({ pid, name }));
export const launchCounts = (): [string, number][] => [...launched].sort((a, b) => b[1] - a[1]);

/** One of the app's own processes as Electron reports it (`app.getAppMetrics()`), named for the log. */
export type OwnProcess = { name: string; kb: number; cpu: number };

/** Electron's process types, named as the log shows them; a page is named by the window it belongs to. */
export function processName(type: string, serviceName: string | undefined, pageName: string | undefined): string {
  if (type === "Browser") return "main";
  if (type === "GPU") return "gpu";
  if (type === "Tab") return pageName ?? "page";
  if (type === "Utility" && serviceName) return serviceName.replace(/^.*?([a-z_]+)\.mojom\.([A-Za-z]+)Service$/, "$1").toLowerCase();
  return type.toLowerCase();
}

/** `tasklist /FO CSV /NH`: memory (KB) by pid, and how many of each program run. The memory column is written in the
 * system's language ("85,432 K", "85.432 KB"): only its digits are read. */
export function parseTasklist(output: string): { kbByPid: Map<number, number>; countByName: Map<string, number> } {
  const kbByPid = new Map<number, number>();
  const countByName = new Map<string, number>();
  for (const line of output.split(/\r?\n/)) {
    const cells = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (cells.length < 5) continue;
    const pid = Number(cells[1]);
    const kb = Number(cells[4].replace(/\D/g, ""));
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (Number.isFinite(kb)) kbByPid.set(pid, kb);
    const name = cells[0].toLowerCase();
    countByName.set(name, (countByName.get(name) ?? 0) + 1);
  }
  return { kbByPid, countByName };
}

/** `ps -o pid=,rss= -p …` (Mac): memory (KB) by pid. */
export function parsePs(output: string): Map<number, number> {
  const kbByPid = new Map<number, number>();
  for (const line of output.split("\n")) {
    const [pid, rss] = line.trim().split(/\s+/).map(Number);
    if (pid > 0 && Number.isFinite(rss)) kbByPid.set(pid, rss);
  }
  return kbByPid;
}

export type ResourceSample = {
  /** What the island is doing (idle, recording…). */
  mode: string;
  uptimeMs: number;
  /** Memory programs can still get (Windows); null where the system does not say it usefully (Mac). */
  freeBytes: number | null;
  totalBytes: number;
  own: OwnProcess[];
  children: { name: string; kb: number | null }[];
  /** How many PowerShells run on the computer (Windows), the app's and others'; null where not read. */
  powershells: number | null;
  launches: [string, number][];
};

const mb = (kb: number) => Math.round(kb / 1024);
const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** The log line: "resources (idle, up 3h12m): free 2.1 of 16.0 GB · Vocify 812 MB [main 120, …] cpu 3% · …". */
export function resourceLine(sample: ResourceSample): string {
  const own = [...sample.own].sort((a, b) => b.kb - a.kb);
  const total = own.reduce((sum, p) => sum + p.kb, 0);
  const cpu = own.reduce((sum, p) => sum + p.cpu, 0);
  const parts = [
    sample.freeBytes === null ? `${gb(sample.totalBytes)} GB memory` : `free ${gb(sample.freeBytes)} of ${gb(sample.totalBytes)} GB`,
    `Vocify ${mb(total)} MB [${own.map((p) => `${p.name} ${mb(p.kb)}`).join(", ")}] cpu ${cpu.toFixed(1)}%`,
  ];
  if (sample.children.length) parts.push(`running: ${sample.children.map((c) => `${c.name} ${c.kb === null ? "?" : `${mb(c.kb)} MB`}`).join(", ")}`);
  if (sample.powershells !== null) parts.push(`powershell.exe on the computer: ${sample.powershells}`);
  if (sample.launches.length) parts.push(`launched since start: ${sample.launches.map(([name, n]) => `${name} ${n}`).join(", ")}`);
  return `resources (${sample.mode}, up ${duration(sample.uptimeMs)}): ${parts.join(" · ")}`;
}
