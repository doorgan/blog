import { compile } from "@mdx-js/mdx";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import { describe, expect, test } from "bun:test";
import {
  parseElixirTree,
  remarkElixirTree,
  renderElixirTree,
} from "./elixir-tree.js";

function outline(node, depth = 0) {
  return [
    `${"  ".repeat(depth)}${node.name}{${node.type}}`,
    ...node.children.flatMap((child) => outline(child, depth + 1)),
  ];
}

function elements(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...(node.children || []).flatMap(elements)];
}

function elementText(node) {
  if (node.type === "text") return node.value;
  return (node.children || []).map(elementText).join("");
}

function graphNodeNamed(nodes, name) {
  return nodes.find((node) =>
    elements(node).some(
      (child) => child.tagName === "text" && elementText(child) === name,
    ),
  );
}

describe("parseElixirTree", () => {
  test("infers an Elixir-oriented tree and strips authoring markers", () => {
    const root = parseElixirTree(`def() # line: 1, arity: 2
  foo()
    a
    b
  do:
    +()
      a
      b
  rescue:
    raise()
      "crashed"`);

    expect(outline(root)).toEqual([
      "def{call}",
      "  foo{call}",
      "    a{variable}",
      "    b{variable}",
      "  do{block clause}",
      "    +{call}",
      "      a{variable}",
      "      b{variable}",
      "  rescue{block clause}",
      "    raise{call}",
      `      "crashed"{string literal}`,
    ]);
    expect(root.details).toBe("line: 1, arity: 2");
    expect(root.children[0].details).toBeNull();
  });

  test("infers literals, aliases, remote calls, and explicit types", () => {
    const root = parseElixirTree(`root {example}
  :ok
  true
  42
  -1.5e2
  "text"
  ~c"chars"
  []
  {}
  %{}
  <<>>
  %User{}
  Foo.Bar
  Enum.map()
  pattern {tuple pattern}`);

    expect(outline(root)).toEqual([
      "root{example}",
      "  :ok{atom literal}",
      "  true{atom literal}",
      "  42{integer literal}",
      "  -1.5e2{float literal}",
      `  "text"{string literal}`,
      `  ~c"chars"{charlist literal}`,
      "  []{list literal}",
      "  {}{tuple literal}",
      "  %{}{map literal}",
      "  <<>>{bitstring literal}",
      "  %User{}{struct literal}",
      "  Foo.Bar{alias}",
      "  Enum.map{call}",
      "  pattern{tuple pattern}",
    ]);
  });

  test("allows hashes inside quotes and ignores comments and blank lines", () => {
    const root = parseElixirTree(`# explanation

"value #1" # shown on hover
  # child explanation
  child`);

    expect(root).toMatchObject({
      name: `"value #1"`,
      type: "string literal",
      details: "shown on hover",
      children: [{ name: "child", type: "variable" }],
    });
  });

  test("does not treat braces inside quoted names as explicit types", () => {
    expect(parseElixirTree(`"value {raw}"`)).toMatchObject({
      name: `"value {raw}"`,
      type: "string literal",
    });
  });

  test.each([
    ["root\n\tchild", "Tabs are not supported at line 2."],
    [
      "root\n child",
      "Indentation must use exactly two spaces per level at line 2.",
    ],
    ["root\n    child", "Indentation cannot skip a level at line 2."],
    ["root\nother", "Elixir tree must contain exactly one root node."],
    ["# only a comment", "Elixir tree must contain a root node."],
    [`"unclosed`, "Unclosed quoted node name at line 1."],
    ["root #", "Node details cannot be empty at line 1."],
    ["root {type", "Unclosed explicit node type at line 1."],
    ["root {}", "Invalid explicit node type at line 1."],
  ])("rejects malformed trees", (source, message) => {
    expect(() => parseElixirTree(source)).toThrow(message);
  });
});

describe("renderElixirTree", () => {
  test("renders a Graphviz SVG and only focuses nodes with details", async () => {
    const tree = await renderElixirTree(`root() # root details
  child`);
    const nodes = elements(tree);
    const renderedNodes = nodes.filter((node) =>
      node.properties?.className?.includes("node"),
    );

    expect(tree).toMatchObject({
      type: "element",
      tagName: "svg",
      properties: {
        className: ["elixir-tree__svg"],
        "aria-label": "Elixir tree diagram",
      },
    });
    expect(nodes.some((node) => node.tagName === "script")).toBe(false);
    expect(renderedNodes[0].properties).toMatchObject({
      tabIndex: 0,
      "aria-label": "root, call. root details",
    });
    expect(renderedNodes[1].properties.tabIndex).toBeUndefined();
    expect(
      renderedNodes[0].children.find((child) => child.tagName === "title")
        .children[0].value,
    ).toBe("root details");
    expect(
      renderedNodes[1].children.find((child) => child.tagName === "title")
        .children[0].value,
    ).toBe("child, variable");
    expect(nodes.filter((node) => node.tagName === "path")).toHaveLength(1);
  });

  test("keeps details attached when Graphviz reorders a branching tree", async () => {
    const tree = await renderElixirTree(`root()
  left # left details
  right
    deep # deep details`);
    const renderedNodes = elements(tree).filter((node) =>
      node.properties?.className?.includes("node"),
    );
    const left = graphNodeNamed(renderedNodes, "left");
    const deep = graphNodeNamed(renderedNodes, "deep");
    const right = graphNodeNamed(renderedNodes, "right");

    expect(left.properties).toMatchObject({
      tabIndex: 0,
      "aria-label": "left, variable. left details",
    });
    expect(deep.properties).toMatchObject({
      tabIndex: 0,
      "aria-label": "deep, variable. deep details",
    });
    expect(right.properties.tabIndex).toBeUndefined();
    expect(
      left.children.find((child) => child.tagName === "title").children[0]
        .value,
    ).toBe("left details");
    expect(
      deep.children.find((child) => child.tagName === "title").children[0]
        .value,
    ).toBe("deep details");
  });
});

describe("remarkElixirTree", () => {
  test("renders through Astro's Markdown pipeline", async () => {
    const processor = await createMarkdownProcessor({
      remarkPlugins: [remarkElixirTree],
      syntaxHighlight: "shiki",
    });
    const result = await processor.render(
      "```elixir-tree\nroot()\n  child\n```",
    );

    expect(result.code).toContain(
      '<figure class="elixir-tree" aria-label="Elixir tree diagram">',
    );
    expect(result.code).toContain(">call<");
    expect(result.code).not.toContain("{call}");
    expect(result.code).toContain("<svg");
    expect(result.code).not.toContain("<pre");
    expect(result.code).not.toContain("<script");
  });

  test("renders through the MDX pipeline", async () => {
    const result = String(
      await compile("```elixir-tree\nroot()\n  child\n```", {
        remarkPlugins: [remarkElixirTree],
      }),
    );

    expect(result).toContain('className: "elixir-tree"');
    expect(result).toContain('className: "elixir-tree__svg"');
    expect(result).not.toContain("language-elixir-tree");
  });

  test("replaces only elixir-tree code blocks", async () => {
    const tree = {
      type: "root",
      children: [
        { type: "code", lang: "elixir", value: "1 + 2" },
        { type: "code", lang: "elixir-tree", value: "root()" },
      ],
    };

    await remarkElixirTree()(tree, { path: "/post.md" });

    expect(tree.children[0].data).toBeUndefined();
    expect(tree.children[1].data).toMatchObject({
      hName: "figure",
      hProperties: { className: ["elixir-tree"] },
    });
  });

  test("adds the post and fence line to syntax errors", async () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "code",
          lang: "elixir-tree",
          value: "root\n child",
          position: { start: { line: 42 } },
        },
      ],
    };

    await expect(
      remarkElixirTree()(tree, { path: "/post.md" }),
    ).rejects.toThrow(
      "/post.md:42: Indentation must use exactly two spaces per level at line 2.",
    );
  });
});
