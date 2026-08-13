import { describe, expect, test } from "bun:test";
import { parseElixirTree } from "./elixir-tree.js";

function labels(node) {
  return [`${node.name}{${node.type}}`, ...node.children.flatMap(labels)];
}

const fixtures = [
  {
    name: "function with rescue",
    source: `def()
  foo()
    a
    b
  do:
    +()
      a
      b
  rescue:
    raise()
      "crashed"`,
    expected: [
      "def{call}",
      "foo{call}",
      "a{variable}",
      "do{block clause}",
      "+{call}",
      "rescue{block clause}",
      "raise{call}",
      `"crashed"{string literal}`,
    ],
  },
  {
    name: "case clauses with editorial node types",
    source: `case()
  value
  do:
    -> {clause}
      {:ok, value} {tuple pattern}
      value
    -> {clause}
      _ {wildcard pattern}
      nil`,
    expected: [
      "case{call}",
      "value{variable}",
      "do{block clause}",
      "->{clause}",
      "{:ok, value}{tuple pattern}",
      "_{wildcard pattern}",
      "nil{atom literal}",
    ],
  },
  {
    name: "pipeline and remote calls",
    source: `|>()
  entries
  Enum.map()
    &Entry.to_string/1 {function capture}`,
    expected: [
      "|>{call}",
      "entries{variable}",
      "Enum.map{call}",
      "&Entry.to_string/1{function capture}",
    ],
  },
];

describe("Elixir tree authoring evals", () => {
  for (const fixture of fixtures) {
    test(fixture.name, () => {
      const actual = labels(parseElixirTree(fixture.source));

      for (const expected of fixture.expected) {
        expect(actual).toContain(expected);
      }
    });
  }
});
