// Shot planning: which changes share a shot, and the part of each page each shot shows. Changes close
// enough on both pages share one; changes far apart get one each, so no change falls off a shot cut
// to the maximum height. With --selector, only the changes inside that element count. What still
// falls outside every shot is said, not dropped.

import type { Area, Box, Region, Span } from '../geometry.ts';
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
  region(selector: string): Promise<Area | null>;
  /** `region`, its edges moved off the text they would cut. With `limits`, its top also leaves the
   * inside of an item: up to the item's start within `room`, or down to the next one's no lower
   * than `keep`, the top of what the shot is of. */
  snap(region: Region, limits?: { room: number; keep: number }): Promise<Region>;
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

/** An unchanged word, where it is on each page: what lines up the two shots of a pair. */
export type Unchanged = Record<Side, Region>;

export async function plan(
  places: Place[],
  options: PlanOptions,
  pages: Record<Side, PlanPage>,
  unchanged: Unchanged[] = [],
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
  const marks = order.flatMap(i => SIDES.flatMap(side => kept[i][side]?.across ?? []));
  const widths = shotWidths(regions, marks, pages, options);
  for (const group of groups) {
    const pad = (region: Region | null) => region && padded(region, options.padding);
    const grown = lineUp({ before: pad(group.before), after: pad(group.after) }, unchanged, options, regions);
    let edges = await bothSides(side =>
      snapped(grown[side], pages[side], group[side]?.top, options, regions?.[side]),
    );
    // Headings and lining up grow a shot up to the maximum height; snap can still push it past, and
    // the cut would fall on the changes. The shot is then the one around the changes alone.
    if (SIDES.some(side => edges[side] && height(edges[side]!) > options.maxHeight)) {
      const bare = (side: Side) =>
        group.changes.length
          ? group.changes.reduce<Region | null>((region, i) => extend(region, kept[i][side]), null)
          : group[side];
      edges = await bothSides(side =>
        snapped(pad(bare(side)), pages[side], bare(side)?.top, options, regions?.[side]),
      );
    }
    const shot = {
      changes: group.changes,
      before: boxOf(edges.before, widths.before, options),
      after: boxOf(edges.after, widths.after, options),
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
): Promise<{ kept: Place[]; outside: number[]; regions: Record<Side, Area> }> {
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

function bothFound(found: Record<Side, Area | null>, selector: string): Record<Side, Area> {
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
  // A heading above the element is not in it: it says nothing of where in the element the change is.
  const heading = span.heading !== undefined && span.heading >= region.top ? span.heading : undefined;
  return top < bottom ? { ...span, top, bottom, heading } : null;
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
  const place = (i: number, side: Side) => headed(places[i][side], options);
  const groups: Group[] = [];
  for (const i of order) {
    const last = groups.at(-1);
    if (last) {
      const before = extend(last.before, place(i, 'before'));
      const after = extend(last.after, place(i, 'after'));
      if (fits(before) && fits(after)) {
        Object.assign(last, { before, after, changes: [...last.changes, i] });
        continue;
      }
    }
    groups.push({
      changes: [i],
      before: extend(null, place(i, 'before')),
      after: extend(null, place(i, 'after')),
    });
  }
  return groups.length ? groups : [{ changes: [], before: null, after: null }];
}

/** A change's place, taking in the heading of what it is in when that is less than a window high
 * above it, and the shot still fits under the maximum height: a card's title, a section's heading,
 * say where the change is. */
function headed(span: Span | null, options: PlanOptions): Span | null {
  if (span?.heading === undefined || span.heading >= span.top) return span;
  const near = span.top - span.heading <= options.height;
  const fits =
    height(padded({ top: span.heading, bottom: span.bottom }, options.padding)) <= options.maxHeight;
  return near && fits ? { ...span, top: span.heading } : span;
}

/** How far from a shot's edge an unchanged word still says where that edge is on the other page. */
const NEAR_EDGE = 80;

/** Both regions of a shot grown to show the same place: each edge of one page, put on the other by
 * the unchanged word nearest it, takes in what it shows there. Above the changes, the same words
 * may sit higher or lower on one page than on the other, as in a row of cards one of which grew: a
 * shot cut at the same distance from the change on both would start in another place on each. An
 * edge with no unchanged word near it stays; so does one that would make the shot taller than the
 * maximum. Done until neither moves, as an edge moved on one page can move one on the other. */
function lineUp(
  regions: Record<Side, Region | null>,
  unchanged: Unchanged[],
  options: PlanOptions,
  bounds: Record<Side, Region> | null,
): Record<Side, Region | null> {
  const lined = { ...regions };
  for (let round = 0; round < 3; round++) {
    let moved = false;
    for (const side of SIDES) {
      const other = side === 'before' ? 'after' : 'before';
      const region = lined[side];
      if (!region) continue;
      const top = across(region.top, 'top', side, unchanged);
      const bottom = across(region.bottom, 'bottom', side, unchanged);
      const was = lined[other];
      const grown = was
        ? { top: Math.min(was.top, top ?? was.top), bottom: Math.max(was.bottom, bottom ?? was.bottom) }
        : top !== undefined && bottom !== undefined
          ? { top, bottom }
          : null;
      if (!grown || height(grown) > options.maxHeight) continue;
      grown.top = Math.max(0, grown.top);
      // With --selector, an edge grows up to the element's, not past it to what is around it.
      const bound = bounds?.[other];
      if (bound) {
        grown.top = Math.max(grown.top, Math.min(was?.top ?? bound.top, bound.top));
        grown.bottom = Math.min(grown.bottom, Math.max(was?.bottom ?? bound.bottom, bound.bottom));
      }
      if (!was || grown.top !== was.top || grown.bottom !== was.bottom) {
        lined[other] = grown;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return lined;
}

/** Where an edge at `y` on `side`'s page is on the other page, by the unchanged word whose same
 * edge is nearest it, within NEAR_EDGE; undefined with none. */
function across(y: number, edge: 'top' | 'bottom', side: Side, unchanged: Unchanged[]): number | undefined {
  const other = side === 'before' ? 'after' : 'before';
  let nearest: Unchanged | undefined;
  for (const word of unchanged)
    if (
      Math.abs(word[side][edge] - y) <= NEAR_EDGE &&
      (!nearest || Math.abs(word[side][edge] - y) < Math.abs(nearest[side][edge] - y))
    )
      nearest = word;
  return nearest && nearest[other][edge] + (y - nearest[side][edge]);
}

/** `region`, already padded, with its edges off any line of text, and its top out of any item, as far
 * up as the shot has room for under the maximum height and no lower than `keep`, the top of what it
 * is of (its own with none); none with none. With --selector, the top goes no further up than
 * `within`, the element, and its padding: the text before the element is not what the shot is of. */
const snapped = async (
  region: Region | null,
  page: PlanPage,
  keep: number | undefined,
  options: PlanOptions,
  within?: Region,
) => {
  if (!region) return region;
  const under = options.maxHeight - height(region);
  const upTo = within ? region.top - (within.top - options.padding) : under;
  return page.snap(region, { room: Math.max(0, Math.min(under, upTo)), keep: keep ?? region.top });
};

/** The narrowest a shot cut to an element gets: its band holds a title and what the colour means. */
const MIN_WIDTH = 400;

/** Where a shot starts and how wide it is, on each page: the whole page, or with --selector the
 * element's width and the padding on each side, at least MIN_WIDTH. A change is inside the element
 * in the page's HTML but can be drawn past it, a dropdown say: the crop takes in the `marks` of the
 * changes shot. Both pages get the same crop, around the element wherever either page has it, so
 * the two shots of a pair show the same part. */
function shotWidths(
  regions: Record<Side, Area> | null,
  marks: { left: number; right: number }[],
  pages: Record<Side, PlanPage>,
  options: PlanOptions,
): Record<Side, Pick<Box, 'x' | 'width'>> {
  if (!regions) return { before: whole(pages.before), after: whole(pages.after) };
  const left = Math.min(regions.before.left, regions.after.left, ...marks.map(m => m.left)) - options.padding;
  const right =
    Math.max(regions.before.right, regions.after.right, ...marks.map(m => m.right)) + options.padding;
  const widthOn = (page: PlanPage) => {
    const wide = Math.min(page.width, Math.max(right - left, MIN_WIDTH));
    const start = Math.min(Math.max(0, (left + right - wide) / 2), page.width - wide);
    // Out to whole pixels, so both images are cut alike and the element is not clipped by a fraction.
    const x = Math.floor(start);
    return { x, width: Math.min(page.width, Math.ceil(start + wide)) - x };
  };
  return { before: widthOn(pages.before), after: widthOn(pages.after) };
}

const whole = (page: PlanPage) => ({ x: 0, width: page.width });

/** The part of a page a shot shows: `edges`, cut to the maximum height, `sides` wide. With none,
 * the top of the page, the viewport high. */
function boxOf(edges: Region | null, sides: Pick<Box, 'x' | 'width'>, options: PlanOptions): Box {
  if (!edges) return { ...sides, y: 0, height: options.height };
  const { top, bottom } = edges;
  return { ...sides, y: top, height: Math.max(1, Math.min(bottom - top, options.maxHeight)) };
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
