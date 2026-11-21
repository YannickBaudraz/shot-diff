// Where the command's shots start and how tall they are, and the changes they leave out.

import { describe, expect, test } from 'vitest';
import { page, shotDiff } from './helpers.ts';

test('the top of a shot does not cut a line of text in half', () => {
  // The heading's text runs from 46px to 82px, the changed line starts at 112px: 50px of padding
  // alone would start the shot at 62px, through the heading.
  const { result } = shotDiff(
    page('words/before.html'),
    page('words/after.html'),
    '--title',
    't',
    '--padding',
    '50',
  );
  expect(result.shots[0].before.box.y).toBeLessThanOrEqual(46);
});

test('changes far apart get a numbered pair each, and none is left out', () => {
  const { done, result } = shotDiff(page('tall/before.html'), page('tall/after.html'), '--title', 't');
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(2);
  expect(result.shots.map((s: { before: { file: string } }) => s.before.file.split('/').pop())).toEqual([
    'shot-1-before.png',
    'shot-2-before.png',
  ]);
  expect(result.shots[0].before.removed).toEqual(['as it was.']);
  expect(result.shots[1].after.added).toEqual(['changed.']);
  expect(result.leftOut).toEqual({ removed: [], added: [] });
  expect(done.stderr).not.toMatch(/cut from every image/);
});

test('a shot opens at the top of an item, not inside the one the padding falls in', () => {
  // 30 items of three lines, 100px apart; the change is in item 12, whose padding above falls in item 11.
  const { done, result } = shotDiff(
    page('items/before.html'),
    page('items/after.html'),
    '--title',
    't',
    '--height',
    '400',
  );
  expect(done.status, done.stderr).toBe(0);
  for (const side of ['before', 'after']) {
    const { y } = result.shots[0][side].box;
    // An item's text runs from 100n to 100n + 60: the shot starts between two items.
    expect(y % 100 < 1 || y % 100 > 60, `starts at ${y}`).toBe(true);
    expect(y).toBeLessThan(1100);
    expect(y).toBeGreaterThan(1000);
  }
  expect(result.leftOut).toEqual({ removed: [], added: [] });
});

describe('--max-height, when not given', () => {
  // Nine changes, 300px apart, from 300px to 2,700px down: more than one shot's height at any maximum here.
  const run = (...args: string[]) =>
    shotDiff(page('items/before.html'), page('items/after-many.html'), '--title', 't', ...args);
  const heights = (result: { shots: Record<'before' | 'after', { box: { height: number } }>[] }) =>
    result.shots.flatMap(shot => [shot.before.box.height, shot.after.box.height]);

  test('is one and a half windows: about what a pull request shows without much scrolling', () => {
    const { done, result } = run();
    expect(done.status, done.stderr).toBe(0);
    expect(result.shots.length).toBeGreaterThan(1);
    expect(Math.max(...heights(result))).toBeLessThanOrEqual(900 * 1.5);
    expect(result.leftOut).toEqual({ removed: [], added: [] });
  });

  test('goes with --height', () => {
    const { done, result } = run('--height', '600');
    expect(done.status, done.stderr).toBe(0);
    expect(Math.max(...heights(result))).toBeLessThanOrEqual(600 * 1.5);
    expect(Math.max(...heights(result))).toBeGreaterThan(600); // more than a window: it is not --height itself
  });

  test('is what --max-height says, when given', () => {
    const { done, result } = run('--max-height', '2400');
    expect(done.status, done.stderr).toBe(0);
    expect(Math.max(...heights(result))).toBeGreaterThan(900 * 1.5);
  });
});

test('a change cut from its shot is listed as left out, not as in the shot', () => {
  const { done, result } = shotDiff(
    page('words/before.html'),
    page('words/after.html'),
    '--title',
    't',
    '--padding',
    '0',
    '--max-height',
    '20',
  );
  expect(done.status, done.stderr).toBe(0);
  for (const shot of result.shots) expect(shot.before.removed).toEqual([]);
  // The paragraph added is taller than the shot, and shown by its top; the words are cut from every shot.
  expect(result.shots.flatMap((shot: { after: { added: string[] } }) => shot.after.added)).toEqual([
    '[p: added] Step 13 merges it.',
  ]);
  expect(result.leftOut).toEqual({
    removed: ['approve them before they are published.'],
    added: ['confirm the breakdown in the same session.'],
  });
  expect(done.stderr).toMatch(/cut from every image; raise --max-height/);
});

test('a change a scroll area cuts off is listed as hidden, and no box is drawn for it', () => {
  const { done, result } = shotDiff(page('clipped/before.html'), page('clipped/after.html'), '--title', 't');
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(1);
  expect(result.shots[0].before.removed).toEqual(['as it was.']); // the line shown on the page
  expect(result.shots[0].after.added).toEqual(['changed.']);
  expect(result.hidden).toEqual({ removed: ['as it was.'], added: ['changed.'] });
  expect(result.leftOut).toEqual({ removed: [], added: [] });
  expect(done.stderr).toMatch(/2 change\(s\) are in a part of the page a scroll area cuts off/);
});

test('--max-height cuts a change too tall for it, and says so', () => {
  const { done, result } = shotDiff(
    page('dashboard/before.html'),
    page('dashboard/after.html'),
    '--title',
    't',
    '--max-height',
    '120',
  );
  expect(done.status, done.stderr).toBe(0);
  expect(result.leftOut.removed).toContain('[section: spacing]');
  expect(done.stderr).toMatch(/cut from every image/);
});
