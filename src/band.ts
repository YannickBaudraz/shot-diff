// The band drawn on top of each shot, with sharp: no browser needed.

import sharp from 'sharp';
import { DISC } from './markers.ts';
import { COLOURS, WORDS, type Side } from './side.ts';
import { escapePango, renderText } from './text.ts';

/** What a numbered box on a shot means: its disc, the same image as on the page, and what changed. */
export type Key = { disc: Buffer; what: string };

/** What the band says: which side the shot is, the title, which shot of how many, and the key of its
 * numbered boxes (none with labels). */
export type Content = { side: Side; title: string; number: number; total: number; key: Key[] };

/** An image to compose onto the band, and where. */
type Piece = { input: Buffer; left: number; top: number };

// Sizes in CSS pixels, multiplied by the shot's scale.
const ROW = 52; // the band's first row: side, title, colour
const PADDING = 16; // between the band's edges and what is in it
const KEY_GAP = 12; // added under the first row when there is a key
const KEY_RAISE = 4; // the key starts this far up into the first row's bottom

/** The shot, a PNG at `scale`, with a band on top: its side, the title, which shot of how many, and
 * what its colour means; under them, when the shot has numbered boxes, what each number means. */
export async function band(shot: Buffer, content: Content, scale: number): Promise<Buffer> {
  const { width: shotWidth = 0, height: shotHeight = 0 } = await sharp(shot).metadata();
  const frame = Math.max(1, Math.round(scale)); // the line around the band and the shot
  const padding = Math.round(PADDING * scale);
  const rowHeight = Math.round(ROW * scale);
  const key = content.key.length ? await keyPieces(content.key, shotWidth - 2 * padding, scale) : null;
  const bandHeight = rowHeight + (key ? key.height + Math.round(KEY_GAP * scale) : 0);
  const width = shotWidth + 2 * frame;
  const height = frame + bandHeight + frame + shotHeight + frame;
  return sharp({ create: { width, height, channels: 4, background: '#d0d7de' } })
    .composite([
      {
        input: { create: { width: shotWidth, height: bandHeight, channels: 4, background: '#f6f8fa' } },
        left: frame,
        top: frame,
      },
      ...offset(key?.pieces ?? [], frame + padding, frame + rowHeight - Math.round(KEY_RAISE * scale)),
      ...offset(await heading(content, scale), frame + padding, frame),
      ...offset(await colourKey(content.side, scale), width - frame - padding, frame),
      { input: shot, left: frame, top: frame + bandHeight + frame },
    ])
    .png()
    .toBuffer();
}

/** `pieces`, moved by `dx` and `dy`. */
const offset = (pieces: Piece[], dx: number, dy: number) =>
  pieces.map(p => ({ ...p, left: p.left + dx, top: p.top + dy }));

/** The top that centres something `height` high in the band's first row. */
const middleOfRow = (height: number, scale: number) => Math.round((Math.round(ROW * scale) - height) / 2);

/** The band's left: the side's pill, then the title and which shot of how many; placed from the
 * band's top left corner. */
async function heading({ side, title, number, total }: Content, scale: number): Promise<Piece[]> {
  const sideName = await renderText(
    `<span foreground="#ffffff">${WORDS[side].name}</span>`,
    15,
    'Semi-Bold',
    scale,
  );
  const count = total > 1 ? `<span foreground="#59636e" weight="normal">   ${number} of ${total}</span>` : '';
  const titleText = await renderText(
    `<span foreground="#1f2328">${escapePango(title)}</span>${count}`,
    18,
    'Semi-Bold',
    scale,
  );
  const pill = { width: sideName.info.width + Math.round(20 * scale), height: Math.round(26 * scale) };
  const pillSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pill.width}" height="${pill.height}">
    <rect width="${pill.width}" height="${pill.height}" rx="${pill.height / 2}" fill="${COLOURS[side].color}"/></svg>`;
  return [
    { input: Buffer.from(pillSvg), left: 0, top: middleOfRow(pill.height, scale) },
    { input: sideName.data, left: Math.round(10 * scale), top: middleOfRow(sideName.info.height, scale) },
    {
      input: titleText.data,
      left: pill.width + Math.round(12 * scale),
      top: middleOfRow(titleText.info.height, scale),
    },
  ];
}

/** The band's right: a swatch of the side's colour and what it means; placed from the band's top
 * right corner, so the lefts are negative. */
async function colourKey(side: Side, scale: number): Promise<Piece[]> {
  const { color, tint } = COLOURS[side];
  const meaning = await renderText(
    `<span foreground="#1f2328">${WORDS[side].marks}</span>`,
    15,
    'Regular',
    scale,
  );
  const size = Math.round(16 * scale);
  const swatchSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect x="${scale}" y="${scale}" width="${size - 2 * scale}" height="${size - 2 * scale}" rx="${3 * scale}"
      fill="${tint}" stroke="${color}" stroke-width="${2 * scale}"/></svg>`;
  return [
    { input: meaning.data, left: -meaning.info.width, top: middleOfRow(meaning.info.height, scale) },
    {
      input: Buffer.from(swatchSvg),
      left: -meaning.info.width - Math.round(6 * scale) - size,
      top: middleOfRow(size, scale),
    },
  ];
}

/** The key of numbered boxes: each disc and what it means beside it, in rows no wider than `width`.
 * Returns the pieces, placed from the key's top left corner, and the key's height. */
async function keyPieces(keys: Key[], width: number, scale: number) {
  const discSize = Math.round(DISC * scale);
  const gap = Math.round(6 * scale); // between a disc and its meaning
  const space = Math.round(24 * scale); // between one meaning and the next disc
  const rowGap = Math.round(6 * scale);
  const items = await Promise.all(
    keys.map(async ({ disc, what }) => ({
      disc,
      what: await renderText(`<span foreground="#1f2328">${escapePango(what)}</span>`, 14, 'Regular', scale),
    })),
  );
  const rowHeight = Math.max(discSize, ...items.map(item => item.what.info.height));
  const pieces: Piece[] = [];
  let x = 0;
  let y = 0;
  for (const { disc, what } of items) {
    const itemWidth = discSize + gap + what.info.width;
    if (x > 0 && x + itemWidth > width) {
      x = 0;
      y += rowHeight + rowGap;
    }
    const middle = (height: number) => y + Math.round((rowHeight - height) / 2);
    pieces.push(
      { input: disc, left: x, top: middle(discSize) },
      { input: what.data, left: x + discSize + gap, top: middle(what.info.height) },
    );
    x += itemWidth + space;
  }
  return { pieces, height: y + rowHeight };
}
