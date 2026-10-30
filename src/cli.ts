#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import confirm from '@inquirer/confirm';
import { Command, InvalidArgumentError, Option, type OptionValues } from 'commander';
import { chromium } from 'playwright-core';
import { launch } from './browser.ts';
import { run, type Options, type Result } from './shoot.ts';

const number = (value: string) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new InvalidArgumentError('not a number');
  return n;
};
const pair = (value: string, pairs: [string, string][]) => {
  const at = value.indexOf('=');
  if (at < 1) throw new InvalidArgumentError('wants key=value');
  return [...pairs, [value.slice(0, at), value.slice(at + 1)] as [string, string]];
};
const each = (value: string, list: string[]) => [...list, value];

const program = new Command('shot-diff')
  .description(`Writes <name>-before.png, with what the after page no longer has marked red, and
<name>-after.png, with what it adds marked green. Each image has a band with its side and the
title. Changes far apart get a pair each: <name>-1-before.png, <name>-1-after.png, and so on.
A local file is a file:// URL.`)
  .argument('<before-url>')
  .argument('<after-url>')
  .requiredOption('--title <text>', "the band's title")
  .option('--out <dir>', 'where to write the images', '.')
  .option('--name <name>', "the files' prefix", 'shot')
  .option('--width <px>', 'viewport width', number, 1280)
  .option('--height <px>', "viewport height, and the shot's height when nothing changed", number, 900)
  .option('--scale <n>', 'device pixel ratio', number, 2)
  .option('--dark', 'a dark colour scheme', false)
  .option('--storage <key=value>', 'set in localStorage before the page runs (repeatable)', pair, [])
  .option('--click <selector>', 'click after loading, in order (repeatable)', each, [])
  .option('--wait <ms>', 'wait after loading and clicking', number, 300)
  .option('--selector <css>', 'shoot this element instead of the area around the changes')
  .option('--padding <px>', 'room around the changes', number, 80)
  .addOption(new Option('--markers <kind>', 'how a box around a change of look says what changed: a label on it, or a number explained in the band')
    .choices(['labels', 'numbers']).default('labels'))
  .option('--max-height <px>', 'the tallest a shot gets; changes farther apart get a pair each', number, 2400)
  .addOption(new Option('--chrome <path>', 'the Chrome or Chromium to use (default: the installed Google Chrome)').env('CHROME'))
  .option('--download', "without Chrome, download Playwright's headless Chromium without asking")
  .option('--no-download', 'without Chrome, stop instead of offering to download it')
  .option('--json', 'print what was marked as JSON', false)
  .showHelpAfterError()
  .action(async (beforeUrl: string, afterUrl: string, values: OptionValues) => {
    const browser = await browserFor(values);
    try {
      const result = await run(browser, options(beforeUrl, afterUrl, values));
      report(result, write(result, values.out, values.name), values.json);
    } finally {
      await browser.close();
    }
  });

/** The browser to use: --chrome, or the installed Chrome, or a download, asked about on a terminal.
 * The question goes to stderr, so stdout stays the --json output. */
function browserFor(values: OptionValues) {
  const ask = process.stdin.isTTY && process.stderr.isTTY
    ? (message: string) => confirm({ message, default: false }, { output: process.stderr })
    : null;
  const download = values.download === true ? 'yes' : values.download === false ? 'no' : 'ask';
  return launch(chromium, { chrome: values.chrome, download, confirm: ask, log: line => console.error(line) });
}

function options(before: string, after: string, values: OptionValues): Options {
  const { title, width, height, scale, dark, storage, click, wait, padding, maxHeight, markers } = values;
  return { before, after, title, width, height, scale, dark, storage, click, wait, selector: values.selector ?? null, padding, maxHeight, markers };
}

/** Write each shot's two images; a page with several shots numbers them in the file names. */
function write(result: Result, out: string, name: string) {
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

/** Say what was written, as JSON or a line per image; and on stderr, when nothing changed or a change
 * is in no image. */
function report(result: Result, shots: ReturnType<typeof write>, json: boolean) {
  if (json) {
    console.log(JSON.stringify({ hunks: result.hunks, restyled: result.restyled, shots, leftOut: result.leftOut }, null, 2));
  } else {
    for (const shot of shots) {
      console.log(`${shot.before.file}: ${shot.before.removed.length} part(s) removed`);
      console.log(`${shot.after.file}: ${shot.after.added.length} part(s) added`);
    }
  }
  if (!result.hunks && !result.restyled) console.error("shot-diff: no difference in the pages' words, images or looks; the shots show the top of each page");
  const missed = [...result.leftOut.removed.map(s => `removed: ${s}`), ...result.leftOut.added.map(s => `added: ${s}`)];
  if (missed.length) {
    console.error(`shot-diff: ${missed.length} change(s) are not in any image (cut by --max-height, or outside --selector):`);
    for (const line of missed) console.error(`  ${line}`);
  }
}

program.parseAsync().catch((error: unknown) => {
  console.error(`shot-diff: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
