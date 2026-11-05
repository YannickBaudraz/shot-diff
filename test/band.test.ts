import sharp from 'sharp';
import { describe, expect, test } from 'vitest';
import { band, intoRows, type Content } from '../src/band.ts';
import { markersFor } from '../src/markers.ts';

const SCALE = 2;
const shot = sharp({ create: { width: 800, height: 300, channels: 4, background: '#ffffff' } })
  .png()
  .toBuffer();
const size = async (png: Buffer) => {
  const { width, height } = await sharp(png).metadata();
  return { width: width!, height: height! };
};
const content = (more: Partial<Content> = {}): Content => ({
  side: 'before',
  title: 'Cart',
  number: 1,
  total: 1,
  key: [],
  ...more,
});
/** The band's key for `count` numbered changes of look, with this side's discs. */
const key = async (count: number) =>
  (
    await markersFor(
      Array.from({ length: count }, (_, i) => ({
        element: { before: i, after: i },
        what: ['background', 'border colour'],
        name: '',
      })),
      'numbers',
      SCALE,
    )
  ).flatMap(({ badge, what }) =>
    'disc' in badge ? [{ disc: badge.disc.before, what: what.join(', ') }] : [],
  );

describe('band', () => {
  test('puts a band on top of the shot, and a 1px frame around both', async () => {
    const out = await size(await band(await shot, content(), SCALE));
    expect(out.width).toBe(800 + 2 * SCALE);
    expect(out.height).toBeGreaterThan(300 + 40 * SCALE);
  });

  test('a key adds rows under the title, as many as the band is wide enough for', async () => {
    const plain = (await size(await band(await shot, content(), SCALE))).height;
    const few = (await size(await band(await shot, content({ key: await key(2) }), SCALE))).height;
    const many = (await size(await band(await shot, content({ key: await key(12) }), SCALE))).height;
    expect(few).toBeGreaterThan(plain);
    expect(many).toBeGreaterThan(few);
  });

  test('a title too long for the band wraps, and the band grows to hold it', async () => {
    const phone = await sharp({ create: { width: 750, height: 300, channels: 4, background: '#ffffff' } })
      .png()
      .toBuffer();
    const height = async (title: string) => (await size(await band(phone, content({ title }), SCALE))).height;
    const long = 'Cart: the empty state on a phone, after the redesign of the checkout';
    expect(await height(long)).toBeGreaterThan(await height('Cart'));
    expect(await height('Cart: ' + 'checkout'.repeat(30))).toBeGreaterThan(await height('Cart'));
  });

  test("a number's meaning too long for the band wraps", async () => {
    const [disc] = await key(1);
    const height = async (what: string) =>
      (await size(await band(await shot, content({ key: [{ ...disc, what }] }), SCALE))).height;
    expect(await height('background, '.repeat(40))).toBeGreaterThan(await height('background'));
  });

  test('a title with markup characters is drawn as written', async () => {
    await expect(
      band(await shot, content({ title: 'a <b> & "c"', side: 'after', number: 2, total: 3 }), SCALE),
    ).resolves.toBeInstanceOf(Buffer);
  });
});

describe('intoRows', () => {
  const gaps = { itemGap: 10, rowGap: 5 };
  const item = (width: number, height = 20) => ({ width, height });

  test('starts a new row when the next item would not fit', () => {
    expect(intoRows([item(40), item(40), item(40)], 100, gaps)).toEqual({
      spots: [
        { left: 0, top: 0, rowHeight: 20 },
        { left: 50, top: 0, rowHeight: 20 },
        { left: 0, top: 25, rowHeight: 20 },
      ],
      height: 45,
    });
  });

  test('an item wider than a row takes one of its own, not an empty one before it', () => {
    expect(intoRows([item(150), item(40)], 100, gaps).spots).toEqual([
      { left: 0, top: 0, rowHeight: 20 },
      { left: 0, top: 25, rowHeight: 20 },
    ]);
  });

  test('each row is as tall as its tallest item, and no taller', () => {
    expect(intoRows([item(40), item(40, 60), item(40), item(40)], 100, gaps)).toEqual({
      spots: [
        { left: 0, top: 0, rowHeight: 60 },
        { left: 50, top: 0, rowHeight: 60 },
        { left: 0, top: 65, rowHeight: 20 },
        { left: 50, top: 65, rowHeight: 20 },
      ],
      height: 85,
    });
  });
});
