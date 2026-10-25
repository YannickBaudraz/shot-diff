#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command, InvalidArgumentError, Option } from 'commander';
import { chromium } from 'playwright-core';
import { run } from './shoot.ts';

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
  .option('--max-height <px>', 'the tallest a shot gets; changes farther apart get a pair each', number, 2400)
  .addOption(new Option('--chrome <path>', 'the Chrome or Chromium to use (default: the installed Google Chrome)').env('CHROME'))
  .option('--json', 'print what was marked as JSON', false)
  .showHelpAfterError()
  .action(async (beforeUrl: string, afterUrl: string, values) => {
    const browser = await chromium.launch(values.chrome ? { executablePath: values.chrome } : { channel: 'chrome' });
    try {
      const result = await run(browser, {
        before: beforeUrl,
        after: afterUrl,
        title: values.title,
        width: values.width,
        height: values.height,
        scale: values.scale,
        dark: values.dark,
        storage: values.storage,
        click: values.click,
        wait: values.wait,
        selector: values.selector ?? null,
        padding: values.padding,
        maxHeight: values.maxHeight,
      });
      mkdirSync(values.out, { recursive: true });
      const shots = result.shots.map((shot, n) => {
        const prefix = result.shots.length > 1 ? `${values.name}-${n + 1}` : values.name;
        const files = { before: join(values.out, `${prefix}-before.png`), after: join(values.out, `${prefix}-after.png`) };
        writeFileSync(files.before, shot.before.png);
        writeFileSync(files.after, shot.after.png);
        return {
          before: { file: files.before, removed: shot.before.changed, box: shot.before.box },
          after: { file: files.after, added: shot.after.changed, box: shot.after.box },
        };
      });
      if (values.json) {
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
    } finally {
      await browser.close();
    }
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`shot-diff: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
