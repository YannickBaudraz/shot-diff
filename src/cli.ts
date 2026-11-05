#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import confirm from '@inquirer/confirm';
import { Command, InvalidArgumentError, Option } from 'commander';
import { chromium } from 'playwright-core';
import { launch, type Download } from './browser.ts';
import type { Mode } from './markers.ts';
import type { Box } from './page.ts';
import { run, type Options, type Result } from './shoot.ts';

/** The options as commander gives them, by their camel-cased names: the run's, and the command's own. */
type CliValues = Omit<Options, 'before' | 'after' | 'selector'> & {
  selector?: string;
  out: string;
  name: string;
  chrome?: string;
  download?: boolean; // undefined when neither --download nor --no-download is given
  json: boolean;
};

/** One shot's two files, and what each shows. */
type WrittenShot = {
  before: { file: string; removed: string[]; box: Box };
  after: { file: string; added: string[]; box: Box };
};

// Option parsers, as commander calls them: the value given, and what the option held so far.

function nonNegativeNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new InvalidArgumentError('not a number');
  return parsed;
}

function appendKeyValue(value: string, pairs: [string, string][]): [string, string][] {
  const equals = value.indexOf('=');
  if (equals < 1) throw new InvalidArgumentError('wants key=value');
  return [...pairs, [value.slice(0, equals), value.slice(equals + 1)]];
}

function append(value: string, list: string[]): string[] {
  return [...list, value];
}

const program = new Command('shot-diff')
  .description(
    `Writes <name>-before.png, with what the after page no longer has marked red, and
<name>-after.png, with what it adds marked green. Each image has a band with its side and the
title. Changes far apart get a pair each: <name>-1-before.png, <name>-1-after.png, and so on.
A local file is a file:// URL.`,
  )
  .argument('<before-url>')
  .argument('<after-url>')
  .requiredOption('--title <text>', "the band's title")
  .option('--out <dir>', 'where to write the images', '.')
  .option('--name <name>', "the files' prefix", 'shot')
  .option('--width <px>', 'viewport width', nonNegativeNumber, 1280)
  .option(
    '--height <px>',
    "viewport height, and the shot's height when nothing changed",
    nonNegativeNumber,
    900,
  )
  .option('--scale <n>', 'device pixel ratio', nonNegativeNumber, 2)
  .option('--dark', 'a dark colour scheme', false)
  .option(
    '--storage <key=value>',
    'set in localStorage before the page runs (repeatable)',
    appendKeyValue,
    [],
  )
  .option('--click <selector>', 'click after loading, in order (repeatable)', append, [])
  .option('--wait <ms>', 'wait after loading and clicking', nonNegativeNumber, 300)
  .option('--selector <css>', 'only look at changes inside this element; the rest are ignored')
  .option('--padding <px>', 'room around the changes', nonNegativeNumber, 80)
  .addOption(
    new Option(
      '--markers <kind>',
      'how a box around a change of look says what changed: a label on it, or a number explained in the band',
    )
      .choices(['labels', 'numbers'])
      .default('labels'),
  )
  .option(
    '--max-height <px>',
    'the tallest a shot gets; changes farther apart get a pair each',
    nonNegativeNumber,
    2400,
  )
  .addOption(
    new Option('--chrome <path>', 'the Chrome or Chromium to use (default: the installed Google Chrome)').env(
      'CHROME',
    ),
  )
  .option('--download', "without Chrome, download Playwright's headless Chromium without asking")
  .option('--no-download', 'without Chrome, stop instead of offering to download it')
  .option('--json', 'print what was marked as JSON', false)
  .showHelpAfterError()
  .action(async (beforeUrl: string, afterUrl: string, values: CliValues) => {
    const browser = await browserFor(values);
    try {
      const result = await run(browser, options(beforeUrl, afterUrl, values));
      const shots = write(result, values.out, values.name);
      if (values.json) printJson(result, shots);
      else printLines(shots);
      warn(result);
    } finally {
      await browser.close();
    }
  });

/** The browser to use: --chrome, or the installed Chrome, or a download, asked about on a terminal.
 * The question goes to stderr, so stdout stays the --json output. */
function browserFor(values: CliValues) {
  const ask =
    process.stdin.isTTY && process.stderr.isTTY
      ? (message: string) => confirm({ message, default: false }, { output: process.stderr })
      : null;
  return launch(chromium, {
    chrome: values.chrome,
    download: downloadChoice(values.download),
    confirm: ask,
    log: line => console.error(line),
  });
}

/** --download, --no-download, or neither: commander leaves the value undefined when neither is given. */
function downloadChoice(download: boolean | undefined): Download {
  if (download === true) return 'yes';
  if (download === false) return 'no';
  return 'ask';
}

/** The run's options: the command's own left out, and no --selector as null. */
function options(before: string, after: string, values: CliValues): Options {
  const { out, name, chrome, download, json, selector, ...run } = values;
  return { ...run, before, after, selector: selector ?? null };
}

/** Write each shot's two images; a page with several shots numbers them in the file names. */
function write(result: Result, out: string, name: string): WrittenShot[] {
  mkdirSync(out, { recursive: true });
  return result.shots.map((shot, n) => {
    const prefix = result.shots.length > 1 ? `${name}-${n + 1}` : name;
    const files = { before: join(out, `${prefix}-before.png`), after: join(out, `${prefix}-after.png`) };
    writeFileSync(files.before, shot.before.png);
    writeFileSync(files.after, shot.after.png);
    return {
      before: { file: files.before, removed: shot.before.changed, box: shot.before.box },
      after: { file: files.after, added: shot.after.changed, box: shot.after.box },
    };
  });
}

/** What was marked, where, and what was left out, as JSON on stdout. */
function printJson(result: Result, shots: WrittenShot[]) {
  const { wordChanges, lookChanges, leftOut, ignored } = result;
  console.log(JSON.stringify({ wordChanges, lookChanges, shots, leftOut, ignored }, null, 2));
}

/** A line per image written, and how many parts it marks. */
function printLines(shots: WrittenShot[]) {
  for (const shot of shots) {
    console.log(`${shot.before.file}: ${shot.before.removed.length} part(s) removed`);
    console.log(`${shot.after.file}: ${shot.after.added.length} part(s) added`);
  }
}

/** On stderr, so stdout stays the --json output: when nothing changed, when changes were outside
 * --selector, or when a change is in no image. */
function warn(result: Result) {
  if (!result.wordChanges && !result.lookChanges)
    console.error(
      "shot-diff: no difference in the pages' words, images or looks; the shots show the top of each page",
    );
  const missed = [
    ...result.leftOut.removed.map(s => `removed: ${s}`),
    ...result.leftOut.added.map(s => `added: ${s}`),
  ];
  const ignored = result.ignored.removed.length + result.ignored.added.length;
  if (ignored)
    console.error(
      `shot-diff: ${ignored} change(s) outside --selector ignored (listed under "ignored" in --json)`,
    );
  if (missed.length) {
    console.error(
      `shot-diff: ${missed.length} change(s) are cut from every image; raise --max-height to fit them:`,
    );
    for (const line of missed) console.error(`  ${line}`);
  }
}

program.parseAsync().catch((error: unknown) => {
  console.error(`shot-diff: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
