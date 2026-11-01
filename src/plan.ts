// Shot planning: which changes share a shot, and the part of each page each shot shows. Changes close
// enough on both pages share one; changes far apart get one each, so no change falls off a shot cut
// to the maximum height. What still falls outside every shot is said, not dropped.

import type { Box, Region, Span } from './page.ts';
import { SIDES, type Side } from './side.ts';

/** Where a change sits on each page; null on a page it has no place on. */
export type Place = Record<Side, Span | null>;

export type PlanOptions = {
  padding: number; // room around the changes
  maxHeight: number; // the tallest a shot gets
  height: number; // the shot's height when there is nothing to show
  selector: string | null; // shoot this element instead of the area around the changes
};

/** What planning needs from a loaded page; loaded.ts gives the real one. */
export type PlanPage = { width: number; region(selector: string): Promise<Region | null>; snap(region: Region): Promise<Region> };

/** A shot: its changes (indexes into the places, top to bottom), and the part of each page it shows. */
export type PlannedShot = { changes: number[] } & Record<Side, Box>;

/** The shots, and the changes whose changed part is in no shot, on each page. */
export type Plan = { shots: PlannedShot[]; leftOut: Record<Side, number[]> };

export async function plan(places: Place[], options: PlanOptions, pages: Record<Side, PlanPage>): Promise<Plan> {
  const order = places.map((_, i) => i).sort((i, j) => startOf(places[i]) - startOf(places[j]));
  const groups = options.selector ? [await aroundSelector(order, options.selector, pages)] : byDistance(order, places, options);
  const shots: PlannedShot[] = [];
  const leftOut: Record<Side, number[]> = { before: [], after: [] };
  for (const group of groups) {
    const shot = { changes: group.changes } as PlannedShot;
    for (const side of SIDES) {
      shot[side] = await clip(group[side], pages[side], options);
      leftOut[side].push(...group.changes.filter(i => outside(places[i][side], shot[side])));
    }
    shots.push(shot);
  }
  return { shots, leftOut };
}

/** Changes that share a shot, and the region they span on each page (null where they have none). */
type Group = { changes: number[] } & Record<Side, Region | null>;

/** Changes in page order, each joining the shot before it when that shot, padded, still fits in the
 * maximum height on both pages. With no changes, one shot of the top of the page. */
function byDistance(order: number[], places: Place[], options: PlanOptions): Group[] {
  const fits = (region: Region | null) => !region || height(padded(region, options.padding)) <= options.maxHeight;
  const groups: Group[] = [];
  for (const i of order) {
    const last = groups.at(-1);
    if (last) {
      const before = extend(last.before, places[i].before);
      const after = extend(last.after, places[i].after);
      if (fits(before) && fits(after)) {
        Object.assign(last, { before, after, changes: [...last.changes, i] });
        continue;
      }
    }
    groups.push({ changes: [i], before: extend(null, places[i].before), after: extend(null, places[i].after) });
  }
  return groups.length ? groups : [{ changes: [], before: null, after: null }];
}

/** All the changes in one shot, around the element `selector` matches on each page. */
async function aroundSelector(order: number[], selector: string, pages: Record<Side, PlanPage>): Promise<Group> {
  const before = await pages.before.region(selector);
  const after = await pages.after.region(selector);
  if (!before) throw new Error(`--selector ${selector} matches nothing on the before page`);
  if (!after) throw new Error(`--selector ${selector} matches nothing on the after page`);
  return { changes: order, before, after };
}

/** The part of a page a shot shows around `region`: padded, its edges off any line of text, cut to
 * the maximum height. With no region, the top of the page, the viewport high. */
async function clip(region: Region | null, page: PlanPage, options: PlanOptions): Promise<Box> {
  if (!region) return { x: 0, y: 0, width: page.width, height: options.height };
  const { top, bottom } = await page.snap(padded(region, options.padding));
  return { x: 0, y: top, width: page.width, height: Math.min(bottom - top, options.maxHeight) };
}

/** Whether a change's changed part falls outside the shot's box; a page with none of it never does. */
function outside(span: Span | null, box: Box): boolean {
  if (!span || span.changedTop === null || span.changedBottom === null) return false;
  return span.changedTop < box.y || span.changedBottom > box.y + box.height;
}

/** `region` grown to take in `span`; a region of its own when there is none yet. */
function extend(region: Region | null, span: Span | null): Region | null {
  if (!span) return region;
  if (!region) return { top: span.top, bottom: span.bottom };
  return { top: Math.min(region.top, span.top), bottom: Math.max(region.bottom, span.bottom) };
}

const padded = (region: Region, padding: number): Region => ({ top: Math.max(0, region.top - padding), bottom: region.bottom + padding });

const height = (region: Region) => region.bottom - region.top;

/** Where a change starts, to put changes in page order: on the before page, else on the after. */
const startOf = (place: Place) => place.before?.top ?? place.after?.top ?? 0;
