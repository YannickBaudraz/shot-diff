// Shot planning: which changes share a shot, and the part of each page each shot shows. Changes close
// enough on both pages share one; changes far apart get one each, so no change falls off a shot cut
// to the maximum height. With --selector, only the changes inside that element count. What still
// falls outside every shot is said, not dropped.

import type { Box, Region, Span } from '../geometry.ts';
import { bothSides, SIDES, type Side } from '../side.ts';

/** Where a change sits on each page; null on a page it has no place on. */
export type Place = Record<Side, Span | null>;

export type PlanOptions = {
  padding: number; // room around the changes
  maxHeight: number; // the tallest a shot gets
  height: number; // the shot's height when there is nothing to show
  selector: string | null; // only the changes inside this element count
};

/** What planning needs from a loaded page; loaded.ts gives the real one. */
export type PlanPage = {
  width: number;
  region(selector: string): Promise<Region | null>;
  snap(region: Region): Promise<Region>;
};

/** A shot: its changes (indexes into the places, top to bottom), and the part of each page it shows. */
export type PlannedShot = { changes: number[] } & Record<Side, Box>;

/** The shots; the changes whose changed part is in no shot, on each page; the changes a scroll area
 * cuts off, on each page, which no shot can show there; and the changes outside --selector's element
 * on both pages, which no shot looks for. */
export type Plan = {
  shots: PlannedShot[];
  leftOut: Record<Side, number[]>;
  hidden: Record<Side, number[]>;
  outside: number[];
};

export async function plan(
  places: Place[],
  options: PlanOptions,
  pages: Record<Side, PlanPage>,
): Promise<Plan> {
  const { kept, outside, regions } = options.selector
    ? await within(places, options.selector, pages)
    : { kept: places, outside: [] as number[], regions: null };
  const counted = kept.map((_, i) => i).filter(i => !outside.includes(i));
  const hiddenOn = (side: Side) => counted.filter(i => kept[i][side]?.clipped);
  const hidden = { before: hiddenOn('before'), after: hiddenOn('after') };
  // A change cut off wherever it shows gets no shot: there would be nothing marked in it.
  const shown = (i: number) =>
    SIDES.some(side => kept[i][side]?.changed) || !SIDES.some(side => kept[i][side]?.clipped);
  const order = counted.filter(shown).sort((i, j) => startOf(kept[i]) - startOf(kept[j]));
  const shots: PlannedShot[] = [];
  const leftOut: Record<Side, number[]> = { before: [], after: [] };
  const groups = byDistance(order, kept, options);
  // Nothing changed inside --selector's element: one shot of the element, from its top.
  if (regions && !order.length)
    Object.assign(groups[0], {
      before: { top: regions.before.top, bottom: regions.before.bottom },
      after: { top: regions.after.top, bottom: regions.after.bottom },
    });
  for (const group of groups) {
    const shot = {
      changes: group.changes,
      ...(await bothSides(side => clip(group[side], pages[side], options))),
    };
    for (const side of SIDES)
      leftOut[side].push(...group.changes.filter(i => isOutside(kept[i][side], shot[side])));
    shots.push(shot);
  }
  return { shots, leftOut, hidden, outside };
}

/** The places cut to `selector`'s element on each page, and the changes inside it on neither page,
 * as the page said when it marked them. A kept change's place on each page is cut to the element's
 * height, so the unchanged words around it do not stretch its shot past the element. */
async function within(
  places: Place[],
  selector: string,
  pages: Record<Side, PlanPage>,
): Promise<{ kept: Place[]; outside: number[]; regions: Record<Side, Region> }> {
  const regions = bothFound(await bothSides(side => pages[side].region(selector)), selector);
  const kept: Place[] = [];
  const outside: number[] = [];
  for (const [i, place] of places.entries()) {
    const counts = SIDES.some(side => has(place[side]) && place[side]?.inside);
    if (!counts) outside.push(i);
    kept.push(
      counts ? { before: cut(place.before, regions.before), after: cut(place.after, regions.after) } : place,
    );
  }
  return { kept, outside, regions };
}

function bothFound(found: Record<Side, Region | null>, selector: string): Record<Side, Region> {
  const { before, after } = found;
  if (!before) throw new Error(`--selector ${selector} matches nothing on the before page`);
  if (!after) throw new Error(`--selector ${selector} matches nothing on the after page`);
  return { before, after };
}

/** A change's place on one page, cut to the element's height: null when its changed part is outside
 * the element, or when nothing of it is in the element's height. */
function cut(span: Span | null, region: Region): Span | null {
  if (!span || (has(span) && !span.inside)) return null;
  const top = Math.max(span.top, region.top);
  const bottom = Math.min(span.bottom, region.bottom);
  return top < bottom ? { ...span, top, bottom } : null;
}

/** Whether a page has the change itself, shown or cut off, not only the unchanged words around it. */
const has = (span: Span | null) => !!span && (span.changed !== null || span.clipped);

/** Changes that share a shot, and the region they span on each page (null where they have none). */
type Group = { changes: number[] } & Record<Side, Region | null>;

/** Changes in page order, each joining the shot before it when that shot, padded, still fits in the
 * maximum height on both pages. With no changes, one shot of the top of the page. */
function byDistance(order: number[], places: Place[], options: PlanOptions): Group[] {
  const fits = (region: Region | null) =>
    !region || height(padded(region, options.padding)) <= options.maxHeight;
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
    groups.push({
      changes: [i],
      before: extend(null, places[i].before),
      after: extend(null, places[i].after),
    });
  }
  return groups.length ? groups : [{ changes: [], before: null, after: null }];
}

/** The part of a page a shot shows around `region`: padded, its edges off any line of text, cut to
 * the maximum height. With no region, the top of the page, the viewport high. */
async function clip(region: Region | null, page: PlanPage, options: PlanOptions): Promise<Box> {
  if (!region) return { x: 0, y: 0, width: page.width, height: options.height };
  const { top, bottom } = await page.snap(padded(region, options.padding));
  return { x: 0, y: top, width: page.width, height: Math.max(1, Math.min(bottom - top, options.maxHeight)) };
}

/** Whether a change's changed part falls outside the shot's box; a page with none of it never does.
 * A component taller than a shot can be is shown by its top: it runs off the bottom of the shot. */
function isOutside(span: Span | null, box: Box): boolean {
  if (!span?.changed) return false;
  return span.changed.top < box.y || (span.changed.bottom > box.y + box.height && !span.byTop);
}

/** `region` grown to take in `span`; a region of its own when there is none yet. */
function extend(region: Region | null, span: Span | null): Region | null {
  if (!span) return region;
  if (!region) return { top: span.top, bottom: span.bottom };
  return { top: Math.min(region.top, span.top), bottom: Math.max(region.bottom, span.bottom) };
}

const padded = (region: Region, padding: number): Region => ({
  top: Math.max(0, region.top - padding),
  bottom: region.bottom + padding,
});

const height = (region: Region) => region.bottom - region.top;

/** Where a change starts, to put changes in page order: on the before page, else on the after. */
const startOf = (place: Place) => place.before?.top ?? place.after?.top ?? 0;
