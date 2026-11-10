// Chrome for Windows from WSL: when it is the one opened, where it has a page, and how it is closed.
// WSL, chrome-launcher and Playwright are stood in for: the real ones open windows on a desktop.

import { EventEmitter } from 'node:events';
import type { Browser } from 'playwright-core';
import { describe, expect, test, vi } from 'vitest';
import { locate, windowsChrome, type Wsl } from '../src/windows.ts';

/** A WSL with Chrome for Windows within reach, and what was started in it. */
function wsl(more: Partial<Wsl> = {}) {
  const process = new EventEmitter();
  const kill = vi.fn();
  const start = vi.fn(async () => ({ port: 9222, pid: 1, process, kill, remoteDebuggingPipes: null }));
  const stood: Wsl = {
    inside: true,
    chrome: () => '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    networking: () => 'mirrored',
    windowsPath: path => `\\\\wsl.localhost\\Ubuntu${path.replaceAll('/', '\\')}`,
    start: start as unknown as Wsl['start'],
    ...more,
  };
  return { stood, start, kill, process };
}

/** A Playwright whose connection gives a browser that records what it is asked. */
function playwright() {
  const sent: string[] = [];
  const browser = {
    newBrowserCDPSession: async () => ({
      send: async (method: string) => {
        sent.push(method);
      },
    }),
    close: async () => {},
  } as unknown as Browser;
  const connectOverCDP = vi.fn(async () => browser);
  return { chromium: { connectOverCDP } as never, connectOverCDP, browser, sent };
}

describe('windowsChrome', () => {
  test('outside WSL, nothing is looked for or started', async () => {
    const chrome = vi.fn();
    const { stood, start } = wsl({ inside: false, chrome });
    expect(await windowsChrome(playwright().chromium, () => {}, stood)).toBeNull();
    expect(chrome).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test('without Chrome for Windows, nothing is started', async () => {
    const { stood, start } = wsl({ chrome: () => undefined });
    expect(await windowsChrome(playwright().chromium, () => {}, stood)).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  test.each(['nat', null])(
    'where WSL does not share localhost with Windows (%s), nothing is started, and it says why',
    async networking => {
      const log = vi.fn();
      const { stood, start } = wsl({ networking: () => networking });
      expect(await windowsChrome(playwright().chromium, log, stood)).toBeNull();
      expect(start).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/networkingMode=mirrored.*Linux Chrome/));
    },
  );

  test('within reach, it is started without a window of its own and connected to on its port', async () => {
    const { stood, start } = wsl();
    const { chromium, connectOverCDP, browser } = playwright();
    const launched = await windowsChrome(chromium, () => {}, stood);
    expect(start).toHaveBeenCalledWith({
      chromePath: '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
      chromeFlags: expect.arrayContaining(['--no-startup-window', '--hide-scrollbars']),
    });
    expect(connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9222');
    expect(launched?.browser).toBe(browser);
    expect(launched?.locate('file:///home/me/site/index.html')).toBe(
      'file://wsl.localhost/Ubuntu/home/me/site/index.html',
    );
  });

  test('closed, it is asked to quit, and its profile is removed once it has', async () => {
    const { stood, kill, process } = wsl();
    const { chromium, sent } = playwright();
    const launched = await windowsChrome(chromium, () => {}, stood);
    const closed = launched?.close();
    await vi.waitFor(() => expect(sent).toEqual(['Browser.close']));
    expect(kill).not.toHaveBeenCalled(); // not under a Chrome still writing to it
    process.emit('exit', 0);
    await closed;
    expect(kill).toHaveBeenCalledOnce();
  });

  test('one that cannot be connected to is not left behind', async () => {
    const { stood, kill } = wsl();
    const chromium = { connectOverCDP: vi.fn().mockRejectedValue(new Error('refused')) } as never;
    await expect(windowsChrome(chromium, () => {}, stood)).rejects.toThrow('refused');
    expect(kill).toHaveBeenCalledOnce();
  });
});

describe('locate', () => {
  const share = (path: string) => `\\\\wsl.localhost\\Ubuntu${path.replaceAll('/', '\\')}`;

  test('a file in WSL is on its network share, with its query and fragment kept', () => {
    expect(locate('file:///home/me/my%20site/index.html?tab=2#prices', share)).toBe(
      'file://wsl.localhost/Ubuntu/home/me/my%20site/index.html?tab=2#prices',
    );
  });

  test('a file on a Windows drive is at its Windows path', () => {
    expect(locate('file:///mnt/c/Users/me/index.html', () => 'C:\\Users\\me\\index.html')).toBe(
      'file:///C:/Users/me/index.html',
    );
  });

  test('any other address is the same', () => {
    const never = () => {
      throw new Error('not a file');
    };
    expect(locate('http://localhost:3000/cart', never)).toBe('http://localhost:3000/cart');
    expect(locate('not an address', never)).toBe('not an address');
  });
});
