// The command on pages of each kind (web components, embedded pages, a dashboard...) and --markers.

import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { cli, page, shotDiff } from './helpers.ts';

test('changes inside a web component are marked: in its shadow tree, and in what it is given', () => {
  const { done, result } = shotDiff(page('shadow/before.html'), page('shadow/after.html'), '--title', 't');
  expect(done.status, done.stderr).toBe(0);
  const [shot] = result.shots;
  // The price and the button are in the card's shadow tree; the description is given to its slot.
  expect(shot.before.removed).toEqual(['$12', 'teams.', '[button: text colour, background]']);
  expect(shot.after.added).toEqual([
    '$15',
    'teams, with priority support.',
    '[button: text colour, background]',
  ]);
});

test('a change inside an embedded page is marked on the iframe, as a whole', () => {
  const pages = [page('frame/before/index.html'), page('frame/after/index.html')];
  const { done, result } = shotDiff(...pages, '--title', 't');
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots[0].before.removed).toEqual(['[iframe: embedded page]']);
  expect(result.shots[0].after.added).toEqual(['[iframe: embedded page]']);
  // The same embedded page on both sides is no change.
  const same = shotDiff(pages[0], pages[0], '--title', 't');
  expect(same.done.stderr).toMatch(/no difference/);
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
    expect.arrayContaining(['[image mountains.svg]', '[img: image]', '[button: background]']),
  );
  expect(added).toEqual(
    expect.arrayContaining(['[image night.svg]', '[img: image]', '[button: background]']),
  );
  expect(result.leftOut).toEqual({ removed: [], added: [] });
});

test('an element with no words that one page alone has is marked there, and both shots show its place', () => {
  const { done, result } = shotDiff(
    page('wordless/before.html'),
    page('wordless/after.html'),
    '--title',
    't',
  );
  expect(done.status, done.stderr).toBe(0);
  expect(result.wordChanges).toBe(0);
  expect(result.lookChanges).toBe(2);
  expect(result.shots).toHaveLength(1);
  const [shot] = result.shots;
  // The bar with its fill is one change; each page lists only what it has.
  expect(shot.before.removed).toEqual(['[hr: removed]']);
  expect(shot.after.added).toEqual(['[div: added]']);
  // Each shot takes in the element next to the other page's change whole: they start near each other.
  expect(Math.abs(shot.before.box.y - shot.after.box.y)).toBeLessThan(40);
});

test('a component added or removed is one change, said once, and its words are no word changes', () => {
  const [before, after] = [page('components/before.html'), page('components/after.html')];
  for (const [from, to, side, found] of [
    [before, after, 'after', '[section: added] Team 9 euros per month'],
    [after, before, 'before', '[section: removed] Team 9 euros per month'],
  ] as const) {
    const { done, result } = shotDiff(from, to, '--title', 't');
    expect(done.status, done.stderr).toBe(0);
    expect(result.wordChanges).toBe(0);
    expect(result.lookChanges).toBe(1); // the card and the bar in it are one change, nothing inside is marked
    expect(result.shots).toHaveLength(1);
    const [shot] = result.shots;
    expect(shot[side].added ?? shot[side].removed).toEqual([found]);
    expect(result.leftOut).toEqual({ removed: [], added: [] });
  }
});

test('a dashboard: only what changed is marked, not the boxes layout resized around it; a line whose words changed has its new colour marked too', () => {
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
    '[div: text colour]',
    '[svg: Monthly revenue chart redrawn]',
    '[span: background]',
  ]);
  expect(result.shots[0].after.added).toEqual([
    '$51,940',
    '[a: background, weight]',
    '[section: spacing]',
    '1.6% -0.5',
    '[div: text colour]',
    '[svg: Monthly revenue chart redrawn]',
    '[tr: added] Katherine Johnson Team plan $199.00 paid',
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
  // In the order of the shot's page, which a disc and a label take differently.
  expect([...numbers.result.shots[0].after.added].sort()).toEqual(
    [...labels.result.shots[0].after.added].sort(),
  );
  // The numbers' meanings take a line in the band, so the image is taller than with labels.
  const height = async (file: string) => (await sharp(file).metadata()).height;
  expect(await height(numbers.result.shots[0].after.file)).toBeGreaterThan(
    await height(labels.result.shots[0].after.file),
  );

  const wrong = spawnSync(
    process.execPath,
    [cli, page('words/before.html'), page('words/after.html'), '--title', 't', '--markers', 'arrows'],
    { encoding: 'utf8' },
  );
  expect(wrong.status).not.toBe(0);
  expect(wrong.stderr).toMatch(/labels, numbers/);
});

test('a workflow page: each pair shows the same place, from the heading of the card it changed in, and an item inserted in a list leaves the items below it unmarked', () => {
  const { done, result } = shotDiff(
    page('workflow/before.html'),
    page('workflow/after.html'),
    '--title',
    't',
  );
  expect(done.status, done.stderr).toBe(0);
  expect(result.shots).toHaveLength(2);
  const [cards, rules] = result.shots;
  // Above the row of cards both pages are laid out alike: the same place starts at the same height.
  expect(cards.before.box.y).toBe(cards.after.box.y);
  // The card's heading, "Tickets", starts 209px down (style.css): both shots take it in.
  expect(cards.before.box.y).toBeLessThanOrEqual(209);
  expect(cards.before.removed).toEqual(['[p: removed] You approve before publishing']);
  expect(rules.before.removed).toEqual(['tickets are approved by being published, and', ', 10']);
  // The item inserted is one change; the diamond of the item it pushed down is none.
  expect(rules.after.added).toEqual([
    'is approved',
    expect.stringMatching(/^\[li: added\] Step 10 has a confirmation/),
  ]);
});
