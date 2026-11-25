// Which browser opens the pages, and whether a person sets them up by hand first.

import { Option } from 'commander';
import { chromium } from 'playwright-core';
import { launch, type Download, type Launched } from '../browser/launch.ts';
import { windowsChrome } from '../browser/windows.ts';
import type { Options } from '../run.ts';
import type { Side } from '../side.ts';
import type { Ask } from './ask.ts';
import type { OptionGroup, Pages } from './group.ts';

export type BrowserValues = {
  chrome?: string;
  download?: boolean; // undefined when neither --download nor --no-download is given
  interactive: boolean;
  tabs: boolean;
};

/** The browser options, with the terminal --interactive asks on: null when there is none. */
export function browser(ask: Ask | null): OptionGroup<BrowserValues, Pick<Options, 'tabs' | 'prepare'>> {
  return {
    heading: 'Browser:',
    options: [
      new Option(
        '--chrome <path>',
        'the Chrome or Chromium to use (default: the installed Google Chrome)',
      ).env('CHROME'),
      // --download before --no-download, so that giving neither leaves the value undefined.
      new Option('--download', "without Chrome, download Playwright's headless Chromium without asking"),
      new Option('--no-download', 'without Chrome, stop instead of offering to download it'),
      new Option(
        '--interactive',
        'open both pages in windows, and shoot them once you have set them up by hand',
      ).default(false),
      new Option(
        '--tabs',
        'with --interactive: open both pages as tabs of one window, which you can resize, not a window each',
      ).default(false),
    ],
    rules: [
      {
        holds: values => !values.interactive || ask !== null,
        message: '--interactive needs a terminal, to wait there while you set the pages up',
      },
      {
        holds: values => !values.tabs || values.interactive,
        message: '--tabs goes with --interactive: it is how the pages you set up are opened',
      },
    ],
    // --interactive is the wait for the pages to be set up.
    resolve: ({ interactive, tabs }, pages) => ({
      tabs,
      prepare: interactive ? crowded => prepare(pages, tabs, crowded, ask) : null,
    }),
  };
}

/** The browser to use: --chrome, or the installed Chrome, or a download, asked about on a terminal.
 * With --interactive, one that opens windows: on WSL, Chrome for Windows when no other is named. */
export async function browserFor(values: BrowserValues, ask: Ask | null): Promise<Launched> {
  const log = (line: string) => console.error(line);
  const windows = values.interactive && !values.chrome ? await windowsChrome(chromium, log) : null;
  if (windows) return windows;
  const browser = await launch(chromium, {
    chrome: values.chrome,
    window: values.interactive,
    download: downloadChoice(values.download),
    confirm: ask && (question => ask(question, false)),
    log,
  });
  return { browser, locate: url => url, close: () => browser.close() };
}

/** Says which window, or which tab with --tabs, is which page, and waits for a yes to shoot them. A
 * no stops the run. Asked again when there are more tabs than can be shot, it says which to close. */
async function prepare(
  { before, after }: Pages,
  tabs: boolean,
  crowded: Side[],
  ask: Ask | null,
): Promise<void> {
  if (!crowded.length) {
    console.error(
      tabs
        ? 'shot-diff: one window is open, with a tab on each page; resize it to the size to shoot:'
        : 'shot-diff: two windows are open, one on each page:',
    );
    console.error(`  before  ${before}`);
    console.error(`  after   ${after}`);
  } else if (tabs) {
    console.error(
      'shot-diff: the window must have two tabs left, the before page and the after page: close the others',
    );
  } else {
    for (const side of crowded)
      console.error(
        `shot-diff: the ${side} window has several tabs, and only one can be shot: close the others`,
      );
  }
  const shoot = await ask?.('Set both pages up the same way, by hand. Shoot them now?', true);
  if (!shoot) throw new Error('stopped before shooting; no image written');
}

/** --download, --no-download, or neither: commander leaves the value undefined when neither is given. */
function downloadChoice(download: boolean | undefined): Download {
  if (download === true) return 'yes';
  if (download === false) return 'no';
  return 'ask';
}
