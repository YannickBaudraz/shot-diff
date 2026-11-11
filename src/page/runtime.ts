// The code that runs inside each page. Playwright sends a function's source to the page, not its
// closure, so runtime() stands alone: no imports at run time, nothing from outside its body. It
// reads the page and returns the page's interface; loaded.ts installs it once per page and calls it.

import type { ElementInfo } from '../changes/looks.ts';
import type { Box, Region, Span } from '../geometry.ts';

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
export function runtime(properties: string[], ignore: string[] = []) {
  /** A word, as a stretch of a text node, or an image. */
  type Token = { node: Text; start: number; end: number } | { image: Element };

  let marked = false;
  /** How to take back what mark() drew for each change, so unmark() can. */
  const undo: { words: (() => void)[][]; looks: (() => void)[][] } = { words: [], looks: [] };

  // Sizes in CSS pixels.
  // margin: between an element and its box; ring: the white line outside it, which keeps it apart
  // from a background close to its colour
  const BOX = { margin: 8, border: 3, ring: 2, radius: 6 };
  const LABEL = { gap: BOX.border, font: '600 12px/1.4 system-ui,sans-serif', padding: '1px 6px' };
  // How far two boxes go into each other before one covers the other: a line of text's rectangle is
  // taller than its letters, so a label that only touches it hides nothing.
  const TOUCHING = 2;
  const IMAGE_OUTLINE = { width: 3, offset: 2 };
  const WORD_BOX_MARGIN = { x: 4, y: 3 }; // between a line of changed words and its box
  const SNAP_CLEARANCE = 6; // between a moved shot edge and the line of text it would have cut
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
  const drawBox = (layer: HTMLElement, color: string, box: Box) => {
    const element = document.createElement('div');
    element.style.cssText =
      `position:absolute;box-sizing:border-box;border:${BOX.border}px solid ${color};border-radius:${BOX.radius}px;` +
      `box-shadow:0 0 0 ${BOX.ring}px ${ON_COLOR};left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px`;
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

  /** The rectangles to box for a change, a group of them per box: all the words of a block that the
   * change takes entirely make one group, as there is no unchanged word for a box to run through;
   * other words are grouped by the line of text they are on. */
  const groupsOf = (changed: number[], tokens: Token[]): DOMRect[][] => {
    const byBlock = new Map<Element | null, number[]>();
    for (const i of changed) {
      const block = blockOf(tokens[i]);
      byBlock.set(block, [...(byBlock.get(block) ?? []), i]);
    }
    return [...byBlock].flatMap(([block, indexes]) => {
      const rects = indexes.flatMap(i => shownRectsOf(tokens[i]));
      return block && indexes.length === sizeOfBlock(block) && rects.length ? [rects] : linesOf(rects);
    });
  };

  /** Box a word change, one box per line, so a change that wraps gets no box through the words
   * between, or one box for the block it takes entirely; and say where it is, with the unchanged
   * words around it. Each box drawn goes in `drawn`. A changed word that a scroll area cuts off gets
   * no box; with none shown, the change is clipped. */
  const boxWords = (
    change: Marks['words'][number],
    tokens: Token[],
    layer: HTMLElement,
    color: string,
    drawn: HTMLElement[],
  ): Span | null => {
    const elements = groupsOf(change.changed, tokens).map(rects =>
      drawBox(layer, color, onPage(grow(pageBox(around(rects)), WORD_BOX_MARGIN.x, WORD_BOX_MARGIN.y))),
    );
    drawn.push(...elements);
    const boxes = elements.map(element => element.getBoundingClientRect());
    const shown = [...boxes, ...change.anchors.flatMap(i => rectsOf(tokens[i]))];
    if (!shown.length) return null;
    return {
      ...inPage(pageRegion(shown)),
      changed: boxes.length ? inPage(pageRegion(boxes)) : null,
      inside: true,
      clipped: change.changed.length > 0 && !boxes.length,
    };
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
   * then beside it. At the top of the page there is no place above. */
  const labelPlace = (box: Box, width: number, height: number, taken: Box[]): Box => {
    const pageWidth = document.documentElement.clientWidth;
    // Along the box's edge, kept on the page: a box at the page's edge starts a little outside it.
    const left = Math.max(0, box.x);
    const right = Math.max(0, Math.min(box.x + box.width, pageWidth) - width);
    const above = box.y + BOX.border - LABEL.gap - height;
    const below = box.y + box.height - BOX.border + LABEL.gap;
    const beside = box.x + box.width + LABEL.gap;
    const places = [
      ...(above >= 0 ? [{ x: left, y: above }] : []),
      { x: left, y: below },
      ...(above >= 0 ? [{ x: right, y: above }] : []),
      { x: right, y: below },
      ...(beside + width <= pageWidth ? [{ x: beside, y: Math.max(0, box.y) }] : []),
    ].map(corner => ({ ...corner, width, height }));
    const hides = (place: Box) => taken.filter(other => covers(place, other)).length;
    return places.reduce((best, place) => (hides(place) < hides(best) ? place : best));
  };

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
  const drawLabel = (boxElement: HTMLElement, label: string, color: string, box: Box, taken: Box[]) => {
    const tag = document.createElement('div');
    tag.textContent = label;
    tag.style.cssText =
      `position:absolute;left:0;top:0;padding:${LABEL.padding};` +
      `border-radius:${BOX.radius}px;white-space:nowrap;background:${color};color:${ON_COLOR};font:${LABEL.font}`;
    boxElement.appendChild(tag);
    const { width, height } = tag.getBoundingClientRect();
    const place = labelPlace(box, width, height, taken);
    // From the inside of the box's border, which is what a tag inside the box is placed from.
    tag.style.left = `${place.x - box.x - BOX.border}px`;
    tag.style.top = `${place.y - box.y - BOX.border}px`;
    taken.push(place);
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
    taken: Box[],
  ): Span => {
    const rect = element.getBoundingClientRect();
    const clipper = getComputedStyle(element).position === 'fixed' ? null : shownIn(element);
    const shown = shownPart(rect, clipper);
    if (!shown) return { ...inPage(pageRegion([rect])), changed: null, inside: true, clipped: true };
    const box = onPage(grow(pageBox(shown), BOX.margin));
    const boxElement = drawBox(layer, color, box);
    const badge =
      'disc' in badgeOf
        ? drawDisc(layer, badgeOf.disc, box)
        : 'label' in badgeOf
          ? drawLabel(boxElement, badgeOf.label, color, box, taken)
          : boxElement;
    drawn.push(boxElement);
    if (badge.parentElement !== boxElement && badge !== boxElement) drawn.push(badge);
    const region = inPage(pageRegion([boxElement, badge].map(drawn => drawn.getBoundingClientRect())));
    return { ...region, changed: region, inside: true, clipped: false };
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

  /** Where each line of each token is on the page. */
  const textLines = (tokens: Token[]): Region[] =>
    tokens.flatMap(token =>
      [...rangeOf(token).getClientRects()].filter(rect => rect.height).map(rect => pageRegion([rect])),
    );

  /** Whether a shot edge at `y` would cut through `line`. */
  const cuts = (line: Region, y: number) => line.top < y && y < line.bottom;

  // The elements --ignore names, each selector's: they, and all inside them, are not read, so
  // nothing in them is compared or marked.
  const ignoredBy = ignore.map(selector => [...document.querySelectorAll(selector)]);
  const ignored = new Set(ignoredBy.flat());
  const { words, tokens } = readWords(ignored);
  const allTokens = ignored.size ? readWords(new Set()).tokens : tokens; // a shot edge cuts no text, ignored or not
  const { elements, domElements } = readElements(properties, tokenRanges(tokens));

  return {
    /** The page's words and elements, read before anything was drawn over it, and its width. */
    reading: {
      words,
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
      const layer = overlay();
      const removing = (drawn: HTMLElement[]) => drawn.map(element => () => element.remove());
      // In the element's tree, the shadow trees inside it included, wherever layout puts it: an
      // ancestor around it, or a column beside it, is outside.
      const scope = marks.within ? document.querySelector(marks.within) : null;
      const inside = (nodes: Node[]) => !marks.within || nodes.some(node => !!scope && inTreeOf(scope, node));
      const words = marks.words.map((change, i) => {
        const drawn: HTMLElement[] = [];
        const span = boxWords(change, tokens, layer, marks.color, drawn);
        undo.words.push([...outlines[i], ...removing(drawn)]);
        const nodes = change.changed
          .map(t => tokens[t])
          .map(token => ('image' in token ? token.image : token.node));
        return span && { ...span, inside: inside(nodes) };
      });
      // What a label should not hide: the page's words and images, and the labels placed before it.
      const taken = tokens.flatMap(rectsOf).map(pageBox);
      const looks = marks.looks.map(look => {
        const drawn: HTMLElement[] = [];
        const element: Element | undefined = domElements[look.index];
        const span =
          look.badge && element
            ? boxLook(look.badge, element, layer, marks.color, drawn, taken)
            : placeAt(element, look.edge ?? 'top', look.beside);
        undo.looks.push(removing(drawn));
        return { ...span, inside: inside(element ? [element] : []) };
      });
      return { words, looks };
    },

    /** Take back what mark() drew for these changes, indexes into its marks' words and looks: for
     * the changes no shot is about, which a shot of another change could otherwise show. */
    unmark(changes: { words: number[]; looks: number[] }) {
      for (const i of changes.words) for (const take of undo.words[i] ?? []) take();
      for (const i of changes.looks) for (const take of undo.looks[i] ?? []) take();
    },

    /** Where `selector`'s element is, or null when it is not there. */
    region(selector: string): Region | null {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? pageRegion([rect]) : null;
    },

    /** The region with its edges moved out of any line of text they would cut: the top up, the
     * bottom down. Moving an edge can land it inside another line, so it repeats until neither moves. */
    snap(region: Region): Region {
      const lines = textLines(allTokens);
      let { top, bottom } = region;
      let moved: boolean;
      do {
        moved = false;
        for (const line of lines) {
          if (cuts(line, top)) {
            top = line.top - SNAP_CLEARANCE;
            moved = true;
          }
          if (cuts(line, bottom)) {
            bottom = line.bottom + SNAP_CLEARANCE;
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
