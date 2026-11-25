// How the shots are cut and what is drawn on them.

import { Option } from 'commander';
import type { Nested } from '../page/runtime.ts';
import type { Options } from '../run.ts';
import type { Mode } from '../shots/markers.ts';
import type { OptionGroup } from './group.ts';
import type { PageValues } from './page.ts';
import { nonNegativeNumber } from './parsers.ts';

export type DrawValues = {
  markers: Mode;
  nested: Nested;
  padding: number;
  maxHeight?: number; // undefined when not given: MAX_HEIGHT_IN_WINDOWS windows
  unified: boolean;
} & Pick<PageValues, 'height'>;

/** How tall a shot may be, in windows, when --max-height is not given: about what a pull request
 * shows without much scrolling, with the before and the after still to compare by eye. */
export const MAX_HEIGHT_IN_WINDOWS = 1.5;

export const draw: OptionGroup<
  DrawValues,
  Pick<Options, 'markers' | 'nested' | 'padding' | 'maxHeight' | 'unified'>
> = {
  heading: 'Drawing:',
  options: [
    new Option(
      '--markers <kind>',
      'how a box around a change of look says what changed: a label on it, or a number explained in the band',
    )
      .choices(['labels', 'numbers'])
      .default('labels'),
    new Option(
      '--nested <which>',
      'of two boxes one inside the other, what is drawn: both, the inner one (what changed in a component), or the outer one (the component)',
    )
      .choices(['both', 'inner', 'outer'])
      .default('both'),
    new Option('--padding <px>', 'room around the changes').argParser(nonNegativeNumber).default(80),
    new Option(
      '--max-height <px>',
      'the tallest a shot gets; changes farther apart get a pair each (default: 1.5 times --height)',
    ).argParser(nonNegativeNumber),
    new Option(
      '--unified',
      'a pair whose changes are all removals, or all additions, is one image, <name>.png: the before shot, or the after shot, its band saying Removed or Added',
    ).default(false),
  ],
  resolve: ({ markers, nested, padding, maxHeight, unified, height }) => ({
    markers,
    nested,
    padding,
    maxHeight: maxHeight ?? height * MAX_HEIGHT_IN_WINDOWS,
    unified,
  }),
};
