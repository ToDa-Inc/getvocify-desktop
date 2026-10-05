// Wave side: whose voice the island's wave shows
export type WaveSideType = "you" | "them";

export const WaveSide = {
  speaking: 0.05,
  margin: 0.1,

  next(you: number, them: number, previous: WaveSideType): WaveSideType {
    const max = Math.max(you, them);
    const abs = Math.abs(you - them);
    if (max < this.speaking || abs < this.margin) return previous;
    return you > them ? "you" : "them";
  },
};
