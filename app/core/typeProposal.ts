// Live call type: how a type Vocify chose is announced on the island, and how the rep's pick ends it.
// The rep always prevails: a pick (even of the type already shown) or an undo makes the type theirs for the call,
// and from then on nothing is announced.
export type Language = "es" | "en";

/** "propose": the first type Vocify gave the call. "change": it replaced a type that was already shown. */
export interface ProposalNote {
  id: number;
  kind: "propose" | "change";
  key: string;
  /** The type shown before a change (what Undo restores); null for the first proposal. */
  previous: string | null;
}

export class TypeProposal {
  /** How long the tag stays grown, in seconds. */
  static readonly noteSeconds = 4;

  shown: string | null = null;
  note: ProposalNote | null = null;
  private rep = false;
  private seq = 0;

  /** What the dashboard says the call's type is; returns the note to show when Vocify set or changed it. */
  hear(selected: string | null, proposed: boolean): ProposalNote | null {
    const before = this.shown;
    this.shown = selected;
    if (selected === null || selected === before) {
      if (selected === null) this.note = null;
      return null;
    }
    // The dashboard sends what it holds: after the rep's pick, a proposal still in flight is shown but never announced.
    if (this.rep || !proposed) {
      this.note = null;
      return null;
    }
    this.note = { id: ++this.seq, kind: before === null ? "propose" : "change", key: selected, previous: before };
    return this.note;
  }

  /** The rep picked a type; null hands the call back to Vocify. */
  pick(key: string | null): void {
    this.note = null;
    this.rep = key !== null;
    if (key !== null) this.shown = key;
  }

  /** Undo on "Cambia a ...": the type before, now the rep's; null when there is nothing to go back to. */
  undo(): string | null {
    const note = this.note;
    if (!note || note.kind !== "change" || note.previous === null) return null;
    this.pick(note.previous);
    return note.previous;
  }

  /** The note's time ran out. */
  expire(): void {
    this.note = null;
  }

  /** A new call. */
  reset(): void {
    this.shown = null;
    this.note = null;
    this.rep = false;
  }
}

export const ProposalWording = {
  lead(language: Language, kind: ProposalNote["kind"], label: string): string {
    if (language === "es") return kind === "propose" ? `Propone: ${label}` : `Cambia a ${label}`;
    return kind === "propose" ? `Suggests: ${label}` : `Changes to ${label}`;
  },

  /** The tappable end of the line: Change opens the list, Undo goes back to the previous type. */
  action(language: Language, kind: ProposalNote["kind"]): string {
    if (language === "es") return kind === "propose" ? "Cambiar" : "Deshacer";
    return kind === "propose" ? "Change" : "Undo";
  },

  /** The language of the rep's computer (`es-ES`, `en-US`): Spanish, else English. */
  language(locale: string): Language {
    return locale.toLowerCase().startsWith("es") ? "es" : "en";
  },
};
