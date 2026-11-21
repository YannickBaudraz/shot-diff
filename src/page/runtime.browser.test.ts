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

  test('draws nothing for them unless asked', () => {
    document.body.innerHTML = STYLE + '<p>keep</p><p class="data">12</p>';
    const p = new Function(
      `return (${runtime.toString()})(${JSON.stringify(PROPS)}, ${JSON.stringify(['.data'])})`,
    )() as Runtime;
    p.mark(marks({}));
    expect(drawn()).toHaveLength(0);
  });

  test('gets a dashed box saying so when the page is marked, one for an area in another', () => {
    document.body.innerHTML = STYLE + '<p>keep</p><div class="data"><p class="data">12</p></div>';
    const p = new Function(
      `return (${runtime.toString()})(${JSON.stringify(PROPS)}, ${JSON.stringify(['.data'])}, true)`,
    )() as Runtime;
    p.mark(marks({}));
    const [box, ...more] = drawn();
    expect(more).toHaveLength(0);
    expect(box.style.borderStyle).toBe('dashed');
    expect(box.textContent).toBe('ignored');
  });
});

describe('read', () => {
  test('lists visible words and images in order, and leaves hidden text out', () => {
    const p = page(
      '<p>One two</p><p style="display:none">hidden</p><img src="pics/logo.png" width="10" height="10"><p>three</p>',
    );
    expect(p.reading.words).toEqual(['One', 'two', '[image logo.png]', 'three']);
  });

  test('says where each word shows on the page, and nothing of one a scroll area cuts off', () => {
    const p = page(
      '<p>One two</p><div style="height:24px;overflow:hidden"><p style="margin:0">in</p><p>out</p></div>',
    );
    const [one, two, inside, out] = p.reading.places;
    expect(one!.top).toBe(two!.top);
    expect(one!.bottom).toBeLessThanOrEqual(inside!.top);
    expect(out).toBeNull();
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
  test('boxes a wrapped change line by line where its lines are not side by side, and paints nothing over the words', () => {
    // "cc dd ee" ends the first line, "ff gg" starts the second: no width is under both.
    const p = page('<p style="width:120px">aa bb cc dd ee ff gg hh</p>');
    const marked = p.mark(marks({ words: [{ changed: [2, 3, 4, 5, 6], anchors: [1, 7] }] }));
    expect(CSS.highlights.size).toBe(0);
    const boxes = drawn();
    expect(boxes.length).toBeGreaterThan(1);
    for (const box of boxes) expect(box.getBoundingClientRect().height).toBeLessThan(36); // one 24px line each
    const { changed } = marked.words[0]!;
    expect(changed!.top).toBeLessThan(changed!.bottom);
  });

  test('marks a change over several lines, starting and ending inside them, with one outline around its words alone', () => {
    const p = page('<p style="width:150px">aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr</p>');
    const changed = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    p.mark(marks({ words: [{ changed, anchors: [0, 1, 2, 13, 14, 15] }] }));
    const [mark, ...more] = drawn();
    expect(more).toHaveLength(0);
    const outline = [...mark.querySelectorAll('path')].at(-1)!;
    const origin = mark.getBoundingClientRect();
    const words = document.querySelector('p')!.firstChild as Text;
    expect(
      words.data.split(' ').map((_, i) => {
        const range = document.createRange();
        range.setStart(words, i * 3);
        range.setEnd(words, i * 3 + 2);
        const word = range.getBoundingClientRect();
        const center = new DOMPoint(
          word.left + word.width / 2 - origin.left,
          word.top + word.height / 2 - origin.top,
        );
        return outline.isPointInFill(center);
      }),
    ).toEqual(words.data.split(' ').map((_, i) => changed.includes(i)));
  });

  test('a change is placed by the unchanged words near it, not by those past a gap', () => {
    const p = page('<p>aa bb</p><div style="height:2000px"></div><p>cc dd</p>');
    const { words } = p.mark(marks({ words: [{ changed: [1], anchors: [0, 2, 3] }] }));
    expect(words[0]!.bottom).toBeLessThan(200); // not down to "cc dd", 2000px below
  });

  test('boxes a block whose words all changed once, however many lines it wraps to', () => {
    const p = page('<p style="width:120px">aa bb cc dd ee ff gg hh</p><p>ii jj</p>');
    p.mark(marks({ words: [{ changed: [0, 1, 2, 3, 4, 5, 6, 7], anchors: [8] }] }));
    const [box, ...more] = drawn();
    expect(more).toHaveLength(0);
    expect(box.getBoundingClientRect().height).toBeGreaterThan(36); // around every line of the block
  });

  test('keeps the line of a word box off an unchanged word written against it', () => {
    // "8" ends the link and "," starts the text after it, with no space between them.
    const p = page('<p><a href="#4">Steps 4 to 8</a>, 10 and 13 have one, <a href="#8">step 8</a></p>');
    p.mark(marks({ words: [{ changed: [4, 5], anchors: [2, 3, 6, 7] }] }));
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('a')!);
    const eight = range.getBoundingClientRect();
    const [box] = drawn();
    // The 1px ring outside the line may touch the rectangle of the "8", which ends with a margin of its letter.
    expect(box.getBoundingClientRect().left).toBeGreaterThanOrEqual(eight.right);
  });

  test('gives every box a white ring outside it, thinner on a word box, which is close to other words', () => {
    const p = page('<p>aa bb</p><button style="position:absolute;top:100px;left:20px">b</button>');
    const button = p.reading.elements.findIndex(e => e.tag === 'button');
    p.mark(
      marks({
        words: [{ changed: [0], anchors: [1] }],
        looks: [{ index: button, badge: { label: 'background' } }],
      }),
    );
    const [word, element] = drawn();
    expect(word.style.borderWidth).toBe('2px');
    expect(word.style.boxShadow).toContain('255, 255, 255');
    expect(word.style.boxShadow).toContain('1px');
    expect(element.style.boxShadow).toContain('255, 255, 255');
    expect(element.style.boxShadow).toContain('2px');
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

  test("a label does not cross another box's line when a place keeps clear of it", () => {
    // Two boxes 12px apart: above the lower one, its label would cross the upper one's bottom line.
    const p = page(
      '<div style="height:40px;margin:60px 20px 0;width:200px" id="a"></div>' +
        '<div style="height:40px;margin:12px 20px 0;width:200px" id="b"></div>',
    );
    const index = (id: string) => p.reading.elements.findIndex(e => e.signature.includes(`#${id}`));
    p.mark(
      marks({
        looks: [
          { index: index('a'), badge: { label: 'size' } },
          { index: index('b'), badge: { label: 'corners' } },
        ],
      }),
    );
    const [upper, lower] = drawn().map(box => box.getBoundingClientRect());
    const label = drawn()[1].firstElementChild!.getBoundingClientRect();
    const crossesUpper = label.top < upper.bottom && label.bottom > upper.bottom - 3;
    expect(crossesUpper).toBe(false);
    expect(label.top).toBeGreaterThanOrEqual(lower.top - 1);
  });

  test('a label goes inside its box, at the top, when every place outside hides words', () => {
    const line = (text: string) =>
      `<p style="margin:0;width:300px;text-align-last:justify">${text} ${text} ${text} ${text} ${text}</p>`;
    const p = page(
      line('above') +
        '<div id="x" style="height:60px;width:300px;margin:10px 0"></div>' +
        line('below') +
        '<span style="position:absolute;left:300px;top:30px">beside beside beside beside</span>',
    );
    const index = p.reading.elements.findIndex(e => e.signature.includes('#x'));
    p.mark(marks({ looks: [{ index, badge: { label: 'size' } }] }));
    const box = drawn()[0].getBoundingClientRect();
    const label = drawn()[0].firstElementChild!.getBoundingClientRect();
    expect(label.top).toBeGreaterThanOrEqual(box.top);
    expect(label.bottom).toBeLessThanOrEqual(box.bottom);
  });

  test("a label stays on the page beside a box at the page's right edge", () => {
    const p = page('<button style="position:absolute;top:100px;right:10px">b</button>');
    const index = p.reading.elements.findIndex(e => e.tag === 'button');
    p.mark(marks({ looks: [{ index, badge: { label: 'text colour, background, border colour' } }] }));
    const label = drawn()[0].firstElementChild!.getBoundingClientRect();
    expect(label.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
    expect(label.left).toBeGreaterThanOrEqual(0);
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

  test('tints the inside of a word box faintly in its colour, so unchanged words between two changes stay plain', () => {
    const p = page('<p>aa bb cc</p>');
    p.mark(marks({ words: [{ changed: [1], anchors: [0, 2] }] }));
    const [box] = drawn();
    // The colour at 14%: see-through, the words under it still read.
    expect(getComputedStyle(box).backgroundColor).toMatch(/^color\(srgb 1 0 0 \/ 0\.14\)$/);
  });

  test('tints the inside of an outline over several lines the same, and not its white ring', () => {
    const p = page('<p style="width:150px">aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr</p>');
    p.mark(marks({ words: [{ changed: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], anchors: [2, 13] }] }));
    const [ring, line] = [...drawn()[0].querySelectorAll('path')];
    expect(line.getAttribute('fill')).toBe('red');
    expect(line.getAttribute('fill-opacity')).toBe('0.14');
    expect(ring.getAttribute('fill')).toBe('none');
  });

  test('does not tint a changed picture: the tint would change the very thing the shot shows', () => {
    const src =
      'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22/%3E';
    const p = page(`<p>aa <img src="${src}" alt="logo" width="40" height="40"> bb</p>`);
    p.mark(marks({ words: [{ changed: [1], anchors: [0, 2] }] }));
    for (const box of drawn()) expect(getComputedStyle(box).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  });

  test('still tints the words of a change that also has a picture: only the box on the picture is plain', () => {
    const src =
      'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22/%3E';
    const p = page(`<p>aa <img src="${src}" alt="logo" width="40" height="40"> bb<br>cc dd<br>ee ff gg</p>`);
    p.mark(marks({ words: [{ changed: [1, 5, 6], anchors: [0, 7] }] }));
    const [onPicture, onWords] = drawn();
    expect(getComputedStyle(onPicture).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(onWords).backgroundColor).toMatch(/0\.14\)$/);
  });

  test('does not tint the box of a change of look: it is around an element, which shows as it is', () => {
    const p = page('<button style="position:absolute;top:100px;left:20px">x</button>');
    p.mark(marks({ looks: [{ index: 0, badge: { plain: true } }] }));
    expect(getComputedStyle(drawn()[0]).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  });

  test('a word change says how far across its box goes, where the page has a box for it', () => {
    const p = page('<p style="margin-left:100px;width:200px">aa bb cc</p>');
    const { words } = p.mark(marks({ words: [{ changed: [1], anchors: [0, 2] }] }));
    const [box] = drawn();
    const { left, right } = box.getBoundingClientRect();
    expect(left).toBeGreaterThan(100);
    expect(words[0]!.across).toEqual({ left, right });
    // No box on a page with nothing of the change: none to say.
    const none = page('<p>aa bb</p>').mark(marks({ words: [{ changed: [], anchors: [0] }] }));
    expect(none.words[0]!.across).toBeUndefined();
  });

  test('a change of look says how far across its box and its label go: a label can run past the box', () => {
    const p = page('<button style="position:absolute;top:100px;left:20px">x</button>');
    const { looks } = p.mark(marks({ looks: [{ index: 0, badge: { label: 'background-color' } }] }));
    const [box] = drawn();
    const label = box.firstElementChild!.getBoundingClientRect();
    expect(label.right).toBeGreaterThan(box.getBoundingClientRect().right);
    expect(looks[0].across).toEqual({
      left: Math.min(label.left, box.getBoundingClientRect().left),
      right: label.right,
    });
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

describe('mark, the heading of what a change is in', () => {
  const cards =
    '<p>intro</p><div style="display:flex;gap:20px">' +
    '<article><h3 style="margin:0">Refinement</h3><p>aa</p></article>' +
    '<article><h3 style="margin:0">Tickets</h3><p>bb</p><div style="height:300px"></div>' +
    '<div><p>Tickets with edges. cc dd</p><hr></div></article></div>';
  const headingTop = (text: string) =>
    [...document.querySelectorAll('h3')].find(h => h.textContent === text)!.getBoundingClientRect().top;

  test("is said for a word change: the card's title, however far above it", () => {
    const p = page(cards);
    const { words } = p.mark(marks({ words: [{ changed: [8, 9], anchors: [5, 6, 7] }] }));
    expect(words[0]!.heading).toBe(headingTop('Tickets'));
  });

  test('is said for a change of look, and for the place of an element the page has not', () => {
    const p = page(cards);
    const hr = p.reading.elements.findIndex(e => e.tag === 'hr');
    const { looks } = p.mark(
      marks({
        looks: [
          { index: hr, badge: { plain: true } },
          { index: hr, badge: null, edge: 'top' },
        ],
      }),
    );
    expect(looks.map(look => look.heading)).toEqual([headingTop('Tickets'), headingTop('Tickets')]);
  });

  test('is none for a change with no heading before it in what it is in, nor the page banner', () => {
    const p = page('<header><nav>menu</nav><h1>Acme</h1></header><main><p>aa bb</p></main>');
    const { words } = p.mark(marks({ words: [{ changed: [3], anchors: [2] }] }));
    expect(words[0]!.heading).toBeUndefined();
  });

  test('is the heading itself for a change in one, or with none on this page, for an unchanged word in one', () => {
    const p = page('<p>intro</p><h3>Tickets</h3><p>aa bb</p>');
    const { words } = p.mark(
      marks({
        words: [
          { changed: [1], anchors: [0] },
          { changed: [], anchors: [1, 2] },
        ],
      }),
    );
    const top = document.querySelector('h3')!.getBoundingClientRect().top;
    expect(words.map(word => word!.heading)).toEqual([top, top]);
  });
});

describe('mark, the part of the page a change is in', () => {
  const change = { words: [{ changed: [1], anchors: [0] }] };

  test('is the card around it, by its id: the widest thing around the change that is still narrower than the page', () => {
    const p = page(
      '<div id="row" style="display:flex"><div id="card" style="width:300px"><p>aa bb</p></div></div>',
    );
    expect(p.mark(marks(change)).words[0]!.area).toBe('#card');
  });

  test('is a column with no id, by its way down from the nearest id', () => {
    const p = page(
      '<section id="rules"><div style="display:flex">' +
        '<div style="width:300px"><p>aa bb</p></div><div style="width:300px"><p>cc</p></div>' +
        '</div></section>',
    );
    const { area } = p.mark(marks(change)).words[0]!;
    expect(area).toBe('#rules > div:nth-child(1) > div:nth-child(1)');
    expect(document.querySelector(area!)).toBe(document.querySelector('p')!.parentElement);
  });

  test('is not a link or a word in a line as wide as the page: with nothing narrow around it, the nearest id', () => {
    const p = page('<main id="main"><p>aa <a href="#x">bb</a></p></main>');
    expect(p.mark(marks(change)).words[0]!.area).toBe('#main');
  });

  test('is none where nothing around the change is narrow or has an id', () => {
    const p = page('<p>aa bb</p>');
    expect(p.mark(marks(change)).words[0]!.area).toBeUndefined();
  });

  test('is found through a tag no selector can be written with as it is, and the run goes on', () => {
    document.body.innerHTML = STYLE;
    const odd = document.body.appendChild(document.createElement('o:p'));
    odd.innerHTML = '<div style="width:300px"><p>aa bb</p></div>';
    const p = install();
    const { area } = p.mark(marks(change)).words[0]!;
    expect(document.querySelector(area!)).toBe(odd.firstElementChild);
  });

  test('is said for a change of look too', () => {
    const p = page('<div id="card" style="width:300px"><button>x</button></div>');
    const { looks } = p.mark(marks({ looks: [{ index: 1, badge: { plain: true } }] }));
    expect(looks[0].area).toBe('#card');
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

describe('region', () => {
  test("is where the element is, across as well as down, in the page's pixels", () => {
    const p = page('<div id="card" style="margin:30px 0 0 100px;width:300px;height:50px"></div>');
    expect(p.region('#card')).toEqual({ top: 30, bottom: 80, left: 100, right: 400 });
  });

  test('is null for an element the page has not', () => {
    expect(page('<p>text</p>').region('#none')).toBeNull();
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

  test('moves an edge to the room after the line it cut, not on down a paragraph whose lines leave less room', () => {
    // Lines 20px apart, whose letters leave a pixel or two between them: less than an edge keeps off a line.
    const p = page(
      `<p style="width:120px;line-height:20px">${'aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr ss tt'}</p>`,
    );
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('p')!);
    const [first, second, third] = [...range.getClientRects()].filter(r => r.width);
    expect(third.top - second.bottom).toBeLessThan(6);
    const { bottom } = p.snap({ top: 0, bottom: (second.top + second.bottom) / 2 });
    expect(bottom).toBeGreaterThanOrEqual(second.bottom);
    expect(bottom).toBeLessThanOrEqual(third.top);
    const { top } = p.snap({ top: (second.top + second.bottom) / 2, bottom: 200 });
    expect(top).toBeLessThanOrEqual(second.top);
    expect(top).toBeGreaterThanOrEqual(first.bottom);
  });
});

describe('snap, the top of a shot inside an item', () => {
  // Three items of three lines each, 24px a line and 24px between them.
  const items = () => page('<p>a1<br>a2<br>a3</p><p>b1<br>b2<br>b3</p><p>c1<br>c2<br>c3</p>');
  /** The lines of text of the item at `index`, top to bottom. */
  const lines = (index: number) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelectorAll('p')[index]);
    return [...range.getClientRects()].filter(r => r.width);
  };

  test('goes to the top of the item when there is room for it, not mid-item between two lines', () => {
    const p = items();
    const [b1, b2] = lines(1);
    const between = (b1.bottom + b2.top) / 2;
    const { top } = p.snap({ top: between, bottom: 400, room: 500, keep: 400 });
    expect(top).toBeGreaterThanOrEqual(lines(0)[2].bottom); // not up into the item before
    expect(top).toBeLessThanOrEqual(b1.top);
  });

  test('goes down to the top of the next item when the item is too tall to take in, if the change stays in', () => {
    const p = items();
    const [b1, b2] = lines(1);
    const [c1] = lines(2);
    const { top } = p.snap({ top: (b1.bottom + b2.top) / 2, bottom: 400, room: 10, keep: c1.top });
    expect(top).toBeGreaterThanOrEqual(lines(1)[2].bottom);
    expect(top).toBeLessThanOrEqual(c1.top);
  });

  test('stays where the change itself is in the item: only a line of text is not cut', () => {
    const p = items();
    const [b1, b2] = lines(1);
    const between = (b1.bottom + b2.top) / 2;
    expect(p.snap({ top: between, bottom: 400, room: 10, keep: between }).top).toBe(between);
    const middle = (b2.top + b2.bottom) / 2; // in a line: off it, as before
    const { top } = p.snap({ top: middle, bottom: 400, room: 10, keep: middle });
    expect(top).toBeLessThanOrEqual(b2.top);
    expect(top).toBeGreaterThanOrEqual(b1.bottom);
  });

  test('counts the clearance above the item in the room: the shot is no taller than it was given room for', () => {
    const p = items();
    const [b1, b2] = lines(1);
    const between = (b1.bottom + b2.top) / 2;
    const exactly = between - b1.top; // reaches the first line, but not the clearance above it
    expect(p.snap({ top: between, bottom: 400, room: exactly, keep: between }).top).toBe(between);
    const { top } = p.snap({ top: between, bottom: 400, room: exactly + 12, keep: between });
    expect(between - top).toBeLessThanOrEqual(exactly + 12);
    expect(top).toBeLessThanOrEqual(b1.top);
  });

  test('is the item the edge is in, not a block whose text runs on both sides of a list it holds', () => {
    // The block's own lines, d1 d2 and d3, run from the top to the bottom, with a list in between.
    const p = page(
      '<div>d1<br>d2<ul style="margin:24px 0;padding:0;list-style:none"><li>a1<br>a2</li><li style="margin-top:24px">b1<br>b2</li></ul>d3</div>',
    );
    const range = (el: Element) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return [...r.getClientRects()].filter(x => x.width);
    };
    const [li1, li2] = [...document.querySelectorAll('li')].map(range);
    const between = (li2[0].bottom + li2[1].top) / 2;
    const { top } = p.snap({ top: between, bottom: 600, room: 600, keep: 600 });
    expect(top).toBeGreaterThanOrEqual(li1[1].bottom); // the second list item's start, not "d1"
    expect(top).toBeLessThanOrEqual(li2[0].top);
  });

  test('is not in an item for text a scroll area hides: what does not show is no item', () => {
    // Ten lines in a panel that shows three: the other seven would run on down the page, unseen.
    const p = page(
      '<div style="height:72px;overflow:auto"><p>l1<br>l2<br>l3<br>l4<br>l5<br>l6<br>l7<br>l8<br>l9<br>l10</p></div>' +
        '<div style="height:400px"></div><p>end</p>',
    );
    const [, , , , , , l7, l8] = lines(0);
    const between = (l7.bottom + l8.top) / 2; // under the panel, between two lines that do not show
    expect(between).toBeGreaterThan(72);
    expect(p.snap({ top: between, bottom: 600, room: 500, keep: 600 }).top).toBe(between);
  });

  test('stays when going up and moving the bottom off its line would make the shot taller than its room', () => {
    const p = items();
    const [b1, b2] = lines(1);
    const [, c2] = lines(2);
    const between = (b1.bottom + b2.top) / 2;
    const cut = (c2.top + c2.bottom) / 2; // the bottom is in a line, and moves down off it
    const up = between - p.snap({ top: between, bottom: 400, room: 500, keep: between }).top;
    // Room for the top alone: with the bottom's move the shot would be over it.
    expect(p.snap({ top: between, bottom: cut, room: up, keep: between }).top).toBe(between);
    // Room for both: the top goes up.
    expect(p.snap({ top: between, bottom: cut, room: up + 30, keep: between }).top).toBe(between - up);
  });

  test('goes down to the next item when going up and moving the bottom would be over its room, if the change stays in', () => {
    const p = items();
    const [b1, b2, b3] = lines(1);
    const [c1, c2] = lines(2);
    const between = (b1.bottom + b2.top) / 2;
    const up = between - p.snap({ top: between, bottom: 400, room: 500, keep: between }).top;
    const { top } = p.snap({ top: between, bottom: (c2.top + c2.bottom) / 2, room: up, keep: c1.top });
    expect(top).toBeGreaterThanOrEqual(b3.bottom);
    expect(top).toBeLessThanOrEqual(c1.top);
  });

  test('goes down past the item to just above the change, when the change starts above the next line of text, as a box around an item does', () => {
    const p = items();
    const [b1, b2, b3] = lines(1);
    const [c1] = lines(2);
    const boxTop = c1.top - 6; // the top of a box drawn around the third item
    const { top } = p.snap({ top: (b1.bottom + b2.top) / 2, bottom: 400, room: 10, keep: boxTop });
    expect(top).toBeGreaterThanOrEqual(b3.bottom);
    expect(top).toBeLessThanOrEqual(boxTop);
  });

  test('is as before with no room given', () => {
    const p = items();
    const [b1, b2] = lines(1);
    const between = (b1.bottom + b2.top) / 2;
    expect(p.snap({ top: between, bottom: 400 }).top).toBe(between);
  });
});
