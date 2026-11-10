// The band drawn on top of each shot, with sharp: no browser needed.

import sharp from 'sharp';
import { DISC } from './markers.ts';
import { COLORS, ON_SIDE_COLOR, WORDS, type Side } from '../side.ts';
import { escapePango, inkOf, renderText, STRUT } from './text.ts';

/** What a numbered box on a shot means: its disc, the same image as on the page, and what changed. */
export type Key = { disc: Buffer; what: string };

/** What the band says: which side the shot is, the title, which shot of how many, and the key of its
 * numbered boxes (none with labels). */
export type Content = { side: Side; title: string; number: number; total: number; key: Key[] };

/** An image to compose onto the band, and where. */
type Piece = { input: Buffer; left: number; top: number };

// Sizes in CSS pixels, multiplied by the shot's scale.
const FIRST_ROW_HEIGHT = 52; // the side, the title and what the colour means; taller when the title wraps
const PADDING = 16; // between the band's edges and what is in it
const TITLE = { margin: 12, gapToColorKey: 24, minWidth: 120 }; // margin: above and below a title that wraps
const KEY_GAP = 12; // added under the first row when there is a key
const KEY_RAISE = 4; // the key starts this far up into the first row's bottom
const PILL = { height: 26, inset: 10, gapToTitle: 12 }; // inset: between its ends and the side's name
const SWATCH = { size: 16, stroke: 2, radius: 3, gapToMeaning: 6 };
const KEY = { discGap: 6, itemGap: 24, rowGap: 6 }; // itemGap: between one meaning and the next disc

/** Font sizes in points, one point to the CSS pixel. */
const FONT_SIZE = { sideName: 15, title: 18, colorMeaning: 15, key: 14 };

// The band's colours.
const FRAME_LINE = '#d0d7de'; // around the band and the shot
const BACKGROUND = '#f6f8fa';
const TEXT = '#1f2328';
const SHOT_COUNT_TEXT = '#59636e';

/** The shot, a PNG at `scale`, with a band on top: its side, the title, which shot of how many, and
 * what its colour means; under them, when the shot has numbered boxes, what each number means. Text
 * too long for the shot's width wraps, and the band grows to hold it. */
export async function band(shot: Buffer, content: Content, scale: number): Promise<Buffer> {
  const { width: shotWidth = 0, height: shotHeight = 0 } = await sharp(shot).metadata();
  const frame = Math.max(1, Math.round(scale)); // the width of the frame line
  const padding = Math.round(PADDING * scale);
  const colors = await colorKey(content.side, scale);
  const colorsWidth = -Math.min(...colors.map(piece => piece.left));
  const titleRoom = shotWidth - 2 * padding - colorsWidth - Math.round(TITLE.gapToColorKey * scale);
  const head = await heading(content, titleRoom, scale);
  const rowHeight = head.height;
  const key = content.key.length ? await keyPieces(content.key, shotWidth - 2 * padding, scale) : null;
  const bandHeight = rowHeight + (key ? key.height + Math.round(KEY_GAP * scale) : 0);
  const width = shotWidth + 2 * frame;
  const height = frame + bandHeight + frame + shotHeight + frame;
  return sharp({ create: { width, height, channels: 4, background: FRAME_LINE } })
    .composite([
      {
        input: { create: { width: shotWidth, height: bandHeight, channels: 4, background: BACKGROUND } },
        left: frame,
        top: frame,
      },
      ...offset(key?.pieces ?? [], frame + padding, frame + rowHeight - Math.round(KEY_RAISE * scale)),
      ...offset(head.pieces, frame + padding, frame),
      ...offset(colors, width - frame - padding, frame),
      { input: shot, left: frame, top: frame + bandHeight + frame },
    ])
    .png()
    .toBuffer();
}

/** `pieces`, moved by `dx` and `dy`. */
const offset = (pieces: Piece[], dx: number, dy: number) =>
  pieces.map(p => ({ ...p, left: p.left + dx, top: p.top + dy }));

/** The top that centres something `height` high in the band's first row. */
const middleOfRow = (height: number, scale: number) =>
  Math.round((Math.round(FIRST_ROW_HEIGHT * scale) - height) / 2);

/** The band's left: the side's pill, then the title and which shot of how many, wrapped to what is
 * left of `room` after the pill. Returns the pieces, placed from the band's top left corner, and the
 * height of the first row: the usual one, or taller to hold a title that wraps. */
async function heading(
  { side, title, number, total }: Content,
  room: number,
  scale: number,
): Promise<{ pieces: Piece[]; height: number }> {
  const sideName = await renderText(
    `<span foreground="${ON_SIDE_COLOR}">${WORDS[side].name}</span>`,
    FONT_SIZE.sideName,
    'Semi-Bold',
    scale,
  );
  const count =
    total > 1 ? `<span foreground="${SHOT_COUNT_TEXT}" weight="normal">   ${number} of ${total}</span>` : '';
  const pill = {
    width: sideName.info.width + Math.round(2 * PILL.inset * scale),
    height: Math.round(PILL.height * scale),
  };
  const titleLeft = pill.width + Math.round(PILL.gapToTitle * scale);
  const titleText = await renderText(
    `<span foreground="${TEXT}">${escapePango(title)}</span>${count}`,
    FONT_SIZE.title,
    'Semi-Bold',
    scale,
    Math.max(room - titleLeft, Math.round(TITLE.minWidth * scale)),
  );
  const margin = Math.round(TITLE.margin * scale);
  const pillSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pill.width}" height="${pill.height}">
    <rect width="${pill.width}" height="${pill.height}" rx="${pill.height / 2}" fill="${COLORS[side].color}"/></svg>`;
  return {
    pieces: [
      { input: Buffer.from(pillSvg), left: 0, top: middleOfRow(pill.height, scale) },
      {
        input: sideName.data,
        left: Math.round(PILL.inset * scale),
        top: middleOfRow(sideName.info.height, scale),
      },
      {
        input: titleText.data,
        left: titleLeft,
        top: Math.max(margin, middleOfRow(titleText.info.height, scale)),
      },
    ],
    height: Math.max(Math.round(FIRST_ROW_HEIGHT * scale), titleText.info.height + 2 * margin),
  };
}

/** The band's right: a swatch of the side's colour and what it means; placed from the band's top
 * right corner, so the lefts are negative. */
async function colorKey(side: Side, scale: number): Promise<Piece[]> {
  const { color, tint } = COLORS[side];
  const meaning = await renderText(
    `<span foreground="${TEXT}">${WORDS[side].marks}</span>`,
    FONT_SIZE.colorMeaning,
    'Regular',
    scale,
  );
  const size = Math.round(SWATCH.size * scale);
  const stroke = SWATCH.stroke * scale;
  const swatchSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect x="${stroke / 2}" y="${stroke / 2}" width="${size - stroke}" height="${size - stroke}"
      rx="${SWATCH.radius * scale}" fill="${tint}" stroke="${color}" stroke-width="${stroke}"/></svg>`;
  return [
    { input: meaning.data, left: -meaning.info.width, top: middleOfRow(meaning.info.height, scale) },
    {
      input: Buffer.from(swatchSvg),
      left: -meaning.info.width - Math.round(SWATCH.gapToMeaning * scale) - size,
      top: middleOfRow(size, scale),
    },
  ];
}

/** The key of numbered boxes: each disc and what it means beside it, in rows no wider than `width`,
 * a meaning too long for a row wrapped to it. Returns the pieces, placed from the key's top left
 * corner, and the key's height. */
async function keyPieces(keys: Key[], width: number, scale: number) {
  const discSize = Math.round(DISC * scale);
  const discGap = Math.round(KEY.discGap * scale);
  const meaningWidth = Math.max(width - discSize - discGap, discSize);
  const line = await keyLine(scale);
  const items = await Promise.all(
    keys.map(async ({ disc, what }) => ({ disc, what: await keyMeaning(what, meaningWidth, scale) })),
  );
  const rows = intoRows(
    items.map(({ what }) => ({
      width: discSize + discGap + what.width,
      height: Math.max(discSize, what.height),
    })),
    width,
    { itemGap: Math.round(KEY.itemGap * scale), rowGap: Math.round(KEY.rowGap * scale) },
  );
  const pieces = items.flatMap(({ disc, what }, i): Piece[] => {
    const { left, top, rowHeight } = rows.spots[i];
    const middle = (height: number) => top + Math.round((rowHeight - height) / 2);
    // On one line, the meaning reads level with its disc's number: the middle of its capitals is
    // where the number's is, at the disc's centre. Wrapped, it is centred as a block.
    const meaningTop =
      what.height === line.height
        ? top + Math.round(rowHeight / 2 - line.capitalsMiddle)
        : middle(what.height);
    return [
      { input: disc, left, top: middle(discSize) },
      { input: what.data, left: left + discSize + discGap, top: meaningTop },
    ];
  });
  return { pieces, height: rows.height };
}

/** What a disc means, drawn to wrap at `width`: an image as high as its lines, not as its letters,
 * and as wide as its ink. */
async function keyMeaning(what: string, width: number, scale: number) {
  const markup = `<span foreground="${TEXT}">${escapePango(what)}</span>${STRUT}`;
  const drawn = await renderText(markup, FONT_SIZE.key, 'Regular', scale, width);
  const ink = await inkOf(drawn.data);
  const size = { width: ink.left + ink.width, height: drawn.info.height };
  const data = await sharp(drawn.data)
    .extract({ left: 0, top: 0, ...size })
    .png()
    .toBuffer();
  return { data, ...size };
}

/** A line of the key: how high it is, and how far down it the middle of its capitals is. */
async function keyLine(scale: number) {
  const drawn = await renderText(
    `<span foreground="${TEXT}">H</span>${STRUT}`,
    FONT_SIZE.key,
    'Regular',
    scale,
  );
  const capitals = await inkOf(drawn.data);
  return { height: drawn.info.height, capitalsMiddle: capitals.top + capitals.height / 2 };
}

type Size = { width: number; height: number };

/** Where items of `sizes` go, left to right, `itemGap` apart, starting a new row when the next one
 * would make the row wider than `maxWidth`; an item wider than that gets a row of its own. Each row
 * is as tall as its tallest item, `rowGap` under the one before. Gives each item's spot and its row's
 * height, to centre it in its row, and the height of all the rows. */
export function intoRows(
  sizes: Size[],
  maxWidth: number,
  { itemGap, rowGap }: { itemGap: number; rowGap: number },
): { spots: { left: number; top: number; rowHeight: number }[]; height: number } {
  const rows: { left: number; size: Size }[][] = [];
  let left = 0;
  for (const size of sizes) {
    if (!rows.length || (left > 0 && left + size.width > maxWidth)) {
      rows.push([]);
      left = 0;
    }
    rows[rows.length - 1].push({ left, size });
    left += size.width + itemGap;
  }
  const spots: { left: number; top: number; rowHeight: number }[] = [];
  let top = 0;
  for (const row of rows) {
    const rowHeight = Math.max(...row.map(item => item.size.height));
    for (const item of row) spots.push({ left: item.left, top, rowHeight });
    top += rowHeight + rowGap;
  }
  return { spots, height: rows.length ? top - rowGap : 0 };
}
