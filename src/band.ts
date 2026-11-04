// The band drawn on top of each shot, with sharp: no browser needed.

import sharp from 'sharp';
import { DISC } from './markers.ts';
import { COLORS, ON_SIDE_COLOR, WORDS, type Side } from './side.ts';
import { escapePango, renderText } from './text.ts';

/** What a numbered box on a shot means: its disc, the same image as on the page, and what changed. */
export type Key = { disc: Buffer; what: string };

/** What the band says: which side the shot is, the title, which shot of how many, and the key of its
 * numbered boxes (none with labels). */
export type Content = { side: Side; title: string; number: number; total: number; key: Key[] };

/** An image to compose onto the band, and where. */
type Piece = { input: Buffer; left: number; top: number };

// Sizes in CSS pixels, multiplied by the shot's scale.
const FIRST_ROW_HEIGHT = 52; // the side, the title and what the colour means
const PADDING = 16; // between the band's edges and what is in it
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
 * what its colour means; under them, when the shot has numbered boxes, what each number means. */
export async function band(shot: Buffer, content: Content, scale: number): Promise<Buffer> {
  const { width: shotWidth = 0, height: shotHeight = 0 } = await sharp(shot).metadata();
  const frame = Math.max(1, Math.round(scale)); // the width of the frame line
  const padding = Math.round(PADDING * scale);
  const rowHeight = Math.round(FIRST_ROW_HEIGHT * scale);
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
      ...offset(await heading(content, scale), frame + padding, frame),
      ...offset(await colorKey(content.side, scale), width - frame - padding, frame),
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

/** The band's left: the side's pill, then the title and which shot of how many; placed from the
 * band's top left corner. */
async function heading({ side, title, number, total }: Content, scale: number): Promise<Piece[]> {
  const sideName = await renderText(
    `<span foreground="${ON_SIDE_COLOR}">${WORDS[side].name}</span>`,
    FONT_SIZE.sideName,
    'Semi-Bold',
    scale,
  );
  const count =
    total > 1 ? `<span foreground="${SHOT_COUNT_TEXT}" weight="normal">   ${number} of ${total}</span>` : '';
  const titleText = await renderText(
    `<span foreground="${TEXT}">${escapePango(title)}</span>${count}`,
    FONT_SIZE.title,
    'Semi-Bold',
    scale,
  );
  const pill = {
    width: sideName.info.width + Math.round(2 * PILL.inset * scale),
    height: Math.round(PILL.height * scale),
  };
  const pillSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pill.width}" height="${pill.height}">
    <rect width="${pill.width}" height="${pill.height}" rx="${pill.height / 2}" fill="${COLORS[side].color}"/></svg>`;
  return [
    { input: Buffer.from(pillSvg), left: 0, top: middleOfRow(pill.height, scale) },
    {
      input: sideName.data,
      left: Math.round(PILL.inset * scale),
      top: middleOfRow(sideName.info.height, scale),
    },
    {
      input: titleText.data,
      left: pill.width + Math.round(PILL.gapToTitle * scale),
      top: middleOfRow(titleText.info.height, scale),
    },
  ];
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

/** The key of numbered boxes: each disc and what it means beside it, in rows no wider than `width`.
 * Returns the pieces, placed from the key's top left corner, and the key's height. */
async function keyPieces(keys: Key[], width: number, scale: number) {
  const discSize = Math.round(DISC * scale);
  const discGap = Math.round(KEY.discGap * scale);
  const items = await Promise.all(
    keys.map(async ({ disc, what }) => ({
      disc,
      what: await renderText(
        `<span foreground="${TEXT}">${escapePango(what)}</span>`,
        FONT_SIZE.key,
        'Regular',
        scale,
      ),
    })),
  );
  const rowHeight = Math.max(discSize, ...items.map(item => item.what.info.height));
  const spots = intoRows(
    items.map(item => discSize + discGap + item.what.info.width),
    width,
    { itemGap: Math.round(KEY.itemGap * scale), rowStep: rowHeight + Math.round(KEY.rowGap * scale) },
  );
  const pieces = items.flatMap(({ disc, what }, i): Piece[] => {
    const { left, top } = spots[i];
    const middle = (height: number) => top + Math.round((rowHeight - height) / 2);
    return [
      { input: disc, left, top: middle(discSize) },
      { input: what.data, left: left + discSize + discGap, top: middle(what.info.height) },
    ];
  });
  return { pieces, height: spots[spots.length - 1].top + rowHeight };
}

/** Where items `widths` wide go, left to right, `itemGap` apart, starting a new row `rowStep` lower
 * when the next one would make the row wider than `maxWidth`. An item wider than that gets a row of
 * its own. */
export function intoRows(
  widths: number[],
  maxWidth: number,
  { itemGap, rowStep }: { itemGap: number; rowStep: number },
): { left: number; top: number }[] {
  let left = 0;
  let top = 0;
  return widths.map(width => {
    if (left > 0 && left + width > maxWidth) {
      left = 0;
      top += rowStep;
    }
    const spot = { left, top };
    left += width + itemGap;
    return spot;
  });
}
