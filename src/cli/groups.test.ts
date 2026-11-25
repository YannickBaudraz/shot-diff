import { Command } from 'commander';
import { describe, expect, test } from 'vitest';
import { browser, type BrowserValues } from './browser.ts';
import { draw, MAX_HEIGHT_IN_WINDOWS, type DrawValues } from './draw.ts';
import { broken, type OptionGroup } from './group.ts';
import { output, type OutputValues } from './output.ts';
import { FORMATS, reporters } from './report.ts';

const PAGES = { before: 'file:///before.html', after: 'file:///after.html' };
const DRAW: DrawValues = { markers: 'labels', nested: 'both', padding: 80, unified: false, height: 900 };
const OUTPUT: OutputValues = {
  title: 'A title',
  out: '.',
  name: 'shot',
  json: false,
  format: 'text',
  dryRun: false,
};
const BROWSER: BrowserValues = { interactive: false, tabs: false };
const terminal = async () => true;

/** The values a bare command with only `group`'s options parses from `args`. */
function parse<V>(group: OptionGroup<V, unknown>, args: string[]) {
  const command = new Command().exitOverride();
  for (const option of group.options) command.addOption(option);
  return command.parse(args, { from: 'user' }).opts();
}

describe('draw', () => {
  test('without --max-height, a shot is at most MAX_HEIGHT_IN_WINDOWS windows of --height', () => {
    expect(draw.resolve({ ...DRAW, height: 600 }, PAGES).maxHeight).toBe(600 * MAX_HEIGHT_IN_WINDOWS);
  });

  test('--max-height, when given, is the tallest a shot gets', () => {
    expect(draw.resolve({ ...DRAW, maxHeight: 2000 }, PAGES).maxHeight).toBe(2000);
  });
});

describe('output', () => {
  test('--title is needed, unless with --dry-run', () => {
    const { title, ...untitled } = OUTPUT;
    expect(broken([output], untitled)?.message).toBe(
      "required option '--title <text>' not specified: it is written on each image",
    );
    expect(broken([output], { ...untitled, dryRun: true })).toBeUndefined();
    expect(broken([output], OUTPUT)).toBeUndefined();
  });

  test('no --title is an empty one, on a dry run', () => {
    const { title, ...untitled } = OUTPUT;
    expect(output.resolve({ ...untitled, dryRun: true }, PAGES)).toEqual({ title: '', dryRun: true });
  });

  test('--json is short for --format json', () => {
    expect(parse(output, ['--json']).format).toBe('json');
    expect(parse(output, ['--format', 'json']).format).toBe('json');
    expect(parse(output, []).format).toBe('text');
  });

  test('--json cannot go with another --format', () => {
    const values = (args: string[]) => ({ ...OUTPUT, ...parse(output, args) }) as OutputValues;
    expect(broken([output], values(['--json', '--format', 'text']))?.message).toBe(
      '--json is short for --format json: it cannot go with another --format',
    );
    expect(broken([output], values(['--json']))).toBeUndefined();
    expect(broken([output], values(['--json', '--format', 'json']))).toBeUndefined();
    expect(broken([output], values(['--format', 'text']))).toBeUndefined();
  });
});

describe('browser', () => {
  test('--interactive needs a terminal', () => {
    const interactive = { ...BROWSER, interactive: true };
    expect(broken([browser(null)], interactive)?.message).toBe(
      '--interactive needs a terminal, to wait there while you set the pages up',
    );
    expect(broken([browser(terminal)], interactive)).toBeUndefined();
    expect(broken([browser(null)], BROWSER)).toBeUndefined();
  });

  test('--tabs needs --interactive', () => {
    expect(broken([browser(terminal)], { ...BROWSER, tabs: true })?.message).toBe(
      '--tabs goes with --interactive: it is how the pages you set up are opened',
    );
    expect(broken([browser(terminal)], { interactive: true, tabs: true })).toBeUndefined();
  });

  test('only --interactive waits for the pages to be set up', () => {
    expect(browser(terminal).resolve(BROWSER, PAGES).prepare).toBeNull();
    expect(browser(terminal).resolve({ ...BROWSER, interactive: true }, PAGES).prepare).toBeTypeOf(
      'function',
    );
  });

  test('without --download or --no-download, the value is undefined', () => {
    expect(parse(browser(null), []).download).toBeUndefined();
    expect(parse(browser(null), ['--download']).download).toBe(true);
    expect(parse(browser(null), ['--no-download']).download).toBe(false);
  });
});

test('every format has a reporter', () => {
  for (const format of FORMATS) expect(reporters[format].report).toBeTypeOf('function');
});
