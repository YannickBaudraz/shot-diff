// The page's runtime, run in Chrome on small pages. It is installed from its source text, as
// Playwright sends it, so a helper used from outside its body fails here too.

import { afterEach, describe, expect, test } from 'vitest';
import { runtime, type Marks, type Runtime } from '../src/page.ts';

const STYLE = '<style>body { margin: 0; font: 16px/24px sans-serif } p { margin: 0 0 24px }</style>';
const PROPS = ['margin-top', 'color']; // read as looks.ts reads them; the full list lives there, with Node-only code
const install = () => new Function(`return (${runtime.toString()})()`)() as Runtime;
const page = (html: string) => { document.body.innerHTML = STYLE + html; return install(); };
/** What mark() drew over the page: boxes, and the discs beside them. */
const drawn = () => [...document.documentElement.children].filter(e => e !== document.head && e !== document.body).flatMap(l => [...l.children]) as HTMLElement[];
const marks = (more: Partial<Marks>): Marks => ({ color: 'red', tint: 'pink', strike: true, words: [], looks: [], ...more });

afterEach(() => {
  for (const layer of [...document.documentElement.children]) if (layer !== document.head && layer !== document.body) layer.remove();
  for (const style of document.head.querySelectorAll('style')) if (style.textContent?.includes('shot-diff')) style.remove();
  CSS.highlights.clear();
  document.body.innerHTML = '';
});

describe('read', () => {
  test('lists visible words and images in order, and leaves hidden text out', () => {
    const p = page('<p>One two</p><p style="display:none">hidden</p><img src="pics/logo.png" width="10" height="10"><p>three</p>');
    expect(p.read(PROPS).words).toEqual(['One', 'two', '[image logo.png]', 'three']);
  });

  test('reads the CSS value, so a margin set to auto stays auto', () => {
    const p = page('<div style="display:flex;flex-direction:column;height:300px"><p>a</p><p style="margin-top:auto">b</p></div>');
    const { elements } = p.read(PROPS);
    const b = elements.find(e => e.signature === 'P b')!;
    expect(b.style['margin-top']).toBe('auto');
    expect(elements[b.parent].signature).toBe('DIV');
    expect(elements[b.parent].leaf).toBe(false);
  });

  test('an SVG is one element that paints, its shapes are not listed', () => {
    const p = page('<svg width="40" height="40" aria-label="chart"><rect width="40" height="40" fill="blue"/></svg>');
    const { elements } = p.read(PROPS);
    expect(elements.map(e => e.signature)).toEqual(['svg chart']);
    expect(elements[0].paints).toBe(true);
  });
});

describe('the order', () => {
  test('nothing is marked or snapped before the page is read', () => {
    const p = page('<p>a</p>');
    expect(() => p.mark(marks({}))).toThrow(/read\(\) has not run/);
    expect(() => p.snap({ top: 0, bottom: 10 })).toThrow(/read\(\) has not run/);
  });

  test("an element's pixels are not given once the page is marked", () => {
    const p = page('<p>a</p>');
    p.read(PROPS);
    expect(p.element(0).tagName).toBe('P');
    p.mark(marks({}));
    expect(() => p.element(0)).toThrow(/only given before anything is drawn/);
  });
});

describe('mark', () => {
  test('tints the changed words and boxes a wrapped change line by line', () => {
    const p = page('<p style="width:120px">aa bb cc dd ee ff gg hh</p>');
    p.read(PROPS);
    const marked = p.mark(marks({ words: [{ changed: [2, 3, 4, 5, 6], anchors: [1, 7] }] }));
    expect(CSS.highlights.get('shot-diff')?.size).toBeGreaterThan(0);
    const boxes = drawn();
    expect(boxes.length).toBeGreaterThan(1);
    for (const box of boxes) expect(box.getBoundingClientRect().height).toBeLessThan(36); // one 24px line each
    expect(marked.words[0]!.changedTop).toBeLessThan(marked.words[0]!.changedBottom!);
  });

  const twoButtons = '<button style="position:absolute;top:0;left:20px">top</button><button style="position:absolute;top:200px;left:20px">lower</button>';

  test('a label sits above its box, or below it at the top of the page', () => {
    const p = page(twoButtons);
    p.read(PROPS);
    const { looks } = p.mark(marks({ looks: [{ index: 0, label: 'background', disc: null }, { index: 1, label: 'border', disc: null }] }));
    const labels = drawn().map(box => box.firstElementChild as HTMLElement);
    expect(labels.map(l => l.textContent)).toEqual(['background', 'border']);
    expect(labels[0].style.top).toBe('100%'); // no room above: below
    expect(labels[1].style.bottom).toBe('100%'); // above
    expect(looks[0].top).toBe(0);
    expect(looks[1].top).toBeLessThan(200 - 4);
  });

  test('a disc is the image it is given, on the box, with no label', () => {
    const p = page(twoButtons);
    p.read(PROPS);
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    p.mark(marks({ looks: [{ index: 1, label: null, disc: { src, size: 24 } }] }));
    const [box, disc] = drawn();
    expect(box.children).toHaveLength(0);
    expect((disc as HTMLImageElement).src).toBe(src);
    expect(disc.style.width).toBe('24px');
  });
});

describe('snap', () => {
  test('moves an edge that would cut a line of text off it', () => {
    const p = page('<p>first line</p><p>second line</p>');
    p.read(PROPS);
    // The second line runs from 48px to 72px; edges inside it move to its outside.
    expect(p.snap({ top: 60, bottom: 200 }).top).toBeLessThanOrEqual(48);
    expect(p.snap({ top: 0, bottom: 60 }).bottom).toBeGreaterThanOrEqual(72);
    // Edges between lines stay.
    expect(p.snap({ top: 30, bottom: 40 })).toEqual({ top: 30, bottom: 40 });
  });
});
