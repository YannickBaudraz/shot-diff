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

/** Every visible element of the page, in document order, as visual.ts compares them: what pairs it
 * across the pages, where it sits in the tree, its size and the computed `properties`. The page keeps
 * the elements, for outline() and the pixel comparison to find them again. */
export function elements(properties: string[]): import('./visual.ts').El[] {
  const els: Element[] = [];
  const out: import('./visual.ts').El[] = [];
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
    els.push(el);
    out.push({
      sig,
      parent,
      leaf: true,
      paint: painters.has(el.tagName) || style.backgroundImage !== 'none',
      width: rect.width,
      height: rect.height,
      // The computed value, as the CSS gave it: `auto` stays `auto`, where getComputedStyle would give
      // the pixels layout made of it, which change with whatever else changed on the page.
      style: Object.fromEntries(properties.map(p => [p, (computed.get(p) ?? style.getPropertyValue(p)).toString()])),
    });
  }
  (window as unknown as { __shotDiffEls: Element[] }).__shotDiffEls = els;
  return out;
}

/** A box around each element whose look changed, with what changed written on it; and where each
 * one is, in page pixels. */
export function outline(o: { items: { index: number; label: string }[]; color: string }): Span[] {
  const els = (window as unknown as { __shotDiffEls: Element[] }).__shotDiffEls;
  const sx = window.scrollX;
  const sy = window.scrollY;
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
  document.documentElement.appendChild(layer);
  return o.items.map(({ index, label }) => {
    const r = els[index].getBoundingClientRect();
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;box-sizing:border-box;border:2px solid ${o.color};border-radius:4px;` +
      `left:${r.left + sx - 4}px;top:${r.top + sy - 4}px;width:${r.width + 8}px;height:${r.height + 8}px`;
    const tag = document.createElement('div');
    tag.textContent = label;
    // The label sits above the box, or below it when the page has no room above.
    const LABEL = 22;
    const above = r.top + sy - 4 - LABEL >= 0;
    tag.style.cssText = `position:absolute;left:-2px;${above ? 'bottom:100%;margin-bottom:2px' : 'top:100%;margin-top:2px'};` +
      `padding:1px 6px;border-radius:4px;white-space:nowrap;background:${o.color};color:#ffffff;font:600 12px/1.4 system-ui,sans-serif`;
    box.appendChild(tag);
    layer.appendChild(box);
    const top = Math.max(0, r.top + sy - 4 - (above ? LABEL : 0));
    const bottom = r.bottom + sy + 4 + (above ? 0 : LABEL);
    return { top, bottom, changedTop: top, changedBottom: bottom };
  });
}
