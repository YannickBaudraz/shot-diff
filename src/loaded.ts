// A page loaded in Chrome, for one side of the comparison. It reads the page's words and elements
// once, before anything is drawn over it; gives an element's own pixels until the page is marked;
// marks the page in its side's colour; and shoots parts of it.

import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { Hunk } from './diff.ts';
import { runtime, type Box, type Marked, type MarkOptions, type Region, type Runtime } from './page.ts';
import { PROPERTIES, type El } from './looks.ts';

export type Side = 'before' | 'after';

/** Each side's colour: what the before page no longer has is red, what the after page adds is green. */
export const COLOURS: Record<Side, { color: string; tint: string }> = {
  before: { color: '#cf222e', tint: 'rgba(255, 129, 130, 0.45)' },
  after: { color: '#1a7f37', tint: 'rgba(74, 194, 107, 0.4)' },
};

export type LoadOptions = {
  width: number;
  height: number;
  scale: number;
  dark: boolean;
  storage: [string, string][];
  click: string[];
  wait: number;
};

/** A change of look to box on both pages: its element on each, and what to put on the box. */
export type LookMark = {
  a: number; // the element, as an index into the before page's elements
  b: number; // the same on the after page
  label: string | null;
  disc: { before: Buffer; after: Buffer; size: number } | null; // size in CSS pixels
};

export type LoadedPage = {
  side: Side;
  words: string[];
  elements: El[];
  width: number;
  /** A PNG of element `index`'s own pixels, or null when it cannot be shot. Only before mark(). */
  pixels(index: number): Promise<Buffer | null>;
  /** Mark this side's part of the word changes and the changes of look; once. */
  mark(hunks: Hunk[], looks: LookMark[]): Promise<Marked>;
  region(selector: string): Promise<Region | null>;
  snap(region: Region): Promise<Region>;
  shoot(clip: Box): Promise<Buffer>;
  close(): Promise<void>;
};

/** Call the page's runtime. The function sent to the page names nothing outside itself. */
function call<K extends keyof Runtime>(page: Page, name: K, arg: Parameters<Runtime[K]>[0]): Promise<ReturnType<Runtime[K]>> {
  return page.evaluate(
    ({ name, arg }) => (window as unknown as { __shotDiff: Record<string, (a: unknown) => unknown> }).__shotDiff[name](arg),
    { name, arg },
  ) as Promise<ReturnType<Runtime[K]>>;
}

export async function load(browser: Browser, url: string, side: Side, o: LoadOptions): Promise<LoadedPage> {
  const context = await browser.newContext({
    viewport: { width: o.width, height: o.height },
    deviceScaleFactor: o.scale,
    colorScheme: o.dark ? 'dark' : 'light',
    reducedMotion: 'reduce',
  });
  try {
    const page = await open(context, url, o);
    const { words, elements, width } = await call(page, 'read', Object.keys(PROPERTIES));
    return {
      side,
      words,
      elements,
      width,
      pixels: index => pixels(page, index),
      mark: (hunks, looks) => call(page, 'mark', markOptions(side, hunks, looks)),
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

/** The page at `url`, with the stored settings set before it runs, clicked, waited for, and the
 * runtime installed. */
async function open(context: BrowserContext, url: string, o: LoadOptions): Promise<Page> {
  if (o.storage.length) {
    await context.addInitScript(pairs => {
      for (const [key, value] of pairs) localStorage.setItem(key, value);
    }, o.storage);
  }
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  for (const selector of o.click) {
    await page.click(selector);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(o.wait);
  await page.evaluate(`window.__shotDiff = (${runtime.toString()})()`);
  return page;
}

/** A PNG of element `index`'s own pixels, or null when it is gone or cannot be shot. */
async function pixels(page: Page, index: number): Promise<Buffer | null> {
  const handle = await page.evaluateHandle(i => (window as unknown as { __shotDiff: Runtime }).__shotDiff.element(i), index);
  try {
    return (await handle.asElement()?.screenshot({ animations: 'disabled' })) ?? null;
  } catch {
    return null;
  } finally {
    await handle.dispose();
  }
}

/** What the runtime draws on `side`'s page: its colour, its half of each word change, and each
 * change of look's element there with its label or this side's disc. */
function markOptions(side: Side, hunks: Hunk[], looks: LookMark[]): MarkOptions {
  return {
    ...COLOURS[side],
    strike: side === 'before',
    hunks: hunks.map(h => side === 'before' ? { changed: h.removed, anchors: h.anchorsA } : { changed: h.added, anchors: h.anchorsB }),
    looks: looks.map(l => ({
      index: side === 'before' ? l.a : l.b,
      label: l.label,
      disc: l.disc ? { src: `data:image/png;base64,${l.disc[side].toString('base64')}`, size: l.disc.size } : null,
    })),
  };
}
