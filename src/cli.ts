#!/usr/bin/env node
import { Command } from 'commander';
import { run, type Options } from './run.ts';
import { ask } from './cli/ask.ts';
import { browser, browserFor } from './cli/browser.ts';
import { compare } from './cli/compare.ts';
import { draw } from './cli/draw.ts';
import { broken, type Pages, type ValuesOf } from './cli/group.ts';
import { output } from './cli/output.ts';
import { page } from './cli/page.ts';
import { reporters, warn } from './cli/report.ts';
import { write } from './cli/write.ts';

const browserOptions = browser(ask);

/** The groups, in the order of their sections in --help and of their rules' checks. */
const groups = [output, page, compare, draw, browserOptions];

/** The options as commander gives them, by their camel-cased names: the run's, and the command's own. */
type Values = ValuesOf<typeof output> &
  ValuesOf<typeof page> &
  ValuesOf<typeof compare> &
  ValuesOf<typeof draw> &
  ValuesOf<typeof browserOptions>;

/** The run's options: each group's part, and the pages as the browser opens them. */
function options(values: Values, pages: Pages): Options {
  return {
    ...output.resolve(values, pages),
    ...page.resolve(values, pages),
    ...compare.resolve(values, pages),
    ...draw.resolve(values, pages),
    ...browserOptions.resolve(values, pages),
    ...pages,
  };
}

const program = new Command('shot-diff')
  .description(
    `Writes <name>-before.png, with what the after page no longer has marked red, and
<name>-after.png, with what it adds marked green. Each image has a band with its side and the
title. Changes far apart get a pair each: <name>-1-before.png, <name>-1-after.png, and so on.
With --unified, a pair whose changes are all removals is its before image alone, and one whose
changes are all additions its after image alone: <name>.png (or <name>-1.png, and so on), its
band saying Removed or Added instead of its side. A local file is a file:// URL.`,
  )
  .argument('<before-url>')
  .argument('<after-url>');
for (const group of groups)
  for (const option of group.options) program.addOption(option.helpGroup(group.heading));

program.showHelpAfterError().action(async (beforeUrl: string, afterUrl: string, values: Values) => {
  const rule = broken<Values>(groups, values);
  if (rule) throw new Error(rule.message);
  const chrome = await browserFor(values, ask);
  try {
    const pages = { before: chrome.locate(beforeUrl), after: chrome.locate(afterUrl) };
    const result = await run(chrome.browser, options(values, pages));
    const shots = write(result, values.out, values.name);
    reporters[values.format].report(result, shots, values.dryRun);
    warn(result, shots, values.height);
  } finally {
    await chrome.close();
  }
});

program.parseAsync().catch((error: unknown) => {
  console.error(`shot-diff: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
