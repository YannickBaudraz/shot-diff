// Which browser to run. A Chrome you name comes first, then the installed Google Chrome, then
// Playwright's headless Chromium, downloaded once into Playwright's cache when it is not there and
// you say yes to it.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Browser, BrowserType, LaunchOptions } from 'playwright-core';

/** Whether to fetch Playwright's headless Chromium when no Chrome is found: yes (--download), no
 * (--no-download), or ask. */
export type Download = 'yes' | 'no' | 'ask';

export type Choice = {
  chrome?: string; // a Chrome or Chromium to use, and nothing else
  download: Download;
  /** Asks the question and gives the answer; null when there is no one to ask (no terminal). */
  confirm: ((question: string) => Promise<boolean>) | null;
  log: (line: string) => void;
};

const QUESTION =
  "No Chrome found. Download Playwright's headless Chromium into Playwright's cache (about 100 MB, once)?";
const OTHER_CHROME = 'install Google Chrome, or name one with --chrome or $CHROME';
const OR_DOWNLOAD = `${OTHER_CHROME}, or run again with --download`;

/** The errors Playwright gives when a browser is not on the machine. */
const missing = (error: unknown) =>
  error instanceof Error && /distribution '.*' is not found|Executable doesn't exist/.test(error.message);

export async function launch(
  chromium: Pick<BrowserType, 'launch'>,
  choice: Choice,
  install: () => void = installHeadlessShell,
): Promise<Browser> {
  if (choice.chrome) return chromium.launch({ executablePath: choice.chrome });
  const tries: LaunchOptions[] = [{ channel: 'chrome' }, {}]; // the installed Chrome, then Playwright's headless shell
  for (const options of tries) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  await assertDownloadAllowed(choice);
  choice.log("shot-diff: downloading Playwright's headless Chromium");
  install();
  return chromium.launch();
}

/** Throws unless the choice allows downloading Playwright's headless Chromium, asking when it says to. */
async function assertDownloadAllowed({ download, confirm }: Choice): Promise<void> {
  if (download === 'yes') return;
  if (download === 'no') throw new Error(`no Chrome found: ${OTHER_CHROME}`);
  if (!confirm)
    throw new Error(`no Chrome found, and no terminal to ask before downloading one: ${OR_DOWNLOAD}`);
  if (!(await confirm(QUESTION)))
    throw new Error(`no Chrome found, and the download was declined: ${OR_DOWNLOAD}`);
}

/** Download Playwright's headless Chromium with playwright-core's own installer. `--no-remove` keeps
 * the other browsers in Playwright's cache, which other projects may use. */
export function installHeadlessShell(): void {
  const root = dirname(createRequire(import.meta.url).resolve('playwright-core/package.json'));
  const done = spawnSync(
    process.execPath,
    [join(root, 'cli.js'), 'install', '--no-remove', 'chromium-headless-shell'],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  if (done.status !== 0) throw new Error("the download of Playwright's headless Chromium failed");
}
