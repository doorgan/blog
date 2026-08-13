import { describe, expect, test } from "bun:test";
import { parseReadout, tagColor } from "./lcd";

describe("parseReadout", () => {
  test("maps characters to segments and attaches dots to the previous one", () => {
    expect(parseReadout("1.7")).toEqual([
      { segments: "bc", dot: true },
      { segments: "abc", dot: false },
    ]);
  });

  test("shows every letter", () => {
    expect(parseReadout("abcdefghijklmnopqrstuvwxyz")).toHaveLength(26);
  });

  test("rejects characters the display can't show", () => {
    expect(() => parseReadout("@")).toThrow(`"@" can't be shown on the display.`);
  });
});

describe("tagColor", () => {
  test("gives a tag the same color every time", () => {
    expect(tagColor("elixir")).toBe(tagColor("elixir"));
  });

  test("spreads tags across the palette", () => {
    const colors = ["elixir", "ast", "macros", "sourceror", "refactoring"].map(
      tagColor,
    );

    expect(new Set(colors).size).toBeGreaterThan(1);
  });
});
