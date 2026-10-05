// Live call transcript: bubbles, echo detection, settling
export type Speaker = "rep" | "prospect";

export interface Segment {
  speaker: Speaker | null;
  text: string;
  start: number | null; // seconds
  end: number | null;
  seen: number;
  name?: string;
}

export interface Row {
  key: string;
  speaker: Speaker | null;
  text: string;
  pending: string;
  start?: number;
  end?: number;
  name?: string;
  readonly you: boolean;
  readonly label: string | null;
}

interface Item {
  seen: number;
  speaker: Speaker | null;
  text: string;
  pending: string;
  start: number | null;
  end: number | null;
  name?: string;
  position: number;
}

class Draft {
  key: string;
  speaker: Speaker | null;
  parts: string[];
  pending: string;
  start: number | null;
  end: number | null;
  name?: string;
  wordCount: number;
  firstPosition: number;
  lastPosition: number;

  constructor(key: string, speaker: Speaker | null, parts: string[], pending: string,
    start: number | null, end: number | null, name?: string, wordCount: number = 0,
    firstPosition: number = Number.MAX_SAFE_INTEGER, lastPosition: number = -1) {
    this.key = key;
    this.speaker = speaker;
    this.parts = parts;
    this.pending = pending;
    this.start = start;
    this.end = end;
    this.name = name;
    this.wordCount = wordCount;
    this.firstPosition = firstPosition;
    this.lastPosition = lastPosition;
  }

  getRow(): Row {
    let text = "";
    for (const part of this.parts) {
      if (text.length === 0) {
        text = part;
      } else {
        const first = part[0];
        if (!",.;:!?…)".includes(first)) text += " ";
        text += part;
      }
    }
    return {
      key: this.key,
      speaker: this.speaker,
      text,
      pending: this.pending,
      start: this.start ?? undefined,
      end: this.end ?? undefined,
      name: this.name,
      get you() {
        return this.speaker === "rep";
      },
      get label() {
        if (this.speaker === null) return null;
        return this.speaker === "rep" ? "You" : this.name ?? "Them";
      },
    };
  }
}

export class LiveTranscript {
  segments: Segment[] = [];
  private settled: Row[] = [];
  private live: Item[] = [];
  private tokens: string[][] = [];
  private echo: boolean[] = [];
  private seenOrder: number[] = [];
  private frozen: Row[] = [];
  private frozenPositions = 0;
  private latestEnd = 0.0;
  private interims: Record<string, string> = {};
  private interimStarts: Record<string, number> = {};
  private interimEnds: Record<string, number> = {};
  private interimSeen: Record<string, number> = {};
  private interimNames: Record<string, string> = {};
  private nextSeen = 0;

  private static readonly order = ["rep", "prospect", "unknown"];
  private static readonly echoLookback = 30.0;
  private static readonly freezeAfter = 60.0;
  private static readonly echoWindow = 1.5;
  private static readonly echoOverlap = 0.6;
  private static readonly interjectionWords = 2;
  private static readonly overlapSlack = 0.5;

  get hasSpeech(): boolean {
    return this.segments.length > 0 || Object.values(this.interims).some((s) => s.length > 0);
  }

  apply(
    text: string,
    isFinal: boolean,
    channel: string | null | undefined,
    start: number | null | undefined,
    end: number | null | undefined,
    name?: string
  ): boolean {
    const trimmed = text.trim();
    const speaker = channel ? (channel === "rep" || channel === "prospect" ? (channel as Speaker) : null) : null;
    const key = speaker ?? "unknown";

    if (trimmed.length === 0) {
      if (!isFinal || this.interims[key] === undefined) return false;
      this.dropTail(key);
      return true;
    }

    if (!isFinal) {
      if (this.interims[key] === trimmed) return false;
      this.interims[key] = trimmed;
      if (start !== undefined && start !== null) this.interimStarts[key] = start;
      if (end !== undefined && end !== null) this.interimEnds[key] = end;
      if (name) this.interimNames[key] = name;
      if (this.interimSeen[key] === undefined) {
        this.interimSeen[key] = this.nextSeen;
        this.nextSeen++;
      }
      return true;
    }

    const seen =
      this.interimSeen[key] !== undefined
        ? this.interimSeen[key]
        : ((this.interimSeen[key] = this.nextSeen), this.nextSeen++);

    this.segments.push({
      speaker,
      text: trimmed,
      start: start ?? null,
      end: (end ?? start) ?? null,
      seen,
      name,
    });
    this.tokens.push(LiveTranscript.words(trimmed));
    this.echo.push(false);

    const tail = this.interims[key];
    const tailEnd = this.interimEnds[key];
    if (tail && tailEnd !== undefined && end !== undefined && end < tailEnd - 0.05) {
      const rest = LiveTranscript.remainder(tail, trimmed);
      if (rest) {
        this.interims[key] = rest;
        this.interimStarts[key] = end;
      } else {
        this.dropTail(key);
      }
    } else {
      this.dropTail(key);
    }

    const index = this.segments.length - 1;
    let slot = this.seenOrder.length;
    while (slot > 0 && this.segments[this.seenOrder[slot - 1]].seen > seen) {
      slot--;
    }
    this.seenOrder.splice(slot, 0, index);

    if ((end ?? start) !== null) {
      this.latestEnd = Math.max(this.latestEnd, (end ?? start) as number);
    }
    this.markEchoes(index);
    this.settle();
    return true;
  }

  reset(channel: string | null | undefined, from: number | null | undefined): boolean {
    const speaker = channel ? (channel === "rep" || channel === "prospect" ? (channel as Speaker) : null) : null;
    if (!speaker || from === undefined || from === null) return false;

    const keep = this.segments.map(
      (seg) => !(seg.speaker === speaker && (seg.start ?? -1) >= from - 0.01)
    );

    const hadTail = this.interims[speaker] !== undefined;
    this.dropTail(speaker);

    if (!keep.includes(false)) return hadTail;

    this.segments = this.segments.filter((_, i) => keep[i]);
    this.tokens = this.tokens.filter((_, i) => keep[i]);
    this.echo = this.segments.map((_, i) => this.isEcho(i));
    this.seenOrder = this.segments
      .map((_, i) => i)
      .sort((a, b) => this.segments[a].seen - this.segments[b].seen);
    this.frozen = [];
    this.frozenPositions = 0;
    this.settle();
    return true;
  }

  rows(): Row[] {
    const items: Item[] = [];
    for (const key of LiveTranscript.order) {
      const pending = this.interims[key];
      if (!pending || pending.length === 0) continue;

      if (key === "rep") {
        const start = this.interimStarts[key];
        if (
          start !== undefined &&
          LiveTranscript.echoes(LiveTranscript.words(pending), this.heard(start, null))
        ) {
          continue;
        }
      }

      const start = this.interimStarts[key];
      items.push({
        seen: this.interimSeen[key] ?? this.nextSeen,
        speaker: key === "rep" || key === "prospect" ? (key as Speaker) : null,
        text: "",
        pending,
        start: start ?? null,
        end: start ?? null,
        name: this.interimNames[key],
        position: -1,
      });
    }

    items.sort((a, b) => a.seen - b.seen);

    if (items.length === 0) return this.settled;

    const lastSettled = this.seenOrder.length > 0 ? this.segments[this.seenOrder[this.seenOrder.length - 1]].seen : -1;

    if (items.every((i) => i.seen >= lastSettled)) {
      const kept = this.settled.length > 2 ? this.settled.slice(0, this.settled.length - 2) : [];
      return kept.concat(LiveTranscript.merge(items, this.settled.slice(-2)));
    }

    let ordered = [...this.live];
    for (const tail of items) {
      const slot = ordered.findIndex((o) => o.seen > tail.seen);
      if (slot === -1) ordered.push(tail);
      else ordered.splice(slot, 0, tail);
    }
    return this.frozen.concat(LiveTranscript.mergeDrafts(ordered, []).map((d) => d.getRow()));
  }

  json(): Record<string, any> {
    return {
      segments: this.segments.map((seg) => ({
        speaker: seg.speaker ?? null,
        text: seg.text,
        start: seg.start ?? null,
        end: seg.end ?? null,
        seen: seg.seen,
        name: seg.name ?? null,
      })),
      interims: this.interims,
      interimStarts: this.interimStarts,
      interimSeen: this.interimSeen,
      nextSeen: this.nextSeen,
    };
  }

  static remainder(tail: string, after: string): string | null {
    const covered = LiveTranscript.words(after).length;
    const pieces = tail.split(/\s+/);
    let counted = 0;
    for (let index = 0; index < pieces.length; index++) {
      if (counted >= covered) return pieces.slice(index).join(" ");
      counted += LiveTranscript.words(pieces[index]).length;
    }
    return null;
  }

  static joinChunks(left: string, right: string): string {
    if (left.length === 0) return right;
    if (right.length === 0) return left;
    const first = right[0];
    if (",.;:!?…)".includes(first)) return left + right;
    return left + " " + right;
  }

  private static words(text: string): string[] {
    const normalized = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const parts = normalized.split(/[^a-z0-9']/);
    return parts.filter((p) => p.length > 0);
  }

  private dropTail(key: string): void {
    delete this.interims[key];
    delete this.interimStarts[key];
    delete this.interimEnds[key];
    delete this.interimSeen[key];
    delete this.interimNames[key];
  }

  private markEchoes(around: number): void {
    const segment = this.segments[around];
    if (segment.speaker === "rep") {
      this.echo[around] = this.isEcho(around);
      return;
    }
    if (segment.speaker !== "prospect" || segment.start === null) return;

    const start = segment.start;
    for (let other = this.segments.length - 1; other >= 0; other--) {
      const otherStart = this.segments[other].start;
      if (otherStart === null) continue;
      if (otherStart < start - LiveTranscript.echoLookback) break;
      if (this.segments[other].speaker === "rep") {
        this.echo[other] = this.isEcho(other);
      }
    }
  }

  private settle(): void {
    const items: Item[] = [];
    for (let position = this.frozenPositions; position < this.seenOrder.length; position++) {
      const index = this.seenOrder[position];
      if (this.echo[index]) continue;
      const segment = this.segments[index];
      items.push({
        seen: segment.seen,
        speaker: segment.speaker,
        text: segment.text,
        pending: "",
        start: segment.start,
        end: segment.end,
        name: segment.name,
        position,
      });
    }

    const drafts = LiveTranscript.mergeDrafts(items, []);
    this.live = items.filter((i) => i.position >= this.frozenPositions);

    let cut = 0;
    while (cut < drafts.length - 2 && drafts[cut].end && drafts[cut].end < this.latestEnd - LiveTranscript.freezeAfter) {
      cut++;
    }
    while (cut > 0 && drafts.slice(0, cut).some((d) => d.lastPosition >= drafts[cut].firstPosition)) {
      cut--;
    }

    if (cut > 0) {
      this.frozen = this.frozen.concat(drafts.slice(0, cut).map((d) => d.getRow()));
      this.frozenPositions = drafts[cut].firstPosition;
    }
    this.settled = this.frozen.concat(drafts.slice(cut).map((d) => d.getRow()));
  }

  private isEcho(index: number): boolean {
    const segment = this.segments[index];
    if (segment.speaker !== "rep" || segment.start === null) return false;
    return LiveTranscript.echoes(this.tokens[index], this.heard(segment.start, segment.end ?? segment.start));
  }

  private heard(start: number, end: number | null): Set<string> {
    const heard = new Set<string>();
    for (let other = this.segments.length - 1; other >= 0; other--) {
      if (this.segments[other].speaker !== "prospect") continue;
      const otherStart = this.segments[other].start;
      if (otherStart === null) continue;
      if (otherStart < start - LiveTranscript.echoLookback) break;
      const otherEnd = this.segments[other].end ?? otherStart;
      if (end === null) {
        if (otherStart <= start + LiveTranscript.echoWindow && otherEnd >= start - LiveTranscript.echoWindow) {
          this.tokens[other].forEach((t) => heard.add(t));
        }
      } else {
        if (otherStart <= end + LiveTranscript.echoWindow && otherEnd >= start - LiveTranscript.echoWindow) {
          this.tokens[other].forEach((t) => heard.add(t));
        }
      }
    }

    const tail = this.interims["prospect"];
    const tailStart = this.interimStarts["prospect"];
    if (tail && tailStart !== undefined) {
      if (end === null) {
        if (tailStart <= start + LiveTranscript.echoWindow && tailStart >= start - LiveTranscript.echoLookback) {
          LiveTranscript.words(tail).forEach((t) => heard.add(t));
        }
      } else {
        if (tailStart <= end + LiveTranscript.echoWindow && tailStart >= start - LiveTranscript.echoLookback) {
          LiveTranscript.words(tail).forEach((t) => heard.add(t));
        }
      }
    }

    return heard;
  }

  private static echoes(own: string[], heard: Set<string>): boolean {
    if (own.length === 0 || heard.size === 0) return false;
    const shared = own.filter((w) => heard.has(w)).length;
    return own.length <= 2 ? shared === own.length : shared / own.length >= LiveTranscript.echoOverlap;
  }

  private static merge(items: Item[], start: Row[]): Row[] {
    if (items.length === 0) return start;
    const drafts = LiveTranscript.mergeDrafts(items, start.map((r) => LiveTranscript.draftFromRow(r)));
    return drafts.map((d) => d.getRow());
  }

  private static mergeDrafts(items: Item[], start: Draft[]): Draft[] {
    const drafts = [...start];
    for (const item of items) {
      const index = LiveTranscript.paragraph(item, drafts);
      if (index === null) {
        drafts.push(LiveTranscript.draftFromItem(item));
        continue;
      }
      if (drafts[index].speaker === null) drafts[index].speaker = item.speaker;
      if (item.pending.length === 0) {
        if (item.text.length > 0) {
          drafts[index].parts.push(item.text);
          drafts[index].wordCount += item.text.split(/\s+/).filter((w) => w.length > 0).length;
        }
      } else {
        drafts[index].pending = item.pending;
      }
      if (drafts[index].start === null) drafts[index].start = item.start;
      if (item.end !== null) drafts[index].end = Math.max(drafts[index].end ?? item.end, item.end);
      if (drafts[index].name === undefined) drafts[index].name = item.name;
      if (item.position >= 0) {
        drafts[index].firstPosition = Math.min(drafts[index].firstPosition, item.position);
        drafts[index].lastPosition = Math.max(drafts[index].lastPosition, item.position);
      }
    }
    return drafts;
  }

  private static paragraph(item: Item, rows: Draft[]): number | null {
    if (rows.length === 0) return null;
    const last = rows[rows.length - 1];
    const samePerson =
      last.name === undefined ||
      item.name === undefined ||
      last.name === item.name;
    if (
      last.pending.length === 0 &&
      samePerson &&
      (last.speaker === item.speaker || item.speaker === null || last.speaker === null)
    ) {
      return rows.length - 1;
    }

    if (rows.length < 2 || item.speaker === null) return null;
    const before = rows[rows.length - 2];
    if (
      before.speaker === item.speaker &&
      before.pending.length === 0 &&
      (before.name === undefined || item.name === undefined || before.name === item.name) &&
      last.speaker !== item.speaker &&
      last.pending.length === 0 &&
      last.wordCount <= LiveTranscript.interjectionWords &&
      last.start !== undefined &&
      before.start !== undefined &&
      before.end !== undefined &&
      last.start >= before.start - LiveTranscript.overlapSlack &&
      last.start <= before.end + LiveTranscript.overlapSlack
    ) {
      return rows.length - 2;
    }

    return null;
  }

  private static draftFromRow(row: Row): Draft {
    return new Draft(
      row.key,
      row.speaker,
      row.text.length > 0 ? [row.text] : [],
      row.pending,
      row.start ?? null,
      row.end ?? null,
      row.name,
      row.text.split(/\s+/).filter((w) => w.length > 0).length,
      Number.MAX_SAFE_INTEGER,
      -1
    );
  }

  private static draftFromItem(item: Item): Draft {
    const parts = item.text.length > 0 ? [item.text] : [];
    const wordCount = item.text.split(/\s+/).filter((w) => w.length > 0).length;
    const key = `u${item.seen}`;
    let firstPosition = Number.MAX_SAFE_INTEGER;
    let lastPosition = -1;
    if (item.position >= 0) {
      firstPosition = item.position;
      lastPosition = item.position;
    }

    return new Draft(key, item.speaker, parts, item.pending, item.start, item.end, item.name, wordCount, firstPosition, lastPosition);
  }
}
