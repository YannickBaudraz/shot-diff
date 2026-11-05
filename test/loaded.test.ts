// A loaded page's pixels, in Chrome: an element that cannot be shot is skipped, not an error. The
// failures are recognised by Playwright's wording, so these fail first when a new Playwright changes it.

import { chromium, type Browser } from 'playwright-core';
import sharp from 'sharp';
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

  test('leave the page where it was scrolled: a fixed header stays at the top of a shot of the top', async () => {
    const page = await load(
      browser,
      pageOf(
        '<header style="position:fixed;top:0;left:0;right:0;height:40px;background:#ff0000"></header>' +
          '<div style="height:3000px"></div><div style="width:40px;height:40px;background:blue"></div>',
      ),
      'before',
      OPTIONS,
    );
    try {
      const far = page.elements.findIndex(e => e.style.width === '40px' && e.tag === 'div');
      await page.pixels(far); // scrolls 3000px down to shoot it
      const top = await page.shoot({ x: 0, y: 0, width: 100, height: 40 });
      const { data } = await sharp(top).raw().toBuffer({ resolveWithObject: true });
      expect([...data.subarray(0, 3)]).toEqual([255, 0, 0]); // the header, not the white page
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
