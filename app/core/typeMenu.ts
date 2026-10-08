// Call type menu: the types only, the call's current one ticked (Vocify's proposal or the rep's pick)
export interface Option {
  key: string;
  label: string;
}

export interface MenuRow {
  key: string;
  label: string;
  checked: boolean;
}

export class TypeMenu {
  static readonly placeholderTitle = "Call type";

  options: Option[];
  selected: string | null;
  proposed: boolean;

  constructor(options: Option[], selected: string | null, proposed: boolean) {
    this.options = options;
    this.selected = selected;
    this.proposed = proposed;
  }

  private get labelStr(): string | null {
    return this.options.find((o) => o.key === this.selected)?.label ?? null;
  }

  get title(): string {
    return this.labelStr ?? TypeMenu.placeholderTitle;
  }

  get placeholder(): boolean {
    return this.labelStr === null;
  }

  get rows(): MenuRow[] {
    return this.options.map((option) => ({ key: option.key, label: option.label, checked: option.key === this.selected }));
  }
}

// Live help switch: this call only
export const LiveHelpSwitch = {
  command(turningOn: boolean): string {
    return turningOn ? "assist-on" : "assist-off";
  },
};
