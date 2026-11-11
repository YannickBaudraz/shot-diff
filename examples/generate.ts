// Makes the examples: runs the command on the fixture pages, once per kind of result, and writes
// each one's images in its own folder, with README.md, the page that shows them all.
// Run it with `npm run examples` after a change meant to alter the images.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { run } from '../src/run.ts';

const HERE = import.meta.dirname;
const ROOT = join(HERE, '..');
const CLI = join('src', 'cli.ts');

type Example = {
  id: string; // its folder
  name: string; // its heading: the kind of result it shows
  title: string; // the title in the band: what changed on the page, as a pull request would say it
  shows: string; // what to look at
  pages: [before: string, after: string]; // under e2e/fixtures
  options?: string[];
  /** Set up by hand, with --interactive: the steps as a person reads them, and as they are done here. */
  hands?: { steps: string[]; follow(page: Page): Promise<void> };
};

const EXAMPLES: Example[] = [
  {
    id: 'words',
    name: 'Changed words',
    title: 'Tickets: add the merge step',
    shows:
      'Removed words are boxed red on the before shot; added words are boxed green on the after shot. A paragraph added is one box saying so.',
    pages: ['words/before.html', 'words/after.html'],
  },
  {
    id: 'looks',
    name: 'Changed looks and pictures',
    title: 'Trip: night photo, green button',
    shows:
      'An element restyled, or a picture redrawn under the same file name, has no changed word: it gets a box with what changed written on it.',
    pages: ['visual/before/index.html', 'visual/after/index.html'],
  },
  {
    id: 'no-words',
    name: 'An element with no words, added or removed',
    title: 'Checkout: progress bar in, divider out',
    shows:
      'An element with no word or image in it that only one page has gets a box saying so: here a progress bar added, and a divider removed. Each shot marks only what its page has.',
    pages: ['wordless/before.html', 'wordless/after.html'],
  },
  {
    id: 'component',
    name: 'A component added',
    title: 'Plans: Team plan added',
    shows:
      'A card added gets one box saying so, and nothing inside it is marked: its words, its heading and its bar are all part of it. A card removed gets the same box on the before shot.',
    pages: ['components/before.html', 'components/after.html'],
  },
  {
    id: 'whole-page',
    name: 'A page with both',
    title: 'Dashboard: August figures',
    shows:
      'Words and looks changed on one page. Only what changed is marked, not the boxes the layout resized around it.',
    pages: ['dashboard/before.html', 'dashboard/after.html'],
  },
  {
    id: 'numbers',
    name: 'Numbered boxes',
    title: 'Dashboard: August figures',
    shows:
      'With `--markers numbers`, each box of a change of look has a number, explained in the band, where a label would cover the page.',
    pages: ['dashboard/before.html', 'dashboard/after.html'],
    options: ['--markers', 'numbers'],
  },
  {
    id: 'far-apart',
    name: 'Changes far apart',
    title: 'Tall page: top and bottom lines reworded',
    shows:
      'Changes too far apart for one image get a pair each, numbered in the file names and in the band ("1 of 2").',
    pages: ['tall/before.html', 'tall/after.html'],
  },
  {
    id: 'selector',
    name: 'One part of the page',
    title: 'Tall page: bottom line reworded',
    shows:
      'With `--selector`, only the changes inside the element count. The others are left unmarked, and the terminal says how many.',
    pages: ['tall/before.html', 'tall/after.html'],
    options: ['--selector', '#end'],
  },
  {
    id: 'scroll-area',
    name: 'A change a scroll area cuts off',
    title: 'Scroll area: both lines reworded',
    shows:
      'A change past the edge of a scroll area cannot be shot: it gets no box, and the terminal lists it.',
    pages: ['clipped/before.html', 'clipped/after.html'],
  },
  {
    id: 'too-tall',
    name: 'A change taller than an image may be',
    title: 'Dashboard: August figures',
    shows:
      'A change that does not fit under `--max-height` is cut from the images, and the terminal lists it.',
    pages: ['dashboard/before.html', 'dashboard/after.html'],
    options: ['--max-height', '400'],
  },
  {
    id: 'web-component',
    name: 'Inside a web component',
    title: 'Plans: Team costs more, with priority support',
    shows:
      'Changes in a shadow tree are marked as any other: here a price and a button inside the card, and the description the page gives it.',
    pages: ['shadow/before.html', 'shadow/after.html'],
  },
  {
    id: 'embedded-page',
    name: 'Inside an embedded page',
    title: 'Order: higher payment',
    shows:
      'The words inside an iframe are not read: when it is drawn differently, the whole iframe is boxed as an "embedded page".',
    pages: ['frame/before/index.html', 'frame/after/index.html'],
  },
  {
    id: 'phone',
    name: 'A phone-sized page',
    title: 'Order: out for delivery',
    shows: 'A page made for a phone, shot in a narrow window with `--width` and `--height`.',
    pages: ['phone/before.html', 'phone/after.html'],
    options: ['--width', '390', '--height', '844'],
  },
  {
    id: 'no-difference',
    name: 'No difference',
    title: 'Tickets: refactoring, nothing visible',
    shows:
      'Two pages that look the same: nothing is marked, the terminal says so, and the shots show the top of each page.',
    pages: ['words/before.html', 'words/before.html'],
  },
  {
    id: 'by-hand',
    name: 'A page set up by hand',
    title: 'Cart: total incl. VAT, promo details',
    shows:
      'With `--interactive`, both pages open in windows and are shot as you leave them. This shop looks the same in both versions until its cart is filled: run without `--interactive`, it is the "no difference" above.',
    pages: ['shop/before.html', 'shop/after.html'],
    options: ['--interactive'],
    hands: {
      steps: [
        'Click **Add to cart** on Mug and on Poster.',
        'Set the Mug quantity to 3.',
        'Type `save10` in the promo field and click **Apply**.',
        'Do the same in the other window, then press Enter in the terminal.',
      ],
      async follow(page) {
        await page.click('[data-add="mug"]');
        await page.click('[data-add="poster"]');
        await page.fill('[data-quantity="mug"]', '3');
        await page.fill('#code', 'save10');
        await page.click('#apply');
      },
    },
  },
];

const fixture = (path: string) => `file://${join(ROOT, 'e2e', 'fixtures', path)}`;

/** The folder of an example, emptied of the images of an earlier run. */
function folderOf(example: Example): string {
  const folder = join(HERE, example.id);
  mkdirSync(folder, { recursive: true });
  for (const file of readdirSync(folder)) if (file.endsWith('.png')) rmSync(join(folder, file));
  return folder;
}

/** Run the command on an example's pages, and give what it printed. */
function shoot(example: Example): string {
  const out = join('examples', example.id);
  const args = [...example.pages.map(fixture), '--title', example.title, ...(example.options ?? [])];
  const done = spawnSync(process.execPath, [CLI, ...args, '--out', out], { cwd: ROOT, encoding: 'utf8' });
  if (done.status !== 0) throw new Error(`${example.id}: ${done.stderr}`);
  return (done.stdout + done.stderr).trim();
}

/** Shoot an example set up by hand, its steps followed on both pages as a person would. The command
 * itself waits on a terminal for that person, so the run is called without it, with its defaults. */
async function shootByHand(example: Example, folder: string): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const [before, after] = example.pages.map(fixture);
    const result = await run(browser, {
      before,
      after,
      title: example.title,
      markers: 'labels',
      width: 1280,
      height: 900,
      scale: 2,
      dark: false,
      storage: [],
      click: [],
      wait: 300,
      padding: 80,
      maxHeight: 2400,
      selector: null,
      tabs: false,
      prepare: async () => {
        for (const page of browser.contexts().flatMap(context => context.pages()))
          await example.hands?.follow(page);
      },
    });
    const [shot] = result.shots;
    writeFileSync(join(folder, 'shot-before.png'), shot.before.png);
    writeFileSync(join(folder, 'shot-after.png'), shot.after.png);
  } finally {
    await browser.close();
  }
}

/** An example's part of the page: what it shows, how to run it, what the terminal says, its images. */
function section(example: Example, folder: string, printed: string | null): string {
  const quoted = (arg: string) => (/^[\w./-]+$/.test(arg) ? arg : `"${arg}"`);
  const pages = example.pages.map(path => `"file://$PWD/e2e/fixtures/${path}"`);
  const options = ['--title', example.title, ...(example.options ?? [])].map(quoted).join(' ');
  const images = readdirSync(folder).filter(file => file.endsWith('-before.png'));
  const rows = images.map(before => {
    const after = before.replace('-before.png', '-after.png');
    return `| ![before](${example.id}/${before}) | ![after](${example.id}/${after}) |`;
  });
  return [
    `## ${example.name}`,
    example.shows,
    ['```sh', `shot-diff ${pages.join(' ')} \\`, `  ${options}`, '```'].join('\n'),
    ...(example.hands ? [example.hands.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')] : []),
    ...(printed ? [['```', printed, '```'].join('\n')] : []),
    ['| Before | After |', '|---|---|', ...rows].join('\n'),
  ].join('\n\n');
}

const INTRO = `# Examples

What to expect from each kind of result. Every example is the command run on the test pages of this
repository, from its root: the command, what it prints on the terminal, and the images it writes.

This page and the images are made by \`npm run examples\`: do not edit them by hand. Text is drawn
with the fonts of the machine that made them, so yours may differ a little.`;

const sections: string[] = [];
for (const example of EXAMPLES) {
  const folder = folderOf(example);
  const printed = example.hands ? null : shoot(example);
  if (example.hands) await shootByHand(example, folder);
  sections.push(section(example, folder, printed));
  console.log(`examples/${example.id}`);
}
writeFileSync(join(HERE, 'README.md'), `${[INTRO, ...sections].join('\n\n')}\n`);
