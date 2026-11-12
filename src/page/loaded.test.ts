// A page opened and read, in Chrome. Its pixels: an element that cannot be shot is skipped, not an
// error; the failures are recognised by Playwright's wording, so these fail first when a new
// Playwright changes it. And a page set up by hand between the two: it is read as it was left.

import { chromium, type Browser } from 'playwright-core';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { open, openTabs, type LoadOptions } from './loaded.ts';

const OPTIONS: LoadOptions = {
  width: 800,
  height: 600,
  scale: 1,
  dark: false,
  storage: [],
  click: [],
  wait: 0,
  ignore: [],
  showIgnored: false,
};

/** A page whose body is `html`, as a URL. */
const pageOf = (html: string) =>
  `data:text/html,${encodeURIComponent(`<!doctype html><body>${html}</body>`)}`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(() => browser.close());

/** A page opened and read at once, as when nobody sets it up. */
const load = async (...args: Parameters<typeof open>) => (await open(...args)).read(false);

/** The one page open in the browser, as the person setting it up has it: these tests are their hands. */
const inHand = () => browser.contexts().flatMap(context => context.pages())[0];

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

  test('leave the scroll areas around the element where they were scrolled', async () => {
    const page = await load(
      browser,
      pageOf(
        '<div style="height:100px;overflow:auto">' +
          '<div style="height:100px;background:#ff0000"></div><div style="height:3000px"></div>' +
          '<div style="width:40px;height:40px;background:blue"></div></div>',
      ),
      'before',
      OPTIONS,
    );
    try {
      const far = page.elements.findIndex(e => e.style.width === '40px' && e.tag === 'div');
      await page.pixels(far); // scrolls the area 3100px down to shoot it
      const top = await page.shoot({ x: 20, y: 20, width: 40, height: 40 }); // inside the area, past the body's margin
      const { data } = await sharp(top).raw().toBuffer({ resolveWithObject: true });
      expect([...data.subarray(0, 3)]).toEqual([255, 0, 0]); // the area's top, not its bottom
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

describe('name', () => {
  test('is the accessible name Chrome computes, empty when an element has none', async () => {
    const page = await load(
      browser,
      pageOf(
        '<span id="l1">Monthly</span> <span id="l2">revenue</span>' +
          '<svg width="10" height="10" aria-label="  A   chart "></svg>' +
          '<svg width="10" height="10" aria-labelledby="l1 l2"></svg>' +
          '<img width="10" height="10" alt="Logo">' +
          '<svg width="10" height="10"><title>Sales</title></svg>' +
          '<canvas width="10" height="10" title="Map"></canvas>' +
          '<img width="10" height="10" alt="">' +
          '<svg width="10" height="10"></svg>',
      ),
      'before',
      OPTIONS,
    );
    try {
      const pictures = page.elements.flatMap((element, index) => (element.paints ? [index] : []));
      expect(await Promise.all(pictures.map(index => page.name(index)))).toEqual([
        'A chart',
        'Monthly revenue',
        'Logo',
        'Sales',
        'Map',
        '',
        '',
      ]);
    } finally {
      await page.close();
    }
  });
});

describe('a page set up by hand before it is read', () => {
  test('is read as it was left, not as it loaded', async () => {
    const opened = await open(
      browser,
      pageOf(`<input id="who"><p id="greeting">Nobody yet</p>
        <script>who.oninput = () => (greeting.textContent = 'Hello ' + who.value)</script>`),
      'before',
      OPTIONS,
    );
    try {
      await inHand().fill('#who', 'Ada');
      expect((await opened.read(true)).words).toEqual(['Hello', 'Ada']);
    } finally {
      await opened.close();
    }
  });

  test('has the pointer taken off it: what it was left over is not read as hovered', async () => {
    const opened = await open(
      browser,
      pageOf(
        '<style>a { color: rgb(0, 0, 255) } a:hover { color: rgb(255, 0, 0) }</style><a href="#">A link</a>',
      ),
      'before',
      OPTIONS,
    );
    try {
      await inHand().hover('a');
      const { elements } = await opened.read(true);
      expect(elements.find(e => e.tag === 'a')?.style.color).toBe('rgb(0, 0, 255)');
    } finally {
      await opened.close();
    }
  });

  test('is read in the tab its window has left, when the one it opened in was closed', async () => {
    const opened = await open(browser, pageOf('<p>Where it opened</p>'), 'before', OPTIONS);
    try {
      const first = inHand();
      const second = await first.context().newPage();
      await second.goto(pageOf('<p>Where it went on</p>'));
      expect(opened.tabs()).toBe(2);
      await first.close();
      expect(opened.tabs()).toBe(1);
      expect((await opened.read(true)).words).toEqual(['Where', 'it', 'went', 'on']);
    } finally {
      await opened.close();
    }
  });

  test('says so when its window was closed', async () => {
    const opened = await open(browser, pageOf('<p>Here</p>'), 'after', OPTIONS);
    try {
      await inHand().close();
      expect(opened.tabs()).toBe(0);
      await expect(opened.read(true)).rejects.toThrow("the after page's window was closed");
    } finally {
      await opened.close();
    }
  });
});

describe('both pages as tabs of one window', () => {
  const urls = { before: pageOf('<p>Before page</p>'), after: pageOf('<p>After page</p>') };
  /** The tab on `url`, as the person has it. */
  const tabOn = (url: string) =>
    browser
      .contexts()
      .flatMap(c => c.pages())
      .find(p => p.url() === url)!;
  const closing = async (work: (opened: Awaited<ReturnType<typeof openTabs>>) => Promise<void>) => {
    const opened = await openTabs(browser, urls, OPTIONS);
    try {
      await work(opened);
    } finally {
      await opened[0].close();
    }
  };

  test('are in one browser session, each read and shot as its own side', () =>
    closing(async ([before, after]) => {
      expect(browser.contexts()).toHaveLength(1);
      expect([before.tabs(), after.tabs()]).toEqual([1, 1]);
      const [was, now] = await Promise.all([before.read(true), after.read(true)]);
      expect([was.side, was.words, now.side, now.words]).toEqual([
        'before',
        ['Before', 'page'],
        'after',
        ['After', 'page'],
      ]);
      // Shot at once, as a run does: each waits for its tab to be in front.
      const shots = await Promise.all(
        [was, now].map(page => page.shoot({ x: 0, y: 0, width: 50, height: 20 })),
      );
      for (const shot of shots) expect(shot.subarray(1, 4).toString()).toBe('PNG');
    }));

  test('a tab a page opens is that side going on; any other tab counts on both sides', () =>
    closing(async ([before, after]) => {
      const first = tabOn(urls.before);
      const [opened] = await Promise.all([
        first.context().waitForEvent('page'),
        first.evaluate(() => void window.open('about:blank')),
      ]);
      await opened.setContent('<p>Went on here</p>');
      await expect.poll(() => [before.tabs(), after.tabs()]).toEqual([2, 1]);
      await first.close();
      expect((await before.read(true)).words).toEqual(['Went', 'on', 'here']);
      const nobodys = await first.context().newPage(); // as a person opening a tab themselves
      expect([before.tabs(), after.tabs()]).toEqual([2, 2]);
      await nobodys.close();
      expect([before.tabs(), after.tabs()]).toEqual([1, 1]);
    }));

  test('says so when a side has no tab left', () =>
    closing(async ([, after]) => {
      await tabOn(urls.after).close();
      await expect(after.read(true)).rejects.toThrow("the after page's tab was closed");
    }));

  test('both take the size the window is resized to, and keep their sharpness', () =>
    closing(async ([before, after]) => {
      const tab = tabOn(urls.before);
      const session = await tab.context().newCDPSession(tab);
      const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
      // As a person dragging the window's edge: 200 narrower, 100 shorter.
      const dragged = { width: bounds.width! - 200, height: bounds.height! - 100 };
      await session.send('Browser.setWindowBounds', { windowId, bounds: dragged });
      const sizeOf = (url: string) => tabOn(url).evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
      const taken = [OPTIONS.width - 200, OPTIONS.height - 100, OPTIONS.scale];
      await expect.poll(() => sizeOf(urls.before), { timeout: 5000 }).toEqual(taken);
      expect(await sizeOf(urls.after)).toEqual(taken);
      const [was, now] = await Promise.all([before.read(true), after.read(true)]);
      expect([was.width, now.width]).toEqual([OPTIONS.width - 200, OPTIONS.width - 200]);
    }));

  test('a resize just before they are read is taken too', () =>
    closing(async ([before, after]) => {
      const tab = tabOn(urls.before);
      const session = await tab.context().newCDPSession(tab);
      const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', { windowId, bounds: { width: bounds.width! - 300 } });
      const [was, now] = await Promise.all([before.read(true), after.read(true)]);
      expect([was.width, now.width]).toEqual([OPTIONS.width - 300, OPTIONS.width - 300]);
    }));
});
