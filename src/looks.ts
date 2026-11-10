// Changes of look: changes with no words in them. An element whose look changed (a colour, a border,
// a size set in CSS), found by pairing the elements of the two pages and comparing what the browser
// computed for them; and a picture redrawn, found by comparing its pixels.

import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { diff } from './diff.ts';
import { bothSides, type Side } from './side.ts';

/** One visible element, as the page's runtime reads it. */
export type ElementInfo = {
  signature: string; // what pairs it with its match on the other page: tag, id, role, label, own words, file
  tag: string; // in lower case, to name it in a list of changes
  parent: number; // the index of its nearest listed ancestor, or -1
  leaf: boolean; // no listed element inside it: its pixels are its own, not its children's too
  paints: boolean; // draws pixels its style does not describe: an image, a canvas, an SVG, an embedded page, a background image file
  seen: boolean; // not made transparent, by its own opacity or an ancestor's
  top: number; // in page pixels, to number the changes in reading order
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

/** The share of a picture's pixels that may differ when layout drew it at another size on the other
 * page: scaled to the same size, the same picture differs at its edges, by 0.05% at most on the
 * fixtures' pictures, where a picture redrawn differs by far more. */
const RESCALED_TOLERANCE = 0.005;

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

/** The lines an element can have around it, by the start of their properties' names: the four sides
 * of its border, and its outline. */
const LINES = ['border-top', 'border-right', 'border-bottom', 'border-left', 'outline'];

/** Whether an element draws `line`: one with no style, or no width, is not there. */
const drawn = (element: ElementInfo, line: string) =>
  !['none', 'hidden'].includes(element.style[`${line}-style`]) &&
  parseFloat(element.style[`${line}-width`]) !== 0;

/** Whether `property` is of a line that shows no change of it. A line's colour is the text's when
 * the CSS sets none, so it differs with it on an element with no line at all; and its width and
 * style can be set with nothing drawn. A line neither page draws changed nothing anyone sees. One a
 * single page draws has appeared or gone, which its style and width say, not its colour. */
function ofLineNotSeen(property: string, was: ElementInfo, now: ElementInfo): boolean {
  const line = LINES.find(line => ['color', 'style', 'width'].some(part => property === `${line}-${part}`));
  if (!line) return false;
  const pagesDrawing = [was, now].filter(element => drawn(element, line)).length;
  return pagesDrawing === 0 || (pagesDrawing === 1 && property.endsWith('-color'));
}

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

/** The pairs whose style changed, and what changed; and the pairs that draw their own pixels, with
 * no listed element inside them, and whose style did not change: the ones to compare pixel by pixel.
 * A pair transparent on both pages is neither.
 * An element with others inside it is left out, as its shot holds theirs too: words changed in a
 * section with a background image are a change of words, not a picture redrawn. */
function sortPairs(
  pairs: Pair[],
  before: readonly ElementInfo[],
  after: readonly ElementInfo[],
): { restyles: LookChange[]; pictures: Pair[] } {
  const restyles: LookChange[] = [];
  const pictures: Pair[] = [];
  for (const pair of pairs) {
    // Unseen on both pages, such as a copy button shown only on hover: nothing anyone sees changed.
    if (!before[pair.before].seen && !after[pair.after].seen) continue;
    const what = changedProperties(before[pair.before], after[pair.after], before, after);
    if (what.length) restyles.push({ element: pair, what });
    else if (isPicture(before[pair.before]) && isPicture(after[pair.after])) pictures.push(pair);
  }
  return { restyles, pictures };
}

const isPicture = (element: ElementInfo) => element.paints && element.leaf;

/** What changed between an element on the before page and its pair on the after page, one label per
 * kind of change. A change a child only inherits from its parent is left to the parent, and one of
 * a border or an outline that is not drawn is none. Sizes are
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
    if (oldValue === newValue || ofLineNotSeen(property, was, now)) continue;
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
  const pages = { before, after };
  for (const pair of pairs) {
    const { before: was, after: now } = await bothSides(side => pages[side].pixels(pair[side]));
    if (await repainted(was, now)) {
      // An iframe's pixels are a page's: what changed in it is not known, only that something did.
      const embedded = before.elements[pair.before].tag === 'iframe';
      found.push({ element: pair, what: [embedded ? 'embedded page' : 'picture'] });
    }
  }
  return found;
}

/** Whether two shots of an element differ. One that could not be shot is no change. Shots of two
 * sizes are compared at the smaller, so a picture layout only scaled is no change, as a box that
 * grows or shrinks with the page around it is none; a size set in CSS is a change of style. */
async function repainted(beforePng: Buffer | null, afterPng: Buffer | null): Promise<boolean> {
  if (!beforePng || !afterPng) return false;
  const pixelsOf = (png: Buffer) => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const was = await pixelsOf(beforePng);
  const now = await pixelsOf(afterPng);
  const width = Math.min(was.info.width, now.info.width);
  const height = Math.min(was.info.height, now.info.height);
  const rescaled = [was, now].some(({ info }) => info.width !== width || info.height !== height);
  const atSize = ({ data, info }: typeof was) =>
    info.width === width && info.height === height
      ? data
      : sharp(data, { raw: info }).resize(width, height, { fit: 'fill' }).raw().toBuffer();
  const differ = pixelmatch(await atSize(was), await atSize(now), null, width, height, { threshold: 0.1 });
  return differ > (rescaled ? RESCALED_TOLERANCE * width * height : 0);
}
