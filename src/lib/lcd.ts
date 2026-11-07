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

/** Polygon points for each segment, in a 20 by 40 cell. */
export const SEGMENT_SHAPES: Record<string, string> = {
  a: "3,1 4,0 16,0 17,1 14,3 6,3",
  b: "18,2 19,3 19,17 17.5,19 16,17 16,5",
  c: "17.5,21 19,23 19,37 18,38 16,35 16,23",
  d: "6,37 14,37 17,39 16,40 4,40 3,39",
  e: "2,38 1,37 1,23 2.5,21 4,23 4,35",
  f: "1,3 2,2 4,5 4,17 2.5,19 1,17",
  g: "3.5,20 5,18.5 9,18.5 9.5,20 9,21.5 5,21.5",
  G: "16.5,20 15,18.5 11,18.5 10.5,20 11,21.5 15,21.5",
  h: "5,5 7,5 8.5,12 8.5,17 7,17 5,10",
  i: "9,5 10,4 11,5 11,17 10,18 9,17",
  j: "15,5 13,5 11.5,12 11.5,17 13,17 15,10",
  k: "5,35 7,35 8.5,28 8.5,23 7,23 5,30",
  l: "9,23 10,22 11,23 11,35 10,36 9,35",
  m: "15,35 13,35 11.5,28 11.5,23 13,23 15,30",
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
