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
export async function band(png: Buffer, { side, title: heading, n, of, key: keys }: Content, s: number): Promise<Buffer> {
  const colour = COLOURS[side];
  const { width: w, height: h } = await sharp(png).metadata();
  const band = Math.round(52 * s);
  const line = Math.max(1, Math.round(s));

  const label = await text(`<span foreground="#ffffff">${side === 'before' ? 'Before' : 'After'}</span>`, 15, 'Semi-Bold', s);
  const count = of > 1 ? `<span foreground="#59636e" weight="normal">   ${n} of ${of}</span>` : '';
  const title = await text(`<span foreground="#1f2328">${pango(heading)}</span>${count}`, 18, 'Semi-Bold', s);
  const meaning = await text(`<span foreground="#1f2328">${side === 'before' ? 'removed' : 'added'}</span>`, 15, 'Regular', s);

  const pill = { w: label.info.width + Math.round(20 * s), h: Math.round(26 * s) };
  const pillSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pill.w}" height="${pill.h}">
    <rect width="${pill.w}" height="${pill.h}" rx="${pill.h / 2}" fill="${colour.color}"/></svg>`;
  const sw = Math.round(16 * s);
  const swatchSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sw}">
    <rect x="${s}" y="${s}" width="${sw - 2 * s}" height="${sw - 2 * s}" rx="${3 * s}" fill="${colour.tint}" stroke="${colour.color}" stroke-width="${2 * s}"/></svg>`;

  const pad = Math.round(16 * s);
  const gap = Math.round(12 * s);
  const mid = (height: number) => Math.round((band - height) / 2) + line;
  const width = w! + 2 * line;

  // The numbers' meanings, each number on a disc like the one on the page, on as many rows as they need.
  const legend = keys.length ? await key(keys, w! - 2 * pad, s) : null;
  const below = legend ? legend.height + Math.round(12 * s) : 0;
  const head = band + below;

  return sharp({ create: { width, height: line + head + line + h! + line, channels: 4, background: '#d0d7de' } })
    .composite([
      { input: { create: { width: w!, height: head, channels: 4, background: '#f6f8fa' } }, left: line, top: line },
      ...(legend ? legend.pieces.map(p => ({ ...p, left: p.left + line + pad, top: p.top + line + band - Math.round(4 * s) })) : []),
      { input: Buffer.from(pillSvg), left: line + pad, top: mid(pill.h) },
      { input: label.data, left: line + pad + Math.round(10 * s), top: mid(label.info.height) },
      { input: title.data, left: line + pad + pill.w + gap, top: mid(title.info.height) },
      { input: meaning.data, left: width - line - pad - meaning.info.width, top: mid(meaning.info.height) },
      { input: Buffer.from(swatchSvg), left: width - line - pad - meaning.info.width - Math.round(6 * s) - sw, top: mid(sw) },
      { input: png, left: line, top: line + head + line },
    ])
    .png()
    .toBuffer();
}
