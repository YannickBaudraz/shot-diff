import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';

const here = import.meta.dirname;
const cli = join(here, '..', 'src', 'cli.ts');
const page = (name: string) => pathToFileURL(join(here, 'fixtures', name)).href;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function shotDiff(...args: string[]) {
  const out = mkdtempSync(join(tmpdir(), 'shot-diff-'));
  const done = spawnSync(process.execPath, [cli, ...args, '--out', out, '--json'], { encoding: 'utf8', timeout: 60_000 });
  return { done, result: done.status === 0 ? JSON.parse(done.stdout) : null };
}

test('marks what was removed and what was added, and writes two titled images', () => {
  const { done, result } = shotDiff(page('before.html'), page('after.html'), '--title', 'Step 10');
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(1);
  const [shot] = result.shots;
  expect(shot.before.removed).toEqual(['approve them before they are published.']);
  expect(shot.after.added).toEqual(['confirm the breakdown in the same session.', 'Step 13 merges it.']);
  expect(shot.before.file).toMatch(/shot-before\.png$/);
  for (const file of [shot.before.file, shot.after.file]) expect(readFileSync(file).subarray(0, 4)).toEqual(PNG);
  // Cropped around the changes, so neither shot is the whole viewport.
  expect(shot.before.box.height).toBeLessThan(900);
  expect(shot.after.box.height).toBeLessThan(900);
  expect(result.leftOut).toEqual({ removed: [], added: [] });
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
  expect(result.shots.map((s: { before: { file: string } }) => s.before.file.split('/').pop())).toEqual(['shot-1-before.png', 'shot-2-before.png']);
  expect(result.shots[0].before.removed).toEqual(['as it was.']);
  expect(result.shots[1].after.added).toEqual(['changed.']);
  expect(result.leftOut).toEqual({ removed: [], added: [] });
  expect(done.stderr).not.toMatch(/not in any image/);
});

test('a change outside --selector is reported as left out', () => {
  const { done, result } = shotDiff(page('tall-before.html'), page('tall-after.html'), '--title', 't', '--selector', '#end');
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(1);
  expect(result.leftOut).toEqual({ removed: ['as it was.'], added: ['changed.'] });
  expect(done.stderr).toMatch(/2 change\(s\) are not in any image/);
});

test('the same page twice marks nothing and says so', () => {
  const { done, result } = shotDiff(page('before.html'), page('before.html'), '--title', 't');
  expect(done.status, done.stderr).toBe(0);
  expect(result.hunks).toBe(0);
  expect(done.stderr).toMatch(/no difference/);
});

test('a title is required', () => {
  const done = spawnSync(process.execPath, [cli, page('before.html'), page('after.html')], { encoding: 'utf8' });
  expect(done.status).not.toBe(0);
  expect(done.stderr).toMatch(/--title/);
});
