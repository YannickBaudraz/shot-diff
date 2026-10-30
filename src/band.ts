// The band drawn on top of each shot, with sharp: no browser needed.

import sharp from 'sharp';
import { COLOURS, type Side } from './loaded.ts';
import { DISC } from './markers.ts';
import { pango, text } from './text.ts';

/** What a numbered box on a shot means: its disc, the same image as on the page, and what changed. */
export type Key = { disc: Buffer; what: string };

/** The band's key for numbered boxes: each disc and what it means beside it, laid out in rows no
 * wider than `width`. Returns the pieces to compose, placed from the key's top left corner, and the
 * key's height. */
async function key(keys: Key[], width: number, s: number) {
  const discSize = Math.round(DISC * s);
  const gap = Math.round(6 * s); // between a disc and its meaning
  const space = Math.round(24 * s); // between one meaning and the next disc
  const rowGap = Math.round(6 * s);
  const items = await Promise.all(keys.map(async k => ({
    disc: k.disc,
    what: await text(`<span foreground="#1f2328">${pango(k.what)}</span>`, 14, 'Regular', s),
  })));
  const rowHeight = Math.max(discSize, ...items.map(i => i.what.info.height));
  const pieces: { input: Buffer; left: number; top: number }[] = [];
  let x = 0;
  let y = 0;
  for (const { disc: picture, what } of items) {
    const itemWidth = discSize + gap + what.info.width;
    if (x > 0 && x + itemWidth > width) { x = 0; y += rowHeight + rowGap; }
    const middle = (height: number) => y + Math.round((rowHeight - height) / 2);
    pieces.push(
      { input: picture, left: x, top: middle(discSize) },
      { input: what.data, left: x + discSize + gap, top: middle(what.info.height) },
    );
    x += itemWidth + space;
  }
  return { pieces, height: y + rowHeight };
}

/** What the band says: which side the shot is, the title, which shot of how many, and the key of its
 * numbered boxes (none with labels). */
export type Content = { side: Side; title: string; n: number; of: number; key: Key[] };

/** The shot, a PNG at `scale`, with a band on top: its side, the title, which shot of how many, and
 * what its colour means; under them, when the shot has numbered boxes, what each number means. */
export async function band(png: Buffer, content: Content, s: number): Promise<Buffer> {
  const { width: w, height: h } = await sharp(png).metadata();
  const line = Math.max(1, Math.round(s)); // the frame
  const pad = Math.round(16 * s);
  const top = Math.round(BAND * s); // the band's first row: side, title, colour
  const legend = content.key.length ? await key(content.key, w! - 2 * pad, s) : null;
  const head = top + (legend ? legend.height + Math.round(12 * s) : 0);
  const width = w! + 2 * line;
  const at = (pieces: Piece[], left: number, top: number) => pieces.map(p => ({ ...p, left: p.left + left, top: p.top + top }));
  return sharp({ create: { width, height: line + head + line + h! + line, channels: 4, background: '#d0d7de' } })
    .composite([
      { input: { create: { width: w!, height: head, channels: 4, background: '#f6f8fa' } }, left: line, top: line },
      ...at(legend?.pieces ?? [], line + pad, line + top - Math.round(4 * s)),
      ...at(await heading(content, s), line + pad, line),
      ...at(await colourKey(content.side, s), width - line - pad, line),
      { input: png, left: line, top: line + head + line },
    ])
    .png()
    .toBuffer();
}

type Piece = { input: Buffer; left: number; top: number };

const BAND = 52; // the band's first row, in CSS pixels

/** A top that centres something `height` high in the band's first row. */
const middle = (height: number, s: number) => Math.round((Math.round(BAND * s) - height) / 2);

/** The band's left: the side's pill, then the title and which shot of how many; placed from the
 * band's top left corner. */
async function heading({ side, title, n, of }: Content, s: number): Promise<Piece[]> {
  const label = await text(`<span foreground="#ffffff">${side === 'before' ? 'Before' : 'After'}</span>`, 15, 'Semi-Bold', s);
  const count = of > 1 ? `<span foreground="#59636e" weight="normal">   ${n} of ${of}</span>` : '';
  const words = await text(`<span foreground="#1f2328">${pango(title)}</span>${count}`, 18, 'Semi-Bold', s);
  const pill = { w: label.info.width + Math.round(20 * s), h: Math.round(26 * s) };
  const pillSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pill.w}" height="${pill.h}">
    <rect width="${pill.w}" height="${pill.h}" rx="${pill.h / 2}" fill="${COLOURS[side].color}"/></svg>`;
  return [
    { input: Buffer.from(pillSvg), left: 0, top: middle(pill.h, s) },
    { input: label.data, left: Math.round(10 * s), top: middle(label.info.height, s) },
    { input: words.data, left: pill.w + Math.round(12 * s), top: middle(words.info.height, s) },
  ];
}

/** The band's right: a swatch of the side's colour and what it means; placed from the band's top
 * right corner, so the lefts are negative. */
async function colourKey(side: Side, s: number): Promise<Piece[]> {
  const { color, tint } = COLOURS[side];
  const meaning = await text(`<span foreground="#1f2328">${side === 'before' ? 'removed' : 'added'}</span>`, 15, 'Regular', s);
  const sw = Math.round(16 * s);
  const swatchSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sw}">
    <rect x="${s}" y="${s}" width="${sw - 2 * s}" height="${sw - 2 * s}" rx="${3 * s}" fill="${tint}" stroke="${color}" stroke-width="${2 * s}"/></svg>`;
  return [
    { input: meaning.data, left: -meaning.info.width, top: middle(meaning.info.height, s) },
    { input: Buffer.from(swatchSvg), left: -meaning.info.width - Math.round(6 * s) - sw, top: middle(sw, s) },
  ];
}
