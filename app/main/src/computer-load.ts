/**
 * What the computer itself is and how loaded it is, for the log: a rep's PC where Vocify is slow next to one where it is
 * not says nothing until the two can be compared (2026-11-25: one PC used 22% of a core at rest, the others 1-5%, and
 * the log did not even say which Windows or processor each was). Read from what the system already keeps; nothing is
 * launched.
 */

/** One reading of every processor's counters (`os.cpus()`). */
export type CpuTimes = { idle: number; total: number };

export function cpuTimes(cpus: { times: { user: number; nice: number; sys: number; idle: number; irq: number } }[]): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

/** How busy the whole computer was between two readings, 0-100 across all its processors; null when no time passed. */
export function busyBetween(before: CpuTimes, after: CpuTimes): number | null {
  const total = after.total - before.total;
  if (!(total > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((1 - (after.idle - before.idle) / total) * 100)));
}

/** Reads the computer's load since the last call (the first call returns null). */
export function createLoadMeter(read: () => CpuTimes): () => number | null {
  let last: CpuTimes | null = null;
  return () => {
    const now = read();
    const busy = last ? busyBetween(last, now) : null;
    last = now;
    return busy;
  };
}

/** "Windows 10.0.19045 (Windows 10 Pro) · Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz, 8 processors · 7.9 GB · on battery". */
export function computerLine(about: { platform: string; release: string; version: string; cpuModel: string; processors: number; totalBytes: number; onBattery: boolean | null }): string {
  const system = about.platform === "win32" ? "Windows" : about.platform === "darwin" ? "macOS (Darwin)" : about.platform;
  const power = about.onBattery === null ? "" : about.onBattery ? " · on battery" : " · plugged in";
  return `computer: ${system} ${about.release}${about.version ? ` (${about.version})` : ""} · ${about.cpuModel.trim() || "unknown processor"}, ${about.processors} processors · ${(about.totalBytes / 1024 ** 3).toFixed(1)} GB${power}`;
}
