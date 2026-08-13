import { instance } from "@viz-js/viz";
import { fromHtml } from "hast-util-from-html";

const INDENT_WIDTH = 2;
const viz = instance();

function treeError(message, line) {
  return new Error(`${message} at line ${line}.`);
}

function splitDetails(input, line) {
  let quote = null;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && quote) {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "#" && index > 0 && /\s/.test(input[index - 1])) {
      const details = input.slice(index + 1).trim();
      if (!details) throw treeError("Node details cannot be empty", line);
      return { definition: input.slice(0, index).trimEnd(), details };
    }
  }

  if (quote) throw treeError("Unclosed quoted node name", line);
  return { definition: input, details: null };
}

function explicitType(definition, line) {
  let marker = -1;
  let quote = null;
  let escaped = false;

  for (let index = 0; index < definition.length - 1; index += 1) {
    const char = definition[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && quote) {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === " " && definition[index + 1] === "{") marker = index;
  }

  if (marker === -1) return null;

  if (!definition.endsWith("}")) {
    throw treeError("Unclosed explicit node type", line);
  }

  const name = definition.slice(0, marker).trim();
  const type = definition.slice(marker + 2, -1).trim();

  if (!name) throw treeError("Node name cannot be empty", line);
  if (!type || type.includes("{") || type.includes("}")) {
    throw treeError("Invalid explicit node type", line);
  }

  return { name, type };
}

function inferNode(definition, line) {
  if (!definition) throw treeError("Node name cannot be empty", line);

  const explicit = explicitType(definition, line);
  if (explicit) return explicit;

  if (definition.endsWith("()")) {
    const name = definition.slice(0, -2).trim();
    if (!name) throw treeError("Call name cannot be empty", line);
    return { name, type: "call" };
  }

  if (definition.endsWith(":")) {
    const name = definition.slice(0, -1).trim();
    if (!name) throw treeError("Block clause name cannot be empty", line);
    return { name, type: "block clause" };
  }

  if (/^"(?:[^"\\]|\\.)*"$/.test(definition)) {
    return { name: definition, type: "string literal" };
  }

  if (/^(?:~c"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/.test(definition)) {
    return { name: definition, type: "charlist literal" };
  }

  if (/^:[^\s]+$/.test(definition) || /^(?:true|false|nil)$/.test(definition)) {
    return { name: definition, type: "atom literal" };
  }

  if (/^[+-]?\d(?:_?\d)*$/.test(definition)) {
    return { name: definition, type: "integer literal" };
  }

  if (/^[+-]?(?:\d(?:_?\d)*)?\.\d(?:_?\d)*(?:e[+-]?\d+)?$/i.test(definition)) {
    return { name: definition, type: "float literal" };
  }

  if (definition === "[]") return { name: definition, type: "list literal" };
  if (definition === "{}") return { name: definition, type: "tuple literal" };
  if (definition === "%{}") return { name: definition, type: "map literal" };
  if (definition === "<<>>")
    return { name: definition, type: "bitstring literal" };

  if (/^%[A-Z]\w*(?:\.[A-Z]\w*)*\{\}$/.test(definition)) {
    return { name: definition, type: "struct literal" };
  }

  if (/^[A-Z]\w*(?:\.[A-Z]\w*)*$/.test(definition)) {
    return { name: definition, type: "alias" };
  }

  return { name: definition, type: "variable" };
}

function parseLine(content, line) {
  const { definition, details } = splitDetails(content, line);
  return { ...inferNode(definition, line), details, children: [] };
}

export function parseElixirTree(source) {
  const roots = [];
  const parents = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = index + 1;

    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (raw.includes("\t")) throw treeError("Tabs are not supported", line);

    const indent = raw.match(/^ */)[0].length;
    if (indent % INDENT_WIDTH !== 0) {
      throw treeError(
        "Indentation must use exactly two spaces per level",
        line,
      );
    }

    const depth = indent / INDENT_WIDTH;
    if (depth > parents.length) {
      throw treeError("Indentation cannot skip a level", line);
    }

    const node = parseLine(raw.slice(indent).trimEnd(), line);

    if (depth === 0) {
      roots.push(node);
    } else {
      const parent = parents[depth - 1];
      if (!parent) throw treeError("Node has no parent", line);
      parent.children.push(node);
    }

    parents[depth] = node;
    parents.length = depth + 1;
  }

  if (roots.length === 0)
    throw new Error("Elixir tree must contain a root node.");
  if (roots.length > 1)
    throw new Error("Elixir tree must contain exactly one root node.");
  return roots[0];
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function graphSource(root) {
  const nodes = new Map();
  const statements = [];

  function visit(node, parentId = null) {
    const id = `n${nodes.size}`;
    nodes.set(id, node);

    const label = [
      '<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="2"><TR>',
      '<TD ALIGN="LEFT">',
      `<FONT FACE="Courier" COLOR="#e5e6e6"><B>${escapeHtml(node.name)}</B></FONT>`,
      "</TD>",
      '<TD ALIGN="LEFT">',
      `<FONT FACE="Courier" POINT-SIZE="10" COLOR="#c084fc">${escapeHtml(node.type)}</FONT>`,
      "</TD></TR></TABLE>>",
    ].join("");

    statements.push(`${id} [label=${label}]`);
    if (parentId) statements.push(`${parentId} -> ${id}`);
    for (const child of node.children) visit(child, id);
  }

  visit(root);

  return {
    nodes,
    dot: `digraph {
      graph [rankdir=TB bgcolor="transparent" pad=0.1 nodesep=0.2 ranksep=0.3 splines=ortho ordering=out]
      node [shape=plain]
      edge [color="#818e95" penwidth=1 arrowhead=none]
      ${statements.join("\n")}
    }`,
  };
}

function hasClass(node, className) {
  const classes = node.properties?.className;
  return Array.isArray(classes)
    ? classes.includes(className)
    : typeof classes === "string" && classes.split(/\s+/).includes(className);
}

function elements(node, predicate, matches = []) {
  if (node.type === "element" && predicate(node)) matches.push(node);
  for (const child of node.children || []) elements(child, predicate, matches);
  return matches;
}

function svgTree(svg, nodes) {
  const parsed = fromHtml(svg, { fragment: true });
  const svgElement = elements(parsed, (node) => node.tagName === "svg")[0];
  if (!svgElement) throw new Error("Graphviz did not return an SVG element.");

  svgElement.properties.className = ["elixir-tree__svg"];
  svgElement.properties.role = "img";
  svgElement.properties["aria-label"] = "Elixir tree diagram";

  const renderedNodes = elements(svgElement, (node) => hasClass(node, "node"));
  for (const rendered of renderedNodes) {
    const title = rendered.children.find((child) => child.tagName === "title");
    const id = title?.children[0]?.value;
    const source = nodes.get(id);
    if (!source) continue;

    if (title) {
      title.children = [
        {
          type: "text",
          value: source.details || `${source.name}, ${source.type}`,
        },
      ];
    }

    if (source.details) {
      rendered.properties.tabIndex = 0;
      rendered.properties["aria-label"] =
        `${source.name}, ${source.type}. ${source.details}`;
    }
  }

  return svgElement;
}

export async function renderElixirTree(source) {
  const { dot, nodes } = graphSource(parseElixirTree(source));
  const graphviz = await viz;
  const svg = graphviz.renderString(dot, { format: "svg", engine: "dot" });
  return svgTree(svg, nodes);
}

async function visitCodeBlocks(node, file) {
  if (!Array.isArray(node.children)) return;

  for (const child of node.children) {
    if (child.type === "code" && child.lang === "elixir-tree") {
      try {
        const rendered = await renderElixirTree(child.value);
        child.type = "elixirTree";
        child.data = {
          hName: "figure",
          hProperties: {
            className: ["elixir-tree"],
            "aria-label": "Elixir tree diagram",
          },
          hChildren: [rendered],
        };
      } catch (error) {
        const path = file?.path || "Markdown";
        const line = child.position?.start?.line;
        const location = line ? `${path}:${line}` : path;
        throw new Error(`${location}: ${error.message}`);
      }
    } else {
      await visitCodeBlocks(child, file);
    }
  }
}

export function remarkElixirTree() {
  return async (tree, file) => visitCodeBlocks(tree, file);
}
