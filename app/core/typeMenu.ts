// Call type menu: Vocify's proposal vs rep's pick
export interface Option {
  key: string;
  label: string;
}

export interface MenuRow {
  key: string | null;
  label: string;
  checked: boolean;
  suggested: boolean;
}

export class TypeMenu {
  static readonly decideLabel = "Let Vocify decide";
  static readonly placeholderTitle = "Call type";

  options: Option[];
  selected: string | null;
  proposed: boolean;

  constructor(options: Option[], selected: string | null, proposed: boolean) {
    this.options = options;
    this.selected = selected;
    this.proposed = proposed;
  }

  private get picked(): string | null {
    return this.proposed ? null : this.selected;
  }

  private get labelStr(): string | null {
    return this.options.find((o) => o.key === this.selected)?.label ?? null;
  }

  get title(): string {
    return this.labelStr ?? TypeMenu.placeholderTitle;
  }

  get sparkle(): boolean {
    return this.proposed && this.labelStr !== null;
  }

  get placeholder(): boolean {
    return this.labelStr === null;
  }

  get rows(): MenuRow[] {
    const result: MenuRow[] = [
      {
        key: null,
        label: TypeMenu.decideLabel,
        checked: this.picked === null,
        suggested: false,
      },
    ];
    for (const option of this.options) {
      result.push({
        key: option.key,
        label: option.label,
        checked: option.key === this.picked,
        suggested: this.proposed && option.key === this.selected,
      });
    }
    return result;
  }
}

// Live help switch: this call only
export const LiveHelpSwitch = {
  command(turningOn: boolean): string {
    return turningOn ? "assist-on" : "assist-off";
  },
};
