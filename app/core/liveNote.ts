// Live note with speaker turns
export class NoteTurn {
  speaker: string;
  committed: string;
  live: string;

  constructor(speaker: string, committed: string, live: string) {
    this.speaker = speaker;
    this.committed = committed;
    this.live = live;
  }

  get text(): string {
    if (this.committed.length === 0) return this.live;
    if (this.live.length === 0) return this.committed;
    if (this.live.startsWith(this.committed)) return this.live;
    return `${this.committed} ${this.live}`;
  }
}

export class LiveNote {
  turns: NoteTurn[] = [];

  apply(text: string, isFinal: boolean, speaker: string): void {
    const piece = text.trim();
    if (piece.length === 0) return;
    if (!isFinal) {
      this.applyInterim(piece, speaker);
      return;
    }
    this.applyFinal(piece, speaker);
  }

  get uploadText(): string {
    return this.turns
      .filter((t) => t.text.length > 0)
      .map((turn) => (turn.speaker.length === 0 ? turn.text : `${this.turnLabel(turn)}: ${turn.text}`))
      .join(" ");
  }

  get latestFinal(): string {
    for (let i = this.turns.length - 1; i >= 0; i--) {
      if (this.turns[i].live.length === 0) return this.turns[i].text;
    }
    return "";
  }

  private applyInterim(piece: string, speaker: string): void {
    const index = this.ensureTurn(speaker);
    this.turns[index].live = piece;
  }

  private applyFinal(piece: string, speaker: string): void {
    const index = this.ensureTurn(speaker);
    const prior = this.turns[index].committed;
    if (piece.startsWith(prior) || prior.length === 0) {
      this.turns[index].committed = piece;
    } else if (
      this.turns[index].live.length > 0 &&
      (piece === this.turns[index].live || piece.startsWith(this.turns[index].live))
    ) {
      this.turns[index].committed = this.join(prior, piece);
    } else {
      this.turns[index].committed = this.join(prior, piece);
    }
    this.turns[index].live = "";
  }

  private ensureTurn(speaker: string): number {
    if (this.turns.length > 0) {
      const index = this.turns.length - 1;
      const current = this.turns[index].speaker;
      const changed = speaker.length > 0 && current.length > 0 && speaker !== current;
      if (!changed) {
        if (speaker.length > 0) this.turns[index].speaker = speaker;
        return index;
      }
    }
    this.turns.push(new NoteTurn(speaker, "", ""));
    return this.turns.length - 1;
  }

  private join(left: string, right: string): string {
    return `${left} ${right}`
      .replace(/\s+/g, " ")
      .trim();
  }

  private turnLabel(turn: NoteTurn): string {
    switch (turn.speaker) {
      case "rep":
        return "Tú";
      case "prospect":
        return "Otro";
      default:
        return "";
    }
  }
}
