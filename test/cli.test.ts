import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { cli, page, shotDiff } from './run.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test('marks what was removed and what was added, and writes two titled images', () => {
  const { done, result } = shotDiff(page('before.html'), page('after.html'), '--title', 'Step 10');
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(1);
  const [shot] = result.shots;
  expect(shot.before.removed).toEqual(['approve them before they are published.']);
  expect(shot.after.added).toEqual(['confirm the breakdown in the same session.', 'Step 13 merges it.']);
  expect(shot.before.file).toMatch(/shot-before\.png$/);
  for (const file of [shot.before.file, shot.after.file])
    expect(readFileSync(file).subarray(0, 4)).toEqual(PNG);
  // Cropped around the changes, so neither shot is the whole viewport.
  expect(shot.before.box.height).toBeLessThan(900);
  expect(shot.after.box.height).toBeLessThan(900);
  expect(result.leftOut).toEqual({ removed: [], added: [] });
  expect(done.stderr).not.toMatch(/no difference/);
});

test('hidden text is not compared', () => {
  const { result } = shotDiff(page('before.html'), page('after.html'), '--title', 't');
  expect(result.shots[0].before.removed.join(' ')).not.toContain('hidden');
  expect(result.shots[0].after.added.join(' ')).not.toContain('hidden');
});

test('the top of a shot does not cut a line of text in half', () => {
  // The heading's text runs from 46px to 82px, the changed line starts at 112px: 50px of padding
  // alone would start the shot at 62px, through the heading.
  const { result } = shotDiff(page('before.html'), page('after.html'), '--title', 't', '--padding', '50');
  expect(result.shots[0].before.box.y).toBeLessThanOrEqual(46);
});

test('changes far apart get a numbered pair each, and none is left out', () => {
  const { done, result } = shotDiff(page('tall-before.html'), page('tall-after.html'), '--title', 't');
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(2);
  expect(result.shots.map((s: { before: { file: string } }) => s.before.file.split('/').pop())).toEqual([
    'shot-1-before.png',
    'shot-2-before.png',
  ]);
  expect(result.shots[0].before.removed).toEqual(['as it was.']);
  expect(result.shots[1].after.added).toEqual(['changed.']);
  expect(result.leftOut).toEqual({ removed: [], added: [] });
  expect(done.stderr).not.toMatch(/not in any image/);
});

test('a change outside --selector is reported as left out', () => {
  const { done, result } = shotDiff(
    page('tall-before.html'),
    page('tall-after.html'),
    '--title',
    't',
    '--selector',
    '#end',
  );
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(1);
  expect(result.leftOut).toEqual({ removed: ['as it was.'], added: ['changed.'] });
  expect(done.stderr).toMatch(/2 change\(s\) are not in any image/);
});

test('the same page twice marks nothing and says so', () => {
  const { done, result } = shotDiff(page('before.html'), page('before.html'), '--title', 't');
  expect(done.status, done.stderr).toBe(0);
  expect(result.wordChanges).toBe(0);
  expect(done.stderr).toMatch(/no difference/);
});

test('a title is required', () => {
  const done = spawnSync(process.execPath, [cli, page('before.html'), page('after.html')], {
    encoding: 'utf8',
  });
  expect(done.status).not.toBe(0);
  expect(done.stderr).toMatch(/--title/);
});

test('changes with no words in them are marked: a restyled button, a picture redrawn under the same name', () => {
  const { done, result } = shotDiff(
    page('visual/before/index.html'),
    page('visual/after/index.html'),
    '--title',
    't',
  );
  expect(done.status, done.stderr).toBe(0);
  expect(result.lookChanges).toBe(2);
  const removed = result.shots.flatMap((s: { before: { removed: string[] } }) => s.before.removed);
  const added = result.shots.flatMap((s: { after: { added: string[] } }) => s.after.added);
  expect(removed).toEqual(
    expect.arrayContaining(['[image mountains.svg]', '[img: picture]', '[button: background]']),
  );
  expect(added).toEqual(
    expect.arrayContaining(['[image night.svg]', '[img: picture]', '[button: background]']),
  );
  expect(result.leftOut).toEqual({ removed: [], added: [] });
});

test('a dashboard: only what changed is marked, not the boxes layout resized around it', () => {
  const { done, result } = shotDiff(
    page('dashboard/before.html'),
    page('dashboard/after.html'),
    '--title',
    't',
  );
  expect(done.status, done.stderr).toBe(0);
  // A wider grid gap narrows every card, and a longer name widens the table's columns: neither is a change.
  expect(result.shots[0].before.removed).toEqual([
    '$48,210',
    '[a: background, weight]',
    '[section: spacing]',
    '2.1% +0.3',
    '[svg: picture]',
    '[span: background]',
  ]);
  expect(result.shots[0].after.added).toEqual([
    '$51,940',
    '[a: background, weight]',
    '[section: spacing]',
    '1.6% -0.5',
    '[svg: picture]',
    'Katherine Johnson Team plan $199.00 paid',
    '[span: background]',
  ]);
});

test('--markers numbers marks the same changes; an unknown kind is refused', async () => {
  const labels = shotDiff(page('dashboard/before.html'), page('dashboard/after.html'), '--title', 't');
  const numbers = shotDiff(
    page('dashboard/before.html'),
    page('dashboard/after.html'),
    '--title',
    't',
    '--markers',
    'numbers',
  );
  expect(numbers.done.status, numbers.done.stderr).toBe(0);
  expect(numbers.result.shots[0].after.added).toEqual(labels.result.shots[0].after.added);
  // The numbers' meanings take a line in the band, so the image is taller than with labels.
  const height = async (file: string) => (await sharp(file).metadata()).height;
  expect(await height(numbers.result.shots[0].after.file)).toBeGreaterThan(
    await height(labels.result.shots[0].after.file),
  );

  const wrong = spawnSync(
    process.execPath,
    [cli, page('before.html'), page('after.html'), '--title', 't', '--markers', 'arrows'],
    { encoding: 'utf8' },
  );
  expect(wrong.status).not.toBe(0);
  expect(wrong.stderr).toMatch(/labels, numbers/);
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
  expect(done.stderr).toMatch(/not in any image/);
});
