import type { Browser } from 'playwright-core';
import { band, type Key } from './band.ts';
import { diff, hunks, type Hunk } from './diff.ts';
import { load, type Side } from './loaded.ts';
import { looks as compare, type Look } from './looks.ts';
import { markers, type Marker, type Mode } from './markers.ts';
import type { Box } from './page.ts';
import { plan } from './plan.ts';

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
  try {
    const found: Hunk[] = hunks(diff(before.words, after.words));

    const looks: Look[] = await compare(before, after); // before anything is drawn over the pages
    const marks: Marker[] = await markers(looks, o.markers, o.scale);
    const markA = await before.mark(found, marks);
    const markB = await after.mark(found, marks);

    // Every change, words and looks: where it is on each page, what it is called in each list, and
    // its marker when it has a numbered one.
    const changes = [
      ...found.map((h, i) => ({
        place: { before: markA.words[i], after: markB.words[i] },
        removed: h.removed.map(t => before.words[t]).join(' '),
        added: h.added.map(t => after.words[t]).join(' '),
        marker: null as Marker | null,
      })),
      ...looks.map((l, i) => ({
        place: { before: markA.looks[i], after: markB.looks[i] },
        removed: l.name,
        added: l.name,
        marker: marks[i] as Marker | null,
      })),
    ];
    const planned = await plan(changes.map(c => c.place), o, { before, after });

    // The band's key: the shot's numbered markers, in their order, with this side's disc.
    const keysOf = (indexes: number[], side: Side): Key[] => indexes.map(i => changes[i].marker)
      .filter(m => m?.disc != null).sort((p, q) => p!.n - q!.n).map(m => ({ disc: m!.disc![side], what: m!.what }));
    const shots: Shot[] = [];
    for (const [n, p] of planned.shots.entries()) {
      shots.push({
        before: {
          png: await band(await before.shoot(p.before), { side: 'before', title: o.title, n: n + 1, of: planned.shots.length, key: keysOf(p.changes, 'before') }, o.scale),
          box: p.before,
          changed: p.changes.map(i => changes[i].removed).filter(Boolean),
        },
        after: {
          png: await band(await after.shoot(p.after), { side: 'after', title: o.title, n: n + 1, of: planned.shots.length, key: keysOf(p.changes, 'after') }, o.scale),
          box: p.after,
          changed: p.changes.map(i => changes[i].added).filter(Boolean),
        },
      });
    }
    const leftOut = {
      removed: planned.leftOut.before.map(i => changes[i].removed),
      added: planned.leftOut.after.map(i => changes[i].added),
    };
    return { hunks: found.length, restyled: looks.length, shots, leftOut };
  } finally {
    await before.close();
    await after.close();
  }
}
