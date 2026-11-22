// The whole run: load both pages, find what changed, mark it, plan the shots, and draw them.

import type { Browser } from 'playwright-core';
import { compareLooks, labelOf, type Look } from './changes/looks.ts';
import { wordDiff, type Hunk } from './changes/words.ts';
import type { Box, Span } from './geometry.ts';
import { open, openTabs, type LoadedPage, type LoadOptions, type OpenedPage } from './page/loaded.ts';
import { band, type Content, type Key } from './shots/band.ts';
import { markersFor, type Marker, type Mode } from './shots/markers.ts';
import { plan, type Place, type Plan, type PlanOptions, type Unchanged } from './shots/plan.ts';
import { bothSides, SIDES, type Side } from './side.ts';

export type Options = LoadOptions &
  PlanOptions & {
    before: string;
    after: string;
    title: string;
    markers: Mode; // what a change of look's box says: what changed, or a number the band explains
    /** Compare the words (the default); false (--no-words) for pages whose words differ anyway, as
     * random or other data do: only changes of look, and elements added or removed, are marked. */
    words: boolean;
    /** Waits while a person sets both opened pages up by hand (--interactive); null to read them as
     * they load. Called again, with the sides whose window then has several tabs, until none has. */
    prepare: Prepare | null;
    /** Open both pages as tabs of one window, not a window each (--tabs): for pages set up by hand. */
    tabs: boolean;
    /** Do all of a run but the screenshots (--dry-run): the shots are planned, and none is taken. */
    dryRun: boolean;
    /** A pair whose changes are all removals is its before image alone, and one whose changes are
     * all additions its after image alone (--unified): the other side is not shot. */
    unified: boolean;
  };

export type Prepare = (crowded: Side[]) => Promise<void>;

/** One image of a shot: its PNG (none on a dry run), what it shows changed, and the part of its page it is of. */
export type ShotSide = { png: Buffer | null; changed: string[]; box: Box };
/** A shot's two images; with --unified, null for the side a one-sided pair leaves out (never both). */
export type Shot = Record<Side, ShotSide | null>;
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
  /** How many elements each --ignore selector matched on each page. */
  ignoredAreas: { selector: string; before: number; after: number }[];
  /** The parts of the page the changes shot are in, top to bottom, each with a selector --selector
   * takes on both pages and how many changes it has; null for the changes in no such part. */
  areas: { selector: string | null; changes: number }[];
};

export async function run(browser: Browser, options: Options): Promise<Result> {
  const pages = await loadBoth(browser, options);
  try {
    const ignoredAreas = options.ignore.map((selector, i) => ({
      selector,
      before: pages.before.ignored[i],
      after: pages.after.ignored[i],
    }));
    const missed = ignoredAreas.find(area => !area.before && !area.after);
    if (missed) throw new Error(`--ignore ${missed.selector} matches nothing on either page`);
    const looks = await compareLooks(pages.before, pages.after, options); // before anything is drawn over the pages
    const words = !options.words
      ? { hunks: [], unchanged: [] }
      : wordDiff(
          { before: pages.before.words, after: pages.after.words },
          { before: componentWords(looks, pages, 'before'), after: componentWords(looks, pages, 'after') },
        );
    const wordChanges = words.hunks;
    const markers = await markersFor(looks, options.markers, options.scale);
    const changes = await markPages(pages, wordChanges, markers, options.selector);
    const planned = await plan(
      changes.map(change => change.place),
      options,
      pages,
      placed(words.unchanged, pages),
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
      ignoredAreas,
      areas: await areasOf(changes, planned.outside, pages),
    };
  } finally {
    await bothSides(side => pages[side].close());
  }
}

/** The unchanged words that show on both pages, where each is on each. */
function placed(unchanged: Record<Side, number>[], pages: Record<Side, LoadedPage>): Unchanged[] {
  return unchanged.flatMap(word => {
    const before = pages.before.places[word.before];
    const after = pages.after.places[word.after];
    return before && after ? [{ before, after }] : [];
  });
}

/** The words of the components only `side` has, as stretches of its words: they are said by the
 * component's box, and are no word changes. */
function componentWords(looks: Look[], pages: Record<Side, LoadedPage>, side: Side): [number, number][] {
  return looks.flatMap(look => (look.only === side ? [pages[side].elements[look.element[side]].tokens] : []));
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
      place: {
        before: byTop(spans.before.looks[i], marker.only === 'before'),
        after: byTop(spans.after.looks[i], marker.only === 'after'),
      },
      // An element only one page has is in that page's list alone.
      text: {
        before: marker.only === 'after' ? '' : marker.name,
        after: marker.only === 'before' ? '' : marker.name,
      },
      marker,
    })),
  ];
}

/** `span`, marked as shown by its top when it is a component's: the page has it, and a shot of its
 * top shows it, however far down it runs. */
const byTop = (span: Span, component: boolean): Span => (component ? { ...span, byTop: true } : span);

/** Take the marks off the changes outside --selector's element: a shot of a change inside it could
 * otherwise show their boxes, beside or under it. Changes are listed words first, then looks. */
async function unmarkIgnored(pages: Record<Side, LoadedPage>, outside: number[], wordCount: number) {
  if (!outside.length) return;
  const words = outside.filter(i => i < wordCount);
  const looks = outside.filter(i => i >= wordCount).map(i => i - wordCount);
  await bothSides(side => pages[side].unmark({ words, looks }));
}

/** Each planned shot's two sides, numbered in the band when there are several. A side lists, and
 * keys, only the changes it shows: one cut from it, or cut off on the page, is not shown. With
 * --unified, the side a one-sided shot does not keep is not shot, and is null. */
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
    const kept = options.unified ? keptSide(shot.changes.map(i => changes[i])) : null;
    shots.push(
      await bothSides(async side =>
        kept && kept !== side ? null : picture(pages[side], shot[side], shown(side), heading, options),
      ),
    );
  }
  return shots;
}

/** The one side a shot of `changes` needs, from what the changes are, not from what a side shows (a
 * change cut from a side still has its words): the before side when every change is a removal, the
 * after side when every change is an addition; null for both, as a shot of no change gets. */
function keptSide(changes: Change[]): Side | null {
  if (!changes.length) return null;
  if (changes.every(change => change.text.after === '')) return 'before';
  if (changes.every(change => change.text.before === '')) return 'after';
  return null;
}

/** One side of a shot: the part `box` of its page with the band on top, and what it shows changed. */
async function picture(
  page: LoadedPage,
  box: Box,
  changes: Change[],
  heading: Heading,
  { scale, dryRun }: Pick<Options, 'scale' | 'dryRun'>,
): Promise<ShotSide> {
  const content = { ...heading, side: page.side, key: keyOf(changes, page.side) };
  return {
    png: dryRun ? null : await band(await page.shoot(box), content, scale),
    box,
    changed: changes.map(change => change.text[page.side]).filter(Boolean),
  };
}

/** The parts of the page the changes are in, top to bottom, with how many changes each has: for a
 * change, the part its after page says, or its before page, that a selector finds on both pages, as
 * --selector needs. The changes `outside` --selector's element are not counted; those in no part
 * come last, under no selector. */
async function areasOf(
  changes: Change[],
  outside: number[],
  pages: Record<Side, LoadedPage>,
): Promise<Result['areas']> {
  const onBoth = new Map<string, boolean>();
  const found = async (selector: string) => {
    if (!onBoth.has(selector)) {
      const regions = await bothSides(side => pages[side].region(selector));
      onBoth.set(selector, !!regions.before && !!regions.after);
    }
    return onBoth.get(selector)!;
  };
  const topOf = ({ place }: Change) => place.after?.top ?? place.before?.top ?? 0;
  const counts = new Map<string | null, number>();
  const counted = changes.filter((_, i) => !outside.includes(i)).sort((x, y) => topOf(x) - topOf(y));
  for (const { place } of counted) {
    const said = [place.after?.area, place.before?.area];
    // A selector by position names what is at that place on each page: with an element put in or
    // taken out before it, another one. It is given only where both pages say the same; else the
    // id it starts from, which is the same element on both.
    const agreed = said[0] === said[1] || !said[0] || !said[1];
    const sure = (selector: string) => agreed || !selector.includes(':nth-child(');
    const fromId = (selector: string) => selector.split(' > ')[0];
    let area: string | null = null;
    for (const selector of said) {
      if (area || !selector) continue;
      const given = sure(selector) ? selector : fromId(selector);
      if (given !== 'body' && (await found(given))) area = given;
    }
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  const named = [...counts].filter(([selector]) => selector !== null);
  const rest = counts.has(null) ? [[null, counts.get(null)!] as const] : [];
  return [...named, ...rest].map(([selector, n]) => ({ selector, changes: n }));
}

/** The band's key: the numbered markers among `changes` that `side` shows, by number, with its disc. */
function keyOf(changes: Change[], side: Side): Key[] {
  const numbered: (Key & { number: number })[] = [];
  for (const { marker } of changes) {
    if (marker && 'disc' in marker.badge && (!marker.only || marker.only === side))
      numbered.push({ number: marker.number, disc: marker.badge.disc[side], what: labelOf(marker) });
  }
  return numbered.sort((x, y) => x.number - y.number);
}
