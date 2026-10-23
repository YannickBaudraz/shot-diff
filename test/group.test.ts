import { describe, expect, test } from 'vitest';
import { group, outside } from '../src/group.ts';
import type { Span } from '../src/page.ts';

const at = (top: number, bottom = top + 20): Span => ({ top, bottom, changedTop: top, changedBottom: bottom });

describe('group', () => {
  test('changes close together share one shot', () => {
    const spans = [at(100), at(300), at(500)];
    const groups = group(spans, spans, 80, 2400);
    expect(groups.map(g => g.hunks)).toEqual([[0, 1, 2]]);
    expect(groups[0].before).toEqual({ top: 100, bottom: 520 });
  });

  test('changes far apart get a shot each', () => {
    const spans = [at(100), at(300), at(5000), at(8000)];
    expect(group(spans, spans, 80, 2400).map(g => g.hunks)).toEqual([[0, 1], [2], [3]]);
  });

  test('the two pages are grouped alike, by the taller of the two', () => {
    const before = [at(100), at(1000)];
    const after = [at(100), at(3000)]; // the after page added a lot between them
    expect(group(before, after, 80, 2400).map(g => g.hunks)).toEqual([[0], [1]]);
  });

  test('a hunk with no place on one page does not stretch that page\'s region', () => {
    const groups = group([at(100), null], [at(100), at(200)], 80, 2400);
    expect(groups.map(g => g.hunks)).toEqual([[0, 1]]);
    expect(groups[0].before).toEqual({ top: 100, bottom: 120 });
  });

  test('no hunks, no groups', () => {
    expect(group([], [], 80, 2400)).toEqual([]);
  });
});

describe('outside', () => {
  test('changed words below the cut are outside', () => {
    expect(outside(at(2500), { top: 0, bottom: 2400 })).toBe(true);
    expect(outside(at(100), { top: 0, bottom: 2400 })).toBe(false);
  });

  test('a side with no changed words has nothing to leave out', () => {
    expect(outside({ top: 3000, bottom: 3020, changedTop: null, changedBottom: null }, { top: 0, bottom: 100 })).toBe(false);
    expect(outside(null, { top: 0, bottom: 100 })).toBe(false);
  });
});
