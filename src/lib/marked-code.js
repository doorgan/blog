const START_MARKER = "«";
const END_MARKER = "»";

function positionLabel(position) {
  return `${position.line}:${position.column}`;
}

function rangeLabel(range) {
  return `${positionLabel(range.start)}-${positionLabel(range.end)}`;
}

function formatPosition(position) {
  return `${position.line}:${position.column}`;
}

function markerError(message, position) {
  return new Error(`${message} at ${formatPosition(position)}.`);
}

function cloneToken(token, content, offset) {
  return {
    ...token,
    content,
    offset,
    htmlAttrs: token.htmlAttrs ? { ...token.htmlAttrs } : undefined,
  };
}

function addClassAttribute(attrs, className) {
  const current = attrs.class ? `${attrs.class} ` : "";
  attrs.class = `${current}${className}`;
}

function addClassToHastElement(element, className) {
  element.properties ||= {};

  const classes = [element.properties.class, element.properties.className]
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      if (typeof value === "string") return value.split(/\s+/);
      return [];
    })
    .filter(Boolean);

  element.properties.class = [...new Set([...classes, className])].join(" ");
  delete element.properties.className;
}

function cloneHastNode(node, children) {
  if (node.type === "text") {
    return { ...node };
  }

  return {
    ...node,
    properties: node.properties ? { ...node.properties } : undefined,
    children,
  };
}

function nodeTextLength(node) {
  if (node.type === "text") {
    return node.value.length;
  }

  if (Array.isArray(node.children)) {
    return node.children.reduce(
      (length, child) => length + nodeTextLength(child),
      0,
    );
  }

  return 0;
}

function splitHastNode(node, offset) {
  if (node.type === "text") {
    const left = node.value.slice(0, offset);
    const right = node.value.slice(offset);

    return [
      left ? [{ ...node, value: left }] : [],
      right ? [{ ...node, value: right }] : [],
    ];
  }

  if (!Array.isArray(node.children)) {
    return offset <= 0
      ? [[], [cloneHastNode(node, [])]]
      : [[cloneHastNode(node, [])], []];
  }

  let remainingOffset = offset;
  const leftChildren = [];
  const rightChildren = [];
  let hasSplit = false;

  for (const child of node.children) {
    if (hasSplit) {
      rightChildren.push(child);
      continue;
    }

    const childLength = nodeTextLength(child);

    if (remainingOffset >= childLength) {
      leftChildren.push(child);
      remainingOffset -= childLength;
      continue;
    }

    const [childLeft, childRight] = splitHastNode(child, remainingOffset);
    leftChildren.push(...childLeft);
    rightChildren.push(...childRight);
    hasSplit = true;
  }

  return [
    leftChildren.length > 0 ? [cloneHastNode(node, leftChildren)] : [],
    rightChildren.length > 0 ? [cloneHastNode(node, rightChildren)] : [],
  ];
}

function createPointMarker(range) {
  return {
    type: "element",
    tagName: "span",
    properties: {
      class: "marked-code__point",
      "data-marker-point": positionLabel(range.start),
    },
    children: [],
  };
}

function insertPointMarker(lineElement, range) {
  const targetOffset = range.start.column - 1;
  const children = lineElement.children ?? [];
  const nextChildren = [];
  let currentOffset = 0;
  let inserted = false;

  for (const child of children) {
    if (inserted) {
      nextChildren.push(child);
      continue;
    }

    const childLength = nodeTextLength(child);
    const nextOffset = currentOffset + childLength;

    if (targetOffset <= nextOffset) {
      const [left, right] = splitHastNode(child, targetOffset - currentOffset);
      nextChildren.push(...left, createPointMarker(range), ...right);
      inserted = true;
    } else {
      nextChildren.push(child);
    }

    currentOffset = nextOffset;
  }

  if (!inserted) {
    nextChildren.push(createPointMarker(range));
  }

  lineElement.children = nextChildren;
}

function isEmptyRange(range) {
  return range.startOffset === range.endOffset;
}

function isCompactRange(range) {
  return range.endOffset - range.startOffset === 1;
}

function findRangeForSegment(ranges, startOffset, endOffset) {
  return ranges.find(
    (range) => startOffset < range.endOffset && endOffset > range.startOffset,
  );
}

function tokenSplitPoints(ranges, startOffset, endOffset) {
  const splitPoints = new Set([0, endOffset - startOffset]);

  for (const range of ranges) {
    if (range.startOffset > startOffset && range.startOffset < endOffset) {
      splitPoints.add(range.startOffset - startOffset);
    }

    if (range.endOffset > startOffset && range.endOffset < endOffset) {
      splitPoints.add(range.endOffset - startOffset);
    }
  }

  return Array.from(splitPoints).sort((left, right) => left - right);
}

function splitToken(token, ranges) {
  const startOffset = token.offset;
  const endOffset = startOffset + token.content.length;
  const splitPoints = tokenSplitPoints(ranges, startOffset, endOffset);
  const segments = [];

  for (let index = 0; index < splitPoints.length - 1; index += 1) {
    const segmentStart = splitPoints[index];
    const segmentEnd = splitPoints[index + 1];

    if (segmentStart === segmentEnd) continue;

    const segment = cloneToken(
      token,
      token.content.slice(segmentStart, segmentEnd),
      startOffset + segmentStart,
    );
    const segmentEndOffset = startOffset + segmentEnd;
    const range = findRangeForSegment(ranges, segment.offset, segmentEndOffset);

    if (range) {
      segment.htmlAttrs ||= {};
      addClassAttribute(segment.htmlAttrs, "marked-code__token");

      if (isCompactRange(range)) {
        addClassAttribute(segment.htmlAttrs, "marked-code__token--compact");
        segment.htmlAttrs["data-marker-range"] = rangeLabel(range);
        segments.push(segment);
        continue;
      }

      if (segment.offset === range.startOffset) {
        addClassAttribute(segment.htmlAttrs, "marked-code__token--start");
        segment.htmlAttrs["data-marker-start"] = positionLabel(range.start);
      }

      if (segmentEndOffset === range.endOffset) {
        addClassAttribute(segment.htmlAttrs, "marked-code__token--end");
        segment.htmlAttrs["data-marker-end"] = positionLabel(range.end);
      }
    }

    segments.push(segment);
  }

  return segments;
}

function lineHasMarkerLabel(ranges, lineNumber) {
  return ranges.some(
    (range) => range.start.line === lineNumber || range.end.line === lineNumber,
  );
}

export function parseMarkedCode(input) {
  const source = input.replace(/\r\n?/g, "\n");
  let code = "";
  let line = 1;
  let column = 1;
  let offset = 0;
  let openRange = null;
  const ranges = [];

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const position = { line, column };

    if (char === START_MARKER) {
      if (openRange) {
        throw markerError("Nested code markers are not supported", position);
      }

      openRange = {
        start: position,
        startOffset: offset,
      };
      continue;
    }

    if (char === END_MARKER) {
      if (!openRange) {
        throw markerError(
          "Closing code marker has no matching opening marker",
          position,
        );
      }

      ranges.push({
        start: openRange.start,
        end: position,
        startOffset: openRange.startOffset,
        endOffset: offset,
      });
      openRange = null;
      continue;
    }

    code += char;
    offset += 1;

    if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  if (openRange) {
    throw markerError(
      "Opening code marker has no matching closing marker",
      openRange.start,
    );
  }

  return { code, ranges };
}

export function createMarkedCodeTransformer(ranges) {
  return {
    name: "marked-code",
    tokens(tokens) {
      return tokens.map((lineTokens) =>
        lineTokens.flatMap((token) => splitToken(token, ranges)),
      );
    },
    pre(element) {
      addClassToHastElement(element, "marked-code");
    },
    code(element) {
      addClassToHastElement(element, "marked-code__code");
      element.children = element.children.filter(
        (child) => child.type !== "text" || child.value.trim() !== "",
      );
    },
    line(element, lineNumber) {
      addClassToHastElement(element, "marked-code__line");

      if (lineHasMarkerLabel(ranges, lineNumber)) {
        addClassToHastElement(element, "marked-code__line--marked");
      }

      for (const range of ranges.filter(
        (range) => isEmptyRange(range) && range.start.line === lineNumber,
      )) {
        insertPointMarker(element, range);
      }

      element.properties ||= {};
      element.properties["data-line-number"] = String(lineNumber);
    },
  };
}

function fenceMarks(rawMeta = "") {
  const needles = [...rawMeta.matchAll(/\bmark="([^"]+)"/g)].map(
    (match) => match[1],
  );
  return { needles, enabled: needles.length > 0 || /\bmarks\b/.test(rawMeta) };
}

function wrapNeedles(code, needles) {
  return needles.reduce((source, needle) => {
    const index = source.indexOf(needle);
    if (index === -1) {
      throw new Error(`mark="${needle}" does not appear in this code block.`);
    }
    const end = index + needle.length;
    return `${source.slice(0, index)}${START_MARKER}${needle}${END_MARKER}${source.slice(end)}`;
  }, code);
}

/**
 * Enables markers from the code fence, for every Markdown and MDX code block:
 *
 *   ```elixir mark="to_string"     marks the first match
 *   ```elixir marks                marks «ranges» written inside the code
 */
export function markedCodeFence() {
  const forBlock = (context) => context.meta.markedCode;

  return {
    name: "marked-code-fence",
    preprocess(code, options) {
      const { needles, enabled } = fenceMarks(options.meta?.__raw);
      if (!enabled) return;

      const parsed = parseMarkedCode(wrapNeedles(code, needles));
      this.meta.markedCode = createMarkedCodeTransformer(parsed.ranges);
      return parsed.code;
    },
    tokens(tokens) {
      return forBlock(this)?.tokens(tokens);
    },
    pre(element) {
      forBlock(this)?.pre(element);
    },
    code(element) {
      forBlock(this)?.code(element);
    },
    line(element, lineNumber) {
      forBlock(this)?.line(element, lineNumber);
    },
  };
}
