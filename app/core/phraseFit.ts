// Phrase fitting: candidate endings for one-line labels that never clip a word
export const PhraseFit = {
  candidates(text: string): string[] {
    const clean = text
      .split(/\s+/)
      .filter((s) => s.length > 0)
      .join(" ");
    if (clean.length === 0) return [];

    const body = clean.startsWith("…") ? clean.slice(1) : clean;
    const result: string[] = [clean];

    const chars = Array.from(body);
    for (let index = 0; index < chars.length - 1; index++) {
      if (".!?…".includes(chars[index]) && chars[index + 1] === " " && index + 2 < chars.length) {
        result.push(chars.slice(index + 2).join(""));
      }
    }

    let words = body.split(" ");
    while (words.length > 1) {
      words.shift();
      result.push("…" + words.join(" "));
    }

    const seen = new Set<string>();
    return result.filter((s) => {
      const isNew = !seen.has(s);
      if (isNew) seen.add(s);
      return isNew;
    });
  },
};
