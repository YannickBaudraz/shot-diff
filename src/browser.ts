// Which browser to run. A Chrome you name comes first, then the installed Google Chrome, then
// Playwright's Chromium, downloaded once into Playwright's cache when it is not there and you say
// yes to it: its headless one, or the one with windows when the pages are set up by hand.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Browser, BrowserType, LaunchOptions } from 'playwright-core';

/** A browser to run in: where it has the page given as `url`, and how it is closed. */
export type Launched = {
  browser: Browser;
  locate(url: string): string;
  close(): Promise<void>;
};

/** Whether to fetch Playwright's Chromium when no Chrome is found: yes (--download), no
 * (--no-download), or ask. */
export type Download = 'yes' | 'no' | 'ask';

export type Choice = {
  chrome?: string; // a Chrome or Chromium to use, and nothing else
  window: boolean; // open windows a person can use (--interactive), not a headless browser
  download: Download;
  /** Asks the question and gives the answer; null when there is no one to ask (no terminal). */
  confirm: ((question: string) => Promise<boolean>) | null;
  log: (line: string) => void;
};

/** Playwright's Chromium to download when there is no Chrome: the headless one, or the one with windows. */
type Chromium = { name: string; called: string; size: string };
const HEADLESS: Chromium = {
  name: 'chromium-headless-shell',
  called: "Playwright's headless Chromium",
  size: 'about 100 MB',
};
const WINDOWED: Chromium = { name: 'chromium', called: "Playwright's Chromium", size: 'about 200 MB' };

/** A browser with windows, made to draw a page as the headless one does, so the shots are the same
 * with and without --interactive. It shows scrollbars, which take room in the page, where the
 * headless one has none: hidden, the page still scrolls. And on Linux it draws with the GPU, which
 * smooths the edges of letters and curves differently, where the headless one draws without: the
 * same pixels were measured there with it off, and it is left alone on the other systems, unmeasured. */
const WINDOW: LaunchOptions = {
  headless: false,
  args: ['--hide-scrollbars', ...(process.platform === 'linux' ? ['--disable-gpu'] : [])],
};

const OTHER_CHROME = 'install Google Chrome, or name one with --chrome or $CHROME';
const OR_DOWNLOAD = `${OTHER_CHROME}, or run again with --download`;

/** The errors Playwright gives when a browser is not on the machine. */
const missing = (error: unknown) =>
  error instanceof Error && /distribution '.*' is not found|Executable doesn't exist/.test(error.message);

export async function launch(
  chromium: Pick<BrowserType, 'launch'>,
  choice: Choice,
  install: (name: string) => void = installChromium,
): Promise<Browser> {
  const how = choice.window ? WINDOW : {};
  if (choice.chrome) return chromium.launch({ executablePath: choice.chrome, ...how });
  const tries: LaunchOptions[] = [{ channel: 'chrome', ...how }, how]; // the installed Chrome, then Playwright's Chromium
  for (const options of tries) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  const wanted = choice.window ? WINDOWED : HEADLESS;
  await assertDownloadAllowed(choice, wanted);
  choice.log(`shot-diff: downloading ${wanted.called}`);
  install(wanted.name);
  return chromium.launch(how);
}

/** Throws unless the choice allows downloading `wanted`, asking when it says to. */
async function assertDownloadAllowed({ download, confirm }: Choice, wanted: Chromium): Promise<void> {
  if (download === 'yes') return;
  if (download === 'no') throw new Error(`no Chrome found: ${OTHER_CHROME}`);
  if (!confirm)
    throw new Error(`no Chrome found, and no terminal to ask before downloading one: ${OR_DOWNLOAD}`);
  const question = `No Chrome found. Download ${wanted.called} into Playwright's cache (${wanted.size}, once)?`;
  if (!(await confirm(question)))
    throw new Error(`no Chrome found, and the download was declined: ${OR_DOWNLOAD}`);
}

/** Download the Chromium Playwright calls `name` with playwright-core's own installer. `--no-remove`
 * keeps the other browsers in Playwright's cache, which other projects may use. */
export function installChromium(name: string): void {
  const root = dirname(createRequire(import.meta.url).resolve('playwright-core/package.json'));
  const done = spawnSync(process.execPath, [join(root, 'cli.js'), 'install', '--no-remove', name], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (done.status !== 0) throw new Error(`the download of Playwright's ${name} failed`);
}
