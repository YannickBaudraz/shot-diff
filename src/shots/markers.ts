// What marks a change of look on the shots. With labels, its box says what changed. With numbers,
// its box gets a numbered disc, and the band says what each number means. The mode is decided here
// once; the page and the band draw what they are given.

import sharp from 'sharp';
import type { Look } from '../changes/looks.ts';
import { bothSides, COLORS, ON_SIDE_COLOR, type Side } from '../side.ts';
import { renderText } from './text.ts';

export type Mode = 'labels' | 'numbers';

/** A disc's size, in CSS pixels, its white ring included. */
export const DISC = 24;

/** The width of a disc's ring, in CSS pixels. */
const RING = 2;

/** The size of a disc's number, in points: one point to the CSS pixel. */
const NUMBER_SIZE = 12;

/** What goes on a change of look's box: a label saying what changed, or a disc image for each side,
 * DISC wide; nothing on an element added or removed, which the box's colour says. */
export type Badge = { label: string } | { disc: Record<Side, Buffer> } | { plain: true };

/** A change of look, numbered, with what goes on its box. */
export type Marker = Look & { number: number; badge: Badge };

/** The markers of `looks`, numbered in their order; an element added or removed has no number. */
export async function markersFor(looks: Look[], mode: Mode, scale: number): Promise<Marker[]> {
  let count = 0;
  const numbers = looks.map(look => (look.only ? 0 : ++count));
  return Promise.all(
    looks.map(async (look, index) => {
      const number = numbers[index];
      const badge: Badge = look.only
        ? { plain: true }
        : mode === 'labels'
          ? { label: look.what.join(', ') }
          : { disc: await bothSides(side => disc(number, side, scale)) };
      return { ...look, number, badge };
    }),
  );
}

/** A numbered disc in a white ring, in `side`'s colour, as a PNG at the shot's `scale`. The number is
 * centred by its ink's centre of mass, not by its box: a 1 is a stroke with a flag on its left, and
 * centring its box puts the stroke, which the eye reads, right of the middle. */
async function disc(number: number, side: Side, scale: number): Promise<Buffer> {
  const size = Math.round(DISC * scale);
  const half = size / 2;
  const digits = await renderText(
    `<span foreground="${ON_SIDE_COLOR}">${number}</span>`,
    NUMBER_SIZE,
    'Semi-Bold',
    scale,
  );
  const ink = await sharp(digits.data)
    .trim({ background: '#00000000', threshold: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const inkPng = await sharp(ink.data, { raw: ink.info }).png().toBuffer();
  const circles = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${half}" cy="${half}" r="${half}" fill="${ON_SIDE_COLOR}"/>
    <circle cx="${half}" cy="${half}" r="${half - RING * scale}" fill="${COLORS[side].color}"/></svg>`;
  return sharp(Buffer.from(circles))
    .composite([
      {
        input: inkPng,
        left: Math.round(half - inkCentreX(ink)),
        top: Math.round((size - ink.info.height) / 2),
      },
    ])
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
