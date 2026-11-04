// The code that runs inside each page. Playwright sends a function's source to the page, not its
// closure, so runtime() stands alone: no imports at run time, nothing from outside its body. It
// reads the page and returns the page's interface; loaded.ts installs it once per page and calls it.

import type { ElementInfo } from './looks.ts';

export type Box = { x: number; y: number; width: number; height: number };

/** A stretch of the page, in page pixels. */
export type Region = { top: number; bottom: number };

/** Where one change sits on the page, in page pixels. `top` and `bottom` take in what is shown around
 * it: the unchanged words next to a word change, the label of a box. `changed` is the change alone,
 * null when this page has nothing of a word change. */
export type Span = Region & { changed: Region | null };

/** What to draw on a page. */
export type Marks = {
  color: string; // the boxes, the strike and the labels
  tint: string; // the background behind changed words
  strike: boolean; // strike the changed words through (the before page)
  /** Word changes: the changed tokens and the unchanged ones around them, as indexes into the reading's words. */
  words: { changed: number[]; anchors: number[] }[];
  /** Changes of look: an element, as an index into the reading's elements, and what to put on its
   * box: a label, or a disc. */
  looks: { index: number; badge: { label: string } | { disc: { src: string; size: number } } }[];
};

/** Where each word change and each change of look sits, in the order mark() was given them. */
export type Spans = { words: (Span | null)[]; looks: Span[] };

/** The page's runtime, reading the page's words and the `properties` of its elements before anything
 * is drawn over it. */
export function runtime(properties: string[]) {
  /** A word, as a stretch of a text node, or an image. */
  type Token = { node: Text; start: number; end: number } | { image: Element };

  let marked = false;

  // Sizes in CSS pixels.
  const BOX = { margin: 4, border: 2, radius: 4 }; // margin: between an element and its box
  const LABEL = { height: 22, gap: 2, font: '600 12px/1.4 system-ui,sans-serif', padding: '1px 6px' };
  const IMAGE_OUTLINE = { width: 3, offset: 2 };
  const STRIKE_WIDTH = 2;
  const WORD_BOX_MARGIN = { x: 4, y: 3 }; // between a line of changed words and its box
  const SNAP_CLEARANCE = 6; // between a moved shot edge and the line of text it would have cut
  const ON_COLOR = '#ffffff'; // a label's words: ON_SIDE_COLOR in side.ts, which this code cannot import

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

  /** The token's rectangles on screen, one per line it is on. */
  const rectsOf = (token: Token) => [...rangeOf(token).getClientRects()].filter(r => r.width || r.height);

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

  /** Every visible word and image, in document order. Text with opacity 0 counts as hidden here. */
  const readWords = (): { words: string[]; tokens: Token[] } => {
    const found: Token[] = [];
    const words: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (element.tagName === 'IMG' && element.checkVisibility()) {
          found.push({ image: element });
          words.push(imageWord(element));
        }
        continue;
      }
      const text = node as Text;
      if (!text.parentElement?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      for (const match of text.data.matchAll(/\S+/g)) {
        found.push({ node: text, start: match.index, end: match.index + match[0].length });
        words.push(match[0]);
      }
    }
    return { words, tokens: found };
  };

  /** What pairs an element with its match on the other page: tag, id, role, label, own words, file. */
  const signature = (element: Element) => {
    const ownText = [...element.childNodes]
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent)
      .join(' ');
    const ownWords = ownText.replace(/\s+/g, ' ').trim().slice(0, 80);
    const link = element.getAttribute('src') || element.getAttribute('href') || '';
    const file = link.split(/[?#]/)[0].split('/').pop() || '';
    const role = element.getAttribute('role') || '';
    const label = element.getAttribute('aria-label') || '';
    return [element.tagName, element.id && `#${element.id}`, role, label, ownWords, file]
      .filter(Boolean)
      .join(' ');
  };

  const PAINTERS = new Set(['IMG', 'CANVAS', 'svg', 'VIDEO']);

  /** An element as looks.ts compares it; its parent is filled in by readElements(). */
  const describe = (element: Element, rect: DOMRect, properties: string[]): ElementInfo => {
    const style = getComputedStyle(element);
    const computed = element.computedStyleMap();
    return {
      signature: signature(element),
      tag: element.tagName.toLowerCase(),
      parent: -1,
      leaf: true,
      paints: PAINTERS.has(element.tagName) || style.backgroundImage !== 'none',
      top: pageBox(rect).y,
      width: rect.width,
      height: rect.height,
      // The computed value, as the CSS gave it: `auto` stays `auto`, where getComputedStyle would give
      // the pixels layout made of it, which change with whatever else changed on the page.
      style: Object.fromEntries(
        properties.map(p => [p, (computed.get(p) ?? style.getPropertyValue(p)).toString()]),
      ),
    };
  };

  /** The index of the nearest ancestor already listed, if any. */
  const listedAncestor = (element: Element, indexOf: Map<Element, number>) => {
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const index = indexOf.get(ancestor);
      if (index !== undefined) return index;
    }
    return undefined;
  };

  /** Every visible element, in document order. An element with opacity 0 still counts: its opacity
   * is one of the properties compared. */
  const readElements = (properties: string[]): { elements: ElementInfo[]; domElements: Element[] } => {
    const found: Element[] = [];
    const elements: ElementInfo[] = [];
    const indexOf = new Map<Element, number>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      // An SVG is one picture: its shapes are not elements of their own here.
      acceptNode: node =>
        node.parentElement?.closest('svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node as Element;
      const rect = element.getBoundingClientRect();
      const visible =
        element.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) &&
        rect.width &&
        rect.height;
      if (!visible) continue;
      const info = describe(element, rect, properties);
      const parent = listedAncestor(element, indexOf);
      if (parent !== undefined) {
        info.parent = parent;
        elements[parent].leaf = false;
      }
      indexOf.set(element, elements.length);
      found.push(element);
      elements.push(info);
    }
    return { elements, domElements: found };
  };

  /** A changed image's mark: an outline, which takes no room on the page. */
  const outline = (image: HTMLElement, color: string) => {
    image.style.outline = `${IMAGE_OUTLINE.width}px solid ${color}`;
    image.style.outlineOffset = `${IMAGE_OUTLINE.offset}px`;
  };

  /** Tint the changed words, struck through on the before page: one highlight range per run of
   * tokens in the same text node. A changed image gets an outline instead. */
  const highlight = (marks: Marks, tokens: Token[]) => {
    const ranges: Range[] = [];
    for (const change of marks.words) {
      let run: { node: Text; range: Range } | null = null;
      for (const i of change.changed) {
        const token = tokens[i];
        if ('image' in token) {
          outline(token.image as HTMLElement, marks.color);
          run = null;
        } else if (run && run.node === token.node) {
          run.range.setEnd(token.node, token.end);
        } else {
          run = { node: token.node, range: rangeOf(token) };
          ranges.push(run.range);
        }
      }
    }
    paintHighlight(ranges, marks);
  };

  /** Tint `ranges` with a CSS highlight, which changes nothing the page lays out. */
  const paintHighlight = (ranges: Range[], marks: Marks) => {
    const strike = marks.strike ? `text-decoration:line-through ${STRIKE_WIDTH}px ${marks.color};` : '';
    const style = document.createElement('style');
    style.textContent = `::highlight(shot-diff){background-color:${marks.tint};${strike}}`;
    document.head.appendChild(style);
    CSS.highlights.set('shot-diff', new Highlight(...ranges));
  };

  /** A box drawn on `layer` at `box`, in page pixels. */
  const drawBox = (layer: HTMLElement, color: string, box: Box) => {
    const element = document.createElement('div');
    element.style.cssText =
      `position:absolute;box-sizing:border-box;border:${BOX.border}px solid ${color};border-radius:${BOX.radius}px;` +
      `left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px`;
    layer.appendChild(element);
    return element;
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

  /** Box a word change, one box per line, so a change that wraps gets no box through the words
   * between; and say where it is, with the unchanged words around it. */
  const boxWords = (
    change: Marks['words'][number],
    tokens: Token[],
    layer: HTMLElement,
    color: string,
  ): Span | null => {
    const boxes = linesOf(change.changed.flatMap(i => rectsOf(tokens[i]))).map(line =>
      drawBox(
        layer,
        color,
        grow(pageBox(around(line)), WORD_BOX_MARGIN.x, WORD_BOX_MARGIN.y),
      ).getBoundingClientRect(),
    );
    const shown = [...boxes, ...change.anchors.flatMap(i => rectsOf(tokens[i]))];
    if (!shown.length) return null;
    return { ...inPage(pageRegion(shown)), changed: boxes.length ? inPage(pageRegion(boxes)) : null };
  };

  /** Where a disc goes: on a box's top left corner, kept inside the page. */
  const discCorner = (box: Box, size: number) => ({
    left: Math.max(0, box.x - size / 2),
    top: Math.max(0, box.y - size / 2),
  });

  /** Whether a box's label fits above it, or goes below it for lack of room on the page. */
  const labelFitsAbove = (box: Box) => box.y - LABEL.height >= 0;

  /** A numbered disc on a box's top left corner. */
  const drawDisc = (layer: HTMLElement, disc: { src: string; size: number }, box: Box) => {
    const { left, top } = discCorner(box, disc.size);
    const image = document.createElement('img');
    image.src = disc.src;
    image.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${disc.size}px;height:${disc.size}px`;
    layer.appendChild(image);
    return image;
  };

  /** What changed, on a tag above the box, or below it when the page has no room above. */
  const drawLabel = (boxElement: HTMLElement, label: string, color: string, box: Box) => {
    const place = labelFitsAbove(box)
      ? `bottom:100%;margin-bottom:${LABEL.gap}px`
      : `top:100%;margin-top:${LABEL.gap}px`;
    const tag = document.createElement('div');
    tag.textContent = label;
    tag.style.cssText =
      `position:absolute;left:-${BOX.border}px;${place};padding:${LABEL.padding};` +
      `border-radius:${BOX.radius}px;white-space:nowrap;background:${color};color:${ON_COLOR};font:${LABEL.font}`;
    boxElement.appendChild(tag);
    return tag;
  };

  /** Box an element whose look changed, with its label or its disc, and say where all that is. */
  const boxLook = (
    look: Marks['looks'][number],
    element: Element,
    layer: HTMLElement,
    color: string,
  ): Span => {
    const box = grow(pageBox(element.getBoundingClientRect()), BOX.margin);
    const boxElement = drawBox(layer, color, box);
    const badge =
      'disc' in look.badge
        ? drawDisc(layer, look.badge.disc, box)
        : drawLabel(boxElement, look.badge.label, color, box);
    const drawn = inPage(pageRegion([boxElement, badge].map(drawn => drawn.getBoundingClientRect())));
    return { ...drawn, changed: drawn };
  };

  /** Where each line of each token is on the page. */
  const textLines = (tokens: Token[]): Region[] =>
    tokens.flatMap(token =>
      [...rangeOf(token).getClientRects()].filter(rect => rect.height).map(rect => pageRegion([rect])),
    );

  /** Whether a shot edge at `y` would cut through `line`. */
  const cuts = (line: Region, y: number) => line.top < y && y < line.bottom;

  const { words, tokens } = readWords();
  const { elements, domElements } = readElements(properties);

  return {
    /** The page's words and elements, read before anything was drawn over it, and its width. */
    reading: { words, elements, width: document.documentElement.clientWidth },

    /** Element `index` of the reading, for a shot of its own pixels; only before the page is marked. */
    element(index: number): Element {
      if (marked)
        throw new Error("an element's pixels are only given before anything is drawn over the page");
      return domElements[index];
    },

    /** Tint and box the changed words, box the elements whose look changed, and say where each is. */
    mark(marks: Marks): Spans {
      marked = true;
      highlight(marks, tokens);
      const layer = overlay();
      return {
        words: marks.words.map(change => boxWords(change, tokens, layer, marks.color)),
        looks: marks.looks.map(look => boxLook(look, domElements[look.index], layer, marks.color)),
      };
    },

    /** Where `selector`'s element is, or null when it is not there. */
    region(selector: string): Region | null {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? pageRegion([rect]) : null;
    },

    /** The region with its edges moved out of any line of text they would cut: the top up, the
     * bottom down. Moving an edge can land it inside another line, so it repeats until neither moves. */
    snap(region: Region): Region {
      const lines = textLines(tokens);
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
