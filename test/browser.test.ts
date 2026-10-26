import type { Browser, LaunchOptions } from 'playwright-core';
import { describe, expect, test, vi } from 'vitest';
import { launch } from '../src/browser.ts';

const BROWSER = {} as Browser;
const NO_CHROME = new Error("browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome");
const NO_SHELL = new Error("browserType.launch: Executable doesn't exist at /cache/chromium_headless_shell-1248/chrome-headless-shell");

/** A chromium whose launches answer, in turn, with `outcomes`: an error is thrown, anything else is the browser. */
function chromium(...outcomes: (Error | 'ok')[]) {
  const calls: LaunchOptions[] = [];
  return {
    calls,
    launch: async (options: LaunchOptions = {}) => {
      calls.push(options);
      const outcome = outcomes.shift() ?? 'ok';
      if (outcome instanceof Error) throw outcome;
      return BROWSER;
    },
  };
}

describe('launch', () => {
  test('a Chrome named with --chrome is used, and nothing else is tried', async () => {
    const c = chromium(new Error('boom'));
    await expect(launch(c, { chrome: '/my/chrome', download: true, log: () => {} })).rejects.toThrow('boom');
    expect(c.calls).toEqual([{ executablePath: '/my/chrome' }]);
  });

  test('the installed Google Chrome comes first', async () => {
    const c = chromium('ok');
    expect(await launch(c, { download: true, log: () => {} })).toBe(BROWSER);
    expect(c.calls).toEqual([{ channel: 'chrome' }]);
  });

  test('without Chrome, a headless shell already downloaded is used', async () => {
    const install = vi.fn();
    const c = chromium(NO_CHROME, 'ok');
    expect(await launch(c, { download: true, log: () => {} }, install)).toBe(BROWSER);
    expect(install).not.toHaveBeenCalled();
  });

  test('with neither, the headless shell is downloaded once, then used', async () => {
    const install = vi.fn();
    const log = vi.fn();
    const c = chromium(NO_CHROME, NO_SHELL, 'ok');
    expect(await launch(c, { download: true, log }, install)).toBe(BROWSER);
    expect(install).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/downloading/));
  });

  test('--no-download stops with a way out instead of downloading', async () => {
    const install = vi.fn();
    const c = chromium(NO_CHROME, NO_SHELL);
    await expect(launch(c, { download: false, log: () => {} }, install)).rejects.toThrow(/--chrome/);
    expect(install).not.toHaveBeenCalled();
  });

  test('a Chrome that is there but fails to start is an error, not a reason to download', async () => {
    const install = vi.fn();
    const c = chromium(new Error('crashed'));
    await expect(launch(c, { download: true, log: () => {} }, install)).rejects.toThrow('crashed');
    expect(install).not.toHaveBeenCalled();
  });
});
