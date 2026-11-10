// Chrome for Windows, opened from WSL for pages set up by hand. On a Windows desktop that is the
// Chrome a person expects; the Linux one opens through WSLg, as a window from another system.
// Playwright starts a browser over a pipe, which does not cross from Linux to a Windows program, so
// chrome-launcher starts it with a debugging port, in a profile of its own that it removes after,
// and Playwright connects to that port. The port is reached only where WSL shares localhost with
// Windows: networkingMode=mirrored in .wslconfig.

import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch as start, Launcher } from 'chrome-launcher';
import isWsl from 'is-wsl';
import type { BrowserType } from 'playwright-core';
import type { Launched } from './browser.ts';

/** What this needs of WSL; HERE is the real one. */
export type Wsl = {
  inside: boolean;
  /** Chrome for Windows, when it is installed. */
  chrome(): string | undefined;
  /** How WSL is networked with Windows, "mirrored" when they share localhost; null when it does not say. */
  networking(): string | null;
  /** The path Windows has a file in WSL at. */
  windowsPath(path: string): string;
  start: typeof start;
};

const HERE: Wsl = {
  inside: isWsl,
  chrome: () => Launcher.getFirstInstallation(),
  networking: () => output('wslinfo', ['--networking-mode']),
  windowsPath: path => output('wslpath', ['-w', path]) ?? path,
  start,
};

/** What a command prints, or null when it is not there or fails. */
function output(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** What Chrome is started with, on top of chrome-launcher's own flags for a Chrome a tool drives: no
 * window of its own, as each page gets one; no scrollbars, which take room in the page where the
 * headless Chrome has none; and colours that do not depend on the screen's profile. */
const FLAGS = ['--no-startup-window', '--hide-scrollbars', '--force-color-profile=srgb'];

/** How long Chrome gets to quit, once asked, before its profile is removed under it. */
const QUIT_MS = 5000;

/** Chrome for Windows, started and connected to; null where it is not the one to open: outside WSL,
 * without it installed, or where its port cannot be reached, which is said. */
export async function windowsChrome(
  chromium: Pick<BrowserType, 'connectOverCDP'>,
  log: (line: string) => void,
  wsl: Wsl = HERE,
): Promise<Launched | null> {
  if (!wsl.inside) return null;
  const chromePath = wsl.chrome();
  if (!chromePath) return null;
  if (wsl.networking() !== 'mirrored') {
    log(
      'shot-diff: Chrome for Windows cannot be reached from this WSL (it needs networkingMode=mirrored in .wslconfig): opening the Linux Chrome',
    );
    return null;
  }
  const chrome = await wsl.start({ chromePath, chromeFlags: FLAGS });
  const quit = once(chrome.process, 'exit');
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
    return {
      browser,
      locate: url => locate(url, wsl.windowsPath),
      close: async () => {
        // Killing the process WSL started it through leaves Chrome running on Windows: it is asked
        // to quit. One the person already quit has nobody left to ask.
        await browser
          .newBrowserCDPSession()
          .then(session => session.send('Browser.close'))
          .catch(() => {});
        await browser.close().catch(() => {});
        await Promise.race([quit, sleep(QUIT_MS, undefined, { ref: false })]);
        chrome.kill(); // removes the profile
      },
    };
  } catch (error) {
    chrome.kill();
    throw error;
  }
}

/** Where Chrome for Windows has the page at `url`: a file in WSL is on a network share there, and
 * one on a Windows drive is at its Windows path. Any other address is the same. */
export function locate(url: string, windowsPath: (path: string) => string): string {
  const parsed = URL.parse(url);
  if (parsed?.protocol !== 'file:') return url;
  const located = pathToFileURL(windowsPath(fileURLToPath(parsed)), { windows: true });
  located.search = parsed.search;
  located.hash = parsed.hash;
  return located.href;
}
