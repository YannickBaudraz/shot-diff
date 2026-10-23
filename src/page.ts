// Functions run inside the page by page.evaluate. Each must stand alone: no imports, no
// helpers from outside its own body, since Playwright sends only the function's source.

export type Box = { x: number; y: number; width: number; height: number };

export type MarkOptions = {
  hunks: { changed: number[]; anchors: number[] }[];
  color: string; // the border and strike colour
  tint: string; // the background behind changed words
  strike: boolean; // strike the changed words through (the before side)
};

/** Where one hunk sits on the page, in page pixels: `top`/`bottom` span its changed words and the
 * unchanged ones around it; `changedTop`/`changedBottom` the changed words alone (null when this
 * side of the hunk is empty). */
export type Span = { top: number; bottom: number; changedTop: number | null; changedBottom: number | null };

export type Marked = { width: number; spans: (Span | null)[] };

/** Every visible word and image of the page, in document order. The page keeps where each
 * one is, for mark() to find it again. */
export function collect(): string[] {
  type Token = { node: Text; start: number; end: number } | { el: Element };
  const tokens: Token[] = [];
  const words: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.tagName === 'IMG' && el.checkVisibility()) {
        const label = el.getAttribute('alt') || (el.getAttribute('src') || '').split('/').pop() || 'image';
        tokens.push({ el });
        words.push(`[image ${label}]`);
      }
      continue;
    }
    const text = node as Text;
    const parent = text.parentElement;
    if (!parent || !parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    for (const m of text.data.matchAll(/\S+/g)) {
      tokens.push({ node: text, start: m.index, end: m.index + m[0].length });
      words.push(m[0]);
    }
  }
  (window as unknown as { __shotDiff: Token[] }).__shotDiff = tokens;
  return words;
}

/** Tint and box the changed tokens, and say where each hunk is. */
export function mark(o: MarkOptions): Marked {
  type Token = { node: Text; start: number; end: number } | { el: Element };
  const tokens = (window as unknown as { __shotDiff: Token[] }).__shotDiff;
  const rangeOf = (i: number) => {
    const t = tokens[i];
    const r = document.createRange();
    if ('el' in t) r.selectNode(t.el);
    else { r.setStart(t.node, t.start); r.setEnd(t.node, t.end); }
    return r;
  };
  const rectsOf = (i: number) => [...rangeOf(i).getClientRects()].filter(r => r.width || r.height);

  // Changed words: one highlight range per run of tokens in the same text node.
  const ranges: Range[] = [];
  let last: { node: Text; range: Range } | null = null;
  for (const hunk of o.hunks) {
    for (const i of hunk.changed) {
      const t = tokens[i];
      if ('el' in t) {
        (t.el as HTMLElement).style.outline = `3px solid ${o.color}`;
        (t.el as HTMLElement).style.outlineOffset = '2px';
        last = null;
        continue;
      }
      if (last && last.node === t.node) last.range.setEnd(t.node, t.end);
      else {
        const range = document.createRange();
        range.setStart(t.node, t.start);
        range.setEnd(t.node, t.end);
        ranges.push(range);
        last = { node: t.node, range };
      }
    }
    last = null;
  }
  const style = document.createElement('style');
  style.textContent = `::highlight(shot-diff){background-color:${o.tint};` +
    (o.strike ? `text-decoration:line-through 2px ${o.color};` : '') + '}';
  document.head.appendChild(style);
  CSS.highlights.set('shot-diff', new Highlight(...ranges));

  // A box around each hunk, drawn over the page so nothing it lays out moves.
  const sx = window.scrollX;
  const sy = window.scrollY;
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
  document.documentElement.appendChild(layer);
  const spans: (Span | null)[] = [];
  for (const hunk of o.hunks) {
    const changed = hunk.changed.flatMap(rectsOf);
    const all = [...changed, ...hunk.anchors.flatMap(rectsOf)];
    if (!all.length) { spans.push(null); continue; }
    spans.push({
      top: Math.min(...all.map(r => r.top)) + sy,
      bottom: Math.max(...all.map(r => r.bottom)) + sy,
      changedTop: changed.length ? Math.min(...changed.map(r => r.top)) + sy : null,
      changedBottom: changed.length ? Math.max(...changed.map(r => r.bottom)) + sy : null,
    });
    if (!changed.length) continue;
    const left = Math.min(...changed.map(r => r.left));
    const right = Math.max(...changed.map(r => r.right));
    const boxTop = Math.min(...changed.map(r => r.top));
    const boxBottom = Math.max(...changed.map(r => r.bottom));
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;box-sizing:border-box;border:2px solid ${o.color};border-radius:4px;` +
      `left:${left + sx - 4}px;top:${boxTop + sy - 3}px;width:${right - left + 8}px;height:${boxBottom - boxTop + 6}px`;
    layer.appendChild(box);
  }
  return { width: document.documentElement.clientWidth, spans };
}

/** The top of `selector`'s element and its bottom, in page pixels, or null when it is not there. */
export function element(selector: string): { top: number; bottom: number } | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
}

/** Move the region's edges out of any line of text they would cut: the top up, the bottom down. */
export function snap(region: { top: number; bottom: number }): { top: number; bottom: number } {
  type Token = { node: Text; start: number; end: number } | { el: Element };
  const tokens = (window as unknown as { __shotDiff: Token[] }).__shotDiff;
  const sy = window.scrollY;
  const lines: [number, number][] = [];
  for (const t of tokens) {
    const r = document.createRange();
    if ('el' in t) r.selectNode(t.el);
    else { r.setStart(t.node, t.start); r.setEnd(t.node, t.end); }
    for (const rect of r.getClientRects()) if (rect.height) lines.push([rect.top + sy, rect.bottom + sy]);
  }
  let { top, bottom } = region;
  for (let moved = true; moved;) {
    moved = false;
    for (const [a, b] of lines) {
      if (a < top && top < b) { top = a - 6; moved = true; }
      if (a < bottom && bottom < b) { bottom = b + 6; moved = true; }
    }
  }
  return { top: Math.max(0, top), bottom };
}
