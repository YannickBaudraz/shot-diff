// The functions page.evaluate sends to a page, run here in Chrome on small pages.

import { afterEach, describe, expect, test } from 'vitest';
import { collect, elements, mark, outline, snap } from '../src/page.ts';
import { PROPERTIES } from '../src/visual.ts';

const STYLE = '<style>body { margin: 0; font: 16px/24px sans-serif } p { margin: 0 0 24px }</style>';
const page = (html: string) => { document.body.innerHTML = STYLE + html; };
/** What mark() and outline() drew: the boxes, the labels and the discs. */
const drawn = () => [...document.documentElement.children].filter(e => e !== document.head && e !== document.body).flatMap(l => [...l.children]) as HTMLElement[];

afterEach(() => {
  for (const layer of [...document.documentElement.children]) if (layer !== document.head && layer !== document.body) layer.remove();
  for (const style of document.head.querySelectorAll('style')) if (style.textContent?.includes('shot-diff')) style.remove();
  CSS.highlights.clear();
  document.body.innerHTML = '';
});

describe('collect', () => {
  test('lists visible words and images in order, and leaves hidden text out', () => {
    page('<p>One two</p><p style="display:none">hidden</p><img src="pics/logo.png" width="10" height="10"><p>three</p>');
    expect(collect()).toEqual(['One', 'two', '[image logo.png]', 'three']);
  });
});

describe('mark', () => {
  test('tints the changed words and boxes a wrapped change line by line', () => {
    page('<p style="width:120px">aa bb cc dd ee ff gg hh</p>');
    const words = collect();
    const changed = words.map((_, i) => i).slice(2, 7); // cc to gg, over two lines or more
    const marked = mark({ hunks: [{ changed, anchors: [1, 7] }], color: 'red', tint: 'pink', strike: true });
    expect(CSS.highlights.get('shot-diff')?.size).toBeGreaterThan(0);
    const lines = new Set(changed.map(i => Math.round(rangeTop(i))));
    expect(drawn()).toHaveLength(lines.size);
    expect(lines.size).toBeGreaterThan(1);
    expect(marked.spans[0]!.changedTop).toBeLessThan(marked.spans[0]!.changedBottom!);
  });
});

/** The top of token `i` of the last collect(), in page pixels. */
function rangeTop(i: number): number {
  const t = (window as unknown as { __shotDiff: { node: Text; start: number; end: number }[] }).__shotDiff[i];
  const r = document.createRange();
  r.setStart(t.node, t.start);
  r.setEnd(t.node, t.end);
  return r.getBoundingClientRect().top + window.scrollY;
}

describe('snap', () => {
  test('moves an edge that would cut a line of text off it', () => {
    page('<p>first line</p><p>second line</p>');
    collect();
    // The second line runs from 48px to 72px; edges inside it move to its outside.
    expect(snap({ top: 60, bottom: 200 }).top).toBeLessThanOrEqual(48);
    expect(snap({ top: 0, bottom: 60 }).bottom).toBeGreaterThanOrEqual(72);
    // Edges between lines stay.
    expect(snap({ top: 30, bottom: 40 })).toEqual({ top: 30, bottom: 40 });
  });
});

describe('elements', () => {
  test('reads the CSS value, so a margin set to auto stays auto', () => {
    page('<div style="display:flex;flex-direction:column;height:300px"><p>a</p><p style="margin-top:auto">b</p></div>');
    const els = elements(Object.keys(PROPERTIES));
    const b = els.find(e => e.sig === 'P b')!;
    expect(b.style['margin-top']).toBe('auto');
    expect(els[b.parent].sig).toBe('DIV');
    expect(els[b.parent].leaf).toBe(false);
  });

  test('an SVG is one element that paints, its shapes are not listed', () => {
    page('<svg width="40" height="40" aria-label="chart"><rect width="40" height="40" fill="blue"/></svg>');
    const els = elements(Object.keys(PROPERTIES));
    expect(els.map(e => e.sig)).toEqual(['svg chart']);
    expect(els[0].paint).toBe(true);
  });
});

describe('outline', () => {
  const twoButtons = '<button style="position:absolute;top:0;left:20px">top</button><button style="position:absolute;top:200px;left:20px">lower</button>';

  test('labels sit above the box, or below it at the top of the page', () => {
    page(twoButtons);
    elements(Object.keys(PROPERTIES));
    const spans = outline({ markers: 'labels', color: 'red', items: [
      { index: 0, n: 1, label: 'background', disc: '' }, { index: 1, n: 2, label: 'border', disc: '' },
    ] });
    const labels = drawn().map(box => box.firstElementChild as HTMLElement);
    expect(labels.map(l => l.textContent)).toEqual(['background', 'border']);
    expect(labels[0].style.top).toBe('100%'); // no room above: below
    expect(labels[1].style.bottom).toBe('100%'); // above
    expect(spans[0].top).toBe(0);
    expect(spans[1].top).toBeLessThan(200 - 4);
  });

  test('numbers put the disc image they are given on the box, and no label', () => {
    page(twoButtons);
    elements(Object.keys(PROPERTIES));
    const picture = 'data:image/png;base64,iVBORw0KGgo=';
    outline({ markers: 'numbers', color: 'red', items: [{ index: 1, n: 7, label: 'border', disc: picture }] });
    const [box, disc] = drawn();
    expect(box.children).toHaveLength(0);
    expect((disc as HTMLImageElement).src).toBe(picture);
  });
});
