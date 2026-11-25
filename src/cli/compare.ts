// What is compared: the words or not, and which elements.

import { Option } from 'commander';
import type { Options } from '../run.ts';
import type { OptionGroup } from './group.ts';
import { append } from './parsers.ts';

export type CompareValues = {
  words: boolean;
  ignore: string[];
  showIgnored: boolean;
  selector?: string;
};

export const compare: OptionGroup<
  CompareValues,
  Pick<Options, 'words' | 'ignore' | 'showIgnored' | 'selector'>
> = {
  heading: 'Comparison:',
  options: [
    new Option(
      '--no-words',
      'do not compare words, for pages whose text differs anyway (random or other data): mark only changes of look, and elements added or removed',
    ),
    new Option(
      '--ignore <css>',
      'leave these elements, and all inside them, out of the comparison: for parts showing other data (repeatable)',
    )
      .argParser(append)
      .default([]),
    new Option('--show-ignored', 'box what --ignore leaves out in dashed grey, saying it is ignored').default(
      false,
    ),
    new Option('--selector <css>', 'only look at changes inside this element; the rest are ignored'),
  ],
  // No --selector is null: every change counts.
  resolve: ({ words, ignore, showIgnored, selector }) => ({
    words,
    ignore,
    showIgnored,
    selector: selector ?? null,
  }),
};
