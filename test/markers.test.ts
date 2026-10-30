import sharp from 'sharp';
import { describe, expect, test } from 'vitest';
import { DISC, markersFor } from '../src/markers.ts';

const looks = [
  { element: { before: 3, after: 4 }, what: ['background', 'weight'], name: '[a: background, weight]' },
  { element: { before: 7, after: 9 }, what: ['picture'], name: '[img: picture]' },
];

describe('markersFor', () => {
  test('labels: what changed goes on the box, and there is no disc', async () => {
    const m = await markersFor(looks, 'labels', 2);
    expect(m.map(x => [x.number, x.element, x.label, x.disc])).toEqual([[1, { before: 3, after: 4 }, 'background, weight', null], [2, { before: 7, after: 9 }, 'picture', null]]);
  });

  test('numbers: a disc per side, in order, and no label', async () => {
    const m = await markersFor(looks, 'numbers', 2);
    expect(m.map(x => [x.number, x.what, x.label])).toEqual([[1, 'background, weight', null], [2, 'picture', null]]);
    const { width, height } = await sharp(m[0].disc!.image.before).metadata();
    expect([width, height]).toEqual([DISC * 2, DISC * 2]);
    expect(m[0].disc!.size).toBe(DISC);
    expect(m[0].disc!.image.before.equals(m[0].disc!.image.after)).toBe(false); // red and green
  });

  test("a 1 sits on the middle of its disc, by its ink, not by its box", async () => {
    const [m] = await markersFor(looks.slice(0, 1), 'numbers', 4);
    const { data, info } = await sharp(m.disc!.image.before).raw().toBuffer({ resolveWithObject: true });
    // The number is the white inside the ring: the middle 60% of the disc.
    let mass = 0, sumX = 0;
    const from = Math.round(info.width * 0.2), to = Math.round(info.width * 0.8);
    for (let y = from; y < to; y++) for (let x = from; x < to; x++) {
      const i = (y * info.width + x) * info.channels;
      const white = Math.min(data[i], data[i + 1], data[i + 2]);
      if (white > 200) { mass += white; sumX += white * x; }
    }
    expect(Math.abs(sumX / mass - info.width / 2)).toBeLessThan(1.5);
  });
});
