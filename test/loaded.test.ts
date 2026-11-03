// A loaded page's pixels, in Chrome: an element that cannot be shot is skipped, not an error. The
// failures are recognised by Playwright's wording, so these fail first when a new Playwright changes it.

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { load, type LoadOptions } from '../src/loaded.ts';

const OPTIONS: LoadOptions = {
  width: 800,
  height: 600,
  scale: 1,
  dark: false,
  storage: [],
  click: [],
  wait: 0,
};

/** A page whose body is `html`, as a URL. */
const pageOf = (html: string) =>
  `data:text/html,${encodeURIComponent(`<!doctype html><body>${html}</body>`)}`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(() => browser.close());

describe('pixels', () => {
  test('give a PNG of an element that can be shot', async () => {
    const page = await load(
      browser,
      pageOf('<div style="width:40px;height:40px;background:red"></div>'),
      'before',
      OPTIONS,
    );
    try {
      expect((await page.pixels(0))?.subarray(1, 4).toString()).toBe('PNG');
    } finally {
      await page.close();
    }
  });

  test('are null for an element that left the page', async () => {
    const page = await load(
      browser,
      pageOf(`<div id="gone" style="width:40px;height:40px;background:red"></div>
        <script>setTimeout(() => document.getElementById('gone').remove(), 200)</script>`),
      'before',
      OPTIONS,
    );
    try {
      await new Promise(resolve => setTimeout(resolve, 400));
      expect(await page.pixels(0)).toBeNull();
    } finally {
      await page.close();
    }
  });

  test('throw anything else', async () => {
    const page = await load(browser, pageOf('<div style="width:40px;height:40px"></div>'), 'before', OPTIONS);
    await page.close();
    await expect(page.pixels(0)).rejects.toThrow();
  });
});
