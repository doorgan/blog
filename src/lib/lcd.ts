/**
 * Fourteen-segment characters. a-f are the outer ring, g and G the two halves
 * of the middle bar, i and l the center verticals, and h, j, k, m the diagonals.
 */
const SEGMENTS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abdegG",
  "3": "abcdG",
  "4": "bcfgG",
  "5": "acdfgG",
  "6": "acdefgG",
  "7": "abc",
  "8": "abcdefgG",
  "9": "abcdfgG",
  A: "abcefgG",
  B: "abcdGil",
  C: "adef",
  D: "abcdil",
  E: "adefg",
  F: "aefg",
  G: "acdefG",
  H: "bcefgG",
  I: "adil",
  J: "bcde",
  K: "efgjm",
  L: "def",
  M: "bcefhj",
  N: "bcefhm",
  O: "abcdef",
  P: "abefgG",
  Q: "abcdefm",
  R: "abefgGm",
  S: "acdfgG",
  T: "ail",
  U: "bcdef",
  V: "efjk",
  W: "bcefkm",
  X: "hjkm",
  Y: "hjl",
  Z: "adjk",
  "-": "gG",
  " ": "",
};

export interface Character {
  segments: string;
  dot: boolean;
}

/** Turns text into display characters. A "." lights the previous one's dot. */
export function parseReadout(text: string): Character[] {
  const characters: Character[] = [];

  for (const char of text.toUpperCase()) {
    if (char === "." && characters.length > 0) {
      characters[characters.length - 1].dot = true;
      continue;
    }

    const segments = SEGMENTS[char];
    if (segments === undefined) {
      throw new Error(`"${char}" can't be shown on the display.`);
    }
    characters.push({ segments, dot: false });
  }

  return characters;
}

const TAG_COLORS = ["#ff2d87", "#4f8dff", "#a855f7"];

/** Each tag keeps the same color everywhere it appears. */
export function tagColor(text: string): string {
  let hash = 0;
  for (const char of text) hash = Math.imul(hash, 31) + char.charCodeAt(0);
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}
