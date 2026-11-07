import { Resvg } from "@resvg/resvg-js";
import { parseReadout, SEGMENT_SHAPES, tagColor } from "./lcd";

const WIDTH = 1200;
const HEIGHT = 630;
const MARGIN = 72;
const TITLE_WIDTH = WIDTH - MARGIN * 2;
const CHAR_WIDTH = 0.51;
const TITLE_SIZES = [88, 72, 60, 48];
const MAX_LINES = 3;
const TAG_SIZE = 26;
const MAX_TAGS = 3;

interface Card {
  title: string;
  date?: Date;
  tags: string[];
}

function escapeXml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Breaks text into lines of at most `width` monospace characters. */
export function wrapText(text: string, width: number) {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(/\s+/)) {
    if (word.length > width) return null;

    const next = line ? `${line} ${word}` : word;
    if (next.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }

  return [...lines, line];
}

/** Picks the largest title size that fits, truncating if none does. */
export function fitTitle(title: string) {
  const text = title.toUpperCase();

  for (const size of TITLE_SIZES) {
    const width = Math.floor(TITLE_WIDTH / (size * CHAR_WIDTH));
    const lines = wrapText(text, width);
    if (lines && lines.length <= MAX_LINES) return { size, lines };
  }

  const size = TITLE_SIZES[TITLE_SIZES.length - 1];
  const width = Math.floor(TITLE_WIDTH / (size * CHAR_WIDTH));
  const lines = text
    .slice(0, width * MAX_LINES - 1)
    .match(new RegExp(`.{1,${width}}`, "g")) as string[];
  lines[lines.length - 1] = `${lines[lines.length - 1]}…`;

  return { size, lines };
}

function readout(date: Date) {
  const text = date.toISOString().slice(2, 10).replaceAll("-", ".");
  const cells = parseReadout(text);
  const scale = 1.6;
  const x = WIDTH - MARGIN - cells.length * 25 * scale;

  const layers = cells.map((cell, index) => {
    const position = `transform="translate(${index * 25} 0)"`;
    const shapes = Object.entries(SEGMENT_SHAPES);
    const polygons = (fill: string, lit: boolean) =>
      shapes
        .filter(([name]) => cell.segments.includes(name) === lit)
        .map(([, points]) => `<polygon points="${points}" fill="${fill}"/>`)
        .join("");
    const dot = cell.dot
      ? `<rect x="20.5" y="36.5" width="3.5" height="3.5" fill="#d9ecff"/>`
      : "";

    return {
      off: `<g ${position}>${polygons("#141c27", false)}</g>`,
      on: `<g ${position}>${polygons("#d9ecff", true)}${dot}</g>`,
    };
  });

  return `<g transform="translate(${x} ${MARGIN - 8}) scale(${scale})">
    ${layers.map((layer) => layer.off).join("")}
    <g filter="url(#glow)">${layers.map((layer) => layer.on).join("")}</g>
  </g>`;
}

function tagTiles(tags: string[]) {
  let x = MARGIN;
  const y = HEIGHT - MARGIN - 48;

  return tags
    .slice(0, MAX_TAGS)
    .map((tag) => {
      const text = tag.toUpperCase();
      const width = text.length * TAG_SIZE * CHAR_WIDTH + 36;
      const tile = `
        <rect x="${x + 6}" y="${y + 6}" width="${width}" height="48" fill="${tagColor(tag)}"/>
        <rect x="${x}" y="${y}" width="${width}" height="48" fill="#f1f2f2"/>
        <text x="${x + 18}" y="${y + 33}" font-size="${TAG_SIZE}" letter-spacing="0.5" fill="#14141a">${escapeXml(text)}</text>`;
      x += width + 26;
      return tile;
    })
    .join("");
}

/** Draws a post's link preview card as an LCD strip. */
export function cardSvg({ title, date, tags }: Card) {
  const { size, lines } = fitTitle(title);
  const lineHeight = size * 1.15;
  const firstLine = 300 - ((lines.length - 1) * lineHeight) / 2 + size / 3;

  const titleLines = lines
    .map(
      (line, index) =>
        `<text x="${MARGIN}" y="${firstLine + index * lineHeight}" font-size="${size}" fill="#c084fc">${escapeXml(line)}</text>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse">
        <circle cx="7" cy="7" r="2" fill="#15151d"/>
      </pattern>
      <filter id="glow" x="-10%" y="-30%" width="120%" height="160%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feFlood flood-color="#78b9ff" flood-opacity="0.5"/>
        <feComposite in2="blur" operator="in"/>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#000005"/>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#dots)"/>
    <text x="${MARGIN}" y="${MARGIN + 36}" font-size="34" letter-spacing="3" fill="#8a959a">DORGAN</text>
    ${date ? readout(date) : ""}
    ${titleLines}
    ${tagTiles(tags)}
  </svg>`;
}

/** Renders a card to PNG bytes. */
export function renderCard(card: Card) {
  const png = new Resvg(cardSvg(card), {
    font: {
      fontFiles: ["src/styles/fonts/iosevka-800-normal.ttf"],
      defaultFontFamily: "Iosevka",
      loadSystemFonts: false,
    },
  })
    .render()
    .asPng();

  return new Uint8Array(png);
}
