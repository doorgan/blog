const HEADINGS = new Set(["h2", "h3", "h4", "h5", "h6"]);

export function rehypeHeadingLinks() {
  function visit(node) {
    for (const child of node.children ?? []) {
      if (HEADINGS.has(child.tagName) && child.properties?.id) {
        child.children = [
          {
            type: "element",
            tagName: "a",
            properties: {
              className: ["heading-link"],
              href: `#${child.properties.id}`,
            },
            children: child.children,
          },
        ];
      } else {
        visit(child);
      }
    }
  }

  return visit;
}
