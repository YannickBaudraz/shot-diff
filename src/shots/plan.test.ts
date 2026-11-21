import { describe, expect, test } from 'vitest';
import type { Area, Region, Span } from '../geometry.ts';
import { plan, type Place, type PlanOptions, type PlanPage } from './plan.ts';

/** A change from `top` to `bottom`, the unchanged words around it included. */
const at = (top: number, bottom = top + 20): Span => ({
  top,
  bottom,
  changed: { top, bottom },
  inside: true,
  clipped: false,
});
/** A change at `top` that a scroll area cuts off: the page drew no box for it. */
const clippedAt = (top: number): Span => ({ ...at(top), changed: null, clipped: true });
/** The same change, outside --selector's element as the page said when it marked it. */
const outsideAt = (top: number, bottom = top + 20): Span => ({ ...at(top, bottom), inside: false });
/** Where an element is. */
const el = (top: number, bottom: number): Region => ({ top, bottom });
const both = (s: Span | null): Place => ({ before: s, after: s });
const OPTIONS: PlanOptions = { padding: 80, maxHeight: 2400, height: 900, selector: null };

/** A page 1000px wide, whose snap moves edges as `snap` says (not at all by default), and whose
 * elements are where `regions` says, as wide as the page unless they say otherwise. */
const fakePage = (
  snap: (r: Region) => Region = r => r,
  regions: Record<string, Region | Area> = {},
): PlanPage => ({
  width: 1000,
  snap: async r => snap(r),
  region: async s => (regions[s] ? { left: 0, right: 1000, ...regions[s] } : null),
});
const pages = (page: PlanPage = fakePage()) => ({ before: page, after: page });

describe('plan', () => {
  test('changes close together share one shot, padded around them', async () => {
    const p = await plan([both(at(300)), both(at(100)), both(at(500))], OPTIONS, pages());
    expect(p.shots).toEqual([
      {
        changes: [1, 0, 2],
        before: { x: 0, y: 20, width: 1000, height: 580 },
        after: { x: 0, y: 20, width: 1000, height: 580 },
      },
    ]);
    expect(p.leftOut).toEqual({ before: [], after: [] });
  });

  test('changes far apart get a shot each, top to bottom', async () => {
    const p = await plan([both(at(8000)), both(at(100)), both(at(5000)), both(at(300))], OPTIONS, pages());
    expect(p.shots.map(s => s.changes)).toEqual([[1, 3], [2], [0]]);
  });

  test('the two pages are grouped alike, by the taller of the two', async () => {
    const p = await plan(
      [
        { before: at(100), after: at(100) },
        { before: at(1000), after: at(3000) },
      ],
      OPTIONS,
      pages(),
    );
    expect(p.shots.map(s => s.changes)).toEqual([[0], [1]]);
  });

  test("a change with no place on one page does not stretch that page's shot", async () => {
    const p = await plan([both(at(100)), { before: null, after: at(200) }], OPTIONS, pages());
    expect(p.shots.map(s => s.changes)).toEqual([[0, 1]]);
    expect(p.shots[0].before).toEqual({ x: 0, y: 20, width: 1000, height: 180 });
  });

  test('padding stops at the top of the page', async () => {
    const p = await plan([both(at(10))], OPTIONS, pages());
    expect(p.shots[0].before.y).toBe(0);
  });

  test('no changes: one shot of the top of the page, the viewport high', async () => {
    const p = await plan([], OPTIONS, pages());
    expect(p.shots).toEqual([
      {
        changes: [],
        before: { x: 0, y: 0, width: 1000, height: 900 },
        after: { x: 0, y: 0, width: 1000, height: 900 },
      },
    ]);
  });

  test('the shot is where snap moves its edges', async () => {
    const p = await plan(
      [both(at(300))],
      OPTIONS,
      pages(fakePage(r => ({ top: r.top - 10, bottom: r.bottom + 10 }))),
    );
    expect(p.shots[0].before).toEqual({ x: 0, y: 210, width: 1000, height: 200 });
  });
});

describe('--selector, the width of a shot', () => {
  const options = { ...OPTIONS, selector: '#card' };
  /** The element, from `left` to `right` across, and from 900 to 1400 down. */
  const card = (left: number, right: number): Area => ({ top: 900, bottom: 1400, left, right });

  test('is the element and the padding on each side, not the whole page', async () => {
    const page = fakePage(undefined, { '#card': card(200, 900) });
    const p = await plan([both(at(1000))], options, pages(page));
    expect(p.shots[0].before).toMatchObject({ x: 120, width: 860 });
    expect(p.shots[0].after).toMatchObject({ x: 120, width: 860 });
  });

  test('is the same on both pages, taking in the element wherever each page has it', async () => {
    const p = await plan([both(at(1000))], options, {
      before: fakePage(undefined, { '#card': card(200, 800) }),
      after: fakePage(undefined, { '#card': card(300, 900) }),
    });
    // From the before page's left to the after page's right, padded.
    expect(p.shots[0].before).toMatchObject({ x: 120, width: 860 });
    expect(p.shots[0].after).toMatchObject({ x: 120, width: 860 });
  });

  test('takes in the marks of a change drawn past the element, as a dropdown can be', async () => {
    const page = fakePage(undefined, { '#card': card(200, 600) });
    const dropdown = { ...at(1000), across: { left: 550, right: 800 } };
    const p = await plan([both(dropdown)], options, pages(page));
    // From the element's left to the marks' right, padded.
    expect(p.shots[0].before).toMatchObject({ x: 120, width: 760 });
    expect(p.shots[0].after).toMatchObject({ x: 120, width: 760 });
  });

  test('takes in no marks of a change outside the element, which is not shot', async () => {
    const page = fakePage(undefined, { '#card': card(200, 600) });
    const outside = { ...at(1000), inside: false, across: { left: 50, right: 990 } };
    const p = await plan([both(at(1000)), both(outside)], options, pages(page));
    expect(p.shots[0].before).toMatchObject({ x: 120, width: 560 });
  });

  test('is in whole pixels, rounded out so the element stays whole', async () => {
    const page = fakePage(undefined, { '#card': card(100.5, 400.25) });
    const p = await plan([both(at(1000))], options, pages(page));
    expect(p.shots[0].before).toMatchObject({ x: 20, width: 461 });
    expect(p.shots[0].after).toMatchObject({ x: 20, width: 461 });
  });

  test('is never narrower than the title band needs: a narrow element is centred in it', async () => {
    // 200px and the padding is 360px; the band needs 400.
    const page = fakePage(undefined, { '#card': card(400, 600) });
    const p = await plan([both(at(1000))], options, pages(page));
    expect(p.shots[0].before).toMatchObject({ x: 300, width: 400 });
  });

  test('stays on the page: a narrow element at its edge is not centred past it', async () => {
    const left = await plan([both(at(1000))], options, pages(fakePage(undefined, { '#card': card(0, 100) })));
    expect(left.shots[0].before).toMatchObject({ x: 0, width: 400 });
    const right = await plan(
      [both(at(1000))],
      options,
      pages(fakePage(undefined, { '#card': card(900, 1000) })),
    );
    expect(right.shots[0].before).toMatchObject({ x: 600, width: 400 });
  });
});

describe('the heading of what a change is in', () => {
  test('is taken in when it is less than a window high above the change', async () => {
    const p = await plan([both({ ...at(1000), heading: 600 })], OPTIONS, pages());
    expect(p.shots[0].before).toEqual({ x: 0, y: 520, width: 1000, height: 580 });
  });

  test('is left out when taking it in would cut the change from its shot, once snap has moved the edges', async () => {
    // Padded, heading to change is 590px, under the maximum; snap raises the top by 100px.
    const p = await plan(
      [both({ ...at(1000, 1040), heading: 610 })],
      { ...OPTIONS, maxHeight: 600 },
      pages(fakePage(r => ({ top: r.top - 100, bottom: r.bottom + 6 }))),
    );
    expect(p.leftOut).toEqual({ before: [], after: [] });
  });

  test('--selector: one above the element is none, not a heading at its top', async () => {
    const options = { ...OPTIONS, selector: '#main' };
    const page = fakePage(undefined, { '#main': el(600, 3000) });
    const p = await plan([both({ ...at(1100), heading: 100 })], options, pages(page));
    expect(p.shots[0].before.y).toBe(1020);
  });

  test('is left out when it is further above, or would make the shot taller than the maximum', async () => {
    const far = await plan([both({ ...at(1000), heading: 50 })], OPTIONS, pages());
    expect(far.shots[0].before.y).toBe(920);
    const tall = await plan([both({ ...at(1000), heading: 700 })], { ...OPTIONS, maxHeight: 400 }, pages());
    expect(tall.shots[0].before.y).toBe(920);
  });
});

describe('the top of a shot, which snap moves out of an item', () => {
  /** A page that notes what snap was asked, and moves nothing. */
  const asking = () => {
    const asked: { region: Region; limits?: { room: number; keep: number } }[] = [];
    const page: PlanPage = {
      ...fakePage(),
      snap: async (region, limits) => (asked.push({ region, limits }), region),
    };
    return { asked, page };
  };

  test('may go up as far as the shot has room for under --max-height, and no lower than what it is of', async () => {
    const { asked, page } = asking();
    await plan([both(at(1000, 1040))], { ...OPTIONS, maxHeight: 600 }, pages(page));
    // Padded, 920 to 1120: 200px high, 400px under the maximum; it must still start by 1000.
    expect(asked.map(a => a.limits)).toEqual([
      { room: 400, keep: 1000 },
      { room: 400, keep: 1000 },
    ]);
  });

  test('has no room when the shot is already as tall as it may be', async () => {
    const { asked, page } = asking();
    await plan([both(at(1000, 1040))], { ...OPTIONS, maxHeight: 200 }, pages(page));
    expect(asked[0].limits).toEqual({ room: 0, keep: 1000 });
  });
});

describe('both shots of a pair', () => {
  test('show the same place: an edge on one page takes in what the other shows, by the unchanged words near it', async () => {
    // On the after page, what is above the change sits 200px higher, what is below it 280px lower.
    const unchanged = [
      { before: el(900, 920), after: el(700, 720) },
      { before: el(1110, 1130), after: el(1390, 1410) },
    ];
    const p = await plan([{ before: at(1000), after: at(1000, 1300) }], OPTIONS, pages(), unchanged);
    expect(p.shots[0].before).toEqual({ x: 0, y: 920, width: 1000, height: 180 });
    expect(p.shots[0].after).toEqual({ x: 0, y: 720, width: 1000, height: 660 });
  });

  test('--selector: do not grow past the element on either page', async () => {
    const options = { ...OPTIONS, selector: '#card' };
    const page = fakePage(undefined, { '#card': el(900, 1400) });
    // Above the element, the after page has the same words 200px higher.
    const unchanged = [{ before: el(900, 920), after: el(700, 720) }];
    const p = await plan([both(at(1000))], options, pages(page), unchanged);
    expect(p.shots[0].after.y).toBe(900); // up to the element's top, not to the words above it
  });

  test('keep their edges where no unchanged word is near them', async () => {
    const unchanged = [{ before: el(400, 420), after: el(100, 120) }]; // 500px above the shot
    const p = await plan([both(at(1000))], OPTIONS, pages(), unchanged);
    expect(p.shots[0].after.y).toBe(920);
  });
});

describe('what is left out', () => {
  test('a change taller than the maximum is cut, and said to be left out', async () => {
    const p = await plan([both(at(100, 3000))], OPTIONS, pages());
    expect(p.shots[0].before.height).toBe(2400);
    expect(p.leftOut).toEqual({ before: [0], after: [0] });
  });

  test('a component taller than the maximum is shown by its top, and not left out', async () => {
    const tall = (): Place => ({
      before: { ...at(100, 3000), byTop: true },
      after: { ...at(100, 100), changed: null },
    });
    const p = await plan([tall()], OPTIONS, pages());
    expect(p.shots[0].before.height).toBe(2400);
    expect(p.leftOut).toEqual({ before: [], after: [] });
  });

  test('a shot that snap grows past the maximum is cut, and the change at its bottom is left out', async () => {
    const changes = [both(at(400)), both(at(2500))]; // padded, 320 to 2600: 2280px, they share a shot
    // snap raises the top by 300px (a tall line above), so the shot would run 20 to 2600: cut at 2420.
    const p = await plan(changes, OPTIONS, pages(fakePage(r => ({ top: r.top - 300, bottom: r.bottom }))));
    expect(p.shots.map(s => s.changes)).toEqual([[0, 1]]);
    expect(p.leftOut).toEqual({ before: [1], after: [1] });
  });

  test('--selector: the changes outside the element are ignored, those inside shot around them', async () => {
    const options = { ...OPTIONS, selector: '#end' };
    const p = await plan(
      [both(outsideAt(100)), both(at(5000))],
      options,
      pages(fakePage(undefined, { '#end': el(4000, 9000) })),
    );
    expect(p.shots).toEqual([
      {
        changes: [1],
        before: { x: 0, y: 4920, width: 1000, height: 180 },
        after: { x: 0, y: 4920, width: 1000, height: 180 },
      },
    ]);
    expect(p.outside).toEqual([0]);
    expect(p.leftOut).toEqual({ before: [], after: [] });
  });

  test('--selector: changes far apart inside the element still get a shot each', async () => {
    const options = { ...OPTIONS, selector: 'main' };
    const p = await plan(
      [both(at(100)), both(at(5000))],
      options,
      pages(fakePage(undefined, { main: el(0, 9000) })),
    );
    expect(p.shots.map(s => s.changes)).toEqual([[0], [1]]);
    expect(p.outside).toEqual([]);
  });

  test('--selector: a change inside the element on one page only is kept, placed on that page', async () => {
    const options = { ...OPTIONS, selector: '#end' };
    const p = await plan([{ before: outsideAt(100), after: at(5000) }], options, {
      before: fakePage(undefined, { '#end': el(4000, 6000) }),
      after: fakePage(undefined, { '#end': el(4000, 6000) }),
    });
    expect(p.outside).toEqual([]);
    expect(p.shots[0].after).toEqual({ x: 0, y: 4920, width: 1000, height: 180 });
    expect(p.leftOut).toEqual({ before: [], after: [] });
  });

  test('--selector: a change the page says is outside the element is ignored, at any height', async () => {
    const options = { ...OPTIONS, selector: 'article' };
    const sidebarAd = both(outsideAt(500)); // beside the article, at the same height
    const p = await plan(
      [both(at(500)), sidebarAd],
      options,
      pages(fakePage(undefined, { article: el(0, 2000) })),
    );
    expect(p.shots.map(s => s.changes)).toEqual([[0]]);
    expect(p.outside).toEqual([1]);
  });

  test('--selector: the unchanged words around a change do not stretch its shot past the element', async () => {
    const options = { ...OPTIONS, selector: '#top' };
    // The change is at 100, but its next unchanged word is 5000px further down.
    const reaching: Span = {
      top: 100,
      bottom: 5120,
      changed: { top: 100, bottom: 120 },
      inside: true,
      clipped: false,
    };
    const p = await plan([both(reaching)], options, pages(fakePage(undefined, { '#top': el(0, 200) })));
    expect(p.shots[0].before).toEqual({ x: 0, y: 20, width: 1000, height: 260 });
  });

  test('--selector with no change inside: one shot of the element, from its top', async () => {
    const options = { ...OPTIONS, selector: '#end' };
    const p = await plan(
      [both(outsideAt(100))],
      options,
      pages(fakePage(undefined, { '#end': el(4000, 4300) })),
    );
    expect(p.shots).toEqual([
      {
        changes: [],
        before: { x: 0, y: 3920, width: 1000, height: 460 },
        after: { x: 0, y: 3920, width: 1000, height: 460 },
      },
    ]);
    expect(p.outside).toEqual([0]);
  });

  test('--selector that matches nothing names the page', async () => {
    const options = { ...OPTIONS, selector: '#gone' };
    await expect(
      plan([], options, {
        before: fakePage(undefined, { '#gone': el(0, 10) }),
        after: fakePage(),
      }),
    ).rejects.toThrow('--selector #gone matches nothing on the after page');
  });

  test('a side with no changed words has nothing to leave out', async () => {
    const empty: Span = { top: 3000, bottom: 3020, changed: null, inside: false, clipped: false };
    const p = await plan(
      [{ before: empty, after: at(100) }],
      { ...OPTIONS, selector: '#top' },
      pages(fakePage(undefined, { '#top': el(0, 200) })),
    );
    expect(p.leftOut).toEqual({ before: [], after: [] });
  });
});

describe('what a scroll area cuts off', () => {
  test('a change cut off on one page is shot where it is, and listed as hidden on that page', async () => {
    const p = await plan([{ before: clippedAt(300), after: at(300) }], OPTIONS, pages());
    expect(p.shots.map(s => s.changes)).toEqual([[0]]);
    expect(p.shots[0].before).toEqual({ x: 0, y: 220, width: 1000, height: 180 });
    expect(p.hidden).toEqual({ before: [0], after: [] });
    expect(p.leftOut).toEqual({ before: [], after: [] });
  });

  test('a change cut off on both pages gets no shot of its own', async () => {
    const p = await plan([both(clippedAt(100)), both(at(5000))], OPTIONS, pages());
    expect(p.shots.map(s => s.changes)).toEqual([[1]]);
    expect(p.hidden).toEqual({ before: [0], after: [0] });
  });

  test('--selector: a change cut off inside the element is hidden, not ignored', async () => {
    const p = await plan(
      [both(clippedAt(100))],
      { ...OPTIONS, selector: 'main' },
      pages(fakePage(undefined, { main: el(0, 2000) })),
    );
    expect(p.outside).toEqual([]);
    expect(p.hidden).toEqual({ before: [0], after: [0] });
  });
});
