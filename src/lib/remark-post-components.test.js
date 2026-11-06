import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remarkPostComponents } from "./remark-post-components.js";

const dir = mkdtempSync(join(tmpdir(), "post-components-"));
writeFileSync(join(dir, "Used.astro"), "");
writeFileSync(join(dir, "Unused.svelte"), "");

const element = (name) => ({ type: "mdxJsxFlowElement", name, children: [] });
const imports = (tree) =>
  tree.children.filter((node) => node.type === "mdxjsEsm");

describe("remarkPostComponents", () => {
  test("imports only the components a post uses", () => {
    const tree = { children: [{ type: "paragraph", children: [element("Used")] }] };

    remarkPostComponents({ dir })(tree);

    expect(imports(tree).map((node) => node.value)).toEqual([
      `import Used from ${JSON.stringify(join(dir, "Used.astro"))};`,
    ]);
  });

  test("respects a post's own import", () => {
    const own = {
      type: "mdxjsEsm",
      data: {
        estree: { body: [{ specifiers: [{ local: { name: "Used" } }] }] },
      },
    };
    const tree = { children: [own, element("Used")] };

    remarkPostComponents({ dir })(tree);

    expect(imports(tree)).toEqual([own]);
  });
});
