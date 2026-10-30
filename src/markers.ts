// What marks a change of look on the shots. With labels, its box says what changed. With numbers,
// its box gets a numbered disc, and the band says what each number means. The mode is decided here
// once; the page and the band draw what they are given.

import sharp from 'sharp';
import type { Look } from './looks.ts';
import { COLOURS, type Side } from './side.ts';
import { renderText } from './text.ts';

export type Mode = 'labels' | 'numbers';

/** A disc's size, in CSS pixels, its white ring included. */
export const DISC = 24;

/** How a change of look is marked: its element on each page, its number, what changed, and what goes
 * on its box, either a label or a disc image for each side. */
export type Marker = {
  element: Record<Side, number>;
  number: number;
  what: string;
  label: string | null;
  disc: { image: Record<Side, Buffer>; size: number } | null; // size in CSS pixels
};

/** The markers of `looks`, numbered in their order. */
export async function markersFor(looks: Look[], mode: Mode, scale: number): Promise<Marker[]> {
  return Promise.all(looks.map(async (look, index) => {
    const number = index + 1;
    const what = look.what.join(', ');
    if (mode === 'labels') return { element: look.element, number, what, label: what, disc: null };
    const image = { before: await disc(number, 'before', scale), after: await disc(number, 'after', scale) };
    return { element: look.element, number, what, label: null, disc: { image, size: DISC } };
  }));
}

/** A numbered disc in a white ring, in `side`'s colour, as a PNG at the shot's `scale`. The number is
 * centred by its ink's centre of mass, not by its box: a 1 is a stroke with a flag on its left, and
 * centring its box puts the stroke, which the eye reads, right of the middle. */
async function disc(number: number, side: Side, scale: number): Promise<Buffer> {
  const size = Math.round(DISC * scale);
  const half = size / 2;
  const digits = await renderText(`<span foreground="#ffffff">${number}</span>`, 12, 'Semi-Bold', scale);
  const ink = await sharp(digits.data).trim({ background: '#00000000', threshold: 1 }).raw().toBuffer({ resolveWithObject: true });
  const inkPng = await sharp(ink.data, { raw: ink.info }).png().toBuffer();
  const circles = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${half}" cy="${half}" r="${half}" fill="#ffffff"/>
    <circle cx="${half}" cy="${half}" r="${half - 2 * scale}" fill="${COLOURS[side].color}"/></svg>`;
  return sharp(Buffer.from(circles))
    .composite([{ input: inkPng, left: Math.round(half - inkCentreX(ink)), top: Math.round((size - ink.info.height) / 2) }])
    .png()
    .toBuffer();
}

/** The x of an RGBA image's centre of mass, each pixel weighed by how opaque it is. */
function inkCentreX({ data, info }: { data: Buffer; info: { width: number; height: number } }): number {
  let mass = 0;
  let moment = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      mass += alpha;
      moment += alpha * x;
    }
  }
  return mass ? moment / mass : info.width / 2;
}
