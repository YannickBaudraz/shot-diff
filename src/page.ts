// The code that runs inside each page. Playwright sends a function's source to the page, not its
// closure, so runtime() stands alone: no imports at run time, nothing from outside its body. It
// returns the page's interface; loaded.ts installs it once per page and calls it.

import type { El } from './looks.ts';

export type Box = { x: number; y: number; width: number; height: number };

/** A stretch of the page, in page pixels. */
export type Region = { top: number; bottom: number };

/** Where one change sits on the page, in page pixels: `top`/`bottom` take in what is shown around it
 * (the unchanged words next to a word change, the label of a box); `changedTop`/`changedBottom` the
 * change alone (null when this side of a word change is empty). */
export type Span = { top: number; bottom: number; changedTop: number | null; changedBottom: number | null };

export type MarkOptions = {
  color: string; // the boxes, the strike and the labels
  tint: string; // the background behind changed words
  strike: boolean; // strike the changed words through (the before side)
  /** Word changes: the changed tokens and the unchanged ones around them, as indexes into read()'s words. */
  hunks: { changed: number[]; anchors: number[] }[];
  /** Changes of look: an element, as an index into read()'s elements, and what to put on its box. */
  looks: { index: number; label: string | null; disc: { src: string; size: number } | null }[];
};

export type Marked = { words: (Span | null)[]; looks: Span[] };

export function runtime() {
  type Token = { node: Text; start: number; end: number } | { el: Element };
  let tokens: Token[] | null = null;
  let els: Element[] | null = null;
  let marked = false;

  const range = (t: Token) => {
    const r = document.createRange();
    if ('el' in t) r.selectNode(t.el);
    else { r.setStart(t.node, t.start); r.setEnd(t.node, t.end); }
    return r;
  };
  const rects = (t: Token) => [...range(t).getClientRects()].filter(r => r.width || r.height);
  const read = () => {
    if (!tokens || !els) throw new Error('the page is read before it is marked');
    return { tokens, els };
  };
  const overlay = () => {
    const layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    document.documentElement.appendChild(layer);
    return layer;
  };

  /** Every visible word and image, in document order. */
  const words = (): { words: string[]; tokens: Token[] } => {
    const found: Token[] = [];
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (el.tagName === 'IMG' && el.checkVisibility()) {
          const label = el.getAttribute('alt') || (el.getAttribute('src') || '').split('/').pop() || 'image';
          found.push({ el });
          out.push(`[image ${label}]`);
        }
        continue;
      }
      const text = node as Text;
      const parent = text.parentElement;
      if (!parent || !parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      for (const m of text.data.matchAll(/\S+/g)) {
        found.push({ node: text, start: m.index, end: m.index + m[0].length });
        out.push(m[0]);
      }
    }
    return { words: out, tokens: found };
  };

  /** Every visible element, in document order, as looks.ts compares them. */
  const elements = (properties: string[]): { elements: El[]; els: Element[] } => {
    const found: Element[] = [];
    const out: El[] = [];
    const index = new Map<Element, number>();
    const painters = new Set(['IMG', 'CANVAS', 'svg', 'VIDEO']);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      // An SVG is one picture: its shapes are not elements of their own here.
      acceptNode: node => (node.parentElement?.closest('svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node as Element;
      if (!el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const style = getComputedStyle(el);
      const computed = el.computedStyleMap();
      const own = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ')
        .replace(/\s+/g, ' ').trim().slice(0, 80);
      const file = (el.getAttribute('src') || el.getAttribute('href') || '').split(/[?#]/)[0].split('/').pop() || '';
      const sig = [el.tagName, el.id && `#${el.id}`, el.getAttribute('role') || '', el.getAttribute('aria-label') || '', own, file]
        .filter(Boolean).join(' ');
      let parent = -1;
      for (let up = el.parentElement; up; up = up.parentElement) {
        const at = index.get(up);
        if (at !== undefined) { parent = at; out[at].leaf = false; break; }
      }
      index.set(el, out.length);
      found.push(el);
      out.push({
        sig,
        parent,
        leaf: true,
        paint: painters.has(el.tagName) || style.backgroundImage !== 'none',
        top: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
        // The computed value, as the CSS gave it: `auto` stays `auto`, where getComputedStyle would give
        // the pixels layout made of it, which change with whatever else changed on the page.
        style: Object.fromEntries(properties.map(p => [p, (computed.get(p) ?? style.getPropertyValue(p)).toString()])),
      });
    }
    return { elements: out, els: found };
  };

  return {
    /** The page's words and elements, read before anything is drawn over it, and its width. */
    read(properties: string[]): { words: string[]; elements: El[]; width: number } {
      const w = words();
      const e = elements(properties);
      tokens = w.tokens;
      els = e.els;
      return { words: w.words, elements: e.elements, width: document.documentElement.clientWidth };
    },

    /** Element `index` of read(), for a shot of its own pixels; only before the page is marked. */
    element(index: number): Element {
      if (marked) throw new Error("an element's pixels are read before anything is drawn over the page");
      return read().els[index];
    },

    /** Tint and box the changed words, box the elements whose look changed, and say where each is. */
    mark(o: MarkOptions): Marked {
      const { tokens, els } = read();
      marked = true;
      const sx = window.scrollX;
      const sy = window.scrollY;

      // Changed words: one highlight range per run of tokens in the same text node.
      const ranges: Range[] = [];
      for (const hunk of o.hunks) {
        let last: { node: Text; range: Range } | null = null;
        for (const i of hunk.changed) {
          const t = tokens[i];
          if ('el' in t) {
            (t.el as HTMLElement).style.outline = `3px solid ${o.color}`;
            (t.el as HTMLElement).style.outlineOffset = '2px';
            last = null;
          } else if (last && last.node === t.node) {
            last.range.setEnd(t.node, t.end);
          } else {
            const r = range(t);
            ranges.push(r);
            last = { node: t.node, range: r };
          }
        }
      }
      const style = document.createElement('style');
      style.textContent = `::highlight(shot-diff){background-color:${o.tint};` +
        (o.strike ? `text-decoration:line-through 2px ${o.color};` : '') + '}';
      document.head.appendChild(style);
      CSS.highlights.set('shot-diff', new Highlight(...ranges));

      // Boxes, drawn over the page so nothing it lays out moves.
      const layer = overlay();
      const box = (left: number, top: number, width: number, height: number) => {
        const b = document.createElement('div');
        b.style.cssText = `position:absolute;box-sizing:border-box;border:2px solid ${o.color};border-radius:4px;` +
          `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
        layer.appendChild(b);
        return b;
      };

      const wordSpans = o.hunks.map(hunk => {
        const changed = hunk.changed.flatMap(i => rects(tokens[i]));
        const all = [...changed, ...hunk.anchors.flatMap(i => rects(tokens[i]))];
        if (!all.length) return null;
        // One box per line, so a change that wraps does not get a box through the words between.
        const lines: DOMRect[][] = [];
        for (const r of [...changed].sort((p, q) => p.top - q.top || p.left - q.left)) {
          const line = lines.find(l => Math.abs(l[0].top - r.top) < l[0].height / 2);
          if (line) line.push(r);
          else lines.push([r]);
        }
        for (const line of lines) {
          const left = Math.min(...line.map(r => r.left));
          const top = Math.min(...line.map(r => r.top));
          box(left + sx - 4, top + sy - 3, Math.max(...line.map(r => r.right)) - left + 8, Math.max(...line.map(r => r.bottom)) - top + 6);
        }
        return {
          top: Math.min(...all.map(r => r.top)) + sy,
          bottom: Math.max(...all.map(r => r.bottom)) + sy,
          changedTop: changed.length ? Math.min(...changed.map(r => r.top)) + sy : null,
          changedBottom: changed.length ? Math.max(...changed.map(r => r.bottom)) + sy : null,
        };
      });

      // Changes of look: a box with what changed on a label (above it, or below at the top of the
      // page), or a numbered disc on its corner.
      const LABEL = 22;
      const lookSpans = o.looks.map(({ index, label, disc }) => {
        const r = els[index].getBoundingClientRect();
        const boxTop = r.top + sy - 4;
        const boxBottom = r.bottom + sy + 4;
        const b = box(r.left + sx - 4, boxTop, r.width + 8, r.height + 8);
        let top = Math.max(0, boxTop);
        let bottom = boxBottom;
        if (disc) {
          const img = document.createElement('img');
          img.src = disc.src;
          const left = Math.max(0, r.left + sx - 4 - disc.size / 2);
          const discTop = Math.max(0, boxTop - disc.size / 2);
          img.style.cssText = `position:absolute;left:${left}px;top:${discTop}px;width:${disc.size}px;height:${disc.size}px`;
          layer.appendChild(img);
          top = Math.min(top, discTop);
        }
        if (label) {
          const above = boxTop - LABEL >= 0;
          const tag = document.createElement('div');
          tag.textContent = label;
          tag.style.cssText = `position:absolute;left:-2px;${above ? 'bottom:100%;margin-bottom:2px' : 'top:100%;margin-top:2px'};` +
            `padding:1px 6px;border-radius:4px;white-space:nowrap;background:${o.color};color:#ffffff;font:600 12px/1.4 system-ui,sans-serif`;
          b.appendChild(tag);
          if (above) top = Math.max(0, boxTop - LABEL);
          else bottom += LABEL;
        }
        return { top, bottom, changedTop: top, changedBottom: bottom };
      });

      return { words: wordSpans, looks: lookSpans };
    },

    /** Where `selector`'s element is, or null when it is not there. */
    region(selector: string): Region | null {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
    },

    /** The region with its edges moved out of any line of text they would cut: the top up, the bottom down. */
    snap(region: Region): Region {
      const sy = window.scrollY;
      const lines: [number, number][] = [];
      for (const t of read().tokens) for (const r of range(t).getClientRects()) if (r.height) lines.push([r.top + sy, r.bottom + sy]);
      let { top, bottom } = region;
      for (let moved = true; moved;) {
        moved = false;
        for (const [a, b] of lines) {
          if (a < top && top < b) { top = a - 6; moved = true; }
          if (a < bottom && bottom < b) { bottom = b + 6; moved = true; }
        }
      }
      return { top: Math.max(0, top), bottom };
    },
  };
}

/** The page's interface, as runtime() returns it. */
export type Runtime = ReturnType<typeof runtime>;
