// Changes with no words in them: an element whose look changed (a colour, a border, its size), found
// by pairing the elements of the two pages and comparing what the browser computed for them.

import { diffArrays } from 'diff';

/** One visible element, as elements() in page.ts reads it. */
export type El = {
  sig: string; // what pairs it with its match on the other page: tag, id, role, own words, image file
  parent: number; // the index of its nearest listed ancestor, or -1
  leaf: boolean; // no listed element inside it
  paint: boolean; // draws pixels its style does not describe: an image, a canvas, an SVG, a background image
  width: number;
  height: number;
  style: Record<string, string>;
};

/** The computed properties compared, and what to call each in a label. */
export const PROPERTIES: Record<string, string> = {
  'color': 'text colour',
  'background-color': 'background',
  'background-image': 'background image',
  'border-top-color': 'border colour', 'border-right-color': 'border colour',
  'border-bottom-color': 'border colour', 'border-left-color': 'border colour',
  'border-top-width': 'border', 'border-right-width': 'border', 'border-bottom-width': 'border', 'border-left-width': 'border',
  'border-top-style': 'border', 'border-right-style': 'border', 'border-bottom-style': 'border', 'border-left-style': 'border',
  'border-top-left-radius': 'corners', 'border-top-right-radius': 'corners',
  'border-bottom-left-radius': 'corners', 'border-bottom-right-radius': 'corners',
  'outline-color': 'outline', 'outline-style': 'outline', 'outline-width': 'outline',
  'box-shadow': 'shadow',
  'opacity': 'opacity',
  'font-family': 'font', 'font-size': 'text size', 'font-weight': 'weight', 'font-style': 'italic',
  'text-decoration-line': 'underline', 'text-transform': 'case', 'letter-spacing': 'letter spacing',
  'line-height': 'line height', 'text-align': 'alignment',
  'padding-top': 'spacing', 'padding-right': 'spacing', 'padding-bottom': 'spacing', 'padding-left': 'spacing',
  'margin-top': 'spacing', 'margin-right': 'spacing', 'margin-bottom': 'spacing', 'margin-left': 'spacing',
  'gap': 'spacing',
  'display': 'layout', 'flex-direction': 'layout', 'justify-content': 'alignment', 'align-items': 'alignment',
  'filter': 'filter', 'transform': 'transform',
};

/** Properties a child takes from its parent: a change there shows on the parent alone. */
const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
  'line-height', 'text-align', 'text-transform']);

/** Elements that are the same on both pages, as [before index, after index]: the elements of each
 * page in document order, diffed on their signatures. */
export function pairs(a: readonly El[], b: readonly El[]): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (const change of diffArrays(a.map(e => e.sig), b.map(e => e.sig))) {
    if (change.removed) x += change.count;
    else if (change.added) y += change.count;
    else for (let i = 0; i < change.count; i++) out.push([x++, y++]);
  }
  return out;
}

export type Restyled = { a: number; b: number; what: string[] };

/** Paired elements whose look changed, with what changed in words. A change a child only inherits
 * from its parent is left to the parent; a size is compared on leaf elements only, since a box
 * grows with whatever is added inside it. */
export function restyled(a: readonly El[], b: readonly El[], paired: readonly [number, number][]): Restyled[] {
  const out: Restyled[] = [];
  for (const [i, j] of paired) {
    const ea = a[i];
    const eb = b[j];
    const what = new Set<string>();
    for (const [property, label] of Object.entries(PROPERTIES)) {
      const before = ea.style[property];
      const after = eb.style[property];
      if (before === after) continue;
      if (INHERITED.has(property)) {
        const pa = a[ea.parent];
        const pb = b[eb.parent];
        if (pa && pb && pa.style[property] === before && pb.style[property] === after) continue;
      }
      what.add(label);
    }
    if (ea.leaf && eb.leaf && (Math.abs(ea.width - eb.width) > 1 || Math.abs(ea.height - eb.height) > 1)) what.add('size');
    if (what.size) out.push({ a: i, b: j, what: [...what] });
  }
  return out;
}

/** Paired elements that draw their own pixels and whose look did not change otherwise: the ones
 * to compare pixel by pixel. */
export function painted(a: readonly El[], b: readonly El[], paired: readonly [number, number][], changed: readonly Restyled[]): [number, number][] {
  const done = new Set(changed.map(c => c.a));
  return paired.filter(([i, j]) => a[i].paint && b[j].paint && !done.has(i));
}
