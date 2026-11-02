// The whole run: load both pages, find what changed, mark it, plan the shots, and draw them.

import type { Browser } from 'playwright-core';
import { band, type Content, type Key } from './band.ts';
import { diff, hunks, type Hunk } from './diff.ts';
import { load, type LoadedPage } from './loaded.ts';
import { compareLooks, type Look } from './looks.ts';
import { markersFor, type Marker, type Mode } from './markers.ts';
import type { Box } from './page.ts';
import { plan, type Place } from './plan.ts';
import type { Side } from './side.ts';

export type Options = {
  before: string;
  after: string;
  title: string;
  width: number;
  height: number;
  scale: number;
  dark: boolean;
  storage: [string, string][];
  click: string[];
  wait: number;
  selector: string | null;
  padding: number;
  maxHeight: number;
  markers: Mode; // what a change of look's box says: what changed, or a number the band explains
};

export type ShotSide = { png: Buffer; changed: string[]; box: Box };
export type Shot = { before: ShotSide; after: ShotSide };
/** `left out`: changes found but not in any image (above or below a cut, or outside --selector). */
export type Result = {
  hunks: number;
  restyled: number;
  shots: Shot[];
  leftOut: { removed: string[]; added: string[] };
};

export async function run(browser: Browser, options: Options): Promise<Result> {
  const before = await load(browser, options.before, 'before', options);
  const after = await load(browser, options.after, 'after', options).catch(async error => {
    await before.close();
    throw error;
  });
  const pages = { before, after };
  try {
    const wordChanges = hunks(diff(before.words, after.words));
    const looks = await compareLooks(before, after); // before anything is drawn over the pages
    const markers = await markersFor(looks, options.markers, options.scale);
    const changes = await markPages(pages, wordChanges, looks, markers);
    const planned = await plan(
      changes.map(change => change.place),
      options,
      pages,
    );
    const shots: Shot[] = [];
    for (const [index, shot] of planned.shots.entries()) {
      const shown = shot.changes.map(i => changes[i]);
      const heading = { title: options.title, number: index + 1, total: planned.shots.length };
      shots.push({
        before: await picture(before, shot.before, shown, heading, options.scale),
        after: await picture(after, shot.after, shown, heading, options.scale),
      });
    }
    const leftOut = {
      removed: planned.leftOut.before.map(i => changes[i].text.before),
      added: planned.leftOut.after.map(i => changes[i].text.after),
    };
    return { hunks: wordChanges.length, restyled: looks.length, shots, leftOut };
  } finally {
    await before.close();
    await after.close();
  }
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
  looks: Look[],
  markers: Marker[],
): Promise<Change[]> {
  const spans = {
    before: await pages.before.mark(wordChanges, markers),
    after: await pages.after.mark(wordChanges, markers),
  };
  const wordsOf = (side: Side, tokens: number[]) => tokens.map(token => pages[side].words[token]).join(' ');
  return [
    ...wordChanges.map((hunk, i) => ({
      place: { before: spans.before.words[i], after: spans.after.words[i] },
      text: { before: wordsOf('before', hunk.changed.before), after: wordsOf('after', hunk.changed.after) },
      marker: null,
    })),
    ...looks.map((look, i) => ({
      place: { before: spans.before.looks[i], after: spans.after.looks[i] },
      text: { before: look.name, after: look.name },
      marker: markers[i],
    })),
  ];
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
    if (marker?.disc)
      numbered.push({ number: marker.number, disc: marker.disc.image[side], what: marker.what });
  }
  return numbered.sort((x, y) => x.number - y.number);
}
