import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
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

test('--selector takes in the shadow trees inside its element', () => {
  const pages = [page('shadow/before.html'), page('shadow/after.html')];
  const inside = shotDiff(...pages, '--title', 't', '--selector', 'main');
  expect(inside.result.shots[0].after.added).toHaveLength(3);
  expect(inside.result.ignored).toEqual({ removed: [], added: [] });
  const outside = shotDiff(...pages, '--title', 't', '--selector', 'h1');
  expect(outside.result.ignored.added).toHaveLength(3);
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
