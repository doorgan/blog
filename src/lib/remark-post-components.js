import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const COMPONENTS_DIR = fileURLToPath(
  new URL("../components/post/", import.meta.url),
);

function usedElements(node, names = new Set()) {
  if (node.name && node.type.startsWith("mdxJsx")) names.add(node.name);
  for (const child of node.children ?? []) usedElements(child, names);
  return names;
}

function importedNames(tree) {
  return tree.children
    .filter((node) => node.type === "mdxjsEsm")
    .flatMap((node) => node.data?.estree?.body ?? [])
    .flatMap((statement) => statement.specifiers ?? [])
    .map((specifier) => specifier.local.name);
}

function importNode(name, path) {
  return {
    type: "mdxjsEsm",
    value: `import ${name} from ${JSON.stringify(path)};`,
    data: {
      estree: {
        type: "Program",
        sourceType: "module",
        body: [
          {
            type: "ImportDeclaration",
            specifiers: [
              {
                type: "ImportDefaultSpecifier",
                local: { type: "Identifier", name },
              },
            ],
            source: { type: "Literal", value: path },
          },
        ],
      },
    },
  };
}

/**
 * Makes every component in src/components/post available in MDX without an
 * import. These are real imports, so client:* directives work on them, and
 * only the components a post uses end up in its bundle.
 */
export function remarkPostComponents({ dir = COMPONENTS_DIR } = {}) {
  return (tree) => {
    const files = readdirSync(dir).filter((file) =>
      [".astro", ".svelte"].includes(extname(file)),
    );
    const used = usedElements(tree);
    const imported = new Set(importedNames(tree));

    for (const file of files) {
      const name = basename(file, extname(file));
      if (used.has(name) && !imported.has(name)) {
        tree.children.unshift(importNode(name, join(dir, file)));
      }
    }
  };
}
