import type { Browser } from 'playwright-core';
import { band, type Content, type Key } from './band.ts';
import { diff, hunks, type Hunk } from './diff.ts';
import { load, type LoadedPage, type Side } from './loaded.ts';
import { looks as compare, type Look } from './looks.ts';
import { markers, type Marker, type Mode } from './markers.ts';
import type { Box } from './page.ts';
import { plan, type Place } from './plan.ts';

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
  markers: Mode; // what changed, written on each box, or a number on it and the meanings in the band
};

export type ShotSide = { png: Buffer; changed: string[]; box: Box };
export type Shot = { before: ShotSide; after: ShotSide };
/** `left out`: changes found but not in any image (above or below a cut, or outside --selector). */
export type Result = { hunks: number; restyled: number; shots: Shot[]; leftOut: { removed: string[]; added: string[] } };

export async function run(browser: Browser, o: Options): Promise<Result> {
  const before = await load(browser, o.before, 'before', o);
  const after = await load(browser, o.after, 'after', o).catch(async error => { await before.close(); throw error; });
  const pages = { before, after };
  try {
    const found = hunks(diff(before.words, after.words));
    const looks = await compare(before, after); // before anything is drawn over the pages
    const marks = await markers(looks, o.markers, o.scale);
    const changes = await mark(pages, found, looks, marks);
    const planned = await plan(changes.map(c => c.place), o, pages);
    const shots: Shot[] = [];
    for (const [n, p] of planned.shots.entries()) {
      const shown = p.changes.map(i => changes[i]);
      const heading = { title: o.title, n: n + 1, of: planned.shots.length };
      shots.push({
        before: await picture(before, p.before, shown, heading, o.scale),
        after: await picture(after, p.after, shown, heading, o.scale),
      });
    }
    const leftOut = {
      removed: planned.leftOut.before.map(i => changes[i].text.before),
      added: planned.leftOut.after.map(i => changes[i].text.after),
    };
    return { hunks: found.length, restyled: looks.length, shots, leftOut };
  } finally {
    await before.close();
    await after.close();
  }
}

/** A change, words or look: where it is on each page, what it is called in each side's list (empty
 * when that side has nothing), and its marker when it is a change of look. */
type Change = { place: Place; text: Record<Side, string>; marker: Marker | null };

/** The band's title, and which shot of how many. */
type Heading = Pick<Content, 'title' | 'n' | 'of'>;

/** Mark both pages, and list every change. */
async function mark(pages: Record<Side, LoadedPage>, found: Hunk[], looks: Look[], marks: Marker[]): Promise<Change[]> {
  const marked = { before: await pages.before.mark(found, marks), after: await pages.after.mark(found, marks) };
  return [
    ...found.map((h, i) => ({
      place: { before: marked.before.words[i], after: marked.after.words[i] },
      text: { before: h.removed.map(t => pages.before.words[t]).join(' '), after: h.added.map(t => pages.after.words[t]).join(' ') },
      marker: null,
    })),
    ...looks.map((l, i) => ({
      place: { before: marked.before.looks[i], after: marked.after.looks[i] },
      text: { before: l.name, after: l.name },
      marker: marks[i],
    })),
  ];
}

/** One side of a shot: the part `box` of its page with the band on top, and what it shows changed. */
async function picture(page: LoadedPage, box: Box, changes: Change[], heading: Heading, scale: number): Promise<ShotSide> {
  const side = page.side;
  // The band's key: the shot's numbered markers, in their order, with this side's disc.
  const key: Key[] = changes.map(c => c.marker).filter(m => m?.disc != null)
    .sort((p, q) => p!.n - q!.n).map(m => ({ disc: m!.disc![side], what: m!.what }));
  return {
    png: await band(await page.shoot(box), { ...heading, side, key }, scale),
    box,
    changed: changes.map(c => c.text[side]).filter(Boolean),
  };
}
