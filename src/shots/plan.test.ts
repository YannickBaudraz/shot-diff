import { describe, expect, test } from 'vitest';
import type { Region, Span } from '../geometry.ts';
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
 * elements are where `regions` says. */
const fakePage = (snap: (r: Region) => Region = r => r, regions: Record<string, Region> = {}): PlanPage => ({
  width: 1000,
  snap: async r => snap(r),
  region: async s => regions[s] ?? null,
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

describe('what is left out', () => {
  test('a change taller than the maximum is cut, and said to be left out', async () => {
    const p = await plan([both(at(100, 3000))], OPTIONS, pages());
    expect(p.shots[0].before.height).toBe(2400);
    expect(p.leftOut).toEqual({ before: [0], after: [0] });
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
