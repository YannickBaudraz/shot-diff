// The code that runs inside each page. Playwright sends a function's source to the page, not its
// closure, so runtime() stands alone: no imports at run time, nothing from outside its body. It
// reads the page and returns the page's interface; loaded.ts installs it once per page and calls it.

import type { ElementInfo } from '../changes/looks.ts';
import type { Area, Box, Region, Span } from '../geometry.ts';

/** What to draw on a page. */
export type Marks = {
  color: string; // the boxes and the labels
  within: string | null; // a selector: say of each change whether it is inside the element it matches
  /** Of two boxes one inside the other, what is drawn: both (the default), the outer one round the
   * inner one; the inner one, what changed in a component; or the outer one, the component. Nothing
   * crosses either way. A word box always stays: a restyle round it that gives way puts its label
   * on the word box. */
  nested?: Nested;
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

/** Which of two boxes, one inside the other, are drawn. */
export type Nested = 'both' | 'inner' | 'outer';

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
  // The share of a block's words a change cut by unchanged ones takes for one box round the whole
  // block: past it, the few words left unchanged would only cut the change into slivers, each with
  // its own box.
  const MOSTLY = 0.5;
  const APART = 3; // between the lines of two boxes side by side
  const NEST = 8; // between an inner box, or its label, and the line of the box round it
  const LARGE = 60; // an inner box this wide and tall can be drawn inside what it marks, for room
  const SMALLEST = 16; // how narrow or short a large inner box drawn inside what it marks can get
  // How far above the outer box's top a label inside it, at its top, can start: still inside it.
  const TAG_ABOVE = 1;

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

  // A part of the page a change is in, to name with --selector: no wider than this share of the
  // page, so a shot of it is narrower than the page, and no narrower than a small card.
  const AREA = { share: 0.6, min: 200 };

  /** A selector that finds `element` alone: its id, or its way down from the nearest id above it, or
   * from the body. None for an element in a shadow tree, which no selector reaches from the page. */
  const selectorOf = (element: Element): string | null => {
    const alone = (selector: string, target: Element) => {
      try {
        const found = document.querySelectorAll(selector);
        return found.length === 1 && found[0] === target;
      } catch {
        return false; // not a selector the page takes: there is none to give
      }
    };
    const byId = (target: Element) => {
      const selector = target.id ? `#${CSS.escape(target.id)}` : null;
      return selector && alone(selector, target) ? selector : null;
    };
    const steps: string[] = [];
    for (let at: Element | null = element; at; at = at.parentElement) {
      const start = at === document.body ? 'body' : byId(at);
      if (start) {
        const selector = [start, ...steps].join(' > ');
        return alone(selector, element) ? selector : null;
      }
      const index = [...(at.parentElement?.children ?? [])].indexOf(at) + 1;
      steps.unshift(`${CSS.escape(at.localName)}:nth-child(${index})`); // a tag can have a colon in it, as o:p
    }
    return null;
  };

  /** The part of the page `node` is in, as a selector: the widest element around it that is still
   * narrower than the page, a card or a column, whose shot is cut to it; with none, the nearest
   * element around it with an id. Undefined when there is neither. */
  const areaOf = (node: Node): string | undefined => {
    const around: Element[] = [];
    for (
      let at = node instanceof Element ? node : shownIn(node);
      at && at !== document.body;
      at = shownIn(at)
    )
      if (at.getRootNode() === document) around.push(at);
    const page = document.documentElement.clientWidth;
    const narrow = around.filter(element => {
      const { width } = element.getBoundingClientRect();
      const inLine = ['inline', 'contents'].includes(getComputedStyle(element).display);
      return !inLine && width >= AREA.min && width <= page * AREA.share;
    });
    const named = around.filter(element => element.id);
    for (const element of [...narrow.reverse(), ...named]) {
      const selector = selectorOf(element);
      if (selector) return selector;
    }
    return undefined;
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

  /** The element itself when it is a block of its own, else the nearest block around it: an icon
   * or a few words in a line are part of the line's block. */
  const blockAround = (element: Element): Element | null => {
    let block: Element | null = element;
    while (block && /^(inline|contents)/.test(getComputedStyle(block).display)) block = shownIn(block);
    return block;
  };

  let blockSizes: Map<Element, number> | null = null;
  /** The changed words of each block, of every word change on this page, in order: set by mark(). */
  let changedIn = new Map<Element, number[]>();
  /** The block each word box is in. */
  const wordBlocks = new WeakMap<Element, Element | null>();
  /** The line boxes of each outline over several lines: what it goes round, which its rectangle is not. */
  const wordRuns = new WeakMap<Element, Box[]>();

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
   * top to bottom, and whether the change takes all of the block's words. When the changes in a
   * block, this one alone or with others, take most of its words, MOSTLY, cut in several stretches
   * by unchanged ones, the change is given all of them, the unchanged ones too, and is whole: one
   * box round the block says it changed, where a box round each stretch would cut it into slivers.
   * One stretch keeps its outline round its words alone. */
  const blocksOf = (
    changed: number[],
    tokens: Token[],
  ): { lines: DOMRect[][]; whole: boolean; own: Set<number>; block: Element | null }[] => {
    const byBlock = new Map<Element | null, number[]>();
    for (const i of changed) {
      const block = blockOf(tokens[i]);
      byBlock.set(block, [...(byBlock.get(block) ?? []), i]);
    }
    return [...byBlock].flatMap(([block, indexes]) => {
      const size = block ? sizeOfBlock(block) : 0;
      const all = (block && changedIn.get(block)) || indexes;
      const cut = all.some((index, i) => i > 0 && index !== all[i - 1] + 1);
      const mostly = !!block && cut && size > all.length && all.length >= MOSTLY * size;
      const taken = mostly ? tokens.flatMap((token, i) => (blockOf(token) === block ? [i] : [])) : indexes;
      const lines = linesOf(taken.flatMap(i => shownRectsOf(tokens[i])));
      const whole = !!block && (mostly || indexes.length === size);
      return lines.length ? [{ lines, whole, own: new Set(taken), block }] : [];
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
    const draw = (run: Box[]) => {
      if (run.length === 1) return drawBox(layer, color, run[0], lineFor(run));
      const outline = drawOutline(layer, color, run, lineFor(run).tint);
      wordRuns.set(outline, run);
      return outline;
    };
    const elements = blocksOf(change.changed, tokens).flatMap(({ lines, whole, own, block }) => {
      const drawnIn = (element: HTMLElement | SVGElement) => {
        wordBlocks.set(element, block);
        return element;
      };
      // All the words of a block: one box around them, as there is no unchanged word for it to run through.
      if (whole) {
        const outside = tokenRects.flatMap((rects, i) => (changed.has(i) || own.has(i) ? [] : rects));
        return [drawnIn(draw([wordBox(lines.flat(), outside)]))];
      }
      return runsOf(
        lines.map(line => wordBox(line, others)),
        others,
      ).map(run => drawnIn(draw(run)));
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
  const lookBox = (element: Element, plain = false): Box | null => {
    const rect = contentRect(element, !plain);
    const clipper = getComputedStyle(element).position === 'fixed' ? null : shownIn(element);
    const shown = shownPart(rect, clipper);
    return shown && onPage(grow(pageBox(shown), BOX.margin));
  };

  /** What shows of an element that draws nothing of its own, no background, border or shadow: the
   * rectangle round what is inside it. An element added round a button, wide as the page, is
   * boxed round the button, not across the heading beside it. One that draws something, or holds
   * nothing that shows, is its own rectangle. With `spill`, any element's own rectangle and the
   * words inside it that show past its edges: a title set on a frame's border, half above it, is
   * inside the frame's box, not under its line. */
  const contentRect = (element: Element, spill = false): DOMRect => {
    const own = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const paints =
      !/rgba\(.*,\s*0\)$|transparent/.test(style.backgroundColor) ||
      style.backgroundImage !== 'none' ||
      style.boxShadow !== 'none' ||
      ['Top', 'Right', 'Bottom', 'Left'].some(
        side =>
          parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
          style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none',
      );
    if (paints && !spill) return own;
    // A word shown past the element's edges that its box takes in: one on the page, where the page
    // can be scrolled to, and one in the flow, or set over the element's edge. A skip link moved off
    // the page, or a word placed out of the flow away from the element, is not part of its look.
    const spills = (rect: DOMRect, node: Node) => {
      const page = document.documentElement;
      const [left, top] = [-window.scrollX, -window.scrollY];
      const [right, bottom] = [page.scrollWidth + left, page.scrollHeight + top];
      if (rect.right <= left || rect.left >= right || rect.bottom <= top || rect.top >= bottom) return false;
      const apart =
        rect.right <= own.left || rect.left >= own.right || rect.bottom <= own.top || rect.top >= own.bottom;
      if (!apart) return true;
      for (let at = shownIn(node); at && at !== element; at = shownIn(at))
        if (['absolute', 'fixed'].includes(getComputedStyle(at).position)) return false;
      return true;
    };
    // What shows inside it: its words, and the elements that draw, each only where it is seen; a
    // closed fold's content still has boxes, unseen.
    const inside: DOMRect[] = [];
    const seen = (node: Element) => node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    walk(element, node => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (showsText(shownIn(node)) && node.textContent?.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const clipper = shownIn(node);
          const rects = [...range.getClientRects()].flatMap(rect => shownPart(rect, clipper) ?? []);
          inside.push(...(spill ? rects.filter(rect => spills(rect, node)) : rects));
        }
        return false;
      }
      if (!(node instanceof Element)) return false;
      const look = getComputedStyle(node);
      if (look.display === 'contents') return true; // no box of its own: what is in it is asked
      if (!seen(node)) return false;
      const draws =
        ['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(
          node.tagName.toUpperCase(),
        ) ||
        !/rgba\(.*,\s*0\)$|transparent/.test(look.backgroundColor) ||
        look.borderTopStyle !== 'none' ||
        look.display === 'table-cell'; // a row added is as wide as its cells, not its words
      const shownRect =
        draws && node !== element ? shownPart(node.getBoundingClientRect(), shownIn(node)) : null;
      if (shownRect && !spill) inside.push(shownRect);
      return true;
    });
    const shown = inside.filter(r => r.width && r.height);
    if (!shown.length) return own;
    inside.length = 0;
    inside.push(...shown);
    const left = Math.min(...inside.map(r => r.left));
    const top = Math.min(...inside.map(r => r.top));
    const right = Math.max(...inside.map(r => r.right));
    const bottom = Math.max(...inside.map(r => r.bottom));
    if (!spill) return new DOMRect(left, top, right - left, bottom - top);
    const [x, y] = [Math.min(left, own.left), Math.min(top, own.top)];
    return new DOMRect(x, y, Math.max(right, own.right) - x, Math.max(bottom, own.bottom) - y);
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

  /** What changed, on a tag by the box, where it hides the least of `taken`: it is added to them.
   * `border` is how thick the line of `boxElement` is, which the tag is placed inside. */
  const drawLabel = (
    boxElement: HTMLElement,
    label: string,
    color: string,
    box: Box,
    avoid: Avoid,
    border: number = BOX.border,
  ) => {
    const tag = document.createElement('div');
    tag.textContent = label;
    tag.style.cssText =
      // Over every box: a box drawn after this one, or a box round it, never crosses its words.
      `position:absolute;z-index:1;left:0;top:0;padding:${LABEL.padding};` +
      `border-radius:${BOX.radius}px;white-space:nowrap;background:${color};color:${ON_COLOR};font:${LABEL.font}`;
    boxElement.appendChild(tag);
    const { width, height } = tag.getBoundingClientRect();
    const place = labelPlace(box, width, height, avoid);
    // From the inside of the box's border, which is what a tag inside the box is placed from.
    tag.style.left = `${place.x - box.x - border}px`;
    tag.style.top = `${place.y - box.y - border}px`;
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
    const box = lookBox(element, 'plain' in badgeOf);
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

  /** A box mark() drew: its element, where it is, the changes it is of, its label, whether it is a
   * word box, which a box round it and another keeps the look of when both are, and whether it is
   * firm: a word box, or a component added or removed, or a box round one of those: hidden, its
   * change would show nowhere, where a restyle's box hidden leaves the boxes inside it to show. */
  type Drawn = {
    element: HTMLElement | SVGElement;
    box: Box;
    of: { words: number[]; looks: number[] };
    label: string | null;
    word: boolean;
    firm: boolean;
    lines?: Box[]; // an outline's line boxes: it goes round them, not round all of its rectangle
    target?: Element; // the element a change of look's box is round
    block: Element | null; // the block its words are in, or its element
    pinned: Element | null; // the element fixed or sticky on the page that it is in, if any
  };

  /** The nearest element around `element`, or itself, that stays put on the screen while the page
   * scrolls under it, fixed or sticky; null for one that scrolls with the page. */
  const pinnedIn = (element: Element | null): Element | null => {
    for (let around = element; around; around = shownIn(around))
      if (['fixed', 'sticky'].includes(getComputedStyle(around).position)) return around;
    return null;
  };

  /** Whether `inner` is inside `outer`, up to touching. */
  const within = (inner: Box, outer: Box) =>
    inner.x >= outer.x - TOUCHING &&
    inner.y >= outer.y - TOUCHING &&
    inner.x + inner.width <= outer.x + outer.width + TOUCHING &&
    inner.y + inner.height <= outer.y + outer.height + TOUCHING;

  /** The boxes drawn, tidied so that no two cross. Of two one inside the other, a firm outer box
   * stays and the inner one gives way; round a restyle, both stay with `nested` both, the outer
   * one going round the inner one without crossing it, or one gives way: the outer one with
   * inner, or when the inner one is firm, else the inner one, whose label the outer one then says
   * as well. A word box always stays: a restyle round it that cannot be kept off it, or that
   * `nested` does not keep with it, gives way, and the word box says the restyle's label. Two that
   * run into each other, neither inside the other, give way to one box round both, which says what
   * both said. A box that gives way is hidden, not removed, so unmark() still takes it back with
   * its change; a box round others goes once every change it is of is taken back. Gives, for each
   * box drawn, where the box that now shows its change is, its label included. */
  const tidy = (
    drawn: Drawn[],
    layer: HTMLElement,
    color: string,
    avoid: Avoid,
    nested: Nested,
  ): ((drawn: Drawn) => Box[]) => {
    let shown = [...drawn];
    // The box that shows a hidden box's change in its place: the box round it and others, or the
    // word box that says a restyle's label. A box hidden inside a component is not shown by it.
    const shownBy = new Map<Drawn, Drawn>();
    // The labels put on a box after it was drawn: a word box's that a restyle round it gave way to.
    const tags = new Map<Drawn, HTMLElement>();
    const pageRight = document.documentElement.clientWidth - BOX.ring;
    const kinds = ['words', 'looks'] as const;
    const said = (labels: (string | null)[]) =>
      [...new Set(labels.flatMap(label => (label ? label.split(', ') : [])))].join(', ') || null;
    // When a change is taken back, `then` runs: a box `drawn` hid shows again, a box round others goes.
    const whenTaken = (drawn: Drawn, then: () => void) => {
      for (const kind of kinds) for (const i of drawn.of[kind]) (undo[kind][i] ??= []).push(then);
    };
    // A box hidden for others shows again once one of them is taken back, unless its own change was
    // taken back too, which removed it.
    const hide = (gone: Drawn, by: Drawn[]) => {
      gone.element.style.display = 'none';
      shown = shown.filter(other => other !== gone);
      for (const other of by)
        whenTaken(other, () => {
          if (gone.element.isConnected) gone.element.style.display = '';
        });
    };
    const replace = (parts: Drawn[], box: Box, label: string | null) => {
      const word = parts.every(part => part.word);
      const element = drawBox(layer, color, box, word ? WORD_BOX : BOX);
      if (label) drawLabel(element, label, color, box, avoid);
      const changes = (kind: (typeof kinds)[number]) => [...new Set(parts.flatMap(part => part.of[kind]))];
      const of = { words: changes('words'), looks: changes('looks') };
      const firm = parts.some(part => part.firm);
      const blocks = parts.map(part => part.block).filter(block => !!block) as Element[];
      const block = blocks.find(one => blocks.every(other => inTreeOf(one, other))) ?? blocks[0] ?? null;
      const round: Drawn = { element, box, of, label, word, firm, block, pinned: parts[0].pinned };
      // The box round them goes as soon as one of their changes is taken back: the others show
      // their own boxes again, which a shot without that change needs.
      whenTaken(round, () => element.remove());
      for (const part of parts) {
        hide(part, [round]);
        shownBy.set(part, round);
      }
      shown.push(round);
    };
    // Two boxes round one element are left as they are: each says one change of it. So are two
    // one inside the other that `nested` keeps both of.
    const apart: Set<Drawn>[] = [];
    const pairOf = (test: (one: Drawn, other: Drawn) => boolean): [Drawn, Drawn] | null => {
      for (const one of shown)
        for (const other of shown)
          if (
            one !== other &&
            one.pinned === other.pinned &&
            (!one.target || one.target !== other.target) &&
            !apart.some(pair => pair.has(one) && pair.has(other)) &&
            test(one, other)
          )
            return [one, other];
      return null;
    };
    // What shows of an element, read once: the page does not move while its boxes are tidied. An
    // element round the overlay, the page's root, has the boxes in it, which do move: it is read
    // each time.
    const contentRects = { plain: new Map<Element, DOMRect>(), spill: new Map<Element, DOMRect>() };
    const contentRectOf = (element: Element, spill = false): DOMRect => {
      if (inTreeOf(element, layer)) return contentRect(element, spill);
      const known = contentRects[spill ? 'spill' : 'plain'];
      const rect = known.get(element) ?? contentRect(element, spill);
      known.set(element, rect);
      return rect;
    };
    // A box can be drawn closer round what it marks, by up to its margin: a change of look's box
    // round its element, a word box of one line round its words. An outline over several lines,
    // or a box round others, cannot.
    const core = (drawn: Drawn): Box => {
      if (drawn.target) return pageBox(contentRectOf(drawn.target, !drawn.firm));
      if (!drawn.word || !(drawn.element instanceof HTMLElement) || drawn.of.words.length !== 1)
        return drawn.box;
      const closer = grow(drawn.box, -WORD_BOX_MARGIN.x, -WORD_BOX_MARGIN.y);
      return { ...closer, width: Math.max(0, closer.width), height: Math.max(0, closer.height) };
    };
    const redraw = (drawn: Drawn, box: Box) => {
      drawn.box = box;
      Object.assign(drawn.element.style, {
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      });
    };
    // Where a box's label is, if it has one.
    const labelBox = (drawn: Drawn): Box | null => {
      const label = tags.get(drawn) ?? drawn.element.querySelector(':scope > div');
      return label ? pageBox(label.getBoundingClientRect()) : null;
    };
    // A box drawn as one rectangle, not an outline over several lines: an outline's path goes round
    // its lines, which moving its rectangle would not move.
    const plain = (drawn: Drawn) => drawn.element instanceof HTMLElement && !drawn.lines;
    // A word box that a restyle round it gave way to says the restyle's label as well, so the change
    // of look is still named. Once the restyle's change is taken back, its label goes with it.
    const sayAlso = (words: Drawn, restyle: Drawn) => {
      hide(restyle, [words]);
      shownBy.set(restyle, words);
      const label = said([words.label, restyle.label]);
      if (!label || label === words.label) return;
      const before = { label: words.label, tag: tags.get(words) };
      // An outline is an SVG, which holds no label: the label goes on the layer, at its corner.
      let host = words.element;
      if (!(host instanceof HTMLElement)) {
        const corner = document.createElement('div');
        corner.style.cssText = `position:absolute;left:${words.box.x}px;top:${words.box.y}px;width:0;height:0`;
        layer.appendChild(corner);
        whenTaken(words, () => corner.remove());
        host = corner;
      }
      const old = before.tag ?? words.element.querySelector<HTMLElement>(':scope > div');
      if (old) old.style.display = 'none';
      const border = host === words.element ? WORD_BOX.border : 0;
      const tag = drawLabel(host as HTMLElement, label, color, words.box, avoid, border);
      words.label = label;
      tags.set(words, tag);
      whenTaken(restyle, () => {
        tag.remove();
        if (old) old.style.display = '';
        words.label = before.label;
        if (before.tag) tags.set(words, before.tag);
        else tags.delete(words);
      });
    };
    // The words the lines of `box` go on, the words under `mine` left out.
    const wordsUnder = (box: Box, mine: Box[]) => {
      const lines = edgesOf(box);
      return avoid.taken.filter(
        word => !mine.some(tag => covers(tag, word)) && lines.some(line => covers(line, word)),
      );
    };
    // An inner box and its label kept NEST off the outer box's lines on every side: two lines close
    // together read as one thick one, and a label over a line hides it. The room is made first by
    // drawing the inner box closer round what it marks, then by drawing the outer box wider, kept
    // on the page, and last by drawing a large inner box inside what it marks. No line is moved
    // onto a word: it would hide it. False, with nothing moved, when there is not room enough so:
    // and when a small inner box has no room, drawn inside what it marks, it would be a sliver.
    const roomIn = (inner: Drawn, outer: Drawn): boolean => {
      if (!plain(inner)) return true;
      const small = Math.min(inner.box.width, inner.box.height) < LARGE;
      const own = core(inner);
      const [innerTag, outerTag] = [labelBox(inner), labelBox(outer)];
      const above = innerTag ? Math.min(0, innerTag.y - inner.box.y) : 0;
      const b = { ...inner.box };
      const o = { ...outer.box };
      const grows = plain(outer);
      const edge = BOX.border + NEST;
      // Their labels: the words under them are not under the lines.
      const mine = [innerTag, outerTag].filter(tag => !!tag) as Box[];
      // How far, up to `most`, a side of `box` moves, `move`, before one of its lines goes on a word
      // they were not on.
      const free = (box: Box, move: (by: number) => Box, most: number) => {
        if (!(most > 0)) return 0;
        const already = new Set(wordsUnder(box, mine));
        let by = 0;
        while (by < most) {
          const next = Math.min(most, by + 1);
          if (wordsUnder(move(next), mine).some(word => !already.has(word))) break;
          by = next;
        }
        return by;
      };
      // A side of `box` moved by `move` as far as it is free to, up to `most`: how far.
      const take = (box: Box, move: (box: Box, by: number) => Box, most: number) => {
        const by = free(box, next => move(box, next), most);
        if (by) Object.assign(box, move(box, by));
        return by;
      };
      type Side = {
        need: () => { short: number; outerMoves: boolean }; // how much room it lacks, read at its turn
        inward: (box: Box, by: number) => Box; // the side moved into the box
        outward: (box: Box, by: number) => Box; // the side moved out of the box
        toCore: () => number; // how far the inner box's side is from what it marks
        toPage: () => number; // how far the outer box's side can go, on the page
        size: () => number; // the inner box's size across this side
      };
      const sides: Side[] = [
        {
          need: () => ({ short: edge - (b.x - o.x), outerMoves: true }),
          inward: (box, by) => ({ ...box, x: box.x + by, width: box.width - by }),
          outward: (box, by) => ({ ...box, x: box.x - by, width: box.width + by }),
          toCore: () => own.x - b.x,
          toPage: () => o.x - BOX.ring,
          size: () => b.width,
        },
        {
          // The top, the label above the box included. A label inside the outer box, at its top (at
          // the top of the page), is part of its top: the inner box stays below it.
          need: () => {
            const tagInside =
              outerTag &&
              outerTag.y >= o.y - TAG_ABOVE &&
              outerTag.y + outerTag.height <= o.y + o.height &&
              outerTag.x < b.x + b.width &&
              outerTag.x + outerTag.width > b.x;
            return tagInside
              ? { short: NEST - (b.y + above - (outerTag.y + outerTag.height)), outerMoves: false }
              : { short: edge - (b.y + above - o.y), outerMoves: true };
          },
          inward: (box, by) => ({ ...box, y: box.y + by, height: box.height - by }),
          outward: (box, by) => ({ ...box, y: box.y - by, height: box.height + by }),
          toCore: () => own.y - b.y,
          toPage: () => o.y - BOX.ring,
          size: () => b.height,
        },
        {
          need: () => ({ short: edge - (o.x + o.width - (b.x + b.width)), outerMoves: true }),
          inward: (box, by) => ({ ...box, width: box.width - by }),
          outward: (box, by) => ({ ...box, width: box.width + by }),
          toCore: () => b.x + b.width - (own.x + own.width),
          toPage: () => pageRight - (o.x + o.width),
          size: () => b.width,
        },
        {
          need: () => ({ short: edge - (o.y + o.height - (b.y + b.height)), outerMoves: true }),
          inward: (box, by) => ({ ...box, height: box.height - by }),
          outward: (box, by) => ({ ...box, height: box.height + by }),
          toCore: () => b.y + b.height - (own.y + own.height),
          toPage: () => Infinity, // the page grows down
          size: () => b.height,
        },
      ];
      // Left, top, right, bottom, each read once the sides before it have moved.
      for (const side of sides) {
        let { short, outerMoves } = side.need();
        short -= take(b, side.inward, Math.min(short, side.toCore()));
        if (grows && outerMoves) short -= take(o, side.outward, Math.min(short, side.toPage()));
        if (short > 0 && small) return false;
        short -= take(b, side.inward, Math.min(short, side.size() - SMALLEST));
        if (short > 0) return false;
      }
      redraw(inner, b);
      if (grows) redraw(outer, o);
      return true;
    };
    // Two boxes that only run into each other by their margins, drawn back from each other along
    // the way they meet least: the facing sides moved to a line between them, each no closer than
    // what it marks, APART where there is room. False when what they mark overlaps, or when one is
    // an outline: it is tested by its lines, which drawing back its rectangle does not move, so the
    // two would go on meeting.
    const drawBack = (one: Drawn, other: Drawn): boolean => {
      if (!plain(one) || !plain(other)) return false;
      const [a, b] = [one.box, other.box];
      const across = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const down = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      const vertical = down <= across;
      const start = (box: Box) => (vertical ? box.y : box.x);
      const size = (box: Box) => (vertical ? box.height : box.width);
      const [first, second] = start(a) <= start(b) ? [one, other] : [other, one];
      const [firstCore, secondCore] = [core(first), core(second)];
      const firstEnd = start(first.box) + size(first.box);
      const secondStart = start(second.box);
      // The facing sides go no further than what each marks.
      const lowest = start(firstCore) + size(firstCore);
      const highest = start(secondCore);
      // What they mark overlaps: one box round both says it. Too close for APART, they are drawn as
      // close as they can be round what they mark, and their lines meet there.
      if (highest - lowest < -TOUCHING) return false;
      const gap = Math.max(0, Math.min(APART, highest - lowest));
      const middle = Math.min(Math.max((firstEnd + secondStart) / 2, lowest + gap / 2), highest - gap / 2);
      const end = Math.min(firstEnd, middle - gap / 2);
      const begin = Math.max(secondStart, middle + gap / 2);
      const moved = (box: Box, from: number, to: number) =>
        vertical ? { ...box, y: from, height: to - from } : { ...box, x: from, width: to - from };
      redraw(first, moved(first.box, start(first.box), end));
      redraw(second, moved(second.box, begin, start(second.box) + size(second.box)));
      return true;
    };
    // An outline over several lines is tested by its lines: a box in the empty corner of its
    // rectangle is neither inside it nor running into it.
    const pieces = (drawn: Drawn) => drawn.lines ?? [drawn.box];
    const inside = (inner: Drawn, outer: Drawn) =>
      pieces(inner).every(piece => pieces(outer).some(other => within(piece, other)));
    const meet = (one: Drawn, other: Drawn) =>
      pieces(one).some(piece => pieces(other).some(theirs => covers(piece, theirs)));
    // A component added or removed: its plain box says the whole of it changed.
    const component = (drawn: Drawn) => !!drawn.target && drawn.firm;
    // Each turn keeps a pair apart, hides a box, or draws two back off each other: a pair kept apart
    // stays so, boxes hidden are not shown again, and boxes drawn back no longer meet. However many
    // boxes, the turns end; past this many, something is wrong, and the boxes stay as they are.
    let turns = 16 * (drawn.length + 1) ** 2;
    while (turns-- > 0) {
      const nest = pairOf(inside);
      if (nest) {
        // Two boxes of the same size are each inside the other: the inner one is the element inside.
        if (
          inside(nest[1], nest[0]) &&
          nest[0].target &&
          nest[1].target &&
          inTreeOf(nest[0].target, nest[1].target)
        )
          nest.reverse();
        const [inner, outer] = nest;
        // A word box in a restyle: the word box stays, and says the restyle's label too when the
        // restyle's box cannot be kept off it, or `nested` keeps only one.
        if (inner.word && inner.firm && !outer.firm) {
          if (nested === 'both' && roomIn(inner, outer)) apart.push(new Set(nest));
          else sayAlso(inner, outer);
          continue;
        }
        const merge = () => replace([outer, inner], outer.box, said([outer.label, inner.label]));
        // A restyle's label inside a word box, or a box round others, says what nothing else
        // says: both stay. Inside a component, nothing else is marked. Round a restyle, `nested`
        // 'both' keeps both. Two boxes with no room between them become one, which says what both
        // said.
        const both = outer.firm ? !component(outer) && !!inner.label : nested === 'both';
        if (both) {
          if (roomIn(inner, outer)) apart.push(new Set(nest));
          else merge();
        } else if (outer.firm) hide(inner, [outer]);
        else if (nested === 'inner' || inner.firm) hide(outer, [inner]);
        else if (inner.label && said([outer.label, inner.label]) !== outer.label) merge();
        else hide(inner, [outer]);
        continue;
      }
      const crossing = pairOf(meet);
      if (!crossing) break;
      const [one, other] = crossing;
      const together =
        !!one.block &&
        !!other.block &&
        (inTreeOf(one.block, other.block) || inTreeOf(other.block, one.block));
      // A component added in a block with changed words beside it says, with them, that the block
      // changed: one box. Any other two are first drawn back off each other, so each keeps saying
      // its own change, its label and its tint; they give way to one box only when what they mark
      // overlaps.
      if (!(together && (component(one) || component(other))) && drawBack(one, other)) continue;
      // In one block, the box goes across the block, from side to side: ending between the two
      // changes, it would cut a word in two. Down, it goes no further than the two boxes.
      const outer = together && (inTreeOf(one.block!, other.block!) ? one.block! : other.block!);
      const across = outer ? [grow(pageBox(contentRectOf(outer)), BOX.margin)] : [];
      const all = [one.box, other.box];
      const left = Math.min(...[...all, ...across].map(box => box.x));
      const top = Math.min(...all.map(box => box.y));
      const right = Math.max(...[...all, ...across].map(box => box.x + box.width));
      const bottom = Math.max(...all.map(box => box.y + box.height));
      replace(
        [one, other],
        { x: left, y: top, width: right - left, height: bottom - top },
        said([one.label, other.label]),
      );
    }
    return (drawn: Drawn) => {
      let at = drawn;
      while (!shown.includes(at) && shownBy.has(at)) at = shownBy.get(at)!;
      if (!shown.includes(at)) return [];
      const tag = labelBox(at);
      return [pageBox(at.element.getBoundingClientRect()), ...(tag ? [tag] : [])];
    };
  };

  /** `span` grown to take in `boxes`, in page pixels: what it says shows, and how far across. A
   * span with nothing of its change shown has no box to grow by. */
  const widen = (span: Span | null, boxes: Box[]) => {
    if (!span?.changed || !boxes.length) return;
    const top = Math.max(0, Math.min(...boxes.map(box => box.y)));
    const bottom = Math.max(...boxes.map(box => box.y + box.height));
    const left = Math.min(...boxes.map(box => box.x));
    const right = Math.max(...boxes.map(box => box.x + box.width));
    span.top = Math.min(span.top, top);
    span.bottom = Math.max(span.bottom, bottom);
    span.changed = { top: Math.min(span.changed.top, top), bottom: Math.max(span.changed.bottom, bottom) };
    span.across = span.across
      ? { left: Math.min(span.across.left, left), right: Math.max(span.across.right, right) }
      : { left, right };
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
   * is no lower than `keep`, the top of what the shot is of, or to the room between the item's end and
   * `keep`. Where none goes, the item is the change's own: `y` stays. */
  const outOfItem = (y: number, room: number, keep: number, lines: Region[]): number => {
    const items = itemsOfText();
    const inside = items.filter(item => item.top < y && y < item.bottom);
    const reach = inside.filter(item => y - clearAbove(item.top, lines) <= room);
    if (reach.length) return clearAbove(Math.min(...reach.map(item => item.top)), lines);
    if (!inside.length) return y;
    const next = items.filter(item => item.top > y && item.top <= keep).map(item => item.top);
    if (next.length) return clearAbove(Math.min(...next), lines);
    // No item starts by `keep`, but the ones `y` is in end before it: what is kept starts above its
    // own first line, as the box around an item does. The top goes right above it, its ring in: a
    // box around the item before can end a few pixels higher, and would show as a sliver.
    const end = Math.max(...inside.map(item => item.bottom));
    return end <= keep ? Math.max(end, keep - BOX.ring) : y;
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
      changedIn = new Map();
      for (const index of marks.words.flatMap(change => change.changed).sort((x, y) => x - y)) {
        const block = blockOf(tokens[index]);
        if (block) changedIn.set(block, [...(changedIn.get(block) ?? []), index]);
      }
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
      const boxed: Drawn[] = [];
      const words = marks.words.map((change, i) => {
        const drawn: Element[] = [];
        const span = boxWords(change, tokens, tokenRects, layer, marks.color, drawn);
        wordBoxes.push(...drawn);
        for (const element of drawn)
          boxed.push({
            element: element as HTMLElement | SVGElement,
            box: pageBox(element.getBoundingClientRect()),
            of: { words: [i], looks: [] },
            label: null,
            word: true,
            firm: true,
            block: wordBlocks.get(element) ?? null,
            pinned: pinnedIn(wordBlocks.get(element) ?? null),
            lines: wordRuns.get(element),
          });
        undo.words.push([...outlines[i], ...removing(drawn)]);
        const nodes = change.changed
          .map(t => tokens[t])
          .map(token => ('image' in token ? token.image : token.node));
        // Where the change is, or with none of it on this page, the nearest unchanged word before it.
        const at = change.changed[0] ?? change.anchors[0];
        const token: Token | undefined = tokens[at];
        const node = token && ('image' in token ? token.image : token.node);
        return (
          span && {
            ...span,
            inside: inside(nodes),
            heading: node && headingAbove(node),
            area: node && areaOf(node),
          }
        );
      });
      // What a label should not hide: the page's words and images, and the labels placed before it;
      // and, less, the lines of every box: the words', the looks', and the areas left out.
      const boxes = [
        ...wordBoxes.map(element => pageBox(element.getBoundingClientRect())),
        ...marks.looks.flatMap(look => {
          const element = domElements[look.index];
          const box = look.badge && element ? lookBox(element, 'plain' in look.badge) : null;
          return box ? [box] : [];
        }),
        ...(showIgnored ? ignoredBoxes().map(area => area.box) : []),
      ];
      const avoid: Avoid = { taken: tokenRects.flat().map(pageBox), lines: boxes.flatMap(edgesOf) };
      const looks = marks.looks.map((look, i) => {
        const drawn: HTMLElement[] = [];
        const element: Element | undefined = domElements[look.index];
        const span =
          look.badge && element
            ? boxLook(look.badge, element, layer, marks.color, drawn, avoid)
            : placeAt(element, look.edge ?? 'top', look.beside);
        undo.looks.push(removing(drawn));
        // A box with a disc on it is not tidied: its number must stay where the band's key says.
        if (drawn.length && look.badge && !('disc' in look.badge))
          boxed.push({
            element: drawn[0],
            box: pageBox(drawn[0].getBoundingClientRect()),
            of: { words: [], looks: [i] },
            label: 'label' in look.badge ? look.badge.label : null,
            word: false,
            firm: 'plain' in look.badge,
            target: element,
            block: blockAround(element),
            pinned: pinnedIn(element),
          });
        return {
          ...span,
          inside: inside(element ? [element] : []),
          heading: element && headingAbove(element),
          area: element && areaOf(element),
        };
      });
      const showing = tidy(boxed, layer, marks.color, avoid, marks.nested ?? 'both');
      // Tidying can widen a box, put one round others, or add a label: each change's place takes in
      // what now shows it, so a shot cut close to it cuts none of that. A place only grows.
      for (const box of boxed) {
        const now = showing(box);
        for (const i of box.of.words) widen(words[i], now);
        for (const i of box.of.looks) widen(looks[i], now);
      }
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
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return element && rect
        ? {
            ...pageRegion([rect]),
            left: rect.left + window.scrollX,
            right: rect.right + window.scrollX,
            pinned: !!pinnedIn(element),
          }
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
      const offLines = (from: Region): Region => {
        let { top, bottom } = from;
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
      };
      const plain = offLines(shot);
      if (shot.room === undefined || shot.keep === undefined) return plain;
      const { room, keep } = shot;
      // The room is for the whole shot: where the bottom's own move off a line takes it past that,
      // the top goes as with no room at all, down to the next item or not out of its item.
      const fits = (edges: Region) => edges.bottom - edges.top <= shot.bottom - shot.top + room;
      const outWith = (given: number) =>
        offLines({ top: outOfItem(shot.top, given, keep, lines), bottom: shot.bottom });
      const whole = outWith(room);
      return fits(whole) ? whole : outWith(0);
    },
  };
}

/** The page's interface, as runtime() returns it. */
export type Runtime = ReturnType<typeof runtime>;
