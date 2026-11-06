import { describe, expect, test } from "bun:test";
import {
  createMarkedCodeTransformer,
  markedCodeFence,
  parseMarkedCode,
} from "./marked-code.js";

describe("parseMarkedCode", () => {
  test("removes markers and records exclusive positions", () => {
    const source = `defmodule Foo do
  def bar, do:  «:ok»
end`;

    expect(parseMarkedCode(source)).toEqual({
      code: `defmodule Foo do
  def bar, do:  :ok
end`,
      ranges: [
        {
          start: { line: 2, column: 17 },
          end: { line: 2, column: 20 },
          startOffset: 33,
          endOffset: 36,
        },
      ],
    });
  });

  test("supports multiple marked ranges", () => {
    expect(parseMarkedCode("«one» two «three»")).toEqual({
      code: "one two three",
      ranges: [
        {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 4 },
          startOffset: 0,
          endOffset: 3,
        },
        {
          start: { line: 1, column: 9 },
          end: { line: 1, column: 14 },
          startOffset: 8,
          endOffset: 13,
        },
      ],
    });
  });

  test("normalizes CRLF line endings", () => {
    expect(parseMarkedCode("one\r\n«two»")).toEqual({
      code: "one\ntwo",
      ranges: [
        {
          start: { line: 2, column: 1 },
          end: { line: 2, column: 4 },
          startOffset: 4,
          endOffset: 7,
        },
      ],
    });
  });

  test("rejects nested markers", () => {
    expect(() => parseMarkedCode("«one «two»»")).toThrow(
      "Nested code markers are not supported at 1:5.",
    );
  });

  test("rejects unmatched closing markers", () => {
    expect(() => parseMarkedCode("one»")).toThrow(
      "Closing code marker has no matching opening marker at 1:4.",
    );
  });

  test("rejects unclosed opening markers", () => {
    expect(() => parseMarkedCode("one «two")).toThrow(
      "Opening code marker has no matching closing marker at 1:5.",
    );
  });

  test("supports empty ranges", () => {
    expect(parseMarkedCode("one «»two")).toEqual({
      code: "one two",
      ranges: [
        {
          start: { line: 1, column: 5 },
          end: { line: 1, column: 5 },
          startOffset: 4,
          endOffset: 4,
        },
      ],
    });
  });
});

describe("createMarkedCodeTransformer", () => {
  test("splits tokens at marker boundaries and annotates the range", () => {
    const { ranges } = parseMarkedCode("ab«cd»ef");
    const transformer = createMarkedCodeTransformer(ranges);
    const tokens = transformer.tokens([
      [{ content: "abcdef", offset: 0, color: "#fff" }],
    ]);

    expect(tokens).toEqual([
      [
        { content: "ab", offset: 0, color: "#fff", htmlAttrs: undefined },
        {
          content: "cd",
          offset: 2,
          color: "#fff",
          htmlAttrs: {
            class:
              "marked-code__token marked-code__token--start marked-code__token--end",
            "data-marker-start": "1:3",
            "data-marker-end": "1:5",
          },
        },
        { content: "ef", offset: 4, color: "#fff", htmlAttrs: undefined },
      ],
    ]);
  });

  test("uses a compact marker for one-character ranges", () => {
    const { ranges } = parseMarkedCode("ab«c»d");
    const transformer = createMarkedCodeTransformer(ranges);
    const tokens = transformer.tokens([
      [{ content: "abcd", offset: 0, color: "#fff" }],
    ]);

    expect(tokens).toEqual([
      [
        { content: "ab", offset: 0, color: "#fff", htmlAttrs: undefined },
        {
          content: "c",
          offset: 2,
          color: "#fff",
          htmlAttrs: {
            class: "marked-code__token marked-code__token--compact",
            "data-marker-range": "1:3-1:4",
          },
        },
        { content: "d", offset: 3, color: "#fff", htmlAttrs: undefined },
      ],
    ]);
  });

  test("inserts a single point marker for empty ranges", () => {
    const { ranges } = parseMarkedCode("ab«»cd");
    const transformer = createMarkedCodeTransformer(ranges);
    const line = {
      properties: { class: "line" },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: { style: "color:#fff" },
          children: [{ type: "text", value: "abcd" }],
        },
      ],
    };

    transformer.line(line, 1);

    expect(line).toEqual({
      properties: {
        class: "line marked-code__line marked-code__line--marked",
        "data-line-number": "1",
      },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: { style: "color:#fff" },
          children: [{ type: "text", value: "ab" }],
        },
        {
          type: "element",
          tagName: "span",
          properties: {
            class: "marked-code__point",
            "data-marker-point": "1:3",
          },
          children: [],
        },
        {
          type: "element",
          tagName: "span",
          properties: { style: "color:#fff" },
          children: [{ type: "text", value: "cd" }],
        },
      ],
    });
  });

  test("adds marked code classes without duplicating class attributes", () => {
    const { ranges } = parseMarkedCode("one\n«two»");
    const transformer = createMarkedCodeTransformer(ranges);
    const pre = { properties: { class: "astro-code github-dark" } };
    const code = {
      properties: {},
      children: [
        { type: "element", tagName: "span", children: [] },
        { type: "text", value: "\n" },
        { type: "element", tagName: "span", children: [] },
      ],
    };
    const unmarkedLine = { properties: { class: "line" } };
    const markedLine = { properties: { class: "line" } };

    transformer.pre(pre);
    transformer.code(code);
    transformer.line(unmarkedLine, 1);
    transformer.line(markedLine, 2);

    expect(pre).toEqual({
      properties: { class: "astro-code github-dark marked-code" },
    });
    expect(code).toEqual({
      properties: { class: "marked-code__code" },
      children: [
        { type: "element", tagName: "span", children: [] },
        { type: "element", tagName: "span", children: [] },
      ],
    });
    expect(unmarkedLine).toEqual({
      properties: {
        class: "line marked-code__line",
        "data-line-number": "1",
      },
    });
    expect(markedLine).toEqual({
      properties: {
        class: "line marked-code__line marked-code__line--marked",
        "data-line-number": "2",
      },
    });
  });
});

describe("markedCodeFence", () => {
  const run = (code, raw) => {
    const context = { meta: {} };
    const output = markedCodeFence().preprocess.call(context, code, {
      meta: { __raw: raw },
    });
    return { context, output };
  };

  test("leaves unmarked fences alone, even if they contain marker characters", () => {
    const { context, output } = run("«keep»", undefined);

    expect(output).toBeUndefined();
    expect(context.meta.markedCode).toBeUndefined();
  });

  test("marks inline ranges with the marks flag", () => {
    const { context, output } = run("a «b» c", "marks");

    expect(output).toBe("a b c");
    expect(context.meta.markedCode).toBeDefined();
  });

  test("marks the first match of mark=", () => {
    const { context, output } = run("foo foo", 'mark="foo"');

    expect(output).toBe("foo foo");
    expect(context.meta.markedCode).toBeDefined();
  });

  test("fails loudly when mark= does not match", () => {
    expect(() => run("foo", 'mark="bar"')).toThrow(
      'mark="bar" does not appear in this code block.',
    );
  });
});
