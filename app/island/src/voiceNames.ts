import type { IslandAction, VoiceChoice } from "./types.ts";

/** A voice nobody has named yet ("Voice 2", "Voz 2"): not a person to offer. */
const UNNAMED = /^(Voice|Voz) \d+$/;

/** The names to offer: the meeting's people, then names given to voices that are not among them. */
export function voiceNames(menu: { voices: VoiceChoice[]; people: string[] }): string[] {
  const given = menu.voices.map((voice) => voice.label).filter((label) => !UNNAMED.test(label));
  const seen = new Set<string>();
  return [...menu.people, ...given].filter((name) => {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What picking `name` for `voice` does: the same person as the voice that already has it, else this voice's name. */
export function pickName(menu: { voices: VoiceChoice[] }, voice: number, name: string): IslandAction | null {
  const key = name.trim().toLowerCase();
  const current = menu.voices.find((other) => other.id === voice);
  if (current && current.label.trim().toLowerCase() === key) return null;
  const owner = menu.voices.find((other) => other.id !== voice && other.label.trim().toLowerCase() === key);
  return owner ? { name: "voice", op: "merge", keep: owner.id, drop: voice } : { name: "voice", op: "rename", voice, text: name.trim() };
}
