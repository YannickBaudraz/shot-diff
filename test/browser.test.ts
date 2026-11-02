import type { Browser, LaunchOptions } from 'playwright-core';
import { describe, expect, test, vi } from 'vitest';
import { launch, type Choice } from '../src/browser.ts';

const BROWSER = {} as Browser;
const NO_CHROME = new Error(
  "browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome",
);
const NO_SHELL = new Error(
  "browserType.launch: Executable doesn't exist at /cache/chromium_headless_shell-1248/chrome-headless-shell",
);

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

const choice = (more: Partial<Choice> = {}): Choice => ({
  download: 'ask',
  confirm: null,
  log: () => {},
  ...more,
});

describe('launch', () => {
  test('a Chrome named with --chrome is used, and nothing else is tried', async () => {
    const c = chromium(new Error('boom'));
    await expect(launch(c, choice({ chrome: '/my/chrome', download: 'yes' }))).rejects.toThrow('boom');
    expect(c.calls).toEqual([{ executablePath: '/my/chrome' }]);
  });

  test('the installed Google Chrome comes first', async () => {
    const c = chromium('ok');
    expect(await launch(c, choice())).toBe(BROWSER);
    expect(c.calls).toEqual([{ channel: 'chrome' }]);
  });

  test('without Chrome, a headless shell already downloaded is used, with no question', async () => {
    const install = vi.fn();
    const confirm = vi.fn(async () => true);
    expect(await launch(chromium(NO_CHROME, 'ok'), choice({ confirm }), install)).toBe(BROWSER);
    expect(confirm).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  test('with neither, it asks, and downloads on a yes', async () => {
    const install = vi.fn();
    const confirm = vi.fn(async () => true);
    expect(await launch(chromium(NO_CHROME, NO_SHELL, 'ok'), choice({ confirm }), install)).toBe(BROWSER);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Download .* 100 MB/));
    expect(install).toHaveBeenCalledOnce();
  });

  test('on a no, it stops without downloading', async () => {
    const install = vi.fn();
    const confirm = vi.fn(async () => false);
    await expect(launch(chromium(NO_CHROME, NO_SHELL), choice({ confirm }), install)).rejects.toThrow(
      /declined.*--download/,
    );
    expect(install).not.toHaveBeenCalled();
  });

  test('with no terminal to ask, it stops and says how to say yes', async () => {
    const install = vi.fn();
    await expect(launch(chromium(NO_CHROME, NO_SHELL), choice({ confirm: null }), install)).rejects.toThrow(
      /no terminal.*--download/,
    );
    expect(install).not.toHaveBeenCalled();
  });

  test('--download downloads without asking', async () => {
    const install = vi.fn();
    const confirm = vi.fn(async () => false);
    expect(
      await launch(chromium(NO_CHROME, NO_SHELL, 'ok'), choice({ download: 'yes', confirm }), install),
    ).toBe(BROWSER);
    expect(confirm).not.toHaveBeenCalled();
    expect(install).toHaveBeenCalledOnce();
  });

  test('--no-download stops without asking', async () => {
    const install = vi.fn();
    const confirm = vi.fn(async () => true);
    await expect(
      launch(chromium(NO_CHROME, NO_SHELL), choice({ download: 'no', confirm }), install),
    ).rejects.toThrow(/--chrome/);
    expect(confirm).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  test('a Chrome that is there but fails to start is an error, not a reason to download', async () => {
    const install = vi.fn();
    const confirm = vi.fn(async () => true);
    await expect(
      launch(chromium(new Error('crashed')), choice({ download: 'yes', confirm }), install),
    ).rejects.toThrow('crashed');
    expect(confirm).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });
});
