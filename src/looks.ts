// Changes of look: changes with no words in them. An element whose look changed (a colour, a border,
// a size set in CSS), found by pairing the elements of the two pages and comparing what the browser
// computed for them; and a picture redrawn, found by comparing its pixels.

import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { diff } from './diff.ts';
import type { Side } from './side.ts';

/** One visible element, as the page's runtime reads it. */
export type ElementInfo = {
  signature: string; // what pairs it with its match on the other page: tag, id, role, label, own words, file
  tag: string; // in lower case, to name it in a list of changes
  parent: number; // the index of its nearest listed ancestor, or -1
  leaf: boolean; // no listed element inside it
  paints: boolean; // draws pixels its style does not describe: an image, a canvas, an SVG, a background image
  top: number; // in page pixels, to number the changes in reading order
  width: number;
  height: number;
  style: Record<string, string>; // the PROPERTIES below, as the CSS sets them
};

/** What the comparison needs from a loaded page: its elements, and a PNG of one element's own
 * pixels (null when it cannot be shot). loaded.ts gives the real one. */
export type ComparedPage = { elements: ElementInfo[]; pixels(index: number): Promise<Buffer | null> };

/** A change of look: the element on each page (an index into its elements), what changed, and what
 * to call it in a list of changes. */
export type Look = { element: Record<Side, number>; what: string[]; name: string };

/** The most pictures compared pixel by pixel, so a page of thumbnails stays quick. */
export const MAX_PICTURES = 300;

/** The changes of look between two pages, top to bottom on the before page. Read the pages before
 * anything is drawn over them. */
export async function compareLooks(before: ComparedPage, after: ComparedPage): Promise<Look[]> {
  const pairs = pairUp(before.elements, after.elements);
  const { restyles, pictures } = sortPairs(pairs, before.elements, after.elements);
  const changes = [...restyles, ...(await redrawn(pictures.slice(0, MAX_PICTURES), before, after))];
  const onBefore = (change: LookChange) => before.elements[change.element.before];
  return changes
    .sort((x, y) => readingOrder(onBefore(x), onBefore(y)))
    .map(change => ({ ...change, name: `[${onBefore(change).tag}: ${change.what.join(', ')}]` }));
}

/** Top to bottom; elements level with each other in a fixed order, by signature. */
const readingOrder = (x: ElementInfo, y: ElementInfo) =>
  x.top - y.top || x.signature.localeCompare(y.signature);

/** The computed properties compared, and what to call each in a label. */
export const PROPERTIES: Record<string, string> = {
  color: 'text colour',
  'background-color': 'background',
  'background-image': 'background image',
  'border-top-color': 'border colour',
  'border-right-color': 'border colour',
  'border-bottom-color': 'border colour',
  'border-left-color': 'border colour',
  'border-top-width': 'border',
  'border-right-width': 'border',
  'border-bottom-width': 'border',
  'border-left-width': 'border',
  'border-top-style': 'border',
  'border-right-style': 'border',
  'border-bottom-style': 'border',
  'border-left-style': 'border',
  'border-top-left-radius': 'corners',
  'border-top-right-radius': 'corners',
  'border-bottom-left-radius': 'corners',
  'border-bottom-right-radius': 'corners',
  'outline-color': 'outline',
  'outline-style': 'outline',
  'outline-width': 'outline',
  'box-shadow': 'shadow',
  opacity: 'opacity',
  'font-family': 'font',
  'font-size': 'text size',
  'font-weight': 'weight',
  'font-style': 'italic',
  'text-decoration-line': 'underline',
  'text-transform': 'case',
  'letter-spacing': 'letter spacing',
  'line-height': 'line height',
  'text-align': 'alignment',
  'padding-top': 'spacing',
  'padding-right': 'spacing',
  'padding-bottom': 'spacing',
  'padding-left': 'spacing',
  'margin-top': 'spacing',
  'margin-right': 'spacing',
  'margin-bottom': 'spacing',
  'margin-left': 'spacing',
  gap: 'spacing',
  display: 'layout',
  'flex-direction': 'layout',
  'justify-content': 'alignment',
  'align-items': 'alignment',
  filter: 'filter',
  transform: 'transform',
  width: 'size',
  height: 'size',
  'min-width': 'size',
  'max-width': 'size',
  'min-height': 'size',
  'max-height': 'size',
};

/** Properties a child takes from its parent: a change there shows on the parent alone. */
const INHERITED = new Set([
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-align',
  'text-transform',
]);

/** The same element on both pages: its index on each. */
type Pair = Record<Side, number>;

/** A paired element whose look changed, its style or its pixels, and what changed. */
type LookChange = { element: Pair; what: string[] };

/** The elements that are the same on both pages: each page's elements, in document order, diffed on
 * their signatures as the words are, and the ones the diff keeps. */
function pairUp(before: readonly ElementInfo[], after: readonly ElementInfo[]): Pair[] {
  return diff(
    before.map(e => e.signature),
    after.map(e => e.signature),
  )
    .filter(op => op.type === 'equal')
    .map(({ before, after }) => ({ before, after }));
}

/** The pairs whose style changed, and what changed; and the pairs that draw their own pixels and
 * whose style did not change, the ones to compare pixel by pixel. */
function sortPairs(
  pairs: Pair[],
  before: readonly ElementInfo[],
  after: readonly ElementInfo[],
): { restyles: LookChange[]; pictures: Pair[] } {
  const restyles: LookChange[] = [];
  const pictures: Pair[] = [];
  for (const pair of pairs) {
    const what = changedProperties(before[pair.before], after[pair.after], before, after);
    if (what.length) restyles.push({ element: pair, what });
    else if (before[pair.before].paints && after[pair.after].paints) pictures.push(pair);
  }
  return { restyles, pictures };
}

/** What changed between an element on the before page and its pair on the after page, one label per
 * kind of change. A change a child only inherits from its parent is left to the parent. Sizes are
 * compared as the CSS sets them (`auto` stays `auto`), so a box that grows or shrinks with the page
 * around it is not a change. */
function changedProperties(
  was: ElementInfo,
  now: ElementInfo,
  before: readonly ElementInfo[],
  after: readonly ElementInfo[],
): string[] {
  const what = new Set<string>();
  for (const [property, label] of Object.entries(PROPERTIES)) {
    const oldValue = was.style[property];
    const newValue = now.style[property];
    if (oldValue === newValue) continue;
    const fromParent =
      INHERITED.has(property) &&
      before[was.parent]?.style[property] === oldValue &&
      after[now.parent]?.style[property] === newValue;
    if (!fromParent) what.add(label);
  }
  return [...what];
}

/** The pictures among `pairs` whose pixels changed, compared one after the other. */
async function redrawn(pairs: Pair[], before: ComparedPage, after: ComparedPage): Promise<LookChange[]> {
  const found: LookChange[] = [];
  for (const pair of pairs) {
    if (await repainted(await before.pixels(pair.before), await after.pixels(pair.after))) {
      found.push({ element: pair, what: ['picture'] });
    }
  }
  return found;
}

/** Whether two shots of an element differ. One that could not be shot is no change; a size that
 * differs is one. */
async function repainted(beforePng: Buffer | null, afterPng: Buffer | null): Promise<boolean> {
  if (!beforePng || !afterPng) return false;
  const pixelsOf = (png: Buffer) => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const was = await pixelsOf(beforePng);
  const now = await pixelsOf(afterPng);
  const { width, height } = was.info;
  if (now.info.width !== width || now.info.height !== height) return true;
  return pixelmatch(was.data, now.data, null, width, height, { threshold: 0.1 }) > 0;
}
