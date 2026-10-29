import { describe, expect, test } from 'vitest';
import { plan, type Frame, type Place, type PlanOptions } from '../src/plan.ts';
import type { Region, Span } from '../src/page.ts';

/** A change from `top` to `bottom`, the unchanged words around it included. */
const at = (top: number, bottom = top + 20): Span => ({ top, bottom, changedTop: top, changedBottom: bottom });
const both = (s: Span | null): Place => ({ before: s, after: s });
const OPTIONS: PlanOptions = { padding: 80, maxHeight: 2400, height: 900, selector: null };

/** A page 1000px wide, whose snap moves edges as `snap` says (not at all by default), and whose
 * elements are where `regions` says. */
const frame = (snap: (r: Region) => Region = r => r, regions: Record<string, Region> = {}): Frame =>
  ({ width: 1000, snap: async r => snap(r), region: async s => regions[s] ?? null });
const pages = (f: Frame = frame()) => ({ before: f, after: f });

describe('plan', () => {
  test('changes close together share one shot, padded around them', async () => {
    const p = await plan([both(at(300)), both(at(100)), both(at(500))], OPTIONS, pages());
    expect(p.shots).toEqual([{ changes: [1, 0, 2], before: { x: 0, y: 20, width: 1000, height: 580 }, after: { x: 0, y: 20, width: 1000, height: 580 } }]);
    expect(p.leftOut).toEqual({ before: [], after: [] });
  });

  test('changes far apart get a shot each, top to bottom', async () => {
    const p = await plan([both(at(8000)), both(at(100)), both(at(5000)), both(at(300))], OPTIONS, pages());
    expect(p.shots.map(s => s.changes)).toEqual([[1, 3], [2], [0]]);
  });

  test('the two pages are grouped alike, by the taller of the two', async () => {
    const p = await plan([{ before: at(100), after: at(100) }, { before: at(1000), after: at(3000) }], OPTIONS, pages());
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
    expect(p.shots).toEqual([{ changes: [], before: { x: 0, y: 0, width: 1000, height: 900 }, after: { x: 0, y: 0, width: 1000, height: 900 } }]);
  });

  test('the shot is where snap moves its edges', async () => {
    const p = await plan([both(at(300))], OPTIONS, pages(frame(r => ({ top: r.top - 10, bottom: r.bottom + 10 }))));
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
    const p = await plan(changes, OPTIONS, pages(frame(r => ({ top: r.top - 300, bottom: r.bottom }))));
    expect(p.shots.map(s => s.changes)).toEqual([[0, 1]]);
    expect(p.leftOut).toEqual({ before: [1], after: [1] });
  });

  test('--selector: one shot around the element, and the changes outside it left out', async () => {
    const options = { ...OPTIONS, selector: '#end' };
    const p = await plan([both(at(100)), both(at(5000))], options, pages(frame(undefined, { '#end': { top: 4900, bottom: 5100 } })));
    expect(p.shots).toHaveLength(1);
    expect(p.shots[0].before).toEqual({ x: 0, y: 4820, width: 1000, height: 360 });
    expect(p.leftOut).toEqual({ before: [0], after: [0] });
  });

  test('--selector that matches nothing names the page', async () => {
    const options = { ...OPTIONS, selector: '#gone' };
    await expect(plan([], options, { before: frame(undefined, { '#gone': { top: 0, bottom: 10 } }), after: frame() }))
      .rejects.toThrow('--selector #gone matches nothing on the after page');
  });

  test('a side with no changed words has nothing to leave out', async () => {
    const empty: Span = { top: 3000, bottom: 3020, changedTop: null, changedBottom: null };
    const p = await plan([{ before: empty, after: at(100) }], { ...OPTIONS, selector: '#top' }, pages(frame(undefined, { '#top': { top: 0, bottom: 200 } })));
    expect(p.leftOut).toEqual({ before: [], after: [] });
  });
});
