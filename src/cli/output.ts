// Where the images go, what is printed, and whether they are shot at all.

import { Option } from 'commander';
import type { Options } from '../run.ts';
import type { OptionGroup } from './group.ts';
import { FORMATS, type Format } from './report.ts';

export type OutputValues = {
  title?: string; // needed unless --dry-run
  out: string;
  name: string;
  json: boolean; // --format json, by its shorthand
  format: Format;
  dryRun: boolean;
};

export const output: OptionGroup<OutputValues, Pick<Options, 'title' | 'dryRun'>> = {
  heading: 'Output:',
  options: [
    new Option('--title <text>', "the band's title; needed, unless with --dry-run"),
    new Option('--out <dir>', 'where to write the images').default('.'),
    new Option('--name <name>', "the files' prefix").default('shot'),
    new Option('--json', 'print what was marked as JSON').default(false).implies({ format: 'json' }),
    new Option(
      '--format <kind>',
      'what to print: a line per image, or what was marked as JSON; --json is short for --format json',
    )
      .choices(FORMATS)
      .default('text'),
    new Option(
      '--dry-run',
      'do all of a run but the screenshots: list the images it would write, and the parts of the page that changed, with a --selector for each',
    ).default(false),
  ],
  rules: [
    {
      holds: values => values.title !== undefined || values.dryRun,
      message: "required option '--title <text>' not specified: it is written on each image",
    },
    {
      // Not commander's .conflicts('format'): it counts the format --json implies as one given,
      // and would refuse --json alone.
      holds: values => !values.json || values.format === 'json',
      message: '--json is short for --format json: it cannot go with another --format',
    },
  ],
  resolve: ({ title, dryRun }) => ({ title: title ?? '', dryRun }),
};
