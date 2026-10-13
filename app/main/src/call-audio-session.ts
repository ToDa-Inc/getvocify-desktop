/**
 * The audio session a call on the rep's phone plays in (Windows), for its hang-up: the same idea as a call app letting
 * go of the mic, on the other side's audio. Windows marks an app's audio session active while its stream runs and
 * inactive or expired once the app stops it (Core Audio, IAudioSessionControl::GetState). The call is the session that
 * started playing after the rep pressed Call (not one that already played, never Vocify's own); when it stops playing,
 * the call is over. Which app owns it is not assumed: Phone Link, or a Windows service on its behalf.
 */

/** One audio session playing sound now, as the Windows reader reports it. */
export type AudioSession = { pid: number; app: string; id: string };

/** `SESSIONS [...]` from the reader (windows/audio-sessions.ts): the sessions playing now; null for anything else. */
export function parseSessionsLine(line: string): AudioSession[] | null {
  if (!line.startsWith("SESSIONS ")) return null;
  try {
    const parsed: unknown = JSON.parse(line.slice("SESSIONS ".length));
    if (!Array.isArray(parsed)) return null;
    return parsed.flatMap((s) =>
      typeof s === "object" && s !== null && typeof (s as AudioSession).id === "string"
        ? [{ pid: Number((s as AudioSession).pid) || 0, app: String((s as AudioSession).app ?? ""), id: (s as AudioSession).id }]
        : [],
    );
  } catch {
    return null;
  }
}

export class CallAudioSession {
  private readonly deps: { ownApp: string; log(line: string): void };
  /** What played when the rep pressed Call (the first answer); null until the reader answered. */
  private baseline: Set<string> | null = null;
  private active: AudioSession[] = [];
  /** The call's sessions, once its sound was heard. */
  private call: AudioSession[] = [];
  /** Heard before the reader's first answer: the next answer names the call. */
  private pickNext = false;
  private ended = false;
  private endedListeners = new Set<() => void>();
  private backListeners = new Set<() => void>();

  constructor(deps: CallAudioSession["deps"]) {
    this.deps = deps;
  }

  onEnded(cb: () => void): void {
    this.endedListeners.add(cb);
  }

  onBack(cb: () => void): void {
    this.backListeners.add(cb);
  }

  private isOwn(session: AudioSession): boolean {
    return session.app.toLowerCase() === this.deps.ownApp.toLowerCase();
  }

  /** The reader's latest answer: the sessions playing sound now. */
  update(active: AudioSession[]): void {
    this.active = active;
    if (this.baseline === null) {
      if (this.pickNext) {
        // Heard before the first answer: what plays now, but Vocify, is the call.
        this.pickNext = false;
        this.baseline = new Set();
        this.follow(active.filter((s) => !this.isOwn(s)));
      } else {
        this.baseline = new Set(active.map((s) => s.id));
      }
      return;
    }
    if (this.call.length === 0) return;
    const playing = this.call.some((c) => active.some((s) => s.id === c.id));
    if (!playing && !this.ended) {
      this.ended = true;
      this.deps.log(`call audio session: stopped (${this.call.map((c) => c.app).join(", ")})`);
      for (const cb of this.endedListeners) cb();
    } else if (playing && this.ended) {
      this.ended = false;
      this.deps.log("call audio session: playing again");
      for (const cb of this.backListeners) cb();
    }
  }

  /** The call's sound was heard: the sessions that started playing since Call are the call. */
  heard(): AudioSession[] {
    if (this.baseline === null) {
      this.pickNext = true;
      return [];
    }
    const baseline = this.baseline;
    this.follow(this.active.filter((s) => !baseline.has(s.id) && !this.isOwn(s)));
    return this.call;
  }

  /** The sessions followed as the call. */
  followed(): AudioSession[] {
    return this.call;
  }

  private follow(sessions: AudioSession[]): void {
    this.call = sessions;
    this.ended = false;
    this.deps.log(
      sessions.length
        ? `call audio session: following ${sessions.map((s) => `${s.app} (pid ${s.pid})`).join(", ")}`
        : "call audio session: none started with the call; its silence ends it instead",
    );
  }
}
