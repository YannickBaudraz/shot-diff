// Which hunks share a shot. Hunks close enough on both pages go in one pair of images; a page with
// changes far apart gets one pair per place, so no change falls off a shot cut to a maximum height.

import type { Span } from './page.ts';

export type Region = { top: number; bottom: number };

/** Groups of hunk indexes, in order, each with the region it covers on either page. A hunk joins the
 * group before it when the group, padded, then still fits in `maxHeight` on both pages. */
export function group(before: (Span | null)[], after: (Span | null)[], padding: number, maxHeight: number) {
  const groups: { hunks: number[]; before: Region | null; after: Region | null }[] = [];
  const join = (r: Region | null, s: Span | null): Region | null =>
    !s ? r : !r ? { top: s.top, bottom: s.bottom } : { top: Math.min(r.top, s.top), bottom: Math.max(r.bottom, s.bottom) };
  const fits = (r: Region | null) => !r || r.bottom - r.top + 2 * padding <= maxHeight;
  for (let i = 0; i < before.length; i++) {
    const last = groups.at(-1);
    if (last) {
      const b = join(last.before, before[i]);
      const a = join(last.after, after[i]);
      if (fits(b) && fits(a)) {
        last.hunks.push(i);
        last.before = b;
        last.after = a;
        continue;
      }
    }
    groups.push({ hunks: [i], before: join(null, before[i]), after: join(null, after[i]) });
  }
  return groups;
}

/** The changed words of a span that a shot of `clip` leaves out, if any. */
export function outside(span: Span | null, clip: Region): boolean {
  if (!span || span.changedTop === null || span.changedBottom === null) return false;
  return span.changedTop < clip.top || span.changedBottom > clip.bottom;
}
