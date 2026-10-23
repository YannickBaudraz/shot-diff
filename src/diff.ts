// The word diff between the two pages (Myers' algorithm, from the diff package), grouped into hunks.

import { diffArrays } from 'diff';

export type Op = { type: 'equal' | 'remove' | 'add'; a: number; b: number };

export type Hunk = {
  removed: number[]; // token indexes in the before page
  added: number[]; // token indexes in the after page
  anchorsA: number[]; // the unchanged tokens around the hunk, in the before page
  anchorsB: number[]; // the same tokens, in the after page
};

/** The word diff, as one op per token. `a` is the token index in the before list, `b` in the after list
 * (for a remove, `b` is where the after list stands; for an add, `a` is where the before list stands). */
export function diff(a: readonly string[], b: readonly string[]): Op[] {
  const ops: Op[] = [];
  let x = 0;
  let y = 0;
  for (const change of diffArrays([...a], [...b])) {
    for (let i = 0; i < change.count; i++) {
      if (change.removed) ops.push({ type: 'remove', a: x++, b: y });
      else if (change.added) ops.push({ type: 'add', a: x, b: y++ });
      else ops.push({ type: 'equal', a: x++, b: y++ });
    }
  }
  return ops;
}

/** Runs of changes, each with the unchanged tokens on either side of it, so both shots can be
 * cropped around the same place even when one side of a change is empty. */
export function hunks(ops: readonly Op[], context = 3): Hunk[] {
  const out: Hunk[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') { i++; continue; }
    const hunk: Hunk = { removed: [], added: [], anchorsA: [], anchorsB: [] };
    for (let j = i - 1; j >= 0 && j >= i - context && ops[j].type === 'equal'; j--) {
      hunk.anchorsA.push(ops[j].a);
      hunk.anchorsB.push(ops[j].b);
    }
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'remove') hunk.removed.push(ops[i].a);
      else hunk.added.push(ops[i].b);
      i++;
    }
    for (let j = i; j < ops.length && j < i + context && ops[j].type === 'equal'; j++) {
      hunk.anchorsA.push(ops[j].a);
      hunk.anchorsB.push(ops[j].b);
    }
    out.push(hunk);
  }
  return out;
}
