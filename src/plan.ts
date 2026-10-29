// Shot planning: which changes share a shot, and the part of each page each shot shows. Changes close
// enough on both pages share one; changes far apart get one each, so no change falls off a shot cut
// to the maximum height. What still falls outside every shot is said, not dropped.

import type { Side } from './loaded.ts';
import type { Box, Region, Span } from './page.ts';

/** Where a change sits on each page; null on a page it has no place on. */
export type Place = Record<Side, Span | null>;

export type PlanOptions = {
  padding: number; // room around the changes
  maxHeight: number; // the tallest a shot gets
  height: number; // the shot's height when there is nothing to show
  selector: string | null; // shoot this element instead of the area around the changes
};

/** What planning needs from a loaded page; loaded.ts gives the real one. */
export type Frame = { width: number; region(selector: string): Promise<Region | null>; snap(region: Region): Promise<Region> };

/** A shot: its changes (indexes into the places, top to bottom), and the part of each page it shows. */
export type PlannedShot = { changes: number[] } & Record<Side, Box>;

/** The shots, and the changes whose changed part is in no shot, on each page. */
export type Plan = { shots: PlannedShot[]; leftOut: Record<Side, number[]> };

const SIDES: Side[] = ['before', 'after'];

export async function plan(places: Place[], o: PlanOptions, pages: Record<Side, Frame>): Promise<Plan> {
  const padded = (r: Region): Region => ({ top: Math.max(0, r.top - o.padding), bottom: r.bottom + o.padding });
  const join = (r: Region | null, s: Span | null): Region | null =>
    !s ? r : !r ? { top: s.top, bottom: s.bottom } : { top: Math.min(r.top, s.top), bottom: Math.max(r.bottom, s.bottom) };
  const fits = (r: Region | null) => !r || padded(r).bottom - padded(r).top <= o.maxHeight;

  const order = places.map((_, i) => i).sort((i, j) => top(places[i]) - top(places[j]));

  // Which changes share a shot, and the region each shot is around on each page.
  let groups: ({ changes: number[] } & Record<Side, Region | null>)[] = [];
  if (o.selector) {
    const at = { before: await pages.before.region(o.selector), after: await pages.after.region(o.selector) };
    for (const side of SIDES) if (!at[side]) throw new Error(`--selector ${o.selector} matches nothing on the ${side} page`);
    groups = [{ changes: order, ...at }];
  } else {
    for (const i of order) {
      const last = groups.at(-1);
      const joined = last && { before: join(last.before, places[i].before), after: join(last.after, places[i].after) };
      if (last && joined && fits(joined.before) && fits(joined.after)) Object.assign(last, joined, { changes: [...last.changes, i] });
      else groups.push({ changes: [i], before: join(null, places[i].before), after: join(null, places[i].after) });
    }
    if (!groups.length) groups = [{ changes: [], before: null, after: null }];
  }

  // The part of each page each shot shows: padded, its edges off any line of text, cut to the maximum.
  const shots: PlannedShot[] = [];
  const leftOut: Record<Side, number[]> = { before: [], after: [] };
  for (const g of groups) {
    const shot = { changes: g.changes } as PlannedShot;
    for (const side of SIDES) {
      const page = pages[side];
      const region = g[side];
      if (!region) {
        shot[side] = { x: 0, y: 0, width: page.width, height: o.height };
      } else {
        const { top, bottom } = await page.snap(padded(region));
        shot[side] = { x: 0, y: top, width: page.width, height: Math.min(bottom - top, o.maxHeight) };
      }
      const box = shot[side];
      for (const i of g.changes) {
        const s = places[i][side];
        if (s && s.changedTop !== null && s.changedBottom !== null && (s.changedTop < box.y || s.changedBottom > box.y + box.height)) {
          leftOut[side].push(i);
        }
      }
    }
    shots.push(shot);
  }
  return { shots, leftOut };
}

/** Where a change starts, for putting changes in page order: on the before page, else the after. */
const top = (p: Place) => p.before?.top ?? p.after?.top ?? 0;
