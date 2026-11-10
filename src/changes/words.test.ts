import { expect, test } from 'vitest';
import { diff, hunks, type Op } from './words.ts';

const words = (s: string) => s.split(' ').filter(Boolean);
const apply = (a: string[], b: string[], ops: Op[]) => {
  // Replaying the ops rebuilds both lists: proof the diff is complete and in order.
  const left = ops.filter(o => o.type !== 'add').map(o => a[o.before]);
  const right = ops.filter(o => o.type !== 'remove').map(o => b[o.after]);
  return { left, right };
};

test('equal lists give only equal ops', () => {
  const a = words('one two three');
  const ops = diff(a, a);
  expect(ops.every(o => o.type === 'equal')).toBe(true);
  expect(hunks(ops)).toEqual([]);
});

test('a replaced phrase is one hunk with its neighbours as anchors', () => {
  const a = words('Step 10 writes the tickets. You approve them before they are published.');
  const b = words('Step 10 writes the tickets. You confirm the breakdown in the same session.');
  const ops = diff(a, b);
  expect(apply(a, b, ops)).toEqual({ left: a, right: b });
  const found = hunks(ops);
  expect(found.length).toBe(1);
  expect(found[0].changed.before.map(i => a[i])).toEqual(words('approve them before they are published.'));
  expect(found[0].changed.after.map(i => b[i])).toEqual(words('confirm the breakdown in the same session.'));
  expect(found[0].anchors.before.map(i => a[i])).toEqual(words('You tickets. the'));
});

test('an addition at the end has an empty removed side and anchors before it', () => {
  const a = words('a b c');
  const b = words('a b c d e');
  const found = hunks(diff(a, b));
  expect(found.length).toBe(1);
  expect(found[0].changed.before).toEqual([]);
  expect(found[0].changed.after.map(i => b[i])).toEqual(['d', 'e']);
  expect(found[0].anchors.before.map(i => a[i])).toEqual(['c', 'b', 'a']);
  expect(found[0].anchors.after.map(i => b[i])).toEqual(['c', 'b', 'a']);
});

test('changes far apart are separate hunks', () => {
  const a = words('x 1 2 3 4 5 6 7 8 y');
  const b = words('X 1 2 3 4 5 6 7 8 Y');
  const found = hunks(diff(a, b));
  expect(found.length).toBe(2);
});

test('anchors stop at the nearest change', () => {
  const a = words('0 x 1 y 2');
  const b = words('0 X 1 Y 2');
  const found = hunks(diff(a, b), 4);
  expect(found.length).toBe(2);
  expect(found[1].anchors.before.map(i => a[i])).toEqual(['1', '2']);
});

test('either side empty', () => {
  expect(diff([], ['a']).map(o => o.type)).toEqual(['add']);
  expect(diff(['a'], []).map(o => o.type)).toEqual(['remove']);
  expect(diff([], [])).toEqual([]);
});

test('random lists replay exactly', () => {
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let round = 0; round < 200; round++) {
    const a = Array.from({ length: rand(30) }, () => String(rand(5)));
    const b = Array.from({ length: rand(30) }, () => String(rand(5)));
    expect(apply(a, b, diff(a, b))).toEqual({ left: a, right: b });
  }
});
