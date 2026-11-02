// The word diff between the two pages (Myers' algorithm, from the diff package), grouped into hunks.

import { diffArrays } from 'diff';
import type { Side } from './side.ts';

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
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      i++;
      continue;
    }
    const hunk: Hunk = { changed: { before: [], after: [] }, anchors: { before: [], after: [] } };
    const anchor = (op: Op) => {
      hunk.anchors.before.push(op.before);
      hunk.anchors.after.push(op.after);
    };
    for (let j = i - 1; j >= 0 && j >= i - context && ops[j].type === 'equal'; j--) anchor(ops[j]);
    for (; i < ops.length && ops[i].type !== 'equal'; i++) {
      if (ops[i].type === 'remove') hunk.changed.before.push(ops[i].before);
      else hunk.changed.after.push(ops[i].after);
    }
    for (let j = i; j < ops.length && j < i + context && ops[j].type === 'equal'; j++) anchor(ops[j]);
    found.push(hunk);
  }
  return found;
}
