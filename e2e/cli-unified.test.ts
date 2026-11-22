// --unified: a pair whose changes are all removals is its before image alone, and a pair whose
// changes are all additions its after image alone. Decided per pair, from the changes themselves.

import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from 'vitest';
import { page, shotDiff, shotDiffText } from './helpers.ts';

type Written = { file: string } | null;
type Shots = { before: Written; after: Written }[];

/** The images a run wrote, by file name. */
function written(shots: Shots): string[] {
  const file = shots.flatMap(shot => [shot.before, shot.after]).find(side => side)!.file;
  return readdirSync(dirname(file)).sort();
}

// The components page with a card more: from it to the page without, the card is removed, and
// nothing is added.
const removed = [page('components/after.html'), page('components/before.html')];
const added = [page('components/before.html'), page('components/after.html')];

test('a pair whose changes are all removals is its before image alone', () => {
  const { done, result } = shotDiff(...removed, '--title', 't', '--unified');
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(1);
  expect(result.shots[0].before.removed).toEqual(['[section: removed] Team 9 euros per month']);
  expect(result.shots[0].after).toBeNull();
  expect(written(result.shots)).toEqual(['shot-before.png']);
});

test('a pair whose changes are all additions is its after image alone', () => {
  const { done, result } = shotDiff(...added, '--title', 't', '--unified');
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(1);
  expect(result.shots[0].before).toBeNull();
  expect(result.shots[0].after.added).toEqual(['[section: added] Team 9 euros per month']);
  expect(written(result.shots)).toEqual(['shot-after.png']);
});

test('the terminal says the one image written', () => {
  const done = shotDiffText(...removed, '--title', 't', '--unified');
  expect(done.status, done.stderr).toBe(0);
  const lines = done.stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/shot-before\.png: 1 part\(s\) removed, \d+x\d+ px$/);
  expect(readdirSync(done.out)).toEqual(['shot-before.png']);
});

test('with --dry-run, it lists the one image it would write', () => {
  const { done, result } = shotDiff(...added, '--dry-run', '--unified');
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots[0].before).toBeNull();
  expect(result.shots[0].after.file).toMatch(/shot-after\.png$/);
  const text = shotDiffText(...added, '--dry-run', '--unified');
  const images = text.stdout.split('\n').filter(line => line.startsWith('would write'));
  expect(images).toHaveLength(1);
  expect(images[0]).toMatch(/^would write .*shot-after\.png: 1 part\(s\) added/);
  expect(readdirSync(text.out)).toEqual([]);
});

test('a pair with both removals and additions keeps both images', () => {
  const { done, result } = shotDiff(
    page('words/before.html'),
    page('words/after.html'),
    '--title',
    't',
    '--unified',
  );
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots[0].before.removed).toEqual(['approve them before they are published.']);
  expect(result.shots[0].after.added).toHaveLength(2);
  expect(written(result.shots)).toEqual(['shot-after.png', 'shot-before.png']);
});

test('of pairs far apart, only the one whose changes are all additions is one image', () => {
  // The top line reworded, and a line added at the bottom, 5,000px down.
  const { done, result } = shotDiff(
    page('tall/before.html'),
    page('tall/after-added.html'),
    '--title',
    't',
    '--unified',
  );
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(2);
  expect(result.shots[0].before.removed).toEqual(['as it was.']);
  expect(result.shots[0].after.added).toEqual(['changed.']);
  expect(result.shots[1].before).toBeNull();
  expect(result.shots[1].after.added).toEqual(['[p: added] A line added under it.']);
  expect(written(result.shots)).toEqual(['shot-1-after.png', 'shot-1-before.png', 'shot-2-after.png']);
});

test('a change cut from both sides of its pair still keeps both images', () => {
  // The reworded line does not fit under --max-height: the first pair shows nothing changed on
  // either side, yet its change has words on both. The second pair is the paragraph added alone.
  const { done, result } = shotDiff(
    page('words/before.html'),
    page('words/after.html'),
    '--title',
    't',
    '--padding',
    '0',
    '--max-height',
    '20',
    '--unified',
  );
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(2);
  expect(result.shots[0].before.removed).toEqual([]);
  expect(result.shots[0].after.added).toEqual([]);
  expect(result.shots[1].before).toBeNull();
  expect(written(result.shots)).toEqual(['shot-1-after.png', 'shot-1-before.png', 'shot-2-after.png']);
});

test('pages with no difference keep both images', () => {
  const same = page('words/before.html');
  const { done, result } = shotDiff(same, same, '--title', 't', '--unified');
  expect(done.status, done.stderr).toBe(0);
  expect(written(result.shots)).toEqual(['shot-after.png', 'shot-before.png']);
});

test('without --unified, a pair whose changes are all removals keeps both images', () => {
  const { done, result } = shotDiff(...removed, '--title', 't');
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots[0].after.added).toEqual([]);
  expect(written(result.shots)).toEqual(['shot-after.png', 'shot-before.png']);
});
