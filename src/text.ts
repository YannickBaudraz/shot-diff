// Text drawn as an image with sharp, which uses Pango: for the band, and the numbers on discs.

import sharp from 'sharp';

/** `s` with Pango's markup characters escaped. */
export const pango = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** Pango markup as a PNG at the shot's `scale`: `size` in points, at 72 dpi per device pixel ratio, so
 * one point is one CSS pixel; wrapped at `wrap` device pixels when given. */
export const text = (markup: string, size: number, weight: 'Regular' | 'Semi-Bold', scale: number, wrap?: number) =>
  sharp({ text: { text: markup, font: `sans-serif ${weight} ${size}`, dpi: 72 * scale, rgba: true, width: wrap, spacing: 6 * scale } })
    .png().toBuffer({ resolveWithObject: true });
