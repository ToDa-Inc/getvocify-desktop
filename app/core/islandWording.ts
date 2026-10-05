// Island wording: states and decisions
export const LostAudio = {
  opensIsland(was: boolean, now: boolean, recording: boolean, open: boolean): boolean {
    return !was && now && recording && !open;
  },
};
