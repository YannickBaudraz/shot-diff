// A page loaded in Chrome, for one side of the comparison. It reads the page's words and elements
// once, before anything is drawn over it; gives an element's own pixels until the page is marked;
// marks the page in its side's colour; and shoots parts of it.

import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { Hunk } from './diff.ts';
import { PROPERTIES, type ElementInfo } from './looks.ts';
import type { Marker } from './markers.ts';
import { runtime, type Box, type Marks, type Region, type Runtime, type Spans } from './page.ts';
import { COLOURS, type Side } from './side.ts';

declare global {
  interface Window {
    /** The page's runtime, as open() installs it. */
    __shotDiff: Runtime;
  }
}

export type LoadOptions = {
  width: number;
  height: number;
  scale: number;
  dark: boolean;
  storage: [string, string][]; // set in localStorage before the page runs
  click: string[]; // selectors to click after loading, in order
  wait: number; // milliseconds to wait after loading and clicking
};

export type LoadedPage = {
  side: Side;
  words: string[];
  elements: ElementInfo[];
  width: number;
  /** A PNG of element `index`'s own pixels, or null when it cannot be shot. Only before mark(). */
  pixels(index: number): Promise<Buffer | null>;
  /** Mark this side's part of the word changes and the changes of look; once. */
  mark(hunks: Hunk[], markers: Marker[]): Promise<Spans>;
  region(selector: string): Promise<Region | null>;
  snap(region: Region): Promise<Region>;
  shoot(clip: Box): Promise<Buffer>;
  close(): Promise<void>;
};

/** Time for what a click opens (a menu, a tab) to settle before the next click. */
const AFTER_CLICK_MS = 300;

export async function load(browser: Browser, url: string, side: Side, options: LoadOptions): Promise<LoadedPage> {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: options.scale,
    colorScheme: options.dark ? 'dark' : 'light',
    reducedMotion: 'reduce',
  });
  try {
    const page = await open(context, url, options);
    const { words, elements, width } = await call(page, 'read', Object.keys(PROPERTIES));
    return {
      side,
      words,
      elements,
      width,
      pixels: index => pixels(page, index),
      mark: (hunks, markers) => call(page, 'mark', marksFor(side, hunks, markers)),
      region: selector => call(page, 'region', selector),
      snap: region => call(page, 'snap', region),
      shoot: clip => page.screenshot({ clip, fullPage: true, animations: 'disabled' }),
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** The page at `url`: stored settings set before it runs, loaded, clicked, waited for, and with the
 * runtime installed. */
async function open(context: BrowserContext, url: string, options: LoadOptions): Promise<Page> {
  if (options.storage.length) {
    await context.addInitScript(pairs => {
      for (const [key, value] of pairs) localStorage.setItem(key, value);
    }, options.storage);
  }
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  for (const selector of options.click) {
    await page.click(selector);
    await page.waitForTimeout(AFTER_CLICK_MS);
  }
  await page.waitForTimeout(options.wait);
  await page.evaluate(`window.__shotDiff = (${runtime.toString()})()`);
  return page;
}

/** Call one of the runtime's functions in the page. What is sent to the page names nothing outside
 * itself; its result comes back untyped, so it is typed here from the runtime's own signature. */
function call<Name extends keyof Runtime>(page: Page, name: Name, arg: Parameters<Runtime[Name]>[0]) {
  const result = page.evaluate(({ name, arg }) => (window.__shotDiff[name] as (arg: unknown) => unknown)(arg), { name, arg });
  return result as Promise<ReturnType<Runtime[Name]>>;
}

/** A PNG of element `index`'s own pixels, or null when it is gone or cannot be shot. */
async function pixels(page: Page, index: number): Promise<Buffer | null> {
  const handle = await page.evaluateHandle(i => window.__shotDiff.element(i), index);
  try {
    return (await handle.asElement()?.screenshot({ animations: 'disabled' })) ?? null;
  } catch {
    return null;
  } finally {
    await handle.dispose();
  }
}

/** What to draw on `side`'s page: its colour, its half of each word change, and each change of look's
 * element there with its label or this side's disc. */
function marksFor(side: Side, hunks: Hunk[], markers: Marker[]): Marks {
  return {
    ...COLOURS[side],
    strike: side === 'before',
    words: hunks.map(hunk => ({ changed: hunk.changed[side], anchors: hunk.anchors[side] })),
    looks: markers.map(marker => ({
      index: marker.element[side],
      label: marker.label,
      disc: marker.disc && { src: `data:image/png;base64,${marker.disc.image[side].toString('base64')}`, size: marker.disc.size },
    })),
  };
}
