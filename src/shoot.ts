import type { Browser } from 'playwright-core';
import sharp from 'sharp';
import { diff, hunks, type Hunk } from './diff.ts';
import { plan } from './plan.ts';
import { COLOURS, load, type LoadedPage, type Side } from './loaded.ts';
import { DISC, markers, type Marker, type Mode } from './markers.ts';
import type { Box } from './page.ts';
import { pango, text } from './text.ts';
import { looks as compare, type Look } from './looks.ts';

export type Options = {
  before: string;
  after: string;
  title: string;
  width: number;
  height: number;
  scale: number;
  dark: boolean;
  storage: [string, string][];
  click: string[];
  wait: number;
  selector: string | null;
  padding: number;
  maxHeight: number;
  markers: Mode; // what changed, written on each box, or a number on it and the meanings in the band
};

export type ShotSide = { png: Buffer; changed: string[]; box: Box };
export type Shot = { before: ShotSide; after: ShotSide };
/** `left out`: changes found but not in any image (above or below a cut, or outside --selector). */
export type Result = { hunks: number; restyled: number; shots: Shot[]; leftOut: { removed: string[]; added: string[] } };

/** What a numbered box on a shot means: its disc, the same image as on the page, and what changed. */
type Key = { disc: Buffer; what: string };

/** The band's key for numbered boxes: each disc and what it means beside it, laid out in rows no
 * wider than `width`. Returns the pieces to compose, placed from the key's top left corner, and the
 * key's height. */
async function key(keys: Key[], width: number, o: Options) {
  const s = o.scale;
  const discSize = Math.round(DISC * s);
  const gap = Math.round(6 * s); // between a disc and its meaning
  const space = Math.round(24 * s); // between one meaning and the next disc
  const rowGap = Math.round(6 * s);
  const items = await Promise.all(keys.map(async k => ({
    disc: k.disc,
    what: await text(`<span foreground="#1f2328">${pango(k.what)}</span>`, 14, 'Regular', s),
  })));
  const rowHeight = Math.max(discSize, ...items.map(i => i.what.info.height));
  const pieces: { input: Buffer; left: number; top: number }[] = [];
  let x = 0;
  let y = 0;
  for (const { disc: picture, what } of items) {
    const itemWidth = discSize + gap + what.info.width;
    if (x > 0 && x + itemWidth > width) { x = 0; y += rowHeight + rowGap; }
    const middle = (height: number) => y + Math.round((rowHeight - height) / 2);
    pieces.push(
      { input: picture, left: x, top: middle(discSize) },
      { input: what.data, left: x + discSize + gap, top: middle(what.info.height) },
    );
    x += itemWidth + space;
  }
  return { pieces, height: y + rowHeight };
}

/** The shot with a band on top: which side it is, the title, which shot of how many, and what its
 * colour means; under them, when the shot has numbered boxes, what each number means. */
async function titled(png: Buffer, side: Side, n: number, of: number, keys: Key[], o: Options): Promise<Buffer> {
  const s = o.scale;
  const colour = COLOURS[side];
  const { width: w, height: h } = await sharp(png).metadata();
  const band = Math.round(52 * s);
  const line = Math.max(1, Math.round(s));

  const label = await text(`<span foreground="#ffffff">${side === 'before' ? 'Before' : 'After'}</span>`, 15, 'Semi-Bold', s);
  const count = of > 1 ? `<span foreground="#59636e" weight="normal">   ${n} of ${of}</span>` : '';
  const title = await text(`<span foreground="#1f2328">${pango(o.title)}</span>${count}`, 18, 'Semi-Bold', s);
  const meaning = await text(`<span foreground="#1f2328">${side === 'before' ? 'removed' : 'added'}</span>`, 15, 'Regular', s);

  const pill = { w: label.info.width + Math.round(20 * s), h: Math.round(26 * s) };
  const pillSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pill.w}" height="${pill.h}">
    <rect width="${pill.w}" height="${pill.h}" rx="${pill.h / 2}" fill="${colour.color}"/></svg>`;
  const sw = Math.round(16 * s);
  const swatchSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sw}">
    <rect x="${s}" y="${s}" width="${sw - 2 * s}" height="${sw - 2 * s}" rx="${3 * s}" fill="${colour.tint}" stroke="${colour.color}" stroke-width="${2 * s}"/></svg>`;

  const pad = Math.round(16 * s);
  const gap = Math.round(12 * s);
  const mid = (height: number) => Math.round((band - height) / 2) + line;
  const width = w! + 2 * line;

  // The numbers' meanings, each number on a disc like the one on the page, on as many rows as they need.
  const legend = keys.length ? await key(keys, w! - 2 * pad, o) : null;
  const below = legend ? legend.height + Math.round(12 * s) : 0;
  const head = band + below;

  return sharp({ create: { width, height: line + head + line + h! + line, channels: 4, background: '#d0d7de' } })
    .composite([
      { input: { create: { width: w!, height: head, channels: 4, background: '#f6f8fa' } }, left: line, top: line },
      ...(legend ? legend.pieces.map(p => ({ ...p, left: p.left + line + pad, top: p.top + line + band - Math.round(4 * s) })) : []),
      { input: Buffer.from(pillSvg), left: line + pad, top: mid(pill.h) },
      { input: label.data, left: line + pad + Math.round(10 * s), top: mid(label.info.height) },
      { input: title.data, left: line + pad + pill.w + gap, top: mid(title.info.height) },
      { input: meaning.data, left: width - line - pad - meaning.info.width, top: mid(meaning.info.height) },
      { input: Buffer.from(swatchSvg), left: width - line - pad - meaning.info.width - Math.round(6 * s) - sw, top: mid(sw) },
      { input: png, left: line, top: line + head + line },
    ])
    .png()
    .toBuffer();
}

export async function run(browser: Browser, o: Options): Promise<Result> {
  const before = await load(browser, o.before, 'before', o);
  const after = await load(browser, o.after, 'after', o).catch(async error => { await before.close(); throw error; });
  try {
    const found: Hunk[] = hunks(diff(before.words, after.words));

    const looks: Look[] = await compare(before, after); // before anything is drawn over the pages
    const marks: Marker[] = await markers(looks, o.markers, o.scale);
    const markA = await before.mark(found, marks);
    const markB = await after.mark(found, marks);

    // Every change, words and looks: where it is on each page, what it is called in each list, and
    // its marker when it has a numbered one.
    const changes = [
      ...found.map((h, i) => ({
        place: { before: markA.words[i], after: markB.words[i] },
        removed: h.removed.map(t => before.words[t]).join(' '),
        added: h.added.map(t => after.words[t]).join(' '),
        marker: null as Marker | null,
      })),
      ...looks.map((l, i) => ({
        place: { before: markA.looks[i], after: markB.looks[i] },
        removed: l.name,
        added: l.name,
        marker: marks[i] as Marker | null,
      })),
    ];
    const planned = await plan(changes.map(c => c.place), o, { before, after });

    // The band's key: the shot's numbered markers, in their order, with this side's disc.
    const keysOf = (indexes: number[], side: Side): Key[] => indexes.map(i => changes[i].marker)
      .filter(m => m?.disc != null).sort((p, q) => p!.n - q!.n).map(m => ({ disc: m!.disc![side], what: m!.what }));
    const shots: Shot[] = [];
    for (const [n, p] of planned.shots.entries()) {
      shots.push({
        before: {
          png: await titled(await before.shoot(p.before), 'before', n + 1, planned.shots.length, keysOf(p.changes, 'before'), o),
          box: p.before,
          changed: p.changes.map(i => changes[i].removed).filter(Boolean),
        },
        after: {
          png: await titled(await after.shoot(p.after), 'after', n + 1, planned.shots.length, keysOf(p.changes, 'after'), o),
          box: p.after,
          changed: p.changes.map(i => changes[i].added).filter(Boolean),
        },
      });
    }
    const leftOut = {
      removed: planned.leftOut.before.map(i => changes[i].removed),
      added: planned.leftOut.after.map(i => changes[i].added),
    };
    return { hunks: found.length, restyled: looks.length, shots, leftOut };
  } finally {
    await before.close();
    await after.close();
  }
}
