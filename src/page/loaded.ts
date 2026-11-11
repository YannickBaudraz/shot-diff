// A page in Chrome, for one side of the comparison. It is opened first, and can then be set up by
// hand; read, it gives the page's words and elements as they are then, once, before anything is
// drawn over it; gives an element's own pixels until the page is marked; marks the page in its
// side's colour; and shoots parts of it.

import { errors, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { PROPERTIES, type ElementInfo } from '../changes/looks.ts';
import type { Hunk } from '../changes/words.ts';
import type { Box, Region } from '../geometry.ts';
import { DISC, type Marker } from '../shots/markers.ts';
import { runtime, type Marks, type Runtime, type Spans } from './runtime.ts';
import { COLORS, SIDES, type Side } from '../side.ts';

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
  ignore: string[]; // selectors of the elements left out of the comparison, all inside them included
};

/** A page opened for one side: loaded, clicked and waited for, and not read yet. */
export type OpenedPage = {
  side: Side;
  /** How many tabs it has now: a person setting the page up can open more, or close them all. */
  tabs(): number;
  /** Read the page as it is now, in the tab its window has left when that is another one. `handled`
   * says a person had their hands on it since it was opened. */
  read(handled: boolean): Promise<LoadedPage>;
  close(): Promise<void>;
};

export type LoadedPage = {
  side: Side;
  words: string[];
  ignored: number[]; // how many elements each of LoadOptions' ignore selectors matched
  elements: ElementInfo[];
  width: number;
  /** A PNG of element `index`'s own pixels, or null when it cannot be shot. Only before mark(). */
  pixels(index: number): Promise<Buffer | null>;
  /** Element `index`'s accessible name, as Chrome gives it to screen readers; empty when it has none. Only before mark(). */
  name(index: number): Promise<string>;
  /** Mark this side's part of the word changes and the changes of look, saying of each whether it is
   * inside the element `within` matches; once. */
  mark(hunks: Hunk[], markers: Marker[], within: string | null): Promise<Spans>;
  /** Take back the marks of these word changes and changes of look, indexes into what mark() got. */
  unmark(changes: { words: number[]; looks: number[] }): Promise<void>;
  region(selector: string): Promise<Region | null>;
  snap(region: Region): Promise<Region>;
  shoot(clip: Box): Promise<Buffer>;
  close(): Promise<void>;
};

/** Time for what a click opens (a menu, a tab) to settle before the next click. */
const AFTER_CLICK_MS = 300;

/** How often a window's size is looked at, and so how long it holds before its tabs take it: while
 * it is dragged, they are left alone. */
const FOLLOW_MS = 250;

/** A browser context for pages loaded with `options`: their size, sharpness and colour scheme, and
 * the stored settings, set before a page runs. */
async function contextFor(browser: Browser, options: LoadOptions): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: options.scale,
    colorScheme: options.dark ? 'dark' : 'light',
    reducedMotion: 'reduce',
  });
  if (options.storage.length) {
    await context.addInitScript(pairs => {
      for (const [key, value] of pairs) localStorage.setItem(key, value);
    }, options.storage);
  }
  return context;
}

/** A page of one side, in a window of its own. */
export async function open(
  browser: Browser,
  url: string,
  side: Side,
  options: LoadOptions,
): Promise<OpenedPage> {
  const context = await contextFor(browser, options);
  const close = () => context.close();
  try {
    await visit(await context.newPage(), url, options);
    return {
      side,
      tabs: () => context.pages().length,
      read: async handled => {
        const [page] = context.pages();
        if (!page) throw new Error(`the ${side} page's window was closed before it was shot`);
        return read(page, side, options.ignore, handled, close, work => work());
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Both pages as the two tabs of one window (--tabs), for a person to set up. The window is theirs
 * to resize: both tabs keep its size, where two windows resized by hand are never quite the same.
 * One window is one browser session, so the pages share their cookies where they share a host.
 * A tab a page opens, as a link can, goes on as that page's side; any other tab is nobody's, and
 * counts on both sides until it is closed. */
export async function openTabs(
  browser: Browser,
  urls: Record<Side, string>,
  options: LoadOptions,
): Promise<OpenedPage[]> {
  const context = await contextFor(browser, options);
  let following: Following | undefined;
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= Promise.resolve(following?.stop()).then(() => context.close()));
  const sideOf = new Map<Page, Side>();
  context.on('page', page => {
    const takeSide = (opener: Page | null) => {
      const side = opener && sideOf.get(opener);
      if (side) sideOf.set(page, side);
    };
    void page.opener().then(takeSide, () => {});
  });
  try {
    const pages: Record<Side, Page> = { before: await context.newPage(), after: await context.newPage() };
    for (const side of SIDES) sideOf.set(pages[side], side);
    await Promise.all(SIDES.map(side => visit(pages[side], urls[side], options)));
    const follow = (following = await followWindow(context, options));
    let settled: Promise<void> | undefined;
    const inTurn = turns();
    const tabsOf = (side: Side) => context.pages().filter(page => sideOf.get(page) === side);
    const nobodys = () => context.pages().filter(page => !sideOf.has(page));
    return SIDES.map(side => ({
      side,
      tabs: () => tabsOf(side).length + nobodys().length,
      read: async handled => {
        await (settled ??= follow.stop()); // the size both are read and shot at
        const [page] = tabsOf(side);
        if (!page) throw new Error(`the ${side} page's tab was closed before it was shot`);
        // Chrome draws the tab in front only: each shot waits its turn, with its tab brought forward.
        const inFront = <T>(work: () => Promise<T>) => inTurn(() => page.bringToFront().then(work));
        return read(page, side, options.ignore, handled, close, inFront);
      },
      close,
    }));
  } catch (error) {
    await close();
    throw error;
  }
}

/** Runs each piece of work after the one before it is done. */
function turns() {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const mine = last.then(work);
    last = mine.catch(() => {});
    return mine;
  };
}

/** Something that goes on until it is stopped; stopping it finishes what it was doing. */
type Following = { stop(): Promise<void> };

/** Keep every tab of `context`'s window at the size of the window, as a person resizes it. The
 * pages are held at a set size, whatever their window's, so that a shot is as sharp and as wide as
 * asked: the window is looked at again and again, and its size, once it holds, is set on its tabs.
 * Stopping looks a last time, so the tabs have the size the window was left at. */
async function followWindow(context: BrowserContext, options: LoadOptions): Promise<Following> {
  // The window opened to fit the page: what it has around the page is the rest of its size.
  const opened = await inWindow(context, async ({ bounds }) => bounds);
  const around = {
    width: (opened?.width ?? 0) - options.width,
    height: (opened?.height ?? 0) - options.height,
  };
  // A window the screen was too small for was not opened to fit: it is not followed.
  if (!opened || around.width < 0 || around.height < 0) return { stop: async () => {} };
  const sizeOf = (bounds: WindowBounds) => `${bounds.width}x${bounds.height}`;
  let taken = sizeOf(opened); // the window size its tabs have
  let seen = taken; // the window size when it was last looked at
  const look = (last: boolean) =>
    inWindow(context, async ({ bounds, maximise }) => {
      const size = sizeOf(bounds);
      const holds = size === seen;
      seen = size;
      const shown = bounds.windowState === 'normal' || bounds.windowState === 'maximized';
      if (size === taken || !shown || !(holds || last)) return;
      const viewport = {
        width: Math.max(1, (bounds.width ?? 0) - around.width),
        height: Math.max(1, (bounds.height ?? 0) - around.height),
      };
      await Promise.all(context.pages().map(page => page.setViewportSize(viewport)));
      // Sizing a page sizes its window to fit, which takes a maximised one back down.
      if (bounds.windowState === 'maximized') await maximise();
      taken = size;
    });
  // A look that fails, as when a tab is closed under it, is tried again at the next one.
  let looking: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    looking = looking.then(() => look(false)).catch(() => {});
  }, FOLLOW_MS);
  return {
    stop: async () => {
      clearInterval(timer);
      await looking;
      await look(true).catch(() => {});
    },
  };
}

type WindowBounds = { width?: number; height?: number; windowState?: string };

/** Do `work` with the window of `context`'s tabs: its size and state, and how to maximise it.
 * Nothing is done, and nothing given, when it has no tab left. */
async function inWindow<T>(
  context: BrowserContext,
  work: (window: { bounds: WindowBounds; maximise(): Promise<unknown> }) => Promise<T>,
): Promise<T | undefined> {
  const [page] = context.pages();
  if (!page) return undefined;
  const session = await context.newCDPSession(page);
  try {
    const { windowId, bounds } = await session.send('Browser.getWindowForTarget');
    const maximise = () =>
      session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
    return await work({ bounds, maximise });
  } finally {
    await session.detach().catch(() => {});
  }
}

/** Load `url` in `page`, then click and wait as the options say. */
async function visit(page: Page, url: string, options: LoadOptions): Promise<void> {
  await page.goto(url, { waitUntil: 'load' });
  for (const selector of options.click) {
    await page.click(selector);
    await page.waitForTimeout(AFTER_CLICK_MS);
  }
  await page.waitForTimeout(options.wait);
}

/** The page as it is now: the runtime is installed, which reads it. A page a person had their hands
 * on has their pointer moved off it: what it is over looks hovered on that page alone, a difference
 * the change did not make. `shooting` runs each shot of the page, in its turn when it has to wait
 * for one. */
async function read(
  page: Page,
  side: Side,
  ignore: string[],
  handled: boolean,
  close: () => Promise<void>,
  shooting: <T>(shot: () => Promise<T>) => Promise<T>,
): Promise<LoadedPage> {
  if (handled) await page.mouse.move(-1, -1);
  await page.evaluate(
    `window.__shotDiff = (${runtime.toString()})(${JSON.stringify(Object.keys(PROPERTIES))}, ${JSON.stringify(ignore)})`,
  );
  const { words, elements, width, ignored } = await page.evaluate(() => window.__shotDiff.reading);
  return {
    side,
    words,
    ignored,
    elements,
    width,
    pixels: index => shooting(() => pixels(page, index)),
    name: index => accessibleName(page, index),
    mark: (hunks, markers, within) => call(page, 'mark', marksFor(side, hunks, markers, within)),
    region: selector => call(page, 'region', selector),
    snap: region => call(page, 'snap', region),
    unmark: changes => call(page, 'unmark', changes),
    shoot: clip => shooting(() => page.screenshot({ clip, fullPage: true, animations: 'disabled' })),
    close,
  };
}

/** The runtime's functions, called from here; the rest of it is read where it is. */
type Method = 'mark' | 'unmark' | 'region' | 'snap';

/** Call one of the runtime's functions in the page. What is sent to the page names nothing outside
 * itself; its result comes back untyped, so it is typed here from the runtime's own signature. */
function call<Name extends Method>(page: Page, name: Name, arg: Parameters<Runtime[Name]>[0]) {
  const result = page.evaluate(
    ({ name, arg }) => (window.__shotDiff[name] as (arg: unknown) => unknown)(arg),
    { name, arg },
  );
  return result as Promise<ReturnType<Runtime[Name]>>;
}

/** Element `index`'s accessible name, from Chrome's accessibility tree: what a screen reader says,
 * with every rule of the specification applied. Empty for an element that has none, or that the
 * tree leaves out, as an image with empty alternative text. */
async function accessibleName(page: Page, index: number): Promise<string> {
  const session = await page.context().newCDPSession(page);
  try {
    const { result } = await session.send('Runtime.evaluate', {
      expression: `window.__shotDiff.element(${index})`,
    });
    if (!result.objectId) return '';
    const { nodes } = await session.send('Accessibility.getPartialAXTree', {
      objectId: result.objectId,
      fetchRelatives: false,
    });
    return String(nodes[0]?.name?.value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  } finally {
    await session.detach().catch(() => {});
  }
}

/** The errors Playwright gives when an element cannot be shot: it left the page, it has no box, it
 * never became visible, or it is too big for one image. */
const unshootable = (error: unknown) =>
  error instanceof errors.TimeoutError ||
  (error instanceof Error &&
    /not attached to the DOM|Node is either not visible|Node has 0 (width|height)|larger than 32767 pixels/.test(
      error.message,
    ));

/** A PNG of element `index`'s own pixels, or null when it is gone or cannot be shot. Shooting an
 * element scrolls it into view, the page and every scroll area around it; they are scrolled back
 * after, as the marks and the shots are placed with them where they were, and a fixed header or a
 * sticky sidebar is drawn where they are scrolled to. */
async function pixels(page: Page, index: number): Promise<Buffer | null> {
  const handle = await page.evaluateHandle(i => window.__shotDiff.element(i), index);
  const scrollBack = await handle.evaluateHandle(element => {
    const areas: [Element, number, number][] = [];
    // The element it is laid out in: its slot, or past the top of a shadow tree, that tree's element.
    const around = (inner: Element) => {
      const root = inner.getRootNode();
      return inner.assignedSlot ?? inner.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    };
    for (let area = around(element); area; area = around(area))
      areas.push([area, area.scrollLeft, area.scrollTop]);
    const { scrollX, scrollY } = window;
    return () => {
      for (const [area, left, top] of areas) area.scrollTo(left, top);
      window.scrollTo(scrollX, scrollY);
    };
  });
  try {
    return (await handle.asElement()?.screenshot({ animations: 'disabled' })) ?? null;
  } catch (error) {
    if (unshootable(error)) return null;
    throw error;
  } finally {
    await scrollBack.evaluate(back => back());
    await scrollBack.dispose();
    await handle.dispose();
  }
}

/** What to draw on `side`'s page: its colour, its half of each word change, and each change of look's
 * element there with its label or this side's disc. A change only the other page has gets none. */
function marksFor(side: Side, hunks: Hunk[], markers: Marker[], within: string | null): Marks {
  return {
    color: COLORS[side].color,
    within,
    words: hunks.map(hunk => ({ changed: hunk.changed[side], anchors: hunk.anchors[side] })),
    looks: markers.map(({ element, badge, only, edge, beside }) => ({
      index: element[side],
      edge,
      beside,
      badge:
        only && only !== side
          ? null
          : 'disc' in badge
            ? { disc: { src: `data:image/png;base64,${badge.disc[side].toString('base64')}`, size: DISC } }
            : badge,
    })),
  };
}
