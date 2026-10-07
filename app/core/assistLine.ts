// Assist line suggestion display with time-based visibility
export class AssistLine {
  helpOn: boolean;
  text: string;
  shownAt: number | null; // seconds since epoch

  constructor(helpOn: boolean = false, text: string = "", shownAt: number | null = null) {
    this.helpOn = helpOn;
    this.text = text;
    this.shownAt = shownAt;
  }

  visible(now: number, speakerIsRep: boolean): string | null {
    if (!this.helpOn || speakerIsRep) return null;
    if (this.shownAt === null || this.text.length === 0) return null;
    if (now - this.shownAt >= 10) return null;
    return this.text.length > 90 ? this.text.substring(0, 90) : this.text;
  }

  present(raw: string, evidenceCount: number, playbookReady: boolean, now: number): AssistLine {
    const line = raw
      .replace(/\s+/g, " ")
      .trim();
    if (!this.helpOn || !playbookReady || evidenceCount <= 0 || line.length === 0) {
      return new AssistLine(this.helpOn, this.text, this.shownAt);
    }
    const text = line.length > 90 ? line.substring(0, 90) : line;
    return new AssistLine(this.helpOn, text, now);
  }
}
