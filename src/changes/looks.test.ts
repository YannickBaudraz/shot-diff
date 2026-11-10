import sharp from 'sharp';
import { describe, expect, test, vi } from 'vitest';
import { compareLooks, MAX_PICTURES, type ComparedPage, type ElementInfo } from './looks.ts';

const el = (
  signature: string,
  style: Record<string, string> = {},
  more: Partial<ElementInfo> = {},
): ElementInfo => ({
  signature,
  tag: signature.split(' ')[0].toLowerCase(),
  parent: -1,
  leaf: true,
  seen: true,
  paints: false,
  top: 0,
  style,
  ...more,
});
/** A page with these elements, whose pixels are `pictures[i]` (none by default). */
const seen = (
  elements: ElementInfo[],
  pictures: Record<number, Buffer | null> = {},
): ComparedPage & { pixels: ReturnType<typeof vi.fn> } => ({
  elements,
  pixels: vi.fn(async (i: number) => pictures[i] ?? null),
});
const square = (color: string, size = 10) =>
  sharp({ create: { width: size, height: size, channels: 4, background: color } })
    .png()
    .toBuffer();

describe('compareLooks', () => {
  test('names what changed in words, and pairs past elements only one page has', async () => {
    const before = seen([
      el('header'),
      el('h2 Trip'),
      el('BUTTON Book', { 'background-color': 'blue', color: 'white' }),
    ]);
    const after = seen([
      el('header'),
      el('p New'),
      el('h2 Trip'),
      el('BUTTON Book', { 'background-color': 'green', color: 'white' }),
    ]);
    expect(await compareLooks(before, after)).toEqual([
      { element: { before: 2, after: 3 }, what: ['background'], name: '[button: background]' },
    ]);
  });

  test('one label for the four sides of a border', async () => {
    const sides = (c: string) => ({
      'border-top-color': c,
      'border-right-color': c,
      'border-bottom-color': c,
      'border-left-color': c,
    });
    const [look] = await compareLooks(seen([el('DIV', sides('grey'))]), seen([el('DIV', sides('red'))]));
    expect(look.what).toEqual(['border colour']);
  });

  // As Chrome gives them: with none set in the CSS, a border's and an outline's colour is the text's.
  const line = (name: string, style: string, width: string, color: string) => ({
    [`${name}-style`]: style,
    [`${name}-width`]: width,
    [`${name}-color`]: color,
  });
  const lines = (style: string, width: string, color: string) => ({
    ...line('border-top', style, width, color),
    ...line('border-right', style, width, color),
    ...line('border-bottom', style, width, color),
    ...line('border-left', style, width, color),
    ...line('outline', style, width, color),
  });
  const changes = async (was: Record<string, string>, now: Record<string, string>) =>
    (await compareLooks(seen([el('P Hello', was)]), seen([el('P Hello', now)]))).flatMap(l => l.what);

  test('a text colour changed is not a change of the border and outline the element does not have', async () => {
    expect(
      await changes(
        { color: 'red', ...lines('none', '3px', 'red') },
        { color: 'blue', ...lines('none', '3px', 'blue') },
      ),
    ).toEqual(['text colour']);
  });

  test('nor of ones with a style and no width', async () => {
    expect(
      await changes(
        { color: 'red', ...lines('solid', '0px', 'red') },
        { color: 'blue', ...lines('solid', '0px', 'blue') },
      ),
    ).toEqual(['text colour']);
  });

  test('a border and an outline both pages draw, in another colour, changed colour', async () => {
    expect(await changes(lines('solid', '1px', 'red'), lines('solid', '1px', 'blue'))).toEqual([
      'border colour',
      'outline',
    ]);
  });

  test('a border that appears or goes is a border, not a border colour', async () => {
    const none = { ...lines('none', '3px', 'black'), ...line('outline', 'none', '3px', 'black') };
    const drawn = { ...lines('solid', '1px', 'green'), ...line('outline', 'none', '3px', 'green') };
    expect(await changes(none, drawn)).toEqual(['border']);
    expect(await changes(drawn, none)).toEqual(['border']);
  });

  test('a width set on a border nobody draws is no change', async () => {
    expect(await changes(lines('none', '3px', 'black'), lines('none', '8px', 'black'))).toEqual([]);
  });

  test('a colour a child inherits is marked on the parent alone', async () => {
    const page = (c: string) =>
      seen([el('NAV', { color: c }, { leaf: false }), el('A Home', { color: c }, { parent: 0 })]);
    expect((await compareLooks(page('black'), page('navy'))).map(l => [l.element.before, l.what])).toEqual([
      [0, ['text colour']],
    ]);
  });

  test('a child that changes colour on its own is marked', async () => {
    const before = seen([
      el('NAV', { color: 'black' }, { leaf: false }),
      el('A Home', { color: 'black' }, { parent: 0 }),
    ]);
    const after = seen([
      el('NAV', { color: 'black' }, { leaf: false }),
      el('A Home', { color: 'red' }, { parent: 0 }),
    ]);
    expect((await compareLooks(before, after)).map(l => [l.element.before, l.what])).toEqual([
      [1, ['text colour']],
    ]);
  });

  test('a style a child does not inherit is marked on both, though it changed alike', async () => {
    const page = (c: string) =>
      seen([
        el('NAV', { 'background-color': c }, { leaf: false }),
        el('A Home', { 'background-color': c }, { parent: 0, top: 10 }),
      ]);
    expect((await compareLooks(page('white'), page('navy'))).map(l => [l.element.before, l.what])).toEqual([
      [0, ['background']],
      [1, ['background']],
    ]);
  });

  test('a size set in CSS is a change, a size layout gives is not', async () => {
    const before = seen([
      el('MAIN', { width: 'auto' }, { leaf: false }),
      el('IMG logo.png', { width: '32px' }),
    ]);
    const after = seen([
      el('MAIN', { width: 'auto' }, { leaf: false }),
      el('IMG logo.png', { width: '48px' }),
    ]);
    expect((await compareLooks(before, after)).map(l => [l.element.before, l.what])).toEqual([[1, ['size']]]);
  });

  test('nothing changed, nothing found', async () => {
    const page = () => seen([el('P', { color: 'black' })]);
    expect(await compareLooks(page(), page())).toEqual([]);
  });

  test('top to bottom on the before page', async () => {
    const before = seen([
      el('P one', { color: 'black' }, { top: 500 }),
      el('P two', { color: 'black' }, { top: 100 }),
    ]);
    const after = seen([
      el('P one', { color: 'red' }, { top: 500 }),
      el('P two', { color: 'red' }, { top: 100 }),
    ]);
    expect((await compareLooks(before, after)).map(l => l.element.before)).toEqual([1, 0]);
  });
});

describe('pictures', () => {
  const picture = (sig = 'IMG logo.png') => el(sig, {}, { paints: true });

  test('a picture redrawn under the same name is a change; one drawn the same is not', async () => {
    const red = await square('#ff0000');
    const changed = await compareLooks(
      seen([picture()], { 0: red }),
      seen([picture()], { 0: await square('#ff8800') }),
    );
    expect(changed).toEqual([
      { element: { before: 0, after: 0 }, what: ['picture'], name: '[img: picture]' },
    ]);
    expect(await compareLooks(seen([picture()], { 0: red }), seen([picture()], { 0: red }))).toEqual([]);
  });

  test('an embedded page drawn otherwise is a change of the page in it, not of a picture', async () => {
    const frame = () => picture('IFRAME Payment widget.html');
    const changed = await compareLooks(
      seen([frame()], { 0: await square('#ff0000') }),
      seen([frame()], { 0: await square('#ff8800') }),
    );
    expect(changed.map(look => look.name)).toEqual(['[iframe: embedded page]']);
  });

  test('a picture layout scaled is no change, one redrawn at another size is; one not shot is not', async () => {
    const red = await square('#ff0000');
    const scaled = seen([picture()], { 0: await square('#ff0000', 12) });
    expect(await compareLooks(seen([picture()], { 0: red }), scaled)).toEqual([]);
    const redrawn = seen([picture()], { 0: await square('#ff8800', 12) });
    expect(await compareLooks(seen([picture()], { 0: red }), redrawn)).toHaveLength(1);
    expect(await compareLooks(seen([picture()], { 0: red }), seen([picture()], { 0: null }))).toEqual([]);
  });

  test('a background with elements inside it is not shot: its shot holds theirs too', async () => {
    const section = () => el('SECTION', {}, { paints: true, leaf: false });
    const before = seen([section()], { 0: await square('#ff0000') });
    const after = seen([section()], { 0: await square('#ff8800') });
    expect(await compareLooks(before, after)).toEqual([]);
    expect(before.pixels).not.toHaveBeenCalled();
  });

  test('a picture whose style changed is not shot as well', async () => {
    const before = seen([el('IMG logo.png', { opacity: '1' }, { paints: true })]);
    const after = seen([el('IMG logo.png', { opacity: '0.5' }, { paints: true })]);
    expect((await compareLooks(before, after)).map(l => l.what)).toEqual([['opacity']]);
    expect(before.pixels).not.toHaveBeenCalled();
  });

  test('an element unseen on both pages is no change: neither its style nor its pixels', async () => {
    // A copy button shown only on hover: its icon was redrawn, its colour changed, nobody sees either.
    const button = (color: string) => el('BUTTON copy', { color }, { paints: true, seen: false });
    const before = seen([button('black')], { 0: await square('#ff0000') });
    const after = seen([button('grey')], { 0: await square('#00ff00') });
    expect(await compareLooks(before, after)).toEqual([]);
    expect(before.pixels).not.toHaveBeenCalled();
  });

  test('an element that shows on one page only is still compared', async () => {
    const before = seen([el('BUTTON copy', { opacity: '0' }, { seen: false })]);
    const after = seen([el('BUTTON copy', { opacity: '1' })]);
    expect((await compareLooks(before, after)).map(l => l.what)).toEqual([['opacity']]);
  });

  test(`at most ${MAX_PICTURES} pictures are compared`, async () => {
    const many = Array.from({ length: MAX_PICTURES + 5 }, (_, i) => picture(`IMG ${i}.png`));
    const before = seen(many);
    await compareLooks(before, seen(many));
    expect(before.pixels).toHaveBeenCalledTimes(MAX_PICTURES);
  });
});
