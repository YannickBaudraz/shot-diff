// The word diff between the two pages (Myers' algorithm, from the diff package), grouped into hunks.

import { diffArrays } from 'diff';
import type { Side } from '../side.ts';

/** What happened to one token, and where it is on each page. A removed token is not on the after
 * page, so its `after` is where the after page stands at that point; the same for an added one's
 * `before`. */
export type Op = { type: 'equal' | 'remove' | 'add'; before: number; after: number };

/** A run of changed tokens: what changed on each page, and up to three unchanged tokens on either
 * side of it. Those anchor both shots on the same place, even when one page changed nothing. */
export type Hunk = { changed: Record<Side, number[]>; anchors: Record<Side, number[]> };

/** The word diff, as one op per token. */
export function diff(before: readonly string[], after: readonly string[]): Op[] {
  const ops: Op[] = [];
  let beforeAt = 0;
  let afterAt = 0;
  for (const change of diffArrays([...before], [...after])) {
    for (let i = 0; i < change.count; i++) {
      if (change.removed) ops.push({ type: 'remove', before: beforeAt++, after: afterAt });
      else if (change.added) ops.push({ type: 'add', before: beforeAt, after: afterAt++ });
      else ops.push({ type: 'equal', before: beforeAt++, after: afterAt++ });
    }
  }
  return ops;
}

/** The runs of changes in `ops`, each with up to `context` unchanged tokens before and after it. */
export function hunks(ops: readonly Op[], context = 3): Hunk[] {
  const found: Hunk[] = [];
  for (let start = skip(ops, 0, isEqual); start < ops.length;) {
    const end = skip(ops, start, isChange);
    found.push(hunkOf(ops, start, end, context));
    start = skip(ops, end, isEqual);
  }
  return found;
}

const isEqual = (op: Op) => op.type === 'equal';
const isChange = (op: Op) => op.type !== 'equal';

/** The index of the first op from `from` on that is not `passed`, or the end of `ops`. */
function skip(ops: readonly Op[], from: number, passed: (op: Op) => boolean): number {
  let i = from;
  while (i < ops.length && passed(ops[i])) i++;
  return i;
}

/** The ops at the head of `list` that are all `kept`. */
function leading(list: Op[], kept: (op: Op) => boolean): Op[] {
  const stop = list.findIndex(op => !kept(op));
  return stop < 0 ? list : list.slice(0, stop);
}

/** The hunk of the changes from `start` up to `end`. Its anchors are the unchanged ops around them,
 * nearest first: up to `context` before, then up to `context` after. */
function hunkOf(ops: readonly Op[], start: number, end: number, context: number): Hunk {
  const changes = ops.slice(start, end);
  const anchors = [
    ...leading(ops.slice(Math.max(0, start - context), start).reverse(), isEqual),
    ...leading(ops.slice(end, end + context), isEqual),
  ];
  return {
    changed: {
      before: changes.filter(op => op.type === 'remove').map(op => op.before),
      after: changes.filter(op => op.type === 'add').map(op => op.after),
    },
    anchors: { before: anchors.map(op => op.before), after: anchors.map(op => op.after) },
  };
}

/** The word changes between two pages' words, leaving out the `skipped` stretches of each page (from
 * the first word, up to after the last): the words of a component only one page has are no word
 * changes, and could pair with a word elsewhere. Indexes are into the words as given. */
export function wordHunks(
  words: Record<Side, readonly string[]>,
  skipped: Record<Side, [number, number][]>,
): Hunk[] {
  const kept = (side: Side) =>
    words[side].map((_, i) => i).filter(i => !skipped[side].some(([from, to]) => from <= i && i < to));
  const keep = { before: kept('before'), after: kept('after') };
  const at = (side: Side) => (i: number) => keep[side][i];
  return hunks(
    diff(
      keep.before.map(i => words.before[i]),
      keep.after.map(i => words.after[i]),
    ),
  ).map(({ changed, anchors }) => ({
    changed: { before: changed.before.map(at('before')), after: changed.after.map(at('after')) },
    anchors: { before: anchors.before.map(at('before')), after: anchors.after.map(at('after')) },
  }));
}
