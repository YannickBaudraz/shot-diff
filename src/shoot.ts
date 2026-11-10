// The whole run: load both pages, find what changed, mark it, plan the shots, and draw them.

import type { Browser } from 'playwright-core';
import { band, type Content, type Key } from './band.ts';
import { diff, hunks, type Hunk } from './diff.ts';
import { open, openTabs, type LoadedPage, type LoadOptions, type OpenedPage } from './loaded.ts';
import { compareLooks } from './looks.ts';
import { markersFor, type Marker, type Mode } from './markers.ts';
import type { Box } from './page.ts';
import { plan, type Place, type Plan, type PlanOptions } from './plan.ts';
import { bothSides, SIDES, type Side } from './side.ts';

export type Options = LoadOptions &
  PlanOptions & {
    before: string;
    after: string;
    title: string;
    markers: Mode; // what a change of look's box says: what changed, or a number the band explains
    /** Waits while a person sets both opened pages up by hand (--interactive); null to read them as
     * they load. Called again, with the sides whose window then has several tabs, until none has. */
    prepare: Prepare | null;
    /** Open both pages as tabs of one window, not a window each (--tabs): for pages set up by hand. */
    tabs: boolean;
  };

export type Prepare = (crowded: Side[]) => Promise<void>;

export type ShotSide = { png: Buffer; changed: string[]; box: Box };
export type Shot = { before: ShotSide; after: ShotSide };
/** How many word changes and changes of look were found, the shots, the changes found but cut from
 * every image, the changes a scroll area cuts off on the page itself, and the changes outside
 * --selector's element, which no shot looks for. */
export type Result = {
  wordChanges: number;
  lookChanges: number;
  shots: Shot[];
  leftOut: { removed: string[]; added: string[] };
  hidden: { removed: string[]; added: string[] };
  ignored: { removed: string[]; added: string[] };
};

export async function run(browser: Browser, options: Options): Promise<Result> {
  const pages = await loadBoth(browser, options);
  try {
    const wordChanges = hunks(diff(pages.before.words, pages.after.words));
    const looks = await compareLooks(pages.before, pages.after); // before anything is drawn over the pages
    const markers = await markersFor(looks, options.markers, options.scale);
    const changes = await markPages(pages, wordChanges, markers, options.selector);
    const planned = await plan(
      changes.map(change => change.place),
      options,
      pages,
    );
    await unmarkIgnored(pages, planned.outside, wordChanges.length);
    return {
      wordChanges: wordChanges.length,
      lookChanges: looks.length,
      shots: await draw(planned, changes, pages, options),
      leftOut: {
        removed: planned.leftOut.before.map(i => changes[i].text.before),
        added: planned.leftOut.after.map(i => changes[i].text.after),
      },
      hidden: {
        removed: planned.hidden.before.map(i => changes[i].text.before),
        added: planned.hidden.after.map(i => changes[i].text.after),
      },
      ignored: {
        removed: planned.outside.map(i => changes[i].text.before).filter(Boolean),
        added: planned.outside.map(i => changes[i].text.after).filter(Boolean),
      },
    };
  } finally {
    await bothSides(side => pages[side].close());
  }
}

/** Both pages, opened at once: in a window each, or as the tabs of one. When one fails to open, the
 * other is closed and the error is thrown. */
async function openBoth(browser: Browser, options: Options): Promise<OpenedPage[]> {
  const urls = { before: options.before, after: options.after };
  if (options.tabs) return openTabs(browser, urls, options);
  const opens = await Promise.allSettled(SIDES.map(side => open(browser, urls[side], side, options)));
  const opened = opens.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []));
  const [failed] = opens.filter(result => result.status === 'rejected');
  if (!failed) return opened;
  await Promise.allSettled(opened.map(page => page.close()));
  throw failed.reason;
}

/** Both pages, opened, set up by hand when the run says to, then read at once. When that fails,
 * both are closed and the error is thrown. */
async function loadBoth(browser: Browser, options: Options): Promise<Record<Side, LoadedPage>> {
  const opened = await openBoth(browser, options);
  try {
    if (options.prepare) await setUp(opened, options.prepare);
    const handled = options.prepare !== null;
    const [before, after] = await Promise.all(opened.map(page => page.read(handled)));
    return { before, after };
  } catch (error) {
    // A browser the person quit has nothing left to close, and says so: the first error is the one to give.
    await Promise.allSettled(opened.map(page => page.close()));
    throw error;
  }
}

/** Wait for the person setting the pages up, and again while a window of theirs has several tabs: a
 * link can open one, or they can. One tab only is shot, and nothing tells which is in front (to the
 * pages, each is: Playwright has them all behave as focused), so the choice is left to the person. */
async function setUp(opened: OpenedPage[], prepare: Prepare): Promise<void> {
  let crowded: Side[] = [];
  do {
    await prepare(crowded);
    crowded = opened.filter(page => page.tabs() > 1).map(page => page.side);
  } while (crowded.length);
}

/** A change, of words or of look: where it is on each page, what it is called in each page's list
 * (empty when that page has nothing of it), and its marker when it is a change of look. */
type Change = { place: Place; text: Record<Side, string>; marker: Marker | null };

/** The band's title, and which shot of how many. */
type Heading = Pick<Content, 'title' | 'number' | 'total'>;

/** Mark both pages, and list every change: the word changes, then the changes of look. A page's
 * mark() gives their spans in the order it was given them, so index i is the same change in every
 * list here. */
async function markPages(
  pages: Record<Side, LoadedPage>,
  wordChanges: Hunk[],
  markers: Marker[],
  within: string | null,
): Promise<Change[]> {
  const spans = await bothSides(side => pages[side].mark(wordChanges, markers, within));
  const wordsOf = (side: Side, tokens: number[]) => tokens.map(token => pages[side].words[token]).join(' ');
  return [
    ...wordChanges.map((hunk, i) => ({
      place: { before: spans.before.words[i], after: spans.after.words[i] },
      text: { before: wordsOf('before', hunk.changed.before), after: wordsOf('after', hunk.changed.after) },
      marker: null,
    })),
    ...markers.map((marker, i) => ({
      place: { before: spans.before.looks[i], after: spans.after.looks[i] },
      text: { before: marker.name, after: marker.name },
      marker,
    })),
  ];
}

/** Take the marks off the changes outside --selector's element: a shot of a change inside it could
 * otherwise show their boxes, beside or under it. Changes are listed words first, then looks. */
async function unmarkIgnored(pages: Record<Side, LoadedPage>, outside: number[], wordCount: number) {
  if (!outside.length) return;
  const words = outside.filter(i => i < wordCount);
  const looks = outside.filter(i => i >= wordCount).map(i => i - wordCount);
  await bothSides(side => pages[side].unmark({ words, looks }));
}

/** Each planned shot's two sides, numbered in the band when there are several. A side lists, and
 * keys, only the changes it shows: one cut from it, or cut off on the page, is not shown. */
async function draw(
  planned: Plan,
  changes: Change[],
  pages: Record<Side, LoadedPage>,
  options: Options,
): Promise<Shot[]> {
  const shots: Shot[] = [];
  for (const [index, shot] of planned.shots.entries()) {
    const heading = { title: options.title, number: index + 1, total: planned.shots.length };
    const shown = (side: Side) =>
      shot.changes
        .filter(i => !planned.leftOut[side].includes(i) && !planned.hidden[side].includes(i))
        .map(i => changes[i]);
    shots.push(
      await bothSides(side => picture(pages[side], shot[side], shown(side), heading, options.scale)),
    );
  }
  return shots;
}

/** One side of a shot: the part `box` of its page with the band on top, and what it shows changed. */
async function picture(
  page: LoadedPage,
  box: Box,
  changes: Change[],
  heading: Heading,
  scale: number,
): Promise<ShotSide> {
  const content = { ...heading, side: page.side, key: keyOf(changes, page.side) };
  return {
    png: await band(await page.shoot(box), content, scale),
    box,
    changed: changes.map(change => change.text[page.side]).filter(Boolean),
  };
}

/** The band's key: the numbered markers among `changes`, by number, with `side`'s disc. */
function keyOf(changes: Change[], side: Side): Key[] {
  const numbered: (Key & { number: number })[] = [];
  for (const { marker } of changes) {
    if (marker && 'disc' in marker.badge)
      numbered.push({ number: marker.number, disc: marker.badge.disc[side], what: marker.what.join(', ') });
  }
  return numbered.sort((x, y) => x.number - y.number);
}
