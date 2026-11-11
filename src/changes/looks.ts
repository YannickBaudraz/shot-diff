// Changes of look: changes with no words in them. An element whose look changed (a colour, a border,
// a size set in CSS), found by pairing the elements of the two pages and comparing what the browser
// computed for them; a picture redrawn, found by comparing its pixels; and a component only one page
// has, an element added or removed with all that is in it, which is one change, not one per word.

import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { diff } from './words.ts';
import { bothSides, SIDES, type Side } from '../side.ts';

/** One visible element, as the page's runtime reads it. */
export type ElementInfo = {
  signature: string; // what pairs it with its match on the other page: tag, id, role, label, own words, file
  shape: string; // its signature without its own words, to pair it when words are not compared
  tag: string; // in lower case, to name it in a list of changes
  parent: number; // the index of its nearest listed ancestor, or -1
  leaf: boolean; // no listed element inside it: its pixels are its own, not its children's too
  worded: boolean; // has a word or an image in it, its own or inside it
  block: boolean; // not inline: a block of its own, not part of a run of text
  tokens: [number, number]; // its words and images among the page's: from the first, up to after the last
  paints: boolean; // draws pixels its style does not describe: an image, a canvas, an SVG, an embedded page, a background image file
  seen: boolean; // not made transparent, by its own opacity or an ancestor's
  top: number; // in page pixels, to number the changes in reading order
  height: number; // in page pixels, to tell an element too tall to carry its children's change
  style: Record<string, string>; // the PROPERTIES below, as the CSS sets them
};

/** What the comparison needs from a loaded page: its words, its elements, a PNG of one element's own pixels
 * (null when it cannot be shot), and one element's accessible name (empty when it has none).
 * loaded.ts gives the real one. */
export type ComparedPage = {
  words: readonly string[]; // the page's words and images, as the word diff reads them
  elements: ElementInfo[];
  pixels(index: number): Promise<Buffer | null>;
  name(index: number): Promise<string>;
};

/** A change of look: the element on each page (an index into its elements), what changed, and what
 * to call it in a list of changes. An element `only` one page has, a whole component added or
 * removed, is that page's; on the other page
 * `element` is one next to where it would be (-1 with none), `beside` when it is in the same element,
 * and `edge` the side of it that place
 * is at, to show the same place on both. */
export type Look = {
  element: Record<Side, number>;
  what: string[];
  name: string;
  only?: Side;
  edge?: Edge;
  beside?: boolean;
  group?: string; // what changed alike on all its children of one kind
};

/** The top of an element, or its bottom. */
export type Edge = 'top' | 'bottom';

/** The most pictures compared pixel by pixel, so a page of thumbnails stays quick. */
export const MAX_PICTURES = 300;

/** The share of a picture's pixels that may differ when layout drew it at another size on the other
 * page: scaled to the same size, the same picture differs at its edges, by 0.05% at most on the
 * fixtures' pictures, where a picture redrawn differs by far more. */
const RESCALED_TOLERANCE = 0.005;

/** The changes of look between two pages, top to bottom on the before page. Read the pages before
 * anything is drawn over them. */
export async function compareLooks(
  before: ComparedPage,
  after: ComparedPage,
  { maxHeight = Infinity, words = true }: { maxHeight?: number; words?: boolean } = {},
): Promise<Look[]> {
  // Without words, elements are paired by what they are, not by what they say: words that differ
  // from one load to the next, or from one set of data to another, do not unpair them.
  const key = (element: ElementInfo) => (words ? element.signature : element.shape);
  const paired = pairUp(before.elements, after.elements, key);
  const { reworded } = paired;
  const pairs = unhollowed(paired.pairs, before.elements, after.elements);
  const { restyles, pictures } = sortPairs(pairs, reworded, before.elements, after.elements);
  const changes = [
    ...grouped(restyles, pairs, before.elements, after.elements, maxHeight),
    ...(await redrawn(pictures.slice(0, MAX_PICTURES), before, after)),
    ...onOnePage(pairs, { before: before.elements, after: after.elements }),
  ];
  const pages = { before, after };
  const onBefore = (change: LookChange): ElementInfo | undefined => before.elements[change.element.before];
  const own = (change: LookChange) => {
    const side = change.only ?? 'before';
    return { element: pages[side].elements[change.element[side]], words: pages[side].words };
  };
  return changes
    .sort((x, y) => readingOrder(onBefore(x), onBefore(y)))
    .map(change => {
      const { element, words } = own(change);
      const what = `[${element.tag}: ${labelOf(change)}]`;
      return { ...change, name: change.only ? `${what}${beginning(element, words)}` : what };
    });
}

/** What a change of look's label says: what changed on the element, then what changed alike on
 * all its children of one kind. */
export const labelOf = (look: Pick<Look, 'what' | 'group'>): string =>
  [look.what.join(', '), look.group].filter(Boolean).join(' · ');

/** What the children of one kind are called in a label, one and several; a tag not here is called
 * by itself. */
const KINDS: Record<string, [string, string]> = {
  a: ['link', 'links'],
  li: ['item', 'items'],
  td: ['cell', 'cells'],
  tr: ['row', 'rows'],
  button: ['button', 'buttons'],
  img: ['image', 'images'],
  p: ['paragraph', 'paragraphs'],
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`h${n}`, ['heading', 'headings']])),
};

/** The restyles with the ones of all the children of one kind of an element, changed alike, made
 * one change on that element: a menu whose links all got more room is one box, not one per link.
 * The children are those with the same parent and tag on both pages, two or more, all with the same
 * list of what changed and none of them left out. Their parent carries it, with its own change when
 * it has one; one that is the page's body, or taller than a shot, would put it far from them, and
 * leaves them their own boxes. It is done once: a parent that is itself one of a group carries
 * none. */
function grouped(
  restyles: LookChange[],
  pairs: Pair[],
  before: readonly ElementInfo[],
  after: readonly ElementInfo[],
  maxHeight: number,
): LookChange[] {
  const partner = new Map(pairs.map(pair => [pair.before, pair.after]));
  const byParent = new Map<string, LookChange[]>();
  for (const change of restyles) {
    const { parent, tag } = before[change.element.before];
    const key = `${parent} ${tag}`;
    byParent.set(key, [...(byParent.get(key) ?? []), change]);
  }
  const groups = [...byParent.values()].filter(group => {
    const first = before[group[0].element.before];
    const parent = { before: first.parent, after: partner.get(first.parent) ?? -1 };
    if (group.length < 2 || parent.before < 0 || parent.after < 0) return false;
    const alike = group.every(change => change.what.join() === group[0].what.join());
    const kin = (elements: readonly ElementInfo[], side: Side) =>
      elements.filter(e => e.parent === parent[side] && e.tag === first.tag).length;
    const all =
      kin(before, 'before') === group.length &&
      kin(after, 'after') === group.length &&
      group.every(change => after[change.element.after].parent === parent.after);
    const small =
      before[parent.before].tag !== 'body' &&
      before[parent.before].height <= maxHeight &&
      after[parent.after].height <= maxHeight;
    return alike && all && small;
  });
  const members = new Set(groups.flat());
  const kept = restyles.filter(change => !members.has(change));
  const parentOf = (group: LookChange[]) => before[group[0].element.before].parent;
  for (const group of groups) {
    const parent = parentOf(group);
    // A parent in a group of its own is boxed with that group: its children keep their boxes.
    if (groups.some(other => other !== group && other.some(change => change.element.before === parent))) {
      kept.push(...group);
      continue;
    }
    const tag = before[group[0].element.before].tag;
    const [, several] = KINDS[tag] ?? [tag, tag];
    const text = `${group.length} ${several}: ${group[0].what.join(', ')}`;
    const own = kept.find(change => change.element.before === parent);
    if (own) own.group = text;
    else kept.push({ element: { before: parent, after: partner.get(parent)! }, what: [], group: text });
  }
  return kept;
}

/** The longest start of a component's words put in its name, so a long text does not cover the page. */
const MAX_WORDS = 40;

/** What an added or removed element says, to tell it from the others in a list: the start of its
 * words, after a space; nothing when it has none. */
function beginning(element: ElementInfo, words: readonly string[]): string {
  const text = words.slice(...element.tokens).join(' ');
  if (!text) return '';
  return ` ${text.length > MAX_WORDS ? `${text.slice(0, MAX_WORDS - 1).trimEnd()}…` : text}`;
}

/** Top to bottom; elements level with each other in a fixed order, by signature. One with no place
 * on the before page comes first. */
const readingOrder = (x: ElementInfo | undefined, y: ElementInfo | undefined) =>
  (x?.top ?? 0) - (y?.top ?? 0) || (x?.signature ?? '').localeCompare(y?.signature ?? '');

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

/** An element whose look changed, its style or its pixels, and what changed; or one `only` one page
 * has, with the element next to its place on the other page. */
type LookChange = Omit<Look, 'name'>;

/** The elements that are the same on both pages: each page's elements, in document order, diffed on
 * their signatures as the words are, and the ones the diff keeps. Between two of those, the elements
 * left over on both pages are diffed again on their tags alone, those with words apart from those
 * without: an element whose words, id or label changed is the same element in the same place, not
 * one removed and another added, and its look may have changed too. The pairs `reworded` are the
 * ones with words found that way: what they show is not the same, so their pixels differ anyway. */
function pairUp(
  before: readonly ElementInfo[],
  after: readonly ElementInfo[],
  key: (element: ElementInfo) => string,
): { pairs: Pair[]; reworded: Set<Pair> } {
  const pairs: Pair[] = [];
  const reworded = new Set<Pair>();
  let left: Record<Side, number[]> = { before: [], after: [] };
  const sameTags = (worded: boolean): Pair[] => {
    const mine = {
      before: left.before.filter(i => before[i].worded === worded),
      after: left.after.filter(i => after[i].worded === worded),
    };
    return diff(
      mine.before.map(i => before[i].tag),
      mine.after.map(i => after[i].tag),
    )
      .filter(op => op.type === 'equal')
      .map(op => ({ before: mine.before[op.before], after: mine.after[op.after] }));
  };
  const pairLeftOvers = () => {
    const withWords = sameTags(true);
    for (const pair of withWords) reworded.add(pair);
    pairs.push(...withWords, ...sameTags(false));
    left = { before: [], after: [] };
  };
  const ops = diff(before.map(key), after.map(key));
  for (const op of ops) {
    if (op.type === 'remove') left.before.push(op.before);
    else if (op.type === 'add') left.after.push(op.after);
    else {
      pairLeftOvers();
      pairs.push({ before: op.before, after: op.after });
    }
  }
  pairLeftOvers();
  return { pairs, reworded };
}

/** The `pairs` that are of one element and another with something in each, but of nothing in one
 * with anything in the other. Elements alike (the rows of a table) are paired by their place in the
 * list, so a row added can take the old row's pair, and the cells of that row are paired to the
 * cells of the next one: the pair left is not the same element, and is dropped, so the row added
 * is a component of its own; the old row is paired again with the one its cells are in. An element
 * with nothing inside it is never dropped: its words are all that changed. */
function unhollowed(pairs: Pair[], before: readonly ElementInfo[], after: readonly ElementInfo[]): Pair[] {
  const partner = new Map(pairs.map(pair => [pair.before, pair.after]));
  const hollow = ({ before: was, after: now }: Pair) => {
    const inside = range(was + 1, endOf(before, was));
    const there = [now + 1, endOf(after, now)];
    return (
      before[was].worded &&
      after[now].worded &&
      inside.length > 0 &&
      there[1] > there[0] &&
      !inside.some(i => (partner.get(i) ?? -1) >= there[0] && (partner.get(i) ?? -1) < there[1])
    );
  };
  const kept = pairs.filter(pair => !hollow(pair));
  const used = new Set(kept.map(pair => pair.after));
  // Each element dropped is paired again with the one its children's partners are in, when that
  // one has its tag and no pair: the rows below a row added are compared with their own again.
  for (const { before: was } of pairs.filter(hollow)) {
    const child = before.findIndex((e, i) => e.parent === was && partner.has(i));
    const home = child < 0 ? -1 : after[partner.get(child)!].parent;
    if (home >= 0 && after[home].tag === before[was].tag && !used.has(home)) {
      kept.push({ before: was, after: home });
      used.add(home);
    }
  }
  return kept.sort((x, y) => x.before - y.before);
}

/** The components only one page has: an element with nothing inside it that the other page has too,
 * and either no word or image in it, or a block of its own, as a paragraph is and a link in a
 * sentence is not. One inside another is the outer one's: a component added is one change, not one
 * per element in it. One that does not show is none. */
function onOnePage(pairs: Pair[], elements: Record<Side, readonly ElementInfo[]>): LookChange[] {
  const found: LookChange[] = [];
  for (const side of SIDES) {
    const other = side === 'before' ? 'after' : 'before';
    const partner = new Map(pairs.map(pair => [pair[side], pair[other]]));
    const mine = elements[side];
    for (let index = 0; index < mine.length; index++) {
      const end = endOf(mine, index);
      const alone =
        (!mine[index].worded || mine[index].block) && range(index, end).every(i => !partner.has(i));
      if (!alone) continue;
      if (mine[index].seen) {
        const place = placeOn(partner, mine, index, end);
        const element = { [side]: index, [other]: place.element } as Pair;
        found.push({
          element,
          what: [side === 'before' ? 'removed' : 'added'],
          only: side,
          edge: place.edge,
          beside: place.beside,
        });
      }
      index = end - 1; // what is inside it is part of it
    }
  }
  return found;
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** Whether element `index` is inside element `ancestor`, or is it. */
function isIn(elements: readonly ElementInfo[], index: number, ancestor: number): boolean {
  for (let i = index; i >= ancestor; i = elements[i].parent) if (i === ancestor) return true;
  return false;
}

/** The index after the last element inside element `index`: elements are in document order, so the
 * ones inside it follow it. */
function endOf(elements: readonly ElementInfo[], index: number): number {
  let end = index + 1;
  while (end < elements.length && isIn(elements, end, index)) end++;
  return end;
}

/** Where on the other page the element from `index` to `end` would be: under the nearest element
 * before it in the same parent that the other page has too, else over the nearest after it, else at
 * the top of the nearest around it; failing those, under the nearest before it anywhere, or over the
 * nearest after it. No element when the pages share none. */
function placeOn(
  partner: Map<number, number>,
  elements: readonly ElementInfo[],
  index: number,
  end: number,
): { element: number; edge: Edge; beside: boolean } {
  const paired = (indexes: number[]) => indexes.find(i => partner.has(i));
  const before = range(0, index).reverse();
  const after = range(end, elements.length);
  const sibling = (i: number) => elements[i].parent === elements[index].parent;
  const around = (i: number) => isIn(elements, index, i);
  const candidates: [number | undefined, Edge][] = [
    [paired(before.filter(i => sibling(i) && !around(i))), 'bottom'],
    [paired(after.filter(sibling)), 'top'],
    [paired(before.filter(around)), 'top'],
    [paired(before), 'bottom'],
    [paired(after), 'top'],
  ];
  const found = candidates.findIndex(([near]) => near !== undefined);
  const [near, edge] = candidates[found] ?? [undefined, 'top'];
  // The first two are next to it in the same element: what both pages share around it.
  return {
    element: near === undefined ? -1 : (partner.get(near) ?? -1),
    edge,
    beside: found === 0 || found === 1,
  };
}

/** The pairs whose style changed, and what changed; and the pairs that draw their own pixels, with
 * no listed element inside them, and whose style did not change: the ones to compare pixel by pixel.
 * A pair transparent on both pages is neither. One `reworded` is compared for its style alone: an
 * image put in the place of another is a change of words, not the same picture redrawn.
 * An element with others inside it is left out, as its shot holds theirs too: words changed in a
 * section with a background image are a change of words, not a picture redrawn. */
function sortPairs(
  pairs: Pair[],
  reworded: Set<Pair>,
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
    else if (!reworded.has(pair) && isPicture(before[pair.before]) && isPicture(after[pair.after]))
      pictures.push(pair);
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
      const label = redrawnLabel(before.elements[pair.before], await before.name(pair.before));
      found.push({ element: pair, what: [label] });
    }
  }
  return found;
}

/** What kinds of picture are called, when the page gives one no name. */
const PICTURE_KINDS: Record<string, string> = { img: 'image', svg: 'SVG', canvas: 'canvas', video: 'video' };

/** The longest name put on a label, so a long description does not cover the page. */
const MAX_NAME = 40;

/** What a redrawn picture's label says: its accessible name when it has one, its kind otherwise. Any
 * other element that paints does so with a background image file. An iframe's pixels are a page's:
 * what changed in it is not known, only that something did. */
function redrawnLabel(element: ElementInfo, accessibleName: string): string {
  if (element.tag === 'iframe') return 'embedded page';
  const name =
    accessibleName.length > MAX_NAME ? `${accessibleName.slice(0, MAX_NAME - 1).trimEnd()}…` : accessibleName;
  return name ? `${name} redrawn` : (PICTURE_KINDS[element.tag] ?? 'background image');
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
