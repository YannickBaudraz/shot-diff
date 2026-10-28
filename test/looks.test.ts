import sharp from 'sharp';
import { describe, expect, test, vi } from 'vitest';
import { looks, MAX_PICTURES, type El, type Seen } from '../src/looks.ts';

const el = (sig: string, style: Record<string, string> = {}, more: Partial<El> = {}): El =>
  ({ sig, parent: -1, leaf: true, paint: false, top: 0, width: 100, height: 20, style, ...more });
/** A page with these elements, whose pixels are `pictures[i]` (none by default). */
const seen = (elements: El[], pictures: Record<number, Buffer | null> = {}): Seen & { pixels: ReturnType<typeof vi.fn> } =>
  ({ elements, pixels: vi.fn(async (i: number) => pictures[i] ?? null) });
const square = (color: string, size = 10) =>
  sharp({ create: { width: size, height: size, channels: 4, background: color } }).png().toBuffer();

describe('looks', () => {
  test('names what changed in words, and pairs past elements only one page has', async () => {
    const before = seen([el('header'), el('h2 Trip'), el('BUTTON Book', { 'background-color': 'blue', color: 'white' })]);
    const after = seen([el('header'), el('p New'), el('h2 Trip'), el('BUTTON Book', { 'background-color': 'green', color: 'white' })]);
    expect(await looks(before, after)).toEqual([{ a: 2, b: 3, what: ['background'], name: '[button: background]' }]);
  });

  test('one label for the four sides of a border', async () => {
    const sides = (c: string) => ({ 'border-top-color': c, 'border-right-color': c, 'border-bottom-color': c, 'border-left-color': c });
    const [look] = await looks(seen([el('DIV', sides('grey'))]), seen([el('DIV', sides('red'))]));
    expect(look.what).toEqual(['border colour']);
  });

  test('a colour a child inherits is marked on the parent alone', async () => {
    const page = (c: string) => seen([el('NAV', { color: c }, { leaf: false }), el('A Home', { color: c }, { parent: 0 })]);
    expect((await looks(page('black'), page('navy'))).map(l => [l.a, l.what])).toEqual([[0, ['text colour']]]);
  });

  test('a child that changes colour on its own is marked', async () => {
    const before = seen([el('NAV', { color: 'black' }, { leaf: false }), el('A Home', { color: 'black' }, { parent: 0 })]);
    const after = seen([el('NAV', { color: 'black' }, { leaf: false }), el('A Home', { color: 'red' }, { parent: 0 })]);
    expect((await looks(before, after)).map(l => [l.a, l.what])).toEqual([[1, ['text colour']]]);
  });

  test('a size set in CSS is a change, a size layout gives is not', async () => {
    const before = seen([el('MAIN', { width: 'auto' }, { leaf: false, height: 300 }), el('IMG logo.png', { width: '32px' })]);
    const after = seen([el('MAIN', { width: 'auto' }, { leaf: false, height: 400 }), el('IMG logo.png', { width: '48px' })]);
    expect((await looks(before, after)).map(l => [l.a, l.what])).toEqual([[1, ['size']]]);
  });

  test('nothing changed, nothing found', async () => {
    const page = () => seen([el('P', { color: 'black' })]);
    expect(await looks(page(), page())).toEqual([]);
  });

  test('top to bottom on the before page', async () => {
    const before = seen([el('P one', { color: 'black' }, { top: 500 }), el('P two', { color: 'black' }, { top: 100 })]);
    const after = seen([el('P one', { color: 'red' }, { top: 500 }), el('P two', { color: 'red' }, { top: 100 })]);
    expect((await looks(before, after)).map(l => l.a)).toEqual([1, 0]);
  });
});

describe('pictures', () => {
  const picture = (sig = 'IMG logo.png') => el(sig, {}, { paint: true });

  test('a picture redrawn under the same name is a change; one drawn the same is not', async () => {
    const red = await square('#ff0000');
    const changed = await looks(seen([picture()], { 0: red }), seen([picture()], { 0: await square('#ff8800') }));
    expect(changed).toEqual([{ a: 0, b: 0, what: ['picture'], name: '[img: picture]' }]);
    expect(await looks(seen([picture()], { 0: red }), seen([picture()], { 0: red }))).toEqual([]);
  });

  test('a picture whose size changed is a change; one that cannot be shot is not', async () => {
    const red = await square('#ff0000');
    expect(await looks(seen([picture()], { 0: red }), seen([picture()], { 0: await square('#ff0000', 12) }))).toHaveLength(1);
    expect(await looks(seen([picture()], { 0: red }), seen([picture()], { 0: null }))).toEqual([]);
  });

  test('a picture whose style changed is not shot as well', async () => {
    const before = seen([el('IMG logo.png', { opacity: '1' }, { paint: true })]);
    const after = seen([el('IMG logo.png', { opacity: '0.5' }, { paint: true })]);
    expect((await looks(before, after)).map(l => l.what)).toEqual([['opacity']]);
    expect(before.pixels).not.toHaveBeenCalled();
  });

  test(`at most ${MAX_PICTURES} pictures are compared`, async () => {
    const many = Array.from({ length: MAX_PICTURES + 5 }, (_, i) => picture(`IMG ${i}.png`));
    const before = seen(many);
    await looks(before, seen(many));
    expect(before.pixels).toHaveBeenCalledTimes(MAX_PICTURES);
  });
});
