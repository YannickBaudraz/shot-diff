// The images themselves, compared with the reference images in __image_snapshots__: a box in the
// wrong place, a label hiding a word or a band drawn wrong fails here, where the JSON would pass.
// Update the references with `npx vitest run -u` after a change meant to alter them.
//
// Text renders with the machine's fonts, which differ from one machine to another; the references
// are made on a developer's machine, so these tests do not run on CI.

import { readFileSync } from 'node:fs';
import { toMatchImageSnapshot } from '@brachkow/vitest-image-snapshot';
import { describe, expect, test } from 'vitest';
import { page, shotDiff } from './helpers.ts';

expect.extend({ toMatchImageSnapshot });

const CASES: { name: string; before: string; after: string; args?: string[] }[] = [
  { name: 'words', before: 'words/before.html', after: 'words/after.html' },
  { name: 'pictures-and-looks', before: 'visual/before/index.html', after: 'visual/after/index.html' },
  { name: 'no-words', before: 'wordless/before.html', after: 'wordless/after.html' },
  { name: 'components', before: 'components/before.html', after: 'components/after.html' },
  {
    name: 'ignored',
    before: 'activity/before.html',
    after: 'activity/after.html',
    args: ['--ignore', '.updated', '--ignore', '.activity', '--show-ignored'],
  },
  { name: 'dashboard-labels', before: 'dashboard/before.html', after: 'dashboard/after.html' },
  {
    name: 'dashboard-numbers',
    before: 'dashboard/before.html',
    after: 'dashboard/after.html',
    args: ['--markers', 'numbers'],
  },
];

describe.skipIf(process.env.CI)('images', () => {
  test.each(CASES)('$name', ({ name, before, after, args = [] }) => {
    const { done, result } = shotDiff(page(before), page(after), '--title', name, ...args);
    expect(done.status, done.stderr).toBe(0);
    for (const [n, shot] of (
      result.shots as { before: { file: string }; after: { file: string } }[]
    ).entries()) {
      for (const side of ['before', 'after'] as const) {
        expect(readFileSync(shot[side].file)).toMatchImageSnapshot({
          customSnapshotIdentifier: `${name}-${n + 1}-${side}`,
          // On one machine the images come out the same pixel for pixel; a label moved by a few
          // pixels changes thousands. (In 'percent', 0.001 would mean 0.1%, which let that through.)
          failureThreshold: 20,
          failureThresholdType: 'pixel',
        });
      }
    }
  });
});
