import { describe, expect, test } from 'vitest';
import { painted, pairs, restyled, type El } from '../src/visual.ts';

const el = (sig: string, style: Record<string, string> = {}, more: Partial<El> = {}): El =>
  ({ sig, parent: -1, leaf: true, paint: false, top: 0, width: 100, height: 20, style, ...more });

describe('pairs', () => {
  test('pairs elements in order, skipping the ones only one page has', () => {
    const a = [el('header'), el('h2 Trip'), el('button Book')];
    const b = [el('header'), el('p New'), el('h2 Trip'), el('button Book')];
    expect(pairs(a, b)).toEqual([[0, 0], [1, 2], [2, 3]]);
  });
});

describe('restyled', () => {
  test('names what changed in words', () => {
    const a = [el('button Book', { 'background-color': 'blue', 'color': 'white' })];
    const b = [el('button Book', { 'background-color': 'green', 'color': 'white' })];
    expect(restyled(a, b, pairs(a, b))).toEqual([{ a: 0, b: 0, what: ['background'] }]);
  });

  test('one label for the four sides of a border', () => {
    const sides = (c: string) => ({ 'border-top-color': c, 'border-right-color': c, 'border-bottom-color': c, 'border-left-color': c });
    const a = [el('div', sides('grey'))];
    const b = [el('div', sides('red'))];
    expect(restyled(a, b, pairs(a, b))[0].what).toEqual(['border colour']);
  });

  test('a colour a child inherits is marked on the parent alone', () => {
    const a = [el('nav', { color: 'black' }, { leaf: false }), el('a Home', { color: 'black' }, { parent: 0 })];
    const b = [el('nav', { color: 'navy' }, { leaf: false }), el('a Home', { color: 'navy' }, { parent: 0 })];
    expect(restyled(a, b, pairs(a, b))).toEqual([{ a: 0, b: 0, what: ['text colour'] }]);
  });

  test('a child that changes colour on its own is marked', () => {
    const a = [el('nav', { color: 'black' }, { leaf: false }), el('a Home', { color: 'black' }, { parent: 0 })];
    const b = [el('nav', { color: 'black' }, { leaf: false }), el('a Home', { color: 'red' }, { parent: 0 })];
    expect(restyled(a, b, pairs(a, b))).toEqual([{ a: 1, b: 1, what: ['text colour'] }]);
  });

  test('a size set in CSS is compared, a size layout gives is not', () => {
    const a = [el('main', { width: 'auto' }, { leaf: false, height: 300 }), el('img logo.png', { width: '32px' }, { width: 32 })];
    const b = [el('main', { width: 'auto' }, { leaf: false, height: 400 }), el('img logo.png', { width: '48px' }, { width: 48 })];
    expect(restyled(a, b, pairs(a, b))).toEqual([{ a: 1, b: 1, what: ['size'] }]);
  });

  test('nothing changed, nothing marked', () => {
    const a = [el('p', { color: 'black' })];
    expect(restyled(a, a, pairs(a, a))).toEqual([]);
  });
});

describe('painted', () => {
  test('images whose style did not change are left for the pixels', () => {
    const a = [el('img logo.png', {}, { paint: true }), el('img photo.png', { opacity: '1' }, { paint: true }), el('p')];
    const b = [el('img logo.png', {}, { paint: true }), el('img photo.png', { opacity: '0.5' }, { paint: true }), el('p')];
    const paired = pairs(a, b);
    expect(painted(a, b, paired, restyled(a, b, paired))).toEqual([[0, 0]]);
  });
});
