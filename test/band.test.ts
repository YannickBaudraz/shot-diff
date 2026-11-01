import sharp from 'sharp';
import { describe, expect, test } from 'vitest';
import { band, type Content } from '../src/band.ts';
import { markersFor } from '../src/markers.ts';

const SCALE = 2;
const shot = sharp({ create: { width: 800, height: 300, channels: 4, background: '#ffffff' } }).png().toBuffer();
const size = async (png: Buffer) => { const { width, height } = await sharp(png).metadata(); return { width: width!, height: height! }; };
const content = (more: Partial<Content> = {}): Content => ({ side: 'before', title: 'Cart', number: 1, total: 1, key: [], ...more });
/** The band's key for `count` numbered changes of look, with this side's discs. */
const key = async (count: number) => (await markersFor(
  Array.from({ length: count }, (_, i) => ({ element: { before: i, after: i }, what: ['background', 'border colour'], name: '' })), 'numbers', SCALE,
)).map(m => ({ disc: m.disc!.image.before, what: m.what }));

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

  test("a title with markup characters is drawn as written", async () => {
    await expect(band(await shot, content({ title: 'a <b> & "c"', side: 'after', number: 2, total: 3 }), SCALE)).resolves.toBeInstanceOf(Buffer);
  });
});
