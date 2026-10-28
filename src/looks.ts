// Changes of look: changes with no words in them. An element whose look changed (a colour, a border,
// a size set in CSS), found by pairing the elements of the two pages and comparing what the browser
// computed for them; and a picture redrawn, found by comparing its pixels.

import { diffArrays } from 'diff';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';

/** What the comparison needs from a loaded page: its elements, and a PNG of one element's own
 * pixels (null when it cannot be shot). loaded.ts gives the real one. */
export type Seen = { elements: El[]; pixels(index: number): Promise<Buffer | null> };

/** A change of look: the element on each page (indexes into their elements), what changed, and what
 * to call it in a list of changes. */
export type Look = { a: number; b: number; what: string[]; name: string };

/** The most pictures compared pixel by pixel, so a page of thumbnails stays quick. */
export const MAX_PICTURES = 300;

/** The changes of look between two pages, top to bottom on the before page. Read the pages before
 * anything is drawn over them. */
export async function looks(before: Seen, after: Seen): Promise<Look[]> {
  const a = before.elements;
  const b = after.elements;
  const paired = pairs(a, b);
  const found = restyled(a, b, paired);
  for (const [i, j] of painted(a, b, paired, found).slice(0, MAX_PICTURES)) {
    if (await repainted(await before.pixels(i), await after.pixels(j))) found.push({ a: i, b: j, what: ['picture'] });
  }
  return found
    .sort((p, q) => a[p.a].top - a[q.a].top || a[p.a].sig.localeCompare(a[q.a].sig))
    .map(l => ({ ...l, name: `[${a[l.a].sig.split(' ')[0].toLowerCase()}: ${l.what.join(', ')}]` }));
}

/** One visible element, as the page's runtime reads it. */
export type El = {
  sig: string; // what pairs it with its match on the other page: tag, id, role, own words, image file
  parent: number; // the index of its nearest listed ancestor, or -1
  leaf: boolean; // no listed element inside it
  paint: boolean; // draws pixels its style does not describe: an image, a canvas, an SVG, a background image
  top: number; // in page pixels, to number the changes in reading order
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
  'width': 'size', 'height': 'size', 'min-width': 'size', 'max-width': 'size', 'min-height': 'size', 'max-height': 'size',
};

/** Properties a child takes from its parent: a change there shows on the parent alone. */
const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
  'line-height', 'text-align', 'text-transform']);

/** Elements that are the same on both pages, as [before index, after index]: the elements of each
 * page in document order, diffed on their signatures. */
function pairs(a: readonly El[], b: readonly El[]): [number, number][] {
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

type Restyled = { a: number; b: number; what: string[] };

/** Paired elements whose look changed, with what changed in words. A change a child only inherits
 * from its parent is left to the parent. Sizes are compared as the CSS sets them (`auto` stays
 * `auto`), so a box that grows or shrinks with the page around it is not a change. */
function restyled(a: readonly El[], b: readonly El[], paired: readonly [number, number][]): Restyled[] {
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
    if (what.size) out.push({ a: i, b: j, what: [...what] });
  }
  return out;
}

/** Paired elements that draw their own pixels and whose look did not change otherwise: the ones
 * to compare pixel by pixel. */
function painted(a: readonly El[], b: readonly El[], paired: readonly [number, number][], changed: readonly Restyled[]): [number, number][] {
  const done = new Set(changed.map(c => c.a));
  return paired.filter(([i, j]) => a[i].paint && b[j].paint && !done.has(i));
}

/** Whether two shots of an element differ. One that could not be shot is no change; a size that
 * differs is one. */
async function repainted(before: Buffer | null, after: Buffer | null): Promise<boolean> {
  if (!before || !after) return false;
  const raw = (png: Buffer) => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pa = await raw(before);
  const pb = await raw(after);
  if (pa.info.width !== pb.info.width || pa.info.height !== pb.info.height) return true;
  return pixelmatch(pa.data, pb.data, null, pa.info.width, pa.info.height, { threshold: 0.1 }) > 0;
}
