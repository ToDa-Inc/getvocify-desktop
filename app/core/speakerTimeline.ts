// Speaker timeline: who was speaking at what time according to the meeting app
interface Sample {
  at: number; // seconds
  names: string[];
}

export class SpeakerTimeline {
  private samples: Sample[] = [];
  private static readonly sampleSpan = 1.0;
  private static readonly slack = 0.3;

  get isEmpty(): boolean {
    return this.samples.length === 0;
  }

  record(at: number, speaking: string[]): void {
    const last = this.samples[this.samples.length - 1];
    if (last && this.namesEqual(last.names, speaking) && at - last.at < SpeakerTimeline.sampleSpan) {
      return;
    }
    this.samples.push({ at, names: speaking });
  }

  name(from: number, to: number): string | null {
    const time: Record<string, number> = {};
    for (let index = 0; index < this.samples.length; index++) {
      const sample = this.samples[index];
      const next = index + 1 < this.samples.length ? this.samples[index + 1].at : sample.at + SpeakerTimeline.sampleSpan;
      const timeFrom = Math.max(sample.at, from - SpeakerTimeline.slack);
      const timeTo = Math.min(Math.min(next, sample.at + SpeakerTimeline.sampleSpan), to + SpeakerTimeline.slack);
      if (timeTo <= timeFrom) continue;
      for (const name of sample.names) {
        time[name] = (time[name] ?? 0) + (timeTo - timeFrom);
      }
    }
    let max: [string, number] | null = null;
    for (const [key, value] of Object.entries(time)) {
      if (!max || value > max[1]) max = [key, value];
    }
    return max ? max[0] : null;
  }

  private namesEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}

// Zoom tile parsing: "Marta García, Computer audio, Active speaker" -> "Marta García"
export const ZoomTile = {
  speakingName(description: string): string | null {
    if (!description.toLowerCase().includes("active speaker")) return null;

    const audioMarkers = [
      ", Computer audio",
      ", No audio connected",
      ", Phone audio",
      ", Device audio",
      ", Telephone",
      ", Call me",
    ];
    const ends = audioMarkers
      .map((marker) => description.indexOf(marker))
      .filter((idx) => idx !== -1);
    const activeSpeakerIdx = description.toLowerCase().indexOf(", active speaker");

    let end: number | null = null;
    if (ends.length > 0) {
      end = Math.min(...ends);
    }
    if (activeSpeakerIdx !== -1) {
      if (end === null) end = activeSpeakerIdx;
      else end = Math.min(end, activeSpeakerIdx);
    }

    if (end === null) return null;

    const name = description.substring(0, end).trim();
    return name.length === 0 ? null : name;
  },
};
