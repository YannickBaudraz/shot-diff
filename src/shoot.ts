import type { Browser, BrowserContext, Page } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { diff, hunks, type Hunk } from './diff.ts';
import { group, outside, type Region } from './group.ts';
import { collect, element, elements, mark, outline, snap, type Box, type MarkOptions, type Marked, type Span } from './page.ts';
import { PROPERTIES, painted, pairs, restyled, type El, type Restyled } from './visual.ts';

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
  markers: 'labels' | 'numbers'; // what changed, written on each box, or a number on it and the meanings in the band
};

export type Side = { png: Buffer; changed: string[]; box: Box };
export type Shot = { before: Side; after: Side };
/** `left out`: changes found but not in any image (above or below a cut, or outside --selector). */
export type Result = { hunks: number; restyled: number; shots: Shot[]; leftOut: { removed: string[]; added: string[] } };

/** The most pictures compared pixel by pixel, so a page of thumbnails stays quick. */
const MAX_PICTURES = 300;

const RED = { color: '#cf222e', tint: 'rgba(255, 129, 130, 0.45)' };
const GREEN = { color: '#1a7f37', tint: 'rgba(74, 194, 107, 0.4)' };

async function open(browser: Browser, url: string, o: Options): Promise<{ context: BrowserContext; page: Page; words: string[] }> {
  const context = await browser.newContext({
    viewport: { width: o.width, height: o.height },
    deviceScaleFactor: o.scale,
    colorScheme: o.dark ? 'dark' : 'light',
    reducedMotion: 'reduce',
  });
  if (o.storage.length) {
    await context.addInitScript(pairs => {
      for (const [key, value] of pairs) localStorage.setItem(key, value);
    }, o.storage);
  }
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  for (const selector of o.click) {
    await page.click(selector);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(o.wait);
  const words = await page.evaluate(collect);
  return { context, page, words };
}

/** The part of the page to shoot around `region`: padded, its edges off any line of text, and cut
 * to the maximum height. */
async function clipOf(page: Page, region: Region | null, width: number, o: Options): Promise<Box> {
  if (!region) return { x: 0, y: 0, width, height: o.height };
  const padded = { top: Math.max(0, region.top - o.padding), bottom: region.bottom + o.padding };
  const { top, bottom } = await page.evaluate(snap, padded);
  return { x: 0, y: top, width, height: Math.min(bottom - top, o.maxHeight) };
}

const shot = (page: Page, clip: Box) => page.screenshot({ clip, fullPage: true, animations: 'disabled' });

const pango = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** Text as an image, drawn by Pango: `size` in points, at 72 dpi per device pixel ratio, so one point
 * is one CSS pixel; wrapped at `wrap` device pixels when given. */
const text = (markup: string, size: number, weight: 'Regular' | 'Semi-Bold', o: Options, wrap?: number) =>
  sharp({ text: { text: markup, font: `sans-serif ${weight} ${size}`, dpi: 72 * o.scale, rgba: true, width: wrap, spacing: 6 * o.scale } })
    .png().toBuffer({ resolveWithObject: true });

/** What a numbered box on a shot means. */
export type Key = { n: number; what: string };

/** The shot with a band on top: which side it is, the title, which shot of how many, and what its
 * colour means; under them, when the shot has numbered boxes, what each number means. */
async function titled(png: Buffer, side: 'before' | 'after', n: number, of: number, keys: Key[], o: Options): Promise<Buffer> {
  const s = o.scale;
  const colour = side === 'before' ? RED : GREEN;
  const { width: w, height: h } = await sharp(png).metadata();
  const band = Math.round(52 * s);
  const line = Math.max(1, Math.round(s));

  const label = await text(`<span foreground="#ffffff">${side === 'before' ? 'Before' : 'After'}</span>`, 15, 'Semi-Bold', o);
  const count = of > 1 ? `<span foreground="#59636e" weight="normal">   ${n} of ${of}</span>` : '';
  const title = await text(`<span foreground="#1f2328">${pango(o.title)}</span>${count}`, 18, 'Semi-Bold', o);
  const meaning = await text(`<span foreground="#1f2328">${side === 'before' ? 'removed' : 'added'}</span>`, 15, 'Regular', o);

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

  // The numbers' meanings, on as many lines as they need.
  const legend = keys.length
    ? await text(keys.map(k => `<span background="${colour.color}" foreground="#ffffff" weight="bold"> ${k.n} </span> ${pango(k.what)}`)
      .join('      '), 14, 'Regular', o, w! - 2 * pad)
    : null;
  const below = legend ? legend.info.height + Math.round(12 * s) : 0;
  const head = band + below;

  return sharp({ create: { width, height: line + head + line + h! + line, channels: 4, background: '#d0d7de' } })
    .composite([
      { input: { create: { width: w!, height: head, channels: 4, background: '#f6f8fa' } }, left: line, top: line },
      ...(legend ? [{ input: legend.data, left: line + pad, top: line + band - Math.round(4 * s) }] : []),
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

/** Whether element `i` of page `a` and element `j` of page `b` draw different pixels. */
async function repainted(a: Page, i: number, b: Page, j: number): Promise<boolean> {
  const pixels = async (page: Page, k: number) => {
    const handle = await page.evaluateHandle(k => (window as unknown as { __shotDiffEls: Element[] }).__shotDiffEls[k], k);
    try {
      const png = await handle.asElement()?.screenshot({ animations: 'disabled' });
      return png ? await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) : null;
    } catch {
      return null; // gone, or not shootable: nothing to compare
    } finally {
      await handle.dispose();
    }
  };
  const pa = await pixels(a, i);
  const pb = await pixels(b, j);
  if (!pa || !pb) return false;
  if (pa.info.width !== pb.info.width || pa.info.height !== pb.info.height) return true;
  return pixelmatch(pa.data, pb.data, null, pa.info.width, pa.info.height, { threshold: 0.1 }) > 0;
}

/** What a restyled element is, in a word, for the lists of changes. */
const named = (el: El, what: string[]) => `[${el.sig.split(' ')[0].toLowerCase()}: ${what.join(', ')}]`;

export async function run(browser: Browser, o: Options): Promise<Result> {
  const before = await open(browser, o.before, o);
  const after = await open(browser, o.after, o);
  try {
    const found: Hunk[] = hunks(diff(before.words, after.words));

    // Looks: compared before anything is drawn over the pages.
    const properties = Object.keys(PROPERTIES);
    const elsA = await before.page.evaluate(elements, properties);
    const elsB = await after.page.evaluate(elements, properties);
    const paired = pairs(elsA, elsB);
    const looks: Restyled[] = restyled(elsA, elsB, paired);
    for (const [i, j] of painted(elsA, elsB, paired, looks).slice(0, MAX_PICTURES)) {
      if (await repainted(before.page, i, after.page, j)) looks.push({ a: i, b: j, what: ['picture'] });
    }

    // Numbered top to bottom, as the shots are read.
    looks.sort((p, q) => elsA[p.a].top - elsA[q.a].top || elsA[p.a].sig.localeCompare(elsA[q.a].sig));

    const markA: Marked = await before.page.evaluate(mark, {
      ...RED, strike: true, hunks: found.map(h => ({ changed: h.removed, anchors: h.anchorsA })),
    } satisfies MarkOptions);
    const markB: Marked = await after.page.evaluate(mark, {
      ...GREEN, strike: false, hunks: found.map(h => ({ changed: h.added, anchors: h.anchorsB })),
    } satisfies MarkOptions);
    const lookA: Span[] = await before.page.evaluate(outline, { color: RED.color, markers: o.markers, items: looks.map((l, i) => ({ index: l.a, n: i + 1, label: l.what.join(', ') })) });
    const lookB: Span[] = await after.page.evaluate(outline, { color: GREEN.color, markers: o.markers, items: looks.map((l, i) => ({ index: l.b, n: i + 1, label: l.what.join(', ') })) });

    // Every change, words and looks, in the order they sit on the page, for grouping into shots.
    const changes = [
      ...found.map((h, i) => ({
        a: markA.spans[i], b: markB.spans[i],
        removed: h.removed.map(t => before.words[t]).join(' '),
        added: h.added.map(t => after.words[t]).join(' '),
        key: null as Key | null,
      })),
      ...looks.map((l, i) => ({
        a: lookA[i], b: lookB[i], removed: named(elsA[l.a], l.what), added: named(elsB[l.b], l.what),
        key: { n: i + 1, what: l.what.join(', ') },
      })),
    ].sort((x, y) => (x.a?.top ?? x.b?.top ?? 0) - (y.a?.top ?? y.b?.top ?? 0));

    let groups = group(changes.map(c => c.a), changes.map(c => c.b), o.padding, o.maxHeight);
    if (o.selector) {
      const a = await before.page.evaluate(element, o.selector);
      const b = await after.page.evaluate(element, o.selector);
      if (!a || !b) throw new Error(`--selector ${o.selector} matches nothing on the ${!a ? 'before' : 'after'} page`);
      groups = [{ hunks: changes.map((_, i) => i), before: a, after: b }];
    } else if (!groups.length) {
      groups = [{ hunks: [], before: null, after: null }];
    }

    const keysOf = (indexes: number[]) => o.markers === 'labels' ? [] : indexes.map(i => changes[i].key).filter(k => k !== null).sort((p, q) => p.n - q.n);
    const shots: Shot[] = [];
    const leftOut = { removed: [] as string[], added: [] as string[] };
    for (const [n, g] of groups.entries()) {
      const clipA = await clipOf(before.page, g.before, markA.width, o);
      const clipB = await clipOf(after.page, g.after, markB.width, o);
      const regionA = { top: clipA.y, bottom: clipA.y + clipA.height };
      const regionB = { top: clipB.y, bottom: clipB.y + clipB.height };
      for (const i of g.hunks) {
        if (outside(changes[i].a, regionA)) leftOut.removed.push(changes[i].removed);
        if (outside(changes[i].b, regionB)) leftOut.added.push(changes[i].added);
      }
      shots.push({
        before: {
          png: await titled(await shot(before.page, clipA), 'before', n + 1, groups.length, keysOf(g.hunks), o),
          box: clipA,
          changed: g.hunks.map(i => changes[i].removed).filter(Boolean),
        },
        after: {
          png: await titled(await shot(after.page, clipB), 'after', n + 1, groups.length, keysOf(g.hunks), o),
          box: clipB,
          changed: g.hunks.map(i => changes[i].added).filter(Boolean),
        },
      });
    }
    return { hunks: found.length, restyled: looks.length, shots, leftOut };
  } finally {
    await before.context.close();
    await after.context.close();
  }
}
