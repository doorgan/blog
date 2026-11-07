import type { ElementContent, RootContent, Text } from "hast";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";

const URL_ATTRIBUTES = ["href", "src"];

function text(value: string): Text {
  return { type: "text", value };
}

function hasClass(node: RootContent, name: string) {
  if (node.type !== "element") return false;

  const classes = node.properties.className;
  return Array.isArray(classes) && classes.includes(name);
}

function adaptForFeed(node: RootContent, base: string): RootContent[] {
  if (node.type === "comment" || node.type === "doctype") return [];
  if (node.type !== "element") return [node];

  if (["script", "style"].includes(node.tagName)) return [];
  if (hasClass(node, "annotation-ref")) return [];

  const children = node.children.flatMap((child) =>
    adaptForFeed(child, base),
  ) as ElementContent[];

  if (node.tagName === "astro-island") return children;
  if (hasClass(node, "annotation-note")) {
    return [text(" ("), ...children, text(")")];
  }

  const properties = { ...node.properties };
  for (const name of URL_ATTRIBUTES) {
    const value = properties[name];
    if (typeof value === "string") {
      properties[name] = new URL(value, base).href;
    }
  }

  return [{ ...node, properties, children }];
}

/** Turns a rendered post into HTML that reads well outside the site. */
export function feedHtml(html: string, postUrl: string) {
  const tree = fromHtml(html, { fragment: true });

  return toHtml({
    ...tree,
    children: tree.children.flatMap((node) => adaptForFeed(node, postUrl)),
  });
}
