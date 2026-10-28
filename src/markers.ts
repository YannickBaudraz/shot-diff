// What marks a change of look on the shots. With labels, its box says what changed. With numbers,
// its box gets a numbered disc, and the band says what each number means. The mode is decided here
// once; the page and the band draw what they are given.

import sharp from 'sharp';
import { COLOURS, type LookMark, type Side } from './loaded.ts';
import { text } from './text.ts';
import type { Restyled } from './visual.ts';

export type Mode = 'labels' | 'numbers';

/** A disc's size, in CSS pixels, its white ring included. */
export const DISC = 24;

/** A change of look's marker: its number, what changed, and what goes on its box on each page. */
export type Marker = LookMark & { n: number; what: string };

/** The markers of `looks`, numbered in their order. */
export async function markers(looks: Restyled[], mode: Mode, scale: number): Promise<Marker[]> {
  return Promise.all(looks.map(async (l, i) => {
    const n = i + 1;
    const what = l.what.join(', ');
    return {
      a: l.a,
      b: l.b,
      n,
      what,
      label: mode === 'labels' ? what : null,
      disc: mode === 'numbers' ? { before: await disc(n, 'before', scale), after: await disc(n, 'after', scale), size: DISC } : null,
    };
  }));
}

/** A numbered disc in a white ring, in `side`'s colour, as a PNG at the shot's `scale`. The number is
 * centred on its ink's centre of mass, not on its box: a 1 is a stroke with a flag on its left, and
 * centring its box puts the stroke, which the eye reads, right of the middle. */
async function disc(n: number, side: Side, scale: number): Promise<Buffer> {
  const size = Math.round(DISC * scale);
  const ring = 2 * scale;
  const glyph = await sharp((await text(`<span foreground="#ffffff">${n}</span>`, 12, 'Semi-Bold', scale)).data)
    .trim({ background: '#00000000', threshold: 1 }).raw().toBuffer({ resolveWithObject: true });
  let mass = 0;
  let sumX = 0;
  for (let y = 0; y < glyph.info.height; y++) {
    for (let x = 0; x < glyph.info.width; x++) {
      const alpha = glyph.data[(y * glyph.info.width + x) * 4 + 3];
      mass += alpha;
      sumX += alpha * x;
    }
  }
  const centreX = mass ? sumX / mass : glyph.info.width / 2;
  const number = await sharp(glyph.data, { raw: glyph.info }).png().toBuffer();
  const circle = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#ffffff"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - ring}" fill="${COLOURS[side].color}"/></svg>`;
  return sharp(Buffer.from(circle))
    .composite([{ input: number, left: Math.round(size / 2 - centreX), top: Math.round((size - glyph.info.height) / 2) }])
    .png()
    .toBuffer();
}
