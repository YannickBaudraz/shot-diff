// Shot planning: which changes share a shot, and the part of each page each shot shows. Changes close
// enough on both pages share one; changes far apart get one each, so no change falls off a shot cut
// to the maximum height. What still falls outside every shot is said, not dropped.

import { SIDES, type Side } from './side.ts';
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

export async function plan(places: Place[], o: PlanOptions, pages: Record<Side, Frame>): Promise<Plan> {
  const order = places.map((_, i) => i).sort((i, j) => top(places[i]) - top(places[j]));
  const groups = o.selector ? [await aroundSelector(order, o.selector, pages)] : byDistance(order, places, o);
  const shots: PlannedShot[] = [];
  const leftOut: Record<Side, number[]> = { before: [], after: [] };
  for (const group of groups) {
    const shot = { changes: group.changes } as PlannedShot;
    for (const side of SIDES) {
      shot[side] = await clip(group[side], pages[side], o);
      leftOut[side].push(...group.changes.filter(i => outside(places[i][side], shot[side])));
    }
    shots.push(shot);
  }
  return { shots, leftOut };
}

/** Changes that share a shot, and the region they span on each page (null where they have none). */
type Group = { changes: number[] } & Record<Side, Region | null>;

/** Changes in page order, each joining the shot before it when that shot, padded, still fits in
 * the maximum height on both pages. No changes: one shot, of the top of the page. */
function byDistance(order: number[], places: Place[], o: PlanOptions): Group[] {
  const fits = (r: Region | null) => !r || height(padded(r, o.padding)) <= o.maxHeight;
  const groups: Group[] = [];
  for (const i of order) {
    const last = groups.at(-1);
    const joined = last && { before: join(last.before, places[i].before), after: join(last.after, places[i].after) };
    if (last && joined && fits(joined.before) && fits(joined.after)) Object.assign(last, joined, { changes: [...last.changes, i] });
    else groups.push({ changes: [i], before: join(null, places[i].before), after: join(null, places[i].after) });
  }
  return groups.length ? groups : [{ changes: [], before: null, after: null }];
}

/** All the changes in one shot, around the element `selector` matches on each page. */
async function aroundSelector(order: number[], selector: string, pages: Record<Side, Frame>): Promise<Group> {
  const at = { before: await pages.before.region(selector), after: await pages.after.region(selector) };
  for (const side of SIDES) if (!at[side]) throw new Error(`--selector ${selector} matches nothing on the ${side} page`);
  return { changes: order, ...at };
}

/** The part of a page a shot shows around `region`: padded, its edges off any line of text, cut to
 * the maximum height. With no region, the top of the page, the viewport high. */
async function clip(region: Region | null, page: Frame, o: PlanOptions): Promise<Box> {
  if (!region) return { x: 0, y: 0, width: page.width, height: o.height };
  const { top, bottom } = await page.snap(padded(region, o.padding));
  return { x: 0, y: top, width: page.width, height: Math.min(bottom - top, o.maxHeight) };
}

/** Whether a change's changed part falls outside the shot's box; a side with none never does. */
function outside(s: Span | null, box: Box): boolean {
  if (!s || s.changedTop === null || s.changedBottom === null) return false;
  return s.changedTop < box.y || s.changedBottom > box.y + box.height;
}

const padded = (r: Region, padding: number): Region => ({ top: Math.max(0, r.top - padding), bottom: r.bottom + padding });
const height = (r: Region) => r.bottom - r.top;
const join = (r: Region | null, s: Span | null): Region | null =>
  !s ? r : !r ? { top: s.top, bottom: s.bottom } : { top: Math.min(r.top, s.top), bottom: Math.max(r.bottom, s.bottom) };

/** Where a change starts, for putting changes in page order: on the before page, else the after. */
const top = (p: Place) => p.before?.top ?? p.after?.top ?? 0;
