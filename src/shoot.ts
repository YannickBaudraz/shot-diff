import type { Browser, BrowserContext, Page } from 'playwright-core';
import sharp from 'sharp';
import { diff, hunks, type Hunk } from './diff.ts';
import { group, outside, type Region } from './group.ts';
import { collect, element, mark, snap, type Box, type MarkOptions, type Marked } from './page.ts';

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
};

export type Side = { png: Buffer; changed: string[]; box: Box };
export type Shot = { before: Side; after: Side };
/** `left out`: changes found but not in any image (above or below a cut, or outside --selector). */
export type Result = { hunks: number; shots: Shot[]; leftOut: { removed: string[]; added: string[] } };

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

/** A line of text as an image, drawn by Pango: `size` in points, at 72 dpi per device pixel ratio, so one point is one CSS pixel. */
const text = (markup: string, size: number, weight: 'Regular' | 'Semi-Bold', o: Options) =>
  sharp({ text: { text: markup, font: `sans-serif ${weight} ${size}`, dpi: 72 * o.scale, rgba: true } }).png().toBuffer({ resolveWithObject: true });

/** The shot with a band on top: which side it is, the title, which shot of how many, and what its
 * colour means. */
async function titled(png: Buffer, side: 'before' | 'after', n: number, of: number, o: Options): Promise<Buffer> {
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
  return sharp({ create: { width, height: line + band + line + h! + line, channels: 4, background: '#d0d7de' } })
    .composite([
      { input: { create: { width: w!, height: band, channels: 4, background: '#f6f8fa' } }, left: line, top: line },
      { input: Buffer.from(pillSvg), left: line + pad, top: mid(pill.h) },
      { input: label.data, left: line + pad + Math.round(10 * s), top: mid(label.info.height) },
      { input: title.data, left: line + pad + pill.w + gap, top: mid(title.info.height) },
      { input: meaning.data, left: width - line - pad - meaning.info.width, top: mid(meaning.info.height) },
      { input: Buffer.from(swatchSvg), left: width - line - pad - meaning.info.width - Math.round(6 * s) - sw, top: mid(sw) },
      { input: png, left: line, top: line + band + line },
    ])
    .png()
    .toBuffer();
}

export async function run(browser: Browser, o: Options): Promise<Result> {
  const before = await open(browser, o.before, o);
  const after = await open(browser, o.after, o);
  try {
    const found: Hunk[] = hunks(diff(before.words, after.words));
    const markA: Marked = await before.page.evaluate(mark, {
      ...RED, strike: true, hunks: found.map(h => ({ changed: h.removed, anchors: h.anchorsA })),
    } satisfies MarkOptions);
    const markB: Marked = await after.page.evaluate(mark, {
      ...GREEN, strike: false, hunks: found.map(h => ({ changed: h.added, anchors: h.anchorsB })),
    } satisfies MarkOptions);

    let groups = group(markA.spans, markB.spans, o.padding, o.maxHeight);
    if (o.selector) {
      const a = await before.page.evaluate(element, o.selector);
      const b = await after.page.evaluate(element, o.selector);
      if (!a || !b) throw new Error(`--selector ${o.selector} matches nothing on the ${!a ? 'before' : 'after'} page`);
      groups = [{ hunks: found.map((_, i) => i), before: a, after: b }];
    } else if (!groups.length) {
      groups = [{ hunks: [], before: null, after: null }];
    }

    const removed = (i: number) => found[i].removed.map(t => before.words[t]).join(' ');
    const added = (i: number) => found[i].added.map(t => after.words[t]).join(' ');
    const shots: Shot[] = [];
    const leftOut = { removed: [] as string[], added: [] as string[] };
    for (const [n, g] of groups.entries()) {
      const clipA = await clipOf(before.page, g.before, markA.width, o);
      const clipB = await clipOf(after.page, g.after, markB.width, o);
      const regionA = { top: clipA.y, bottom: clipA.y + clipA.height };
      const regionB = { top: clipB.y, bottom: clipB.y + clipB.height };
      for (const i of g.hunks) {
        if (outside(markA.spans[i], regionA)) leftOut.removed.push(removed(i));
        if (outside(markB.spans[i], regionB)) leftOut.added.push(added(i));
      }
      shots.push({
        before: {
          png: await titled(await shot(before.page, clipA), 'before', n + 1, groups.length, o),
          box: clipA,
          changed: g.hunks.map(removed).filter(Boolean),
        },
        after: {
          png: await titled(await shot(after.page, clipB), 'after', n + 1, groups.length, o),
          box: clipB,
          changed: g.hunks.map(added).filter(Boolean),
        },
      });
    }
    return { hunks: found.length, shots, leftOut };
  } finally {
    await before.context.close();
    await after.context.close();
  }
}
