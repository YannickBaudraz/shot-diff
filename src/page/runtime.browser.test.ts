// The page's runtime, run in Chrome on small pages. It is installed from its source text, as
// Playwright sends it, so a helper used from outside its body fails here too.

import { afterEach, describe, expect, test } from 'vitest';
import { runtime, type Marks, type Runtime } from './runtime.ts';

const STYLE = '<style>body { margin: 0; font: 16px/24px sans-serif } p { margin: 0 0 24px }</style>';
const PROPS = ['margin-top', 'color']; // read as looks.ts reads them; the full list lives there, with Node-only code
const install = () => new Function(`return (${runtime.toString()})(${JSON.stringify(PROPS)})`)() as Runtime;
const page = (html: string) => {
  document.body.innerHTML = STYLE + html;
  return install();
};
/** What mark() drew over the page: boxes, and the discs beside them. */
const drawn = () =>
  [...document.documentElement.children]
    .filter(e => e !== document.head && e !== document.body)
    .flatMap(l => [...l.children]) as HTMLElement[];
const marks = (more: Partial<Marks>): Marks => ({
  color: 'red',
  within: null,
  words: [],
  looks: [],
  ...more,
});

/** An element with a shadow tree: a line of its own, a slot for what it is given, and a last line. */
customElements.define(
  'x-card',
  class extends HTMLElement {
    connectedCallback() {
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<style>p { margin: 0 0 24px } :host(.folded) section { display: none }</style>' +
        '<p id="top">Top line</p><section><slot>nothing given</slot></section><p>Bottom</p>';
    }
  },
);

afterEach(() => {
  for (const layer of [...document.documentElement.children])
    if (layer !== document.head && layer !== document.body) layer.remove();
  document.body.innerHTML = '';
});

describe('read, with elements ignored', () => {
  test('leaves out their words and elements, all inside them, and counts them', () => {
    document.body.innerHTML = STYLE + '<p>keep</p><p class="data">12 <b>orders</b></p><p class="data">31</p>';
    const p = new Function(
      `return (${runtime.toString()})(${JSON.stringify(PROPS)}, ${JSON.stringify(['.data', '.none'])})`,
    )() as Runtime;
    expect(p.reading.words).toEqual(['keep']);
    expect(p.reading.elements.map(e => e.signature)).toEqual(['P keep']);
    expect(p.reading.ignored).toEqual([2, 0]);
  });
});

describe('read', () => {
  test('lists visible words and images in order, and leaves hidden text out', () => {
    const p = page(
      '<p>One two</p><p style="display:none">hidden</p><img src="pics/logo.png" width="10" height="10"><p>three</p>',
    );
    expect(p.reading.words).toEqual(['One', 'two', '[image logo.png]', 'three']);
  });

  test('reads the CSS value, so a margin set to auto stays auto', () => {
    const p = page(
      '<div style="display:flex;flex-direction:column;height:300px"><p>a</p><p style="margin-top:auto">b</p></div>',
    );
    const { elements } = p.reading;
    const b = elements.find(e => e.signature === 'P b')!;
    expect(b.style['margin-top']).toBe('auto');
    expect(elements[b.parent].signature).toBe('DIV');
    expect(elements[b.parent].leaf).toBe(false);
  });

  test('an SVG is one element that paints, its shapes are not listed', () => {
    const p = page(
      '<svg width="40" height="40" aria-label="chart"><rect width="40" height="40" fill="blue"/></svg>',
    );
    const { elements } = p.reading;
    expect(elements.map(e => e.signature)).toEqual(['svg chart']);
    expect(elements[0].paints).toBe(true);
  });

  test('a background image file paints, a gradient does not: its CSS value says it all', () => {
    const size = 'width:20px;height:20px';
    const p = page(
      `<div id="file" style="${size};background-image:url(pics/x.png)"></div>` +
        `<div id="gradient" style="${size};background-image:linear-gradient(red, transparent)"></div>`,
    );
    expect(p.reading.elements.map(e => [e.signature, e.paints])).toEqual([
      ['DIV #file', true],
      ['DIV #gradient', false],
    ]);
  });
});

describe('read, the elements with words', () => {
  test('are the ones with a word or an image in them, their own or inside them', () => {
    const p = page(
      '<div id="a"><p>Word</p></div>' +
        '<div id="b" style="height:10px"><i style="display:block;height:5px"></i></div>' +
        '<div id="c"><img src="pics/logo.png" width="10" height="10"></div><hr>',
    );
    expect(p.reading.elements.map(e => [e.signature, e.worded])).toEqual([
      ['DIV #a', true],
      ['P Word', true],
      ['DIV #b', false],
      ['I', false],
      ['DIV #c', true],
      ['IMG logo.png', true],
      ['HR', false],
    ]);
  });
});

describe('read, an embedded page', () => {
  test('is one element that paints: the words in it are not read', () => {
    const p = page(
      '<p>Around</p><iframe title="Payment" srcdoc="<p>Inside</p>" width="200" height="80"></iframe>',
    );
    expect(p.reading.words).toEqual(['Around']);
    const frame = p.reading.elements.find(e => e.tag === 'iframe')!;
    expect([frame.signature, frame.paints, frame.leaf]).toEqual(['IFRAME', true, true]);
  });
});

describe('read, inside a shadow tree', () => {
  test('lists its words where they show: the tree, with what the element is given in its slot', () => {
    const p = page('<p>Before</p><x-card><b>given</b> bare</x-card><p>After</p>');
    expect(p.reading.words).toEqual(['Before', 'Top', 'line', 'given', 'bare', 'Bottom', 'After']);
  });

  test('a slot given nothing shows its own words, and one that is not shown hides what it is given', () => {
    expect(page('<x-card></x-card>').reading.words).toEqual(['Top', 'line', 'nothing', 'given', 'Bottom']);
    expect(page('<x-card class="folded"><b>given</b> bare</x-card>').reading.words).toEqual([
      'Top',
      'line',
      'Bottom',
    ]);
  });

  test('lists its elements, each in the element it shows in', () => {
    const { elements } = page('<x-card><b>given</b></x-card>').reading;
    const parentOf = (signature: string) => elements[elements.find(e => e.signature === signature)!.parent];
    expect(elements.map(e => e.signature)).toEqual([
      'X-CARD',
      'P #top Top line',
      'SECTION',
      'B given',
      'P Bottom',
    ]);
    expect(parentOf('P #top Top line').signature).toBe('X-CARD');
    expect(parentOf('B given').signature).toBe('SECTION'); // through the slot, which has no box
    expect(elements[0].leaf).toBe(false);
  });
});

describe('read, with no box around the words', () => {
  test('words in an element with display: contents are read; hidden through it, they are not', () => {
    const p = page(
      '<div style="display:contents">shown</div>' +
        '<div style="display:contents;visibility:hidden">unseen</div>' +
        '<div style="display:none"><div style="display:contents">gone</div></div>',
    );
    expect(p.reading.words).toEqual(['shown']);
  });
});

describe('the order', () => {
  test("an element's pixels are not given once the page is marked", () => {
    const p = page('<p>a</p>');
    expect(p.element(0).tagName).toBe('P');
    p.mark(marks({}));
    expect(() => p.element(0)).toThrow(/only given before anything is drawn/);
  });
});

describe('mark', () => {
  test('boxes a wrapped change line by line, and paints nothing over the words', () => {
    const p = page('<p style="width:120px">aa bb cc dd ee ff gg hh</p>');
    const marked = p.mark(marks({ words: [{ changed: [2, 3, 4, 5, 6], anchors: [1, 7] }] }));
    expect(CSS.highlights.size).toBe(0);
    const boxes = drawn();
    expect(boxes.length).toBeGreaterThan(1);
    for (const box of boxes) expect(box.getBoundingClientRect().height).toBeLessThan(36); // one 24px line each
    const { changed } = marked.words[0]!;
    expect(changed!.top).toBeLessThan(changed!.bottom);
  });

  test('boxes a block whose words all changed once, however many lines it wraps to', () => {
    const p = page('<p style="width:120px">aa bb cc dd ee ff gg hh</p><p>ii jj</p>');
    p.mark(marks({ words: [{ changed: [0, 1, 2, 3, 4, 5, 6, 7], anchors: [8] }] }));
    const [box, ...more] = drawn();
    expect(more).toHaveLength(0);
    expect(box.getBoundingClientRect().height).toBeGreaterThan(36); // around every line of the block
  });

  test('gives a box a white ring outside it', () => {
    const p = page('<p>aa bb</p>');
    p.mark(marks({ words: [{ changed: [0], anchors: [1] }] }));
    expect(drawn()[0].style.boxShadow).toContain('255, 255, 255');
  });

  const twoButtons =
    '<button style="position:absolute;top:0;left:20px">top</button><button style="position:absolute;top:200px;left:20px">lower</button>';

  test('a label sits above its box, or below it at the top of the page', () => {
    const p = page(twoButtons);
    const { looks } = p.mark(
      marks({
        looks: [
          { index: 0, badge: { label: 'background' } },
          { index: 1, badge: { label: 'border' } },
        ],
      }),
    );
    const boxes = drawn();
    const labels = boxes.map(box => box.firstElementChild as HTMLElement);
    expect(labels.map(l => l.textContent)).toEqual(['background', 'border']);
    const [top, lower] = boxes.map((box, i) => ({
      box: box.getBoundingClientRect(),
      label: labels[i].getBoundingClientRect(),
    }));
    expect(top.label.top).toBe(top.box.bottom); // no room above: below
    expect(lower.label.bottom).toBe(lower.box.top); // above
    expect(top.label.left).toBe(top.box.left);
    expect(looks[0].top).toBe(2); // the box is kept on the page, its ring too
    expect(looks[1].top).toBeLessThan(200 - 4);
  });

  test('a label goes where it hides no words: below a box with a line right above it', () => {
    const p = page(
      '<p style="margin:0">The line above</p><button>changed</button><p style="margin-top:80px">far below</p>',
    );
    const index = p.reading.elements.findIndex(e => e.tag === 'button');
    p.mark(marks({ looks: [{ index, badge: { label: 'background' } }] }));
    const [box] = drawn();
    const label = box.firstElementChild!.getBoundingClientRect();
    expect(label.top).toBe(box.getBoundingClientRect().bottom);
    const line = document.querySelector('p')!.getBoundingClientRect();
    expect(label.top).toBeGreaterThanOrEqual(line.bottom);
  });

  test('with words above and below, it goes to the side that hides none; two labels do not share a place', () => {
    const p = page(
      '<p style="margin:40px 0 0">Above</p><div style="width:300px"><button>one</button></div><p style="margin:0">Below</p>',
    );
    const index = p.reading.elements.findIndex(e => e.tag === 'div');
    const badge = { label: 'spacing' };
    p.mark(
      marks({
        looks: [
          { index, badge },
          { index, badge },
        ],
      }),
    );
    const [first, second] = drawn().map(box => box.firstElementChild!.getBoundingClientRect());
    const [box] = drawn().map(box => box.getBoundingClientRect());
    expect(first.right).toBe(box.right); // above, on the right: "Above" is on the left
    expect(first.bottom).toBe(box.top);
    expect(second.top).toBe(box.bottom); // the same place is taken: below, on the right
    expect(second.right).toBe(box.right);
  });

  test('a disc is the image it is given, on the box, with no label', () => {
    const p = page(twoButtons);
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    p.mark(marks({ looks: [{ index: 1, badge: { disc: { src, size: 24 } } }] }));
    const [box, disc] = drawn();
    expect(box.children).toHaveLength(0);
    expect((disc as HTMLImageElement).src).toBe(src);
    expect(disc.style.width).toBe('24px');
  });
});

describe('mark, a change of look this page has not', () => {
  test('draws nothing, and says where it would be: at that edge of the element it is given', () => {
    const p = page('<p>One</p><p>Two</p>');
    const place = { changed: null, inside: true, clipped: false };
    const { looks } = p.mark(
      marks({
        looks: [
          { index: 1, badge: null, edge: 'top' },
          { index: 1, badge: null, edge: 'bottom' },
          { index: -1, badge: null },
        ],
      }),
    );
    expect(drawn()).toHaveLength(0);
    expect(looks).toEqual([
      { top: 48, bottom: 48, ...place },
      { top: 72, bottom: 72, ...place },
      { top: 0, bottom: 0, ...place },
    ]);
  });
});

describe('mark, at the page edges', () => {
  test('keeps the box of an element as wide as the page inside it, its ring too', () => {
    const p = page('<p>aa</p><div style="height:40px;margin:0">x</div>');
    const index = p.reading.elements.findIndex(e => e.tag === 'div');
    p.mark(marks({ looks: [{ index, badge: { label: 'layout' } }] }));
    const box = drawn()[0].getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(2);
    expect(box.right).toBeLessThanOrEqual(document.documentElement.clientWidth - 2);
  });
});

describe('mark, an element added or removed', () => {
  test('gets a box with nothing on it', () => {
    const p = page('<p>aa</p><hr style="height:4px">');
    p.mark(marks({ looks: [{ index: 1, badge: { plain: true } }] }));
    const [box, ...more] = drawn();
    expect(more).toHaveLength(0);
    expect(box.children).toHaveLength(0);
  });

  test('on the other page, takes the element beside its place in whole', () => {
    const p = page('<p>aa</p><p>bb</p>');
    const { looks } = p.mark(
      marks({
        looks: [
          { index: 0, badge: null, edge: 'bottom', beside: true },
          { index: 0, badge: null, edge: 'bottom' },
        ],
      }),
    );
    expect([looks[0].top, looks[0].bottom]).toEqual([0, 24]);
    expect([looks[1].top, looks[1].bottom]).toEqual([24, 24]);
  });
});

describe('mark, inside a shadow tree', () => {
  test('boxes its changed words, and adds no node and no style to the tree', () => {
    const p = page('<p>Before</p><x-card></x-card>');
    const root = document.querySelector('x-card')!.shadowRoot!;
    const nodes = root.childNodes.length;
    const top = root.querySelector('#top')!.getBoundingClientRect();
    p.mark(marks({ words: [{ changed: [1, 2], anchors: [0] }] })); // "Top line"
    expect(root.adoptedStyleSheets).toHaveLength(0);
    expect(root.childNodes.length).toBe(nodes);
    const [box] = drawn().map(element => element.getBoundingClientRect());
    expect(box.top).toBeLessThanOrEqual(top.top);
    expect(box.bottom).toBeGreaterThanOrEqual(top.top + 16); // around the line of words
  });

  test('a change in it is inside --selector when the element around the tree is', () => {
    const p = page('<main><x-card></x-card></main><aside><x-card></x-card></aside>');
    const tops = p.reading.elements.flatMap((e, i) => (e.signature === 'P #top Top line' ? [i] : []));
    const { words, looks } = p.mark(
      marks({
        within: 'main',
        words: [
          { changed: [0], anchors: [] }, // "Top", in main's card
          { changed: [5], anchors: [] }, // "Top", in the aside's
        ],
        looks: tops.map(index => ({ index, badge: { label: 'colour' } })),
      }),
    );
    expect(words.map(w => w!.inside)).toEqual([true, false]);
    expect(looks.map(l => l.inside)).toEqual([true, false]);
  });

  test('a change in it past the edge of a scroll area around the tree is clipped, not boxed', () => {
    // The scroll area shows the card's first 24px line: "Top line" is in view, "Bottom" is not.
    const p = page('<div style="height:24px;overflow:auto"><x-card></x-card></div>');
    const bottom = p.reading.elements.findIndex(e => e.signature === 'P Bottom');
    const { words, looks } = p.mark(
      marks({
        words: [
          { changed: [0], anchors: [1] }, // "Top"
          { changed: [4], anchors: [3] }, // "Bottom"
        ],
        looks: [{ index: bottom, badge: { label: 'colour' } }],
      }),
    );
    expect(words.map(w => w!.clipped)).toEqual([false, true]);
    expect(looks[0].clipped).toBe(true);
    expect(drawn()).toHaveLength(1); // the box on "Top"
  });
});

describe('inside --selector', () => {
  test("is the element's tree, not where layout puts it: its ancestor and a column beside it are outside", () => {
    const p = page(
      '<div id="wrap" style="padding:8px"><main style="width:300px">in here</main>' +
        '<aside style="position:absolute;top:8px;left:320px">beside</aside></div>',
    );
    const index = (tag: string) => p.reading.elements.findIndex(e => e.tag === tag);
    const { words, looks } = p.mark(
      marks({
        within: 'main',
        words: [
          { changed: [0], anchors: [1] }, // "in", in main
          { changed: [2], anchors: [] }, // "beside", in the aside, at main's height
        ],
        looks: [
          { index: index('main'), badge: { label: 'colour' } },
          { index: index('div'), badge: { label: 'spacing' } }, // the wrapper around main
        ],
      }),
    );
    expect(words.map(w => w!.inside)).toEqual([true, false]);
    expect(looks.map(l => l.inside)).toEqual([true, false]);
  });
});

describe('cut off', () => {
  test("a change past a scroll area's edge gets no box and says it is clipped; one in view is boxed", () => {
    // The scroll area shows one 24px line: "aa bb" is in view, "cc dd" 48px down is not.
    const p = page(
      '<div style="height:24px;overflow:auto"><p>aa bb</p><p>cc dd</p></div>' +
        '<div style="height:10px;overflow:hidden"><button style="position:fixed;top:200px">fixed</button></div>',
    );
    const index = (signature: string) => p.reading.elements.findIndex(e => e.signature === signature);
    const { words, looks } = p.mark(
      marks({
        words: [
          { changed: [0], anchors: [1] },
          { changed: [2], anchors: [3] },
        ],
        looks: [
          { index: index('P cc dd'), badge: { label: 'colour' } },
          { index: index('BUTTON fixed'), badge: { label: 'colour' } }, // fixed: the box around it does not clip it
        ],
      }),
    );
    expect(words.map(w => w!.clipped)).toEqual([false, true]);
    expect(words[1]!.changed).toBeNull();
    expect(looks.map(l => l.clipped)).toEqual([true, false]);
    expect(drawn()).toHaveLength(2); // the box on "aa", and the button's
  });

  test('a box goes around what shows of an element a scroll area cuts in part', () => {
    const p = page(
      '<div style="height:30px;overflow:hidden;margin-top:40px"><section style="height:300px">tall</section></div>',
    );
    const index = p.reading.elements.findIndex(e => e.tag === 'section');
    const { looks } = p.mark(marks({ looks: [{ index, badge: { disc: { src: 'data:,', size: 10 } } }] }));
    const [box] = drawn();
    expect(box.getBoundingClientRect().height).toBe(30 + 2 * 6); // the 30px shown, and the box's margin
    expect(looks[0].clipped).toBe(false);
  });
});

describe('unmark', () => {
  test("takes back only the given changes' boxes, outlines and discs", () => {
    const p = page(
      '<p>aa bb</p><p>cc <img src="pics/x.png" width="10" height="10" style="outline:1px dotted blue"> dd</p>' +
        '<button style="position:absolute;top:200px;left:20px">b</button>',
    );
    const image = document.querySelector('img')!;
    const pageOutline = image.style.outline;
    const button = p.reading.elements.findIndex(e => e.tag === 'button');
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    p.mark(
      marks({
        words: [
          { changed: [0], anchors: [1] },
          { changed: [3], anchors: [2, 4] }, // the image
        ],
        looks: [{ index: button, badge: { disc: { src, size: 24 } } }],
      }),
    );
    expect(drawn()).toHaveLength(4); // a box per word change, the look's box and its disc
    expect(image.style.outlineStyle).toBe('solid');

    p.unmark({ words: [1], looks: [0] });
    expect(drawn()).toHaveLength(1); // the first word change's box
    expect(image.style.outline).toBe(pageOutline); // as the page had it

    p.unmark({ words: [0], looks: [] });
    expect(drawn()).toHaveLength(0);
  });
});

describe('snap', () => {
  test('moves an edge that would cut a line of text off it', () => {
    const p = page('<p>first line</p><p>second line</p>');
    // The second line runs from 48px to 72px; edges inside it move to its outside.
    expect(p.snap({ top: 60, bottom: 200 }).top).toBeLessThanOrEqual(48);
    expect(p.snap({ top: 0, bottom: 60 }).bottom).toBeGreaterThanOrEqual(72);
    // Edges between lines stay.
    expect(p.snap({ top: 30, bottom: 40 })).toEqual({ top: 30, bottom: 40 });
  });
});
