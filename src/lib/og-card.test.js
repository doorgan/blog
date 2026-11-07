import { describe, expect, test } from "bun:test";
import { cardSvg, fitTitle, wrapText } from "./og-card";

describe("wrapText", () => {
  test("breaks on word boundaries", () => {
    expect(wrapText("one two three", 7)).toEqual(["one two", "three"]);
  });

  test("gives up on words wider than a line", () => {
    expect(wrapText("incomprehensibilities", 5)).toBeNull();
  });
});

describe("fitTitle", () => {
  test("keeps short titles large", () => {
    expect(fitTitle("Erlang servers")).toEqual({
      size: 88,
      lines: ["ERLANG SERVERS"],
    });
  });

  test("shrinks long titles to fit", () => {
    const { size, lines } = fitTitle(
      "A deep dive into the Elixir AST: Building a typed struct macro from the ground up",
    );

    expect(size).toBeLessThan(88);
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  test("truncates titles that never fit", () => {
    const { lines } = fitTitle("word ".repeat(100));

    expect(lines).toHaveLength(3);
    expect(lines[2].endsWith("…")).toBe(true);
  });
});

describe("cardSvg", () => {
  test("escapes markup in titles and tags", () => {
    const svg = cardSvg({
      title: "A <b> & c",
      date: new Date("2026-11-06"),
      tags: ["x&y"],
    });

    expect(svg).toContain("A &lt;B&gt; &amp; C");
    expect(svg).toContain("X&amp;Y");
  });
});
