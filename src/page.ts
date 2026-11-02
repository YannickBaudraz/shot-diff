// The code that runs inside each page. Playwright sends a function's source to the page, not its
// closure, so runtime() stands alone: no imports at run time, nothing from outside its body. It
// returns the page's interface; loaded.ts installs it once per page and calls it.

import type { ElementInfo } from './looks.ts';

export type Box = { x: number; y: number; width: number; height: number };

/** A stretch of the page, in page pixels. */
export type Region = { top: number; bottom: number };

/** Where one change sits on the page, in page pixels. `top` and `bottom` take in what is shown around
 * it: the unchanged words next to a word change, the label of a box. `changedTop` and `changedBottom`
 * are the change alone, null when this page has nothing of a word change. */
export type Span = { top: number; bottom: number; changedTop: number | null; changedBottom: number | null };

/** What to draw on a page. */
export type Marks = {
  color: string; // the boxes, the strike and the labels
  tint: string; // the background behind changed words
  strike: boolean; // strike the changed words through (the before page)
  /** Word changes: the changed tokens and the unchanged ones around them, as indexes into read()'s words. */
  words: { changed: number[]; anchors: number[] }[];
  /** Changes of look: an element, as an index into read()'s elements, and what to put on its box. */
  looks: { index: number; label: string | null; disc: { src: string; size: number } | null }[];
};

/** Where each word change and each change of look sits, in the order mark() was given them. */
export type Spans = { words: (Span | null)[]; looks: Span[] };

export function runtime() {
  /** A word, as a stretch of a text node, or an image. */
  type Token = { node: Text; start: number; end: number } | { image: Element };

  // What read() found, kept for mark() and snap().
  let tokens: Token[] | null = null;
  let domElements: Element[] | null = null;
  let marked = false;

  const LABEL_HEIGHT = 22; // a label above a box, in CSS pixels
  const BOX_MARGIN = 4; // between an element and its box
  const WORD_BOX_MARGIN = { x: 4, y: 3 }; // between a line of changed words and its box
  const SNAP_CLEARANCE = 6; // between a moved shot edge and the line of text it would have cut

  const stored = () => {
    if (!tokens || !domElements) throw new Error('read() has not run on this page yet');
    return { tokens, domElements };
  };

  const rangeOf = (token: Token) => {
    const range = document.createRange();
    if ('image' in token) range.selectNode(token.image);
    else {
      range.setStart(token.node, token.start);
      range.setEnd(token.node, token.end);
    }
    return range;
  };

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

  /** Every visible word and image, in document order. Text with opacity 0 counts as hidden here. */
  const readWords = (): { words: string[]; tokens: Token[] } => {
    const found: Token[] = [];
    const words: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (element.tagName === 'IMG' && element.checkVisibility()) {
          const name =
            element.getAttribute('alt') || (element.getAttribute('src') || '').split('/').pop() || 'image';
          found.push({ image: element });
          words.push(`[image ${name}]`);
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
      top: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
      // The computed value, as the CSS gave it: `auto` stays `auto`, where getComputedStyle would give
      // the pixels layout made of it, which change with whatever else changed on the page.
      style: Object.fromEntries(
        properties.map(p => [p, (computed.get(p) ?? style.getPropertyValue(p)).toString()]),
      ),
    };
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
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const parent = indexOf.get(ancestor);
        if (parent === undefined) continue;
        info.parent = parent;
        elements[parent].leaf = false;
        break;
      }
      indexOf.set(element, elements.length);
      found.push(element);
      elements.push(info);
    }
    return { elements, domElements: found };
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
          (token.image as HTMLElement).style.outline = `3px solid ${marks.color}`;
          (token.image as HTMLElement).style.outlineOffset = '2px';
          run = null;
        } else if (run && run.node === token.node) {
          run.range.setEnd(token.node, token.end);
        } else {
          run = { node: token.node, range: rangeOf(token) };
          ranges.push(run.range);
        }
      }
    }
    const strike = marks.strike ? `text-decoration:line-through 2px ${marks.color};` : '';
    const style = document.createElement('style');
    style.textContent = `::highlight(shot-diff){background-color:${marks.tint};${strike}}`;
    document.head.appendChild(style);
    CSS.highlights.set('shot-diff', new Highlight(...ranges));
  };

  /** A box drawn on `layer` at `box`, in page pixels. */
  const drawBox = (layer: HTMLElement, color: string, box: Box) => {
    const element = document.createElement('div');
    element.style.cssText =
      `position:absolute;box-sizing:border-box;border:2px solid ${color};border-radius:4px;` +
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
    const changed = change.changed.flatMap(i => rectsOf(tokens[i]));
    const shown = [...changed, ...change.anchors.flatMap(i => rectsOf(tokens[i]))];
    if (!shown.length) return null;
    const { x: dx, y: dy } = WORD_BOX_MARGIN;
    for (const line of linesOf(changed)) {
      const left = Math.min(...line.map(r => r.left)) + window.scrollX;
      const right = Math.max(...line.map(r => r.right)) + window.scrollX;
      const top = Math.min(...line.map(r => r.top)) + window.scrollY;
      const bottom = Math.max(...line.map(r => r.bottom)) + window.scrollY;
      drawBox(layer, color, {
        x: left - dx,
        y: top - dy,
        width: right - left + 2 * dx,
        height: bottom - top + 2 * dy,
      });
    }
    const sy = window.scrollY;
    return {
      top: Math.min(...shown.map(r => r.top)) + sy,
      bottom: Math.max(...shown.map(r => r.bottom)) + sy,
      changedTop: changed.length ? Math.min(...changed.map(r => r.top)) + sy : null,
      changedBottom: changed.length ? Math.max(...changed.map(r => r.bottom)) + sy : null,
    };
  };

  /** A numbered disc on a box's top left corner, kept inside the page. Returns the disc's top. */
  const drawDisc = (layer: HTMLElement, disc: { src: string; size: number }, box: Box) => {
    const left = Math.max(0, box.x - disc.size / 2);
    const top = Math.max(0, box.y - disc.size / 2);
    const image = document.createElement('img');
    image.src = disc.src;
    image.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${disc.size}px;height:${disc.size}px`;
    layer.appendChild(image);
    return top;
  };

  /** What changed, on a tag above the box, or below it when the page has no room above. Returns
   * whether it went above. */
  const drawLabel = (boxElement: HTMLElement, label: string, color: string, box: Box) => {
    const above = box.y - LABEL_HEIGHT >= 0;
    const place = above ? 'bottom:100%;margin-bottom:2px' : 'top:100%;margin-top:2px';
    const tag = document.createElement('div');
    tag.textContent = label;
    tag.style.cssText =
      `position:absolute;left:-2px;${place};padding:1px 6px;border-radius:4px;white-space:nowrap;` +
      `background:${color};color:#ffffff;font:600 12px/1.4 system-ui,sans-serif`;
    boxElement.appendChild(tag);
    return above;
  };

  /** Box an element whose look changed, with its label or its disc, and say where all that is. */
  const boxLook = (
    look: Marks['looks'][number],
    element: Element,
    layer: HTMLElement,
    color: string,
  ): Span => {
    const rect = element.getBoundingClientRect();
    const box = {
      x: rect.left + window.scrollX - BOX_MARGIN,
      y: rect.top + window.scrollY - BOX_MARGIN,
      width: rect.width + 2 * BOX_MARGIN,
      height: rect.height + 2 * BOX_MARGIN,
    };
    const boxElement = drawBox(layer, color, box);
    let top = Math.max(0, box.y);
    let bottom = box.y + box.height;
    if (look.disc) {
      const discTop = drawDisc(layer, look.disc, box);
      top = Math.min(top, discTop);
    }
    if (look.label) {
      const labelAbove = drawLabel(boxElement, look.label, color, box);
      if (labelAbove) top = Math.max(0, box.y - LABEL_HEIGHT);
      else bottom += LABEL_HEIGHT;
    }
    return { top, bottom, changedTop: top, changedBottom: bottom };
  };

  return {
    /** The page's words and elements, read before anything is drawn over it, and its width. */
    read(properties: string[]): { words: string[]; elements: ElementInfo[]; width: number } {
      const words = readWords();
      const elements = readElements(properties);
      tokens = words.tokens;
      domElements = elements.domElements;
      return { words: words.words, elements: elements.elements, width: document.documentElement.clientWidth };
    },

    /** Element `index` of read(), for a shot of its own pixels; only before the page is marked. */
    element(index: number): Element {
      if (marked)
        throw new Error("an element's pixels are only given before anything is drawn over the page");
      return stored().domElements[index];
    },

    /** Tint and box the changed words, box the elements whose look changed, and say where each is. */
    mark(marks: Marks): Spans {
      const { tokens, domElements } = stored();
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
      return rect ? { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY } : null;
    },

    /** The region with its edges moved out of any line of text they would cut: the top up, the
     * bottom down. Moving an edge can land it inside another line, so it repeats until neither moves. */
    snap(region: Region): Region {
      const lines: Region[] = [];
      for (const token of stored().tokens) {
        for (const rect of rangeOf(token).getClientRects()) {
          if (rect.height)
            lines.push({ top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY });
        }
      }
      let { top, bottom } = region;
      let moved: boolean;
      do {
        moved = false;
        for (const line of lines) {
          if (line.top < top && top < line.bottom) {
            top = line.top - SNAP_CLEARANCE;
            moved = true;
          }
          if (line.top < bottom && bottom < line.bottom) {
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
