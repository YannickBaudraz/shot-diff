// Text drawn as an image with sharp, which uses Pango: for the band, and the numbers on discs.

import sharp from 'sharp';

/** `text` with Pango's markup characters escaped, so it shows as written. */
export const escapePango = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** A tall and deep character with no colour, to end a line of text with. Pango crops a text's image
 * to its ink, so "corners" comes out shorter than "background" and sits elsewhere once centred.
 * Ended with this, a line is as high as its font's letters go, up and down, whatever it says. */
export const STRUT = '<span alpha="1">|</span>';

/** The background of a text's image: nothing. */
const NO_INK = { background: '#00000000', threshold: 1 };

/** Where the ink is in a text's image: its left, its top, and its size. */
export async function inkOf(image: Buffer) {
  const { info } = await sharp(image).trim(NO_INK).toBuffer({ resolveWithObject: true });
  return {
    left: -(info.trimOffsetLeft ?? 0),
    top: -(info.trimOffsetTop ?? 0),
    width: info.width,
    height: info.height,
  };
}

/** Pango markup drawn as a PNG at the shot's `scale`. `size` is in points, at 72 dpi per device pixel
 * ratio, so one point is one CSS pixel. With a `width`, in device pixels, the text wraps to it: at
 * words, or inside a word too long for a line of its own. */
export function renderText(
  markup: string,
  size: number,
  weight: 'Regular' | 'Semi-Bold',
  scale: number,
  width?: number,
) {
  const font = `sans-serif ${weight} ${size}`;
  const wrap = width ? { width, wrap: 'word-char' as const } : {};
  return sharp({ text: { text: markup, font, dpi: 72 * scale, rgba: true, spacing: 6 * scale, ...wrap } })
    .png()
    .toBuffer({ resolveWithObject: true });
}
