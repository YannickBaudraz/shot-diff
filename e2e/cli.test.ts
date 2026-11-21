import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { cli, page, shotDiff } from './helpers.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test('marks what was removed and what was added, and writes two titled images', () => {
  const { done, result } = shotDiff(
    page('words/before.html'),
    page('words/after.html'),
    '--title',
    'Step 10',
  );
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(1);
  const [shot] = result.shots;
  expect(shot.before.removed).toEqual(['approve them before they are published.']);
  expect(shot.after.added).toEqual([
    'confirm the breakdown in the same session.',
    '[p: added] Step 13 merges it.',
  ]);
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
  const { result } = shotDiff(page('words/before.html'), page('words/after.html'), '--title', 't');
  expect(result.shots[0].before.removed.join(' ')).not.toContain('hidden');
  expect(result.shots[0].after.added.join(' ')).not.toContain('hidden');
});

test('--no-words marks no word change, only changes of look and elements added or removed', () => {
  const { done, result } = shotDiff(
    page('words/before.html'),
    page('words/after.html'),
    '--title',
    't',
    '--no-words',
  );
  expect(done.status, done.stderr).toBe(0);
  expect(result.wordChanges).toBe(0);
  // The paragraph added is still an element added: its words are not what is compared.
  expect(result.shots.flatMap((shot: { after: { added: string[] } }) => shot.after.added)).toEqual([
    '[p: added] Step 13 merges it.',
  ]);
});

test('--ignore leaves an area out of the comparison, and says what each selector matched', () => {
  const { done, result } = shotDiff(
    page('dashboard/before.html'),
    page('dashboard/after.html'),
    '--title',
    't',
    '--ignore',
    'table',
  );
  expect(done.status, done.stderr).toBe(0);
  const added = result.shots.flatMap((shot: { after: { added: string[] } }) => shot.after.added);
  expect(added.filter((name: string) => /tr|span/.test(name))).toEqual([]); // the row added, the badge restyled
  expect(added).toContain('$51,940');
  expect(result.ignoredAreas).toEqual([{ selector: 'table', before: 1, after: 1 }]);
});

test('--ignore stops on a selector that matches nothing on either page', () => {
  const { done } = shotDiff(
    page('words/before.html'),
    page('words/after.html'),
    '--title',
    't',
    '--ignore',
    '.nothing',
  );
  expect(done.status).not.toBe(0);
  expect(done.stderr).toMatch(/--ignore \.nothing matches nothing on either page/);
});

test('the same page twice marks nothing and says so', () => {
  const { done, result } = shotDiff(page('words/before.html'), page('words/before.html'), '--title', 't');
  expect(done.status, done.stderr).toBe(0);
  expect(result.wordChanges).toBe(0);
  expect(done.stderr).toMatch(/no difference/);
});

test('a title is required', () => {
  const done = spawnSync(process.execPath, [cli, page('words/before.html'), page('words/after.html')], {
    encoding: 'utf8',
  });
  expect(done.status).not.toBe(0);
  expect(done.stderr).toMatch(/--title/);
});

test('--interactive is refused where there is no terminal to wait on', () => {
  const { done } = shotDiff(
    page('words/before.html'),
    page('words/after.html'),
    '--title',
    't',
    '--interactive',
  );
  expect(done.status).toBe(1);
  expect(done.stderr).toMatch(/--interactive needs a terminal/);
});

test('--tabs is refused without --interactive', () => {
  const { done } = shotDiff(page('words/before.html'), page('words/after.html'), '--title', 't', '--tabs');
  expect(done.status).toBe(1);
  expect(done.stderr).toMatch(/--tabs goes with --interactive/);
});
