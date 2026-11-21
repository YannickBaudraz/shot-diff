// The command with --selector, and the width and height of the images it writes.

import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { page, shotDiff, shotDiffText } from './helpers.ts';

test('--selector: only the changes inside the element are shot, the others ignored', () => {
  const { done, result } = shotDiff(
    page('tall/before.html'),
    page('tall/after.html'),
    '--title',
    't',
    '--selector',
    '#end',
  );
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(1);
  expect(result.shots[0].after.added).toEqual(['changed.']);
  expect(result.shots[0].after.box.height).toBeLessThan(900); // around the change, not the page
  expect(result.ignored).toEqual({ removed: ['as it was.'], added: ['changed.'] });
  expect(result.leftOut).toEqual({ removed: [], added: [] });
  expect(done.stderr).toMatch(/2 change\(s\) outside --selector ignored/);
});

test('--selector: each image is as wide as the element and its padding, not the page', async () => {
  // #end is 600px wide, from 40px; with 80px of padding the shot starts at the page's edge, 760px wide.
  const { done, result } = shotDiff(
    page('tall/before.html'),
    page('tall/after.html'),
    '--title',
    't',
    '--selector',
    '#end',
  );
  expect(done.status, done.stderr).toBe(0);
  const [shot] = result.shots;
  for (const side of ['before', 'after']) {
    expect(shot[side].box).toMatchObject({ x: 0, width: 760 });
    // The image is the box at the scale, in its frame: not the page's 1280px.
    const { width } = await sharp(readFileSync(shot[side].file)).metadata();
    expect(width).toBeGreaterThan(760 * 2);
    expect(width).toBeLessThan(760 * 2 + 20);
  }
});

test('each image is listed with its size, in the pixels --height and --max-height count in', () => {
  const done = shotDiffText(
    page('tall/before.html'),
    page('tall/after.html'),
    '--title',
    't',
    '--selector',
    '#end',
  );
  expect(done.status, done.stderr).toBe(0);
  // 760px wide (see the --selector test above); the height is the change and its padding.
  expect(done.stdout).toMatch(/shot-before\.png: 1 part\(s\) removed, 760x\d+ px$/m);
  expect(done.stdout).toMatch(/shot-after\.png: 1 part\(s\) added, 760x\d+ px$/m);
  expect(done.stderr).not.toMatch(/taller than/);
});

test('an image taller than two windows is said, with what to do about it', () => {
  // A window 80px high: the change and its padding make a shot of about 184px, over two windows.
  const done = shotDiffText(
    page('tall/before.html'),
    page('tall/after.html'),
    '--title',
    't',
    '--selector',
    '#end',
    '--height',
    '80',
    '--max-height',
    '2400',
  );
  expect(done.status, done.stderr).toBe(0);
  expect(done.stderr).toMatch(/2 image\(s\) are taller than two windows \(--height 80\)/);
  expect(done.stderr).toMatch(/shot-before\.png/);
  expect(done.stderr).toMatch(/--max-height/);
  expect(done.stderr).toMatch(/--selector/);
});

test('--selector takes in the shadow trees inside its element', () => {
  const pages = [page('shadow/before.html'), page('shadow/after.html')];
  const inside = shotDiff(...pages, '--title', 't', '--selector', 'main');
  expect(inside.result.shots[0].after.added).toHaveLength(3);
  expect(inside.result.ignored).toEqual({ removed: [], added: [] });
  const outside = shotDiff(...pages, '--title', 't', '--selector', 'h1');
  expect(outside.result.ignored.added).toHaveLength(3);
});
