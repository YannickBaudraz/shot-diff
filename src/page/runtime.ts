// The code that runs inside each page. Playwright sends a function's source to the page, not its
// closure, so runtime() stands alone: no imports at run time, nothing from outside its body. It
// reads the page and returns the page's interface; loaded.ts installs it once per page and calls it.

import type { ElementInfo } from '../changes/looks.ts';
import type { Area, Box, Region, Span } from '../geometry.ts';

/** What to draw on a page. */
export type Marks = {
  color: string; // the boxes and the labels
  within: string | null; // a selector: say of each change whether it is inside the element it matches
  /** Word changes: the changed tokens and the unchanged ones around them, as indexes into the reading's words. */
  words: { changed: number[]; anchors: number[] }[];
  /** Changes of look: an element, as an index into the reading's elements, and what to put on its
   * box: a label, a disc, or nothing (plain). With no badge nothing is drawn: this page has not the
   * element that changed, which would be at this one's `edge` (at the top of the page with -1, for
   * none); when it is `beside` it, in the same element, the place takes all of it in. */
  looks: {
    index: number;
    badge: { label: string } | { disc: { src: string; size: number } } | { plain: true } | null;
    edge?: 'top' | 'bottom';
    beside?: boolean;
  }[];
};

/** Where each word change and each change of look sits, in the order mark() was given them. */
export type Spans = { words: (Span | null)[]; looks: Span[] };

/** The page's runtime, reading the page's words and the `properties` of its elements before anything
 * is drawn over it. */
export function runtime(properties: string[], ignore: string[] = [], showIgnored = false) {
  /** A box's line, as a thin box, with the box it is of (keyOf), which its own label may cross. */
  type Line = Box & { of: string };
  /** What a label avoids: what it would hide (words, images, labels), and the boxes' lines. */
  type Avoid = { taken: Box[]; lines: Line[] };
  const keyOf = (box: Box) => `${box.x} ${box.y} ${box.width} ${box.height}`;

  /** A word, as a stretch of a text node, or an image. */
  type Token = { node: Text; start: number; end: number } | { image: Element };

  let marked = false;
  /** How to take back what mark() drew for each change, so unmark() can. */
  const undo: { words: (() => void)[][]; looks: (() => void)[][] } = { words: [], looks: [] };

  // Sizes in CSS pixels.
  // margin: between an element and its box; ring: the white line outside it, which keeps it apart
  // from a background close to its colour
  const BOX = { margin: 6, border: 3, ring: 2, radius: 6 };
  const LABEL = { gap: BOX.border, font: '600 12px/1.4 system-ui,sans-serif', padding: '1px 6px' };
  // How far two boxes go into each other before one covers the other: a line of text's rectangle is
  // taller than its letters, so a label that only touches it hides nothing.
  const TOUCHING = 2;
  const IMAGE_OUTLINE = { width: 3, offset: 2 };
  const WORD_BOX_MARGIN = { x: 2, y: 3 }; // between a line of changed words and its box
  // A word box sits in running text, a few pixels from the next word: a thinner line and a thinner
  // ring, so it does not cover the end of the word before it. The ring stays: without it a green
  // box on a green button does not show.
  // tint: how much of its colour fills a word box. Two changes a line apart box the unchanged words
  // between them on three sides; filled, what changed tells itself from what its lines only go round.
  const WORD_BOX = { border: 2, ring: 1, tint: 0.14 };
  const ANCHOR_REACH = 120; // how far from a change the unchanged words around it still place it
  const SNAP_CLEARANCE = 6; // between a moved shot edge and the line of text it would have cut
  const IGNORED_COLOR = '#6e7781'; // an area --ignore leaves out: grey, so it reads as no change
  const IGNORED_MARGIN = 2; // close around it, so areas next to each other keep apart
  const HIDING = 10; // how much worse a label hiding a word or a label is than one crossing a box's line
  const ON_COLOR = '#ffffff'; // a label's words and a box's ring: ON_SIDE_COLOR in side.ts, which this code cannot import

  const rangeOf = (token: Token) => {
    const range = document.createRange();
    if ('image' in token) range.selectNode(token.image);
    else {
      range.setStart(token.node, token.start);
      range.setEnd(token.node, token.end);
    }
    return range;
  };

  /** A rectangle on screen, as a box in page pixels. */
  const pageBox = (rect: { left: number; top: number; width: number; height: number }): Box => ({
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  });

  /** The stretch of the page that rectangles on screen take up, in page pixels. */
  const pageRegion = (rects: DOMRect[]): Region => ({
    top: Math.min(...rects.map(r => r.top)) + window.scrollY,
    bottom: Math.max(...rects.map(r => r.bottom)) + window.scrollY,
  });

  /** How far across the page rectangles on screen go, in page pixels. */
  const pageAcross = (rects: DOMRect[]) => ({
    left: Math.min(...rects.map(r => r.left)) + window.scrollX,
    right: Math.max(...rects.map(r => r.right)) + window.scrollX,
  });

  /** `region`, its top kept inside the page. */
  const inPage = (region: Region): Region => ({ top: Math.max(0, region.top), bottom: region.bottom });

  /** The smallest rectangle around `rects`, on screen. */
  const around = (rects: DOMRect[]) => {
    const left = Math.min(...rects.map(r => r.left));
    const top = Math.min(...rects.map(r => r.top));
    const width = Math.max(...rects.map(r => r.right)) - left;
    const height = Math.max(...rects.map(r => r.bottom)) - top;
    return { left, top, width, height };
  };

  /** A box grown by `dx` on its left and right and `dy` above and below. */
  const grow = (box: Box, dx: number, dy = dx): Box => ({
    x: box.x - dx,
    y: box.y - dy,
    width: box.width + 2 * dx,
    height: box.height + 2 * dy,
  });

  /** The nodes laid out inside `node`, in order. An element with a shadow tree shows that tree, not
   * its own children; a slot in it shows the nodes the element gives it, or its own with none given.
   * Only an open shadow tree can be reached from the page: a closed one is not read. */
  const shownChildren = (node: Node): Node[] => {
    if (node instanceof Element && node.shadowRoot) return [...node.shadowRoot.childNodes];
    const given = node instanceof HTMLSlotElement ? node.assignedNodes() : [];
    return given.length ? given : [...node.childNodes];
  };

  /** The element `node` is laid out in: the slot it is given to, the element whose shadow tree it is
   * at the top of, or else its parent. */
  const shownIn = (node: Node): Element | null => {
    const slot = node instanceof Element || node instanceof Text ? node.assignedSlot : null;
    if (slot) return slot;
    return node.parentElement ?? (node.parentNode instanceof ShadowRoot ? node.parentNode.host : null);
  };

  /** Call `visit` on every node laid out in `node`, parents first; it says whether to go inside. */
  const walk = (node: Node, visit: (node: Node) => boolean) => {
    for (const child of shownChildren(node)) if (visit(child)) walk(child, visit);
  };

  /** Whether the text laid out in `parent` shows. An element with `display: contents`, as a slot
   * has, has no box of its own to ask: its visibility is its own, and the rest is asked of the
   * element it is laid out in. */
  const showsText = (parent: Element | null): boolean => {
    if (!parent) return false;
    const style = getComputedStyle(parent);
    if (style.display !== 'contents')
      return parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    return style.visibility === 'visible' && showsText(shownIn(parent));
  };

  /** Whether `node` is in `ancestor`'s tree, the shadow trees inside it included. */
  const inTreeOf = (ancestor: Node, node: Node): boolean => {
    for (let n: Node | null = node; n; n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null))
      if (n === ancestor) return true;
    return false;
  };

  /** The token's rectangles on screen, one per line it is on. */
  const rectsOf = (token: Token) => [...rangeOf(token).getClientRects()].filter(r => r.width || r.height);

  /** The part of `rect`, on screen, that the clipping elements from `clipper` up show, or null when
   * they show none of it: a scroll area's edge, or any overflow that is not visible, cuts the rest
   * off. The page itself scrolls into the shots, so html and body do not count; nor does anything
   * around a fixed element, which they do not clip. */
  const shownPart = (rect: DOMRect, clipper: Element | null): DOMRect | null => {
    let { left, top, right, bottom } = rect;
    for (
      let node = clipper;
      node && node !== document.body && node !== document.documentElement;
      node = shownIn(node)
    ) {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const x = box.left + node.clientLeft;
      const y = box.top + node.clientTop;
      if (style.overflowX !== 'visible') {
        left = Math.max(left, x);
        right = Math.min(right, x + node.clientWidth);
      }
      if (style.overflowY !== 'visible') {
        top = Math.max(top, y);
        bottom = Math.min(bottom, y + node.clientHeight);
      }
      if (style.position === 'fixed') break;
    }
    return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : null;
  };

  /** What shows of a token, a rectangle per line it is on: its text is clipped by its own element
   * and those around it, an image by those around it. */
  const shownRectsOf = (token: Token) => {
    const clipper = shownIn('image' in token ? token.image : token.node);
    return rectsOf(token).flatMap(rect => shownPart(rect, clipper) ?? []);
  };

  /** A layer over the page for the boxes, so nothing the page lays out moves. */
  const overlay = () => {
    const layer = document.createElement('div');
    layer.style.cssText =
      'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    document.documentElement.appendChild(layer);
    return layer;
  };

  /** An image as a word: its alt text, or else its file name. */
  const imageWord = (image: Element) => {
    const name = image.getAttribute('alt') || (image.getAttribute('src') || '').split('/').pop() || 'image';
    return `[image ${name}]`;
  };

  /** Every visible word and image, in the order the page lays them out, shadow trees included. Text
   * with opacity 0 counts as hidden here. */
  const readWords = (skipped: Set<Element>): { words: string[]; tokens: Token[] } => {
    const found: Token[] = [];
    const words: string[] = [];
    walk(document.body, node => {
      if (node instanceof Element && skipped.has(node)) return false;
      if (node instanceof Element) {
        if (node.tagName === 'IMG' && node.checkVisibility()) {
          found.push({ image: node });
          words.push(imageWord(node));
        }
      } else if (node instanceof Text && showsText(shownIn(node))) {
        for (const match of node.data.matchAll(/\S+/g)) {
          found.push({ node, start: match.index, end: match.index + match[0].length });
          words.push(match[0]);
        }
      }
      return true;
    });
    return { words, tokens: found };
  };

  /** What pairs an element with its match on the other page: tag, id, role, label, own words, file. */
  const signature = (element: Element, withWords = true) => {
    const ownText = [...element.childNodes]
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent)
      .join(' ');
    const ownWords = withWords ? ownText.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    const link = element.getAttribute('src') || element.getAttribute('href') || '';
    const file = link.split(/[?#]/)[0].split('/').pop() || '';
    const role = element.getAttribute('role') || '';
    const label = element.getAttribute('aria-label') || '';
    return [element.tagName, element.id && `#${element.id}`, role, label, ownWords, file]
      .filter(Boolean)
      .join(' ');
  };

  /** The elements that draw pixels their style does not describe. An embedded page is one: it is a
   * document of its own, whose words and elements are not read here. */
  const PAINTERS = new Set(['IMG', 'CANVAS', 'svg', 'VIDEO', 'IFRAME']);

  /** The elements with a word or an image in them, their own or inside them, and where theirs are
   * among the page's tokens: from the first, up to after the last. The ones inside an element are
   * next to each other, as the page's tokens are in the order the page lays them out. */
  const tokenRanges = (tokens: Token[]) => {
    const ranges = new Map<Element, [number, number]>();
    for (const [i, token] of tokens.entries()) {
      const first = 'image' in token ? token.image : shownIn(token.node);
      for (let element = first; element; element = shownIn(element)) {
        const range = ranges.get(element);
        if (range) range[1] = i + 1;
        else ranges.set(element, [i, i + 1]);
      }
    }
    return ranges;
  };

  /** An element as looks.ts compares it; its parent is filled in by readElements(). */
  const describe = (
    element: Element,
    rect: DOMRect,
    properties: string[],
    ranges: Map<Element, [number, number]>,
  ): ElementInfo => {
    const style = getComputedStyle(element);
    const computed = element.computedStyleMap();
    return {
      signature: signature(element),
      shape: signature(element, false),
      tag: element.tagName.toLowerCase(),
      parent: -1,
      leaf: true,
      worded: ranges.has(element),
      block: !['inline', 'contents'].includes(style.display),
      tokens: ranges.get(element) ?? [0, 0],
      // A gradient is all in its CSS value, compared as style; and a shot of it holds whatever shows
      // through it, which may be another element passing under it.
      paints: PAINTERS.has(element.tagName) || style.backgroundImage.includes('url('),
      seen: element.checkVisibility({ checkOpacity: true }),
      top: pageBox(rect).y,
      height: rect.height,
      // The computed value, as the CSS gave it: `auto` stays `auto`, where getComputedStyle would give
      // the pixels layout made of it, which change with whatever else changed on the page.
      style: Object.fromEntries(
        properties.map(p => [p, (computed.get(p) ?? style.getPropertyValue(p)).toString()]),
      ),
    };
  };

  /** The index of the nearest element already listed that `element` is laid out in, if any. */
  const listedAncestor = (element: Element, indexOf: Map<Element, number>) => {
    for (let ancestor = shownIn(element); ancestor; ancestor = shownIn(ancestor)) {
      const index = indexOf.get(ancestor);
      if (index !== undefined) return index;
    }
    return undefined;
  };

  /** Every visible element, in the order the page lays them out, shadow trees included. An element
   * with opacity 0 still counts: its opacity is one of the properties compared, and `seen` says
   * whether it shows. */
  const readElements = (
    properties: string[],
    ranges: Map<Element, [number, number]>,
  ): { elements: ElementInfo[]; domElements: Element[] } => {
    const found: Element[] = [];
    const elements: ElementInfo[] = [];
    const indexOf = new Map<Element, number>();
    walk(document.body, node => {
      if (!(node instanceof Element) || ignored.has(node)) return false;
      const rect = node.getBoundingClientRect();
      const visible =
        node.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) && rect.width && rect.height;
      if (visible) {
        const info = describe(node, rect, properties, ranges);
        const parent = listedAncestor(node, indexOf);
        if (parent !== undefined) {
          info.parent = parent;
          elements[parent].leaf = false;
        }
        indexOf.set(node, elements.length);
        found.push(node);
        elements.push(info);
      }
      // An SVG is one picture: its shapes are not elements of their own here.
      return node.tagName !== 'svg';
    });
    return { elements, domElements: found };
  };

  /** A changed image's mark: an outline, which takes no room on the page. Gives how to take it off. */
  const outline = (image: HTMLElement, color: string) => {
    const { outline: was, outlineOffset: wasOffset } = image.style;
    image.style.outline = `${IMAGE_OUTLINE.width}px solid ${color}`;
    image.style.outlineOffset = `${IMAGE_OUTLINE.offset}px`;
    return () => {
      image.style.outline = was;
      image.style.outlineOffset = wasOffset;
    };
  };

  /** Outline the changed images: the words are boxed, not painted over. Gives, for each change, how
   * to take its outlines off. */
  const outlineImages = (marks: Marks, tokens: Token[]): (() => void)[][] =>
    marks.words.map(change =>
      change.changed.flatMap(i => {
        const token = tokens[i];
        return 'image' in token ? [outline(token.image as HTMLElement, marks.color)] : [];
      }),
    );

  /** A box drawn on `layer` at `box`, in page pixels. */
  const drawBox = (
    layer: HTMLElement,
    color: string,
    box: Box,
    line: { border: number; ring: number; tint?: number } = BOX,
  ) => {
    const element = document.createElement('div');
    element.style.cssText =
      `position:absolute;box-sizing:border-box;border:${line.border}px solid ${color};border-radius:${BOX.radius}px;` +
      (line.ring ? `box-shadow:0 0 0 ${line.ring}px ${ON_COLOR};` : '') +
      (line.tint ? `background:color-mix(in srgb, ${color} ${line.tint * 100}%, transparent);` : '') +
      `left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px`;
    layer.appendChild(element);
    return element;
  };

  /** `box` kept inside the page's width and below its top, its ring included: a box around an
   * element as wide as the page would otherwise lose its sides off the shot. */
  const onPage = (box: Box): Box => {
    const left = Math.max(box.x, BOX.ring);
    const top = Math.max(box.y, BOX.ring);
    const right = Math.min(box.x + box.width, document.documentElement.clientWidth - BOX.ring);
    return { x: left, y: top, width: Math.max(0, right - left), height: box.y + box.height - top };
  };

  /** Rectangles grouped by the line of text they sit on, top to bottom. */
  const linesOf = (rects: DOMRect[]) => {
    const lines: DOMRect[][] = [];
    for (const rect of [...rects].sort((p, q) => p.top - q.top || p.left - q.left)) {
      const line = lines.find(l => Math.abs(l[0].top - rect.top) < l[0].height / 2);
      if (line) line.push(rect);
      else lines.push([rect]);
    }
    return lines;
  };

  /** The nearest element around a token that is not inline, where its text is a block of its own. */
  const blockOf = (token: Token): Element | null => {
    let element = shownIn('image' in token ? token.image : token.node);
    while (element && ['inline', 'contents'].includes(getComputedStyle(element).display))
      element = shownIn(element);
    return element;
  };

  let blockSizes: Map<Element, number> | null = null;

  /** How many words and images each block has. */
  const sizeOfBlock = (block: Element): number => {
    if (!blockSizes) {
      blockSizes = new Map();
      for (const token of tokens) {
        const owner = blockOf(token);
        if (owner) blockSizes.set(owner, (blockSizes.get(owner) ?? 0) + 1);
      }
    }
    return blockSizes.get(block) ?? 0;
  };

  /** The words of a change, block by block: the rectangles of its words in that block, line by line
   * top to bottom, and whether the change takes all of the block's words. */
  const blocksOf = (changed: number[], tokens: Token[]): { lines: DOMRect[][]; whole: boolean }[] => {
    const byBlock = new Map<Element | null, number[]>();
    for (const i of changed) {
      const block = blockOf(tokens[i]);
      byBlock.set(block, [...(byBlock.get(block) ?? []), i]);
    }
    return [...byBlock].flatMap(([block, indexes]) => {
      const lines = linesOf(indexes.flatMap(i => shownRectsOf(tokens[i])));
      return lines.length ? [{ lines, whole: !!block && indexes.length === sizeOfBlock(block) }] : [];
    });
  };

  /** The box around changed words, `rects`, in page pixels: WORD_BOX_MARGIN from them, its sides
   * kept off the words beside them on their line that are not theirs, `others`. A word written
   * against a changed one, as "8" is in "8, 10", would otherwise be under its line. Only the thin
   * ring outside the line may go on such a word's rectangle, which ends with a margin of its letter. */
  const wordBox = (rects: DOMRect[], others: DOMRect[]): Box => {
    const words = around(rects);
    const right = words.left + words.width;
    const level = others.filter(
      other => Math.min(other.bottom, words.top + words.height) - Math.max(other.top, words.top) > TOUCHING,
    );
    // Never inside the changed words either, where a neighbour's rectangle runs into theirs.
    const left = Math.max(
      words.left - WORD_BOX_MARGIN.x,
      ...level
        .filter(other => other.right <= words.left + TOUCHING)
        .map(other => Math.min(other.right, words.left)),
    );
    const end = Math.min(
      right + WORD_BOX_MARGIN.x,
      ...level.filter(other => other.left >= right - TOUCHING).map(other => Math.max(other.left, right)),
    );
    const top = words.top - WORD_BOX_MARGIN.y;
    return onPage(pageBox({ left, top, width: end - left, height: words.height + 2 * WORD_BOX_MARGIN.y }));
  };

  /** Boxes around the lines of a change in one block, top to bottom, joined in runs that one outline
   * goes around, as a text selection is drawn: each line under the one before it, and side by side
   * with it, wide enough for an outline round both. In a run, a line the change goes on from takes
   * in the room left at its end, and a line it goes on to the room at its start, so the outline runs
   * straight down both sides; not over a word of `others`, which is not the change's. */
  const runsOf = (boxes: Box[], others: DOMRect[]): Box[][] => {
    const below = (box: Box, next: Box) => next.y - (box.y + box.height) < box.height / 2;
    const stacked: Box[][] = [];
    for (const box of boxes) {
      const run = stacked.at(-1);
      if (run && below(run.at(-1)!, box)) run.push(box);
      else stacked.push([box]);
    }
    const taken = others.map(pageBox);
    const clear = (box: Box) => !taken.some(other => covers(box, other));
    const widened = stacked.map(run => {
      const left = Math.min(...run.map(box => box.x));
      const right = Math.max(...run.map(box => box.x + box.width));
      return run.map((box, i) => {
        let wide = box;
        const end = i < run.length - 1 ? { ...wide, width: right - wide.x } : wide;
        if (clear(end)) wide = end;
        const start = i > 0 ? { ...wide, x: left, width: wide.x + wide.width - left } : wide;
        return clear(start) ? start : wide;
      });
    });
    const meet = (box: Box, next: Box) =>
      Math.min(box.x + box.width, next.x + next.width) - Math.max(box.x, next.x) >= 2 * BOX.radius;
    return widened.flatMap(run => {
      const runs: Box[][] = [];
      for (const box of run) {
        const last = runs.at(-1);
        if (last && meet(last.at(-1)!, box)) last.push(box);
        else runs.push([box]);
      }
      return runs;
    });
  };

  /** The corners of the outline around `boxes`, one under the other, each side by side with the
   * next, its sides, top and bottom moved out by `d` (in by a negative one): down its right side,
   * then up its left. Where two lines meet, the outline steps halfway between them. */
  const outlineCorners = (boxes: Box[], d: number): [number, number][] => {
    const lefts = boxes.map(box => box.x - d);
    const rights = boxes.map(box => box.x + box.width + d);
    const joins = boxes.slice(1).map((box, i) => (boxes[i].y + boxes[i].height + box.y) / 2);
    const top = boxes[0].y - d;
    const last = boxes.length - 1;
    const bottom = boxes[last].y + boxes[last].height + d;
    const corners: [number, number][] = [
      [lefts[0], top],
      [rights[0], top],
    ];
    // A step stays halfway between the two lines, whatever `d`: lines of text have little room
    // between them, and a step moved off the middle would run along the letters of one.
    joins.forEach((y, i) => corners.push([rights[i], y], [rights[i + 1], y]));
    corners.push([rights[last], bottom], [lefts[last], bottom]);
    for (let i = joins.length - 1; i >= 0; i--) corners.push([lefts[i + 1], joins[i]], [lefts[i], joins[i]]);
    // Two lines that end level make no step: their corners are on a straight edge.
    return corners.filter((corner, i) => {
      const prev = corners.at(i - 1)!;
      const next = corners[(i + 1) % corners.length];
      return !(
        (Math.abs(prev[0] - corner[0]) < 0.5 && Math.abs(next[0] - corner[0]) < 0.5) ||
        (Math.abs(prev[1] - corner[1]) < 0.5 && Math.abs(next[1] - corner[1]) < 0.5)
      );
    });
  };

  /** An SVG path through `corners`, each rounded by up to `radius`. */
  const roundedPath = (corners: [number, number][], radius: number): string => {
    const toward = (from: [number, number], to: [number, number]) => {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const r = Math.min(radius, length / 2) / (length || 1);
      return [from[0] + (to[0] - from[0]) * r, from[1] + (to[1] - from[1]) * r];
    };
    return (
      corners
        .map((corner, i) => {
          const [ax, ay] = toward(corner, corners.at(i - 1)!);
          const [bx, by] = toward(corner, corners[(i + 1) % corners.length]);
          return `${i ? 'L' : 'M'}${ax},${ay} Q${corner[0]},${corner[1]} ${bx},${by}`;
        })
        .join(' ') + ' Z'
    );
  };

  /** One outline around `boxes`, in page pixels, one under the other, each side by side with the
   * next: an SVG on `layer`, its line inside their edge and its ring outside it, as a word box has. */
  const drawOutline = (layer: HTMLElement, color: string, boxes: Box[], tint: number) => {
    const left = Math.min(...boxes.map(box => box.x));
    const right = Math.max(...boxes.map(box => box.x + box.width));
    const top = boxes[0].y;
    const bottom = boxes.at(-1)!.y + boxes.at(-1)!.height;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.style.cssText =
      `position:absolute;overflow:visible;left:${left}px;top:${top}px;` +
      `width:${right - left}px;height:${bottom - top}px`;
    const local = boxes.map(box => ({ ...box, x: box.x - left, y: box.y - top }));
    const strokes = [
      { color: ON_COLOR, width: WORD_BOX.ring, at: WORD_BOX.ring / 2, tint: 0 },
      { color, width: WORD_BOX.border, at: -WORD_BOX.border / 2, tint },
    ];
    for (const stroke of strokes.filter(stroke => stroke.width)) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', roundedPath(outlineCorners(local, stroke.at), BOX.radius + stroke.at));
      path.setAttribute('fill', stroke.tint ? stroke.color : 'none');
      if (stroke.tint) path.setAttribute('fill-opacity', `${stroke.tint}`);
      path.setAttribute('stroke', stroke.color);
      path.setAttribute('stroke-width', `${stroke.width}`);
      svg.appendChild(path);
    }
    layer.appendChild(svg);
    return svg;
  };

  /** Box a word change, one box per line, so a change that wraps gets no box through the words
   * between, or one box for the block it takes entirely; and say where it is, with the unchanged
   * words around it. Each box drawn goes in `drawn`. A changed word that a scroll area cuts off gets
   * no box; with none shown, the change is clipped. */
  const boxWords = (
    change: Marks['words'][number],
    tokens: Token[],
    tokenRects: DOMRect[][],
    layer: HTMLElement,
    color: string,
    drawn: Element[],
  ): Span | null => {
    const changed = new Set(change.changed);
    const others = tokenRects.flatMap((rects, i) => (changed.has(i) ? [] : rects));
    // A box on a changed picture gets no tint: tinted, the picture would not show as the page has it.
    const pictures = change.changed
      .filter(i => 'image' in tokens[i])
      .flatMap(i => shownRectsOf(tokens[i]).map(pageBox));
    const lineFor = (boxes: Box[]) =>
      boxes.some(box => pictures.some(picture => covers(box, picture))) ? { ...WORD_BOX, tint: 0 } : WORD_BOX;
    const draw = (run: Box[]) =>
      run.length === 1
        ? drawBox(layer, color, run[0], lineFor(run))
        : drawOutline(layer, color, run, lineFor(run).tint);
    const elements = blocksOf(change.changed, tokens).flatMap(({ lines, whole }) => {
      // All the words of a block: one box around them, as there is no unchanged word for it to run through.
      if (whole) return [draw([wordBox(lines.flat(), others)])];
      return runsOf(
        lines.map(line => wordBox(line, others)),
        others,
      ).map(draw);
    });
    drawn.push(...elements);
    const boxes = elements.map(element => element.getBoundingClientRect());
    const shown = [
      ...boxes,
      ...near(
        boxes,
        change.anchors.map(i => rectsOf(tokens[i])),
      ),
    ];
    if (!shown.length) return null;
    return {
      ...inPage(pageRegion(shown)),
      changed: boxes.length ? inPage(pageRegion(boxes)) : null,
      inside: true,
      clipped: change.changed.length > 0 && !boxes.length,
      ...(boxes.length && { across: pageAcross(boxes) }),
    };
  };

  /** The rectangles of the unchanged words around a change that are near it, each word's given
   * nearest first: those within ANCHOR_REACH of the change's boxes, or with none, of the nearest
   * word. A word far off, past a gap in the page, would stretch the shot over all the gap. */
  const near = (boxes: DOMRect[], words: DOMRect[][]): DOMRect[] => {
    const rects = words.flat();
    const from = boxes.length ? boxes : (words.find(word => word.length) ?? []);
    if (!from.length) return rects;
    const top = Math.min(...from.map(r => r.top)) - ANCHOR_REACH;
    const bottom = Math.max(...from.map(r => r.bottom)) + ANCHOR_REACH;
    return rects.filter(r => r.bottom >= top && r.top <= bottom);
  };

  /** Where a disc goes: on a box's top left corner, kept inside the page. */
  const discCorner = (box: Box, size: number) => ({
    left: Math.max(0, box.x - size / 2),
    top: Math.max(0, box.y - size / 2),
  });

  /** Whether two boxes go into each other, by more than touching. */
  const covers = (one: Box, other: Box) =>
    Math.min(one.x + one.width, other.x + other.width) - Math.max(one.x, other.x) > TOUCHING &&
    Math.min(one.y + one.height, other.y + other.height) - Math.max(one.y, other.y) > TOUCHING;

  /** Where the label of `box` goes, as a box in page pixels: of the places around the box that are
   * on the page, the one that covers the fewest of `taken`, the page's words and the labels before
   * it. Above the box, on its left, comes first; then below it, then the same two on its right,
   * then inside it at the top, then beside it. At the top of the page there is no place above, and
   * a place that would run off the page's side is none. */
  const labelPlace = (box: Box, width: number, height: number, avoid: Avoid): Box => {
    const pageWidth = document.documentElement.clientWidth;
    // Along the box's edge, kept on the page: a box at the page's edge starts a little outside it.
    const left = Math.max(0, box.x);
    const right = Math.max(0, Math.min(box.x + box.width, pageWidth) - width);
    const above = box.y + BOX.border - LABEL.gap - height;
    const below = box.y + box.height - BOX.border + LABEL.gap;
    const beside = box.x + box.width + LABEL.gap;
    const inside = {
      y: box.y + BOX.border,
      left: box.x + BOX.border,
      right: box.x + box.width - BOX.border - width,
    };
    const all = [
      ...(above >= 0 ? [{ x: left, y: above }] : []),
      { x: left, y: below },
      ...(above >= 0 ? [{ x: right, y: above }] : []),
      { x: right, y: below },
      { x: inside.left, y: inside.y },
      ...(inside.right > inside.left ? [{ x: inside.right, y: inside.y }] : []),
      ...(beside + width <= pageWidth ? [{ x: beside, y: Math.max(0, box.y) }] : []),
    ].map(corner => ({ ...corner, width, height }));
    // A place that runs off the page's side would cut the label: one beside a box at the page's
    // right edge, started at the box's left. Such places are left out, unless all of them do.
    const onThePage = all.filter(place => place.x >= 0 && place.x + width <= pageWidth);
    const places = onThePage.length ? onThePage : all;
    // Hiding a word or a label loses what it says; crossing another box's line leaves it a box.
    const own = keyOf(box);
    const cost = (place: Box) =>
      HIDING * avoid.taken.filter(other => covers(place, other)).length +
      avoid.lines.filter(line => line.of !== own && covers(place, line)).length;
    return places.reduce((best, place) => (cost(place) < cost(best) ? place : best));
  };

  /** A box's four lines, each as a thin box, with the box they are of. */
  const edgesOf = (box: Box): Line[] => {
    const of = keyOf(box);
    const t = BOX.border;
    return [
      { x: box.x, y: box.y, width: box.width, height: t, of },
      { x: box.x, y: box.y + box.height - t, width: box.width, height: t, of },
      { x: box.x, y: box.y, width: t, height: box.height, of },
      { x: box.x + box.width - t, y: box.y, width: t, height: box.height, of },
    ];
  };

  /** The box around what shows of an element whose look changed, or null when a scroll area shows
   * none of it. */
  const lookBox = (element: Element): Box | null => {
    const rect = element.getBoundingClientRect();
    const clipper = getComputedStyle(element).position === 'fixed' ? null : shownIn(element);
    const shown = shownPart(rect, clipper);
    return shown && onPage(grow(pageBox(shown), BOX.margin));
  };

  /** The areas --ignore leaves out that get a dashed box, each with its box: one inside another is
   * the outer one's, and one that does not show gets none. */
  const ignoredBoxes = (): { element: Element; box: Box }[] =>
    [...ignored].flatMap(element => {
      const inner = [...ignored].some(other => other !== element && inTreeOf(other, element));
      const rect = element.getBoundingClientRect();
      if (inner || !rect.width || !rect.height) return [];
      return [{ element, box: onPage(grow(pageBox(rect), IGNORED_MARGIN)) }];
    });

  /** A numbered disc on a box's top left corner. */
  const drawDisc = (layer: HTMLElement, disc: { src: string; size: number }, box: Box) => {
    const { left, top } = discCorner(box, disc.size);
    const image = document.createElement('img');
    image.src = disc.src;
    image.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${disc.size}px;height:${disc.size}px`;
    layer.appendChild(image);
    return image;
  };

  /** What changed, on a tag by the box, where it hides the least of `taken`: it is added to them. */
  const drawLabel = (boxElement: HTMLElement, label: string, color: string, box: Box, avoid: Avoid) => {
    const tag = document.createElement('div');
    tag.textContent = label;
    tag.style.cssText =
      `position:absolute;left:0;top:0;padding:${LABEL.padding};` +
      `border-radius:${BOX.radius}px;white-space:nowrap;background:${color};color:${ON_COLOR};font:${LABEL.font}`;
    boxElement.appendChild(tag);
    const { width, height } = tag.getBoundingClientRect();
    const place = labelPlace(box, width, height, avoid);
    // From the inside of the box's border, which is what a tag inside the box is placed from.
    tag.style.left = `${place.x - box.x - BOX.border}px`;
    tag.style.top = `${place.y - box.y - BOX.border}px`;
    avoid.taken.push(place);
    return tag;
  };

  /** Box an element whose look changed, with its label or its disc, and say where all that is. The
   * box and the disc go in `drawn`; a label is inside its box, placed off what is `taken`. The box
   * is around what shows of the element: an element a scroll area cuts off is not boxed at all, it
   * is clipped. */
  const boxLook = (
    badgeOf: NonNullable<Marks['looks'][number]['badge']>,
    element: Element,
    layer: HTMLElement,
    color: string,
    drawn: HTMLElement[],
    avoid: Avoid,
  ): Span => {
    const box = lookBox(element);
    if (!box)
      return {
        ...inPage(pageRegion([element.getBoundingClientRect()])),
        changed: null,
        inside: true,
        clipped: true,
      };
    const boxElement = drawBox(layer, color, box);
    const badge =
      'disc' in badgeOf
        ? drawDisc(layer, badgeOf.disc, box)
        : 'label' in badgeOf
          ? drawLabel(boxElement, badgeOf.label, color, box, avoid)
          : boxElement;
    drawn.push(boxElement);
    if (badge.parentElement !== boxElement && badge !== boxElement) drawn.push(badge);
    const rects = [boxElement, badge].map(drawn => drawn.getBoundingClientRect());
    const region = inPage(pageRegion(rects));
    return { ...region, changed: region, inside: true, clipped: false, across: pageAcross(rects) };
  };

  /** A dashed grey box, with "ignored" on it, around each area --ignore leaves out, with
   * --show-ignored: so a reader can tell it was left out on purpose, not missed. One inside another is the outer one's; one that
   * does not show gets none. It is no change: it says nothing of where the shots go. */
  const drawIgnored = (layer: HTMLElement, avoid: Avoid) => {
    for (const { box } of ignoredBoxes()) {
      const boxElement = drawBox(layer, IGNORED_COLOR, box);
      boxElement.style.borderStyle = 'dashed';
      drawLabel(boxElement, 'ignored', IGNORED_COLOR, box, avoid);
    }
  };

  /** Where a change of look is on a page that has not its element: at that `edge` of `element`,
   * which is not boxed, or at the top of the page with none. An element `beside` it is taken in
   * whole, so the shot shows what both pages have around the place, not a cut through it. */
  const placeAt = (element: Element | undefined, edge: 'top' | 'bottom', beside = false): Span => {
    if (!element) return { top: 0, bottom: 0, changed: null, inside: true, clipped: false };
    const rect = element.getBoundingClientRect();
    if (beside) return { ...inPage(pageRegion([rect])), changed: null, inside: true, clipped: false };
    const y = Math.max(0, rect[edge] + window.scrollY);
    return { top: y, bottom: y, changed: null, inside: true, clipped: false };
  };

  /** What a heading is: a heading element, or one that says it is. */
  const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

  /** The heading an element before a change's own gives it: a heading itself, a header or a group
   * of headings with one in it, or an element around a heading and nothing more, as a title's box.
   * The page's banner, a header right in the body, names the site, not what a change is in. */
  const headingIn = (element: Element): Element | null => {
    if (element.matches(HEADINGS)) return element;
    const inner = element.querySelector(HEADINGS);
    if (!inner) return null;
    if (element.matches('header, hgroup') && element.parentElement !== document.body) return inner;
    return element.textContent?.trim() === inner.textContent?.trim() ? inner : null;
  };

  /** The top of the heading of what `node` is in, in page pixels: from its element up to the body,
   * the nearest heading that shows among the elements before it, a card's title, a section's
   * heading; or the heading `node` is in, which says itself where it is. None with no heading before
   * it. The elements before it are its own, not inside one beside it: a card's neighbour has a title
   * of its own, which does not name this one. */
  const headingAbove = (node: Node): number | undefined => {
    const topOf = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return rect.height ? rect.top + window.scrollY : undefined;
    };
    for (
      let element = node instanceof Element ? node : shownIn(node);
      element && element !== document.body;
      element = shownIn(element)
    ) {
      if (element.matches(HEADINGS)) return topOf(element);
      for (let before = element.previousElementSibling; before; before = before.previousElementSibling) {
        const heading = headingIn(before);
        const top = heading && topOf(heading);
        if (top !== undefined && top !== null) return top;
      }
    }
    return undefined;
  };

  /** Where each line of each token is on the page. */
  const textLines = (tokens: Token[]): Region[] =>
    tokens.flatMap(token =>
      [...rangeOf(token).getClientRects()].filter(rect => rect.height).map(rect => pageRegion([rect])),
    );

  /** Whether a shot edge at `y` would cut through `line`. */
  const cuts = (line: Region, y: number) => line.top < y && y < line.bottom;

  /** Where a shot's top goes to start above the line at `lineTop`: SNAP_CLEARANCE off it, or halfway
   * to the line above when that is nearer. */
  const clearAbove = (lineTop: number, lines: Region[]) => {
    let above = lineTop - 2 * SNAP_CLEARANCE;
    for (const l of lines) if (l.bottom <= lineTop && l.bottom > above) above = l.bottom;
    return (above + lineTop) / 2;
  };

  /** The stretch of each item: a run of lines of text of one block, one right after the other, from
   * its first line to its last. A block with text before and after something it holds, a list
   * say, is an item for each, not one that takes in all the list. */
  const itemsOfText = (): Region[] => {
    const byBlock = new Map<Element, Region[]>();
    for (const token of allTokens) {
      const block = blockOf(token);
      if (!block) continue;
      // Only what shows: text a scroll area hides runs on down the page, where nothing of it is.
      const lines = byBlock.get(block) ?? [];
      lines.push(...shownRectsOf(token).map(rect => pageRegion([rect])));
      byBlock.set(block, lines);
    }
    return [...byBlock.values()].flatMap(lines => {
      const items: Region[] = [];
      for (const line of lines.sort((p, q) => p.top - q.top)) {
        const last = items.at(-1);
        // The next line of the same item starts within a line's height of the one before it ends.
        if (last && line.top - last.bottom <= line.bottom - line.top)
          last.bottom = Math.max(last.bottom, line.bottom);
        else items.push({ ...line });
      }
      return items;
    });
  };

  /** A shot's top `y` moved off the inside of an item: up to the item's start when the shot has `room`
   * for that, the clearance above it included, or else down to the start of the next item, when that
   * is no lower than `keep`, the top of what the shot is of. Where neither goes, the item is the
   * change's own: `y` stays. */
  const outOfItem = (y: number, room: number, keep: number, lines: Region[]): number => {
    const items = itemsOfText();
    const inside = items.filter(item => item.top < y && y < item.bottom);
    const reach = inside.filter(item => y - clearAbove(item.top, lines) <= room);
    if (reach.length) return clearAbove(Math.min(...reach.map(item => item.top)), lines);
    const next = items.filter(item => item.top > y && item.top <= keep).map(item => item.top);
    return inside.length && next.length ? clearAbove(Math.min(...next), lines) : y;
  };

  // The elements --ignore names, each selector's: they, and all inside them, are not read, so
  // nothing in them is compared or marked.
  const ignoredBy = ignore.map(selector => [...document.querySelectorAll(selector)]);
  const ignored = new Set(ignoredBy.flat());
  const { words, tokens } = readWords(ignored);
  const allTokens = ignored.size ? readWords(new Set()).tokens : tokens; // a shot edge cuts no text, ignored or not
  const { elements, domElements } = readElements(properties, tokenRanges(tokens));

  return {
    /** The page's words, where each shows, and its elements, read before anything was drawn over
     * it, and its width. */
    reading: {
      words,
      // Where each word shows, its first line: what lines up the shots of the two pages.
      places: tokens.map(token => {
        const [shown] = shownRectsOf(token);
        return shown ? pageRegion([shown]) : null;
      }),
      elements,
      width: document.documentElement.clientWidth,
      ignored: ignoredBy.map(found => found.length), // how many elements each --ignore selector matched
    },

    /** Element `index` of the reading, for a shot of its own pixels; only before the page is marked. */
    element(index: number): Element {
      if (marked)
        throw new Error("an element's pixels are only given before anything is drawn over the page");
      return domElements[index];
    },

    /** Box the changed words, box the elements whose look changed, and say where each is. */
    mark(marks: Marks): Spans {
      marked = true;
      const outlines = outlineImages(marks, tokens);
      const under = overlay(); // the areas left out, under the changes' marks
      const layer = overlay();
      const removing = (drawn: Element[]) => drawn.map(element => () => element.remove());
      // In the element's tree, the shadow trees inside it included, wherever layout puts it: an
      // ancestor around it, or a column beside it, is outside.
      const scope = marks.within ? document.querySelector(marks.within) : null;
      const inside = (nodes: Node[]) => !marks.within || nodes.some(node => !!scope && inTreeOf(scope, node));
      const tokenRects = tokens.map(rectsOf);
      const wordBoxes: Element[] = [];
      const words = marks.words.map((change, i) => {
        const drawn: Element[] = [];
        const span = boxWords(change, tokens, tokenRects, layer, marks.color, drawn);
        wordBoxes.push(...drawn);
        undo.words.push([...outlines[i], ...removing(drawn)]);
        const nodes = change.changed
          .map(t => tokens[t])
          .map(token => ('image' in token ? token.image : token.node));
        // Where the change is, or with none of it on this page, the nearest unchanged word before it.
        const at = change.changed[0] ?? change.anchors[0];
        const token: Token | undefined = tokens[at];
        const node = token && ('image' in token ? token.image : token.node);
        return span && { ...span, inside: inside(nodes), heading: node && headingAbove(node) };
      });
      // What a label should not hide: the page's words and images, and the labels placed before it;
      // and, less, the lines of every box: the words', the looks', and the areas left out.
      const boxes = [
        ...wordBoxes.map(element => pageBox(element.getBoundingClientRect())),
        ...marks.looks.flatMap(look => {
          const element = domElements[look.index];
          const box = look.badge && element ? lookBox(element) : null;
          return box ? [box] : [];
        }),
        ...(showIgnored ? ignoredBoxes().map(area => area.box) : []),
      ];
      const avoid: Avoid = { taken: tokenRects.flat().map(pageBox), lines: boxes.flatMap(edgesOf) };
      const looks = marks.looks.map(look => {
        const drawn: HTMLElement[] = [];
        const element: Element | undefined = domElements[look.index];
        const span =
          look.badge && element
            ? boxLook(look.badge, element, layer, marks.color, drawn, avoid)
            : placeAt(element, look.edge ?? 'top', look.beside);
        undo.looks.push(removing(drawn));
        return {
          ...span,
          inside: inside(element ? [element] : []),
          heading: element && headingAbove(element),
        };
      });
      if (showIgnored) drawIgnored(under, avoid);
      return { words, looks };
    },

    /** Take back what mark() drew for these changes, indexes into its marks' words and looks: for
     * the changes no shot is about, which a shot of another change could otherwise show. */
    unmark(changes: { words: number[]; looks: number[] }) {
      for (const i of changes.words) for (const take of undo.words[i] ?? []) take();
      for (const i of changes.looks) for (const take of undo.looks[i] ?? []) take();
    },

    /** Where `selector`'s element is, across and down, or null when it is not there. */
    region(selector: string): Area | null {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect
        ? { ...pageRegion([rect]), left: rect.left + window.scrollX, right: rect.right + window.scrollX }
        : null;
    },

    /** The region with its edges moved out of any line of text they would cut: the top up, the
     * bottom down, SNAP_CLEARANCE off the line, or halfway to the next line when that is nearer:
     * lines of text often leave less room than that between them, and an edge moved into the next
     * line would go on down the whole paragraph. Moving an edge can land it inside another line, of
     * another column, so it repeats until neither moves. With `room` and `keep`, the top also leaves
     * the inside of an item, so a shot does not open on the tail of one: see outOfItem(). */
    snap(shot: Region & { room?: number; keep?: number }): Region {
      const lines = textLines(allTokens);
      let { top, bottom } = shot;
      if (shot.room !== undefined && shot.keep !== undefined)
        top = outOfItem(top, shot.room, shot.keep, lines);
      let moved: boolean;
      do {
        moved = false;
        for (const line of lines) {
          if (cuts(line, top)) {
            top = clearAbove(line.top, lines);
            moved = true;
          }
          if (cuts(line, bottom)) {
            let below = line.bottom + 2 * SNAP_CLEARANCE;
            for (const l of lines) if (l.top >= line.bottom && l.top < below) below = l.top;
            bottom = (line.bottom + below) / 2;
            moved = true;
          }
        }
      } while (moved);
      return { top: Math.max(0, top), bottom };
    },
  };
}

/** The page's interface, as runtime() returns it. */
export type Runtime = ReturnType<typeof runtime>;
