// How each page is loaded: the window, the colour scheme, and what is done to it first.

import { Option } from 'commander';
import type { Options } from '../run.ts';
import type { OptionGroup } from './group.ts';
import { append, appendKeyValue, nonNegativeNumber } from './parsers.ts';

export type PageValues = {
  width: number;
  height: number;
  scale: number;
  dark: boolean;
  storage: [string, string][];
  click: string[];
  wait: number;
};

export const page: OptionGroup<
  PageValues,
  Pick<Options, 'width' | 'height' | 'scale' | 'dark' | 'storage' | 'click' | 'wait'>
> = {
  heading: 'Page:',
  options: [
    new Option('--width <px>', 'viewport width').argParser(nonNegativeNumber).default(1280),
    new Option('--height <px>', "viewport height, and the shot's height when nothing changed")
      .argParser(nonNegativeNumber)
      .default(900),
    new Option('--scale <n>', 'device pixel ratio').argParser(nonNegativeNumber).default(2),
    new Option('--dark', 'a dark colour scheme').default(false),
    new Option('--storage <key=value>', 'set in localStorage before the page runs (repeatable)')
      .argParser(appendKeyValue)
      .default([]),
    new Option('--click <selector>', 'click after loading, in order (repeatable)')
      .argParser(append)
      .default([]),
    new Option('--wait <ms>', 'wait after loading and clicking').argParser(nonNegativeNumber).default(300),
  ],
  resolve: ({ width, height, scale, dark, storage, click, wait }) => ({
    width,
    height,
    scale,
    dark,
    storage,
    click,
    wait,
  }),
};
