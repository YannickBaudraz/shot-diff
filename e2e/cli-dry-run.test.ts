// The command with --dry-run: what it lists, with nothing shot.

import { readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { page, shotDiff, shotDiffText } from './helpers.ts';

describe('--dry-run', () => {
  const tall = [page('tall/before.html'), page('tall/after.html')];
  const parts = [page('parts/before.html'), page('parts/after.html')];

  test('does all a run does but the screenshots: the same images listed, with their sizes, and no file', () => {
    const real = shotDiffText(...tall, '--title', 't', '--padding', '40');
    const dry = shotDiffText(...tall, '--title', 't', '--padding', '40', '--dry-run');
    expect(dry.status, dry.stderr).toBe(0);
    expect(readdirSync(dry.out)).toEqual([]);
    const listed = (out: string, text: string) =>
      text
        .split('\n')
        .filter(line => line.includes('.png: '))
        .map(line => line.replace(out, ''));
    expect(listed(real.out, real.stdout)).toHaveLength(4);
    expect(listed(dry.out, dry.stdout).map(line => line.replace('would write ', ''))).toEqual(
      listed(real.out, real.stdout),
    );
    expect(listed(dry.out, dry.stdout).every(line => line.startsWith('would write '))).toBe(true);
  });

  test('needs no title, which only goes on an image; a run that shoots still does', () => {
    expect(shotDiffText(...tall, '--dry-run').status).toBe(0);
    const shooting = shotDiffText(...tall);
    expect(shooting.status).not.toBe(0);
    expect(shooting.stderr).toMatch(/--title/);
  });

  test('lists the parts of the page that changed, with a --selector for each and how many changes it has', () => {
    const dry = shotDiffText(...parts, '--dry-run');
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/2 part\(s\) of the page changed/);
    expect(dry.stdout).toMatch(/--selector '#b' +1 change\(s\)/);
    expect(dry.stdout).toMatch(/--selector '#cols > div:nth-child\(1\) > div:nth-child\(2\)' +2 change\(s\)/);
    const { result } = shotDiff(...parts, '--dry-run');
    expect(result.areas).toEqual([
      { selector: '#b', changes: 1 },
      { selector: '#cols > div:nth-child(1) > div:nth-child(2)', changes: 2 },
    ]);
  });

  test('says that changes in no part need one more run without --selector, when no change is in a part', () => {
    const dry = shotDiffText(page('parts/none-before.html'), page('parts/none-after.html'), '--dry-run');
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(
      /^1 change\(s\) are in no part narrower than the page: shoot them with one more run, without --selector$/m,
    );
    expect(dry.stdout).not.toContain('part(s) of the page changed');
  });

  test('says that changes in no part need one more run without --selector, after the parts', () => {
    const dry = shotDiffText(page('parts/mixed-before.html'), page('parts/mixed-after.html'), '--dry-run');
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/--selector '#b' +1 change\(s\)/);
    expect(dry.stdout).toMatch(
      /^1 change\(s\) are in no part narrower than the page: shoot them with one more run, without --selector$/m,
    );
  });

  test('gives no selector by position that names another element on the before page: the id above it instead', () => {
    // A card inserted first: the second card of the before page is the third of the after page. The
    // new card's own place is first on both: on the before page, where it goes in.
    const { done, result } = shotDiff(
      page('parts/shift-before.html'),
      page('parts/shift-after.html'),
      '--dry-run',
    );
    expect(done.status, done.stderr).toBe(0);
    expect(result.areas).toEqual([
      { selector: '#cols > div:nth-child(1) > div:nth-child(1)', changes: 1 },
      { selector: '#cols', changes: 1 },
    ]);
  });

  test('writes a selector with an apostrophe so that a shell takes it whole', () => {
    const dry = shotDiffText(page('parts/quote-before.html'), page('parts/quote-after.html'), '--dry-run');
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain(`--selector '#today\\'\\''s'`);
  });

  test('says in --json that it is a dry run: the files it names are not there', () => {
    expect(shotDiff(...parts, '--dry-run').result.dryRun).toBe(true);
    expect(shotDiff(...parts, '--title', 't').result.dryRun).toBe(false);
  });

  test('gives selectors a run can be given: each shoots its part alone, narrower than the page', () => {
    const { result: dry } = shotDiff(...parts, '--dry-run');
    for (const { selector, changes } of dry.areas) {
      const { done, result } = shotDiff(...parts, '--title', 't', '--selector', selector);
      expect(done.status, done.stderr).toBe(0);
      expect(result.shots[0].after.added).toHaveLength(changes);
      expect(result.shots[0].after.box.width).toBeLessThan(1280);
    }
  });
});
