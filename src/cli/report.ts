// What the command prints: what was marked, in the --format asked for, and its warnings.

import type { Box } from '../geometry.ts';
import type { Result } from '../run.ts';
import type { WrittenShot } from './write.ts';

/** What --format takes. */
export const FORMATS = ['text', 'json'] as const;
export type Format = (typeof FORMATS)[number];

/** Prints what was marked on stdout. `dryRun`: the files the shots name were not written. */
export type Reporter = { report(result: Result, shots: WrittenShot[], dryRun: boolean): void };

/** A reporter for each format. */
export const reporters: Record<Format, Reporter> = {
  text: {
    report(result, shots, dryRun) {
      printLines(shots, dryRun);
      if (dryRun) printParts(result.areas);
    },
  },
  json: {
    /** What was marked, where, and what was left out, as JSON. */
    report(result, shots, dryRun) {
      const { wordChanges, lookChanges, leftOut, hidden, ignored, ignoredAreas, areas } = result;
      console.log(
        JSON.stringify(
          // dryRun: the files the shots name were not written
          { dryRun, wordChanges, lookChanges, shots, leftOut, hidden, ignored, ignoredAreas, areas },
          null,
          2,
        ),
      );
    },
  },
};

/** A line per image written, how many parts it marks, and its size in the CSS pixels that --height
 * and --max-height count in: the file is that at --scale, with its band. */
function printLines(shots: WrittenShot[], dryRun: boolean) {
  const wrote = dryRun ? 'would write ' : '';
  for (const { before, after } of shots) {
    if (before)
      console.log(`${wrote}${before.file}: ${before.removed.length} part(s) removed, ${sizeOf(before.box)}`);
    if (after)
      console.log(`${wrote}${after.file}: ${after.added.length} part(s) added, ${sizeOf(after.box)}`);
  }
}

/** On a dry run: the parts of the page that changed, each as the --selector that shoots it alone,
 * then the changes in no part, which a run with --selector leaves out. */
function printParts(areas: Result['areas']) {
  const parts = areas.filter(area => area.selector !== null);
  if (parts.length) {
    console.log(
      `${parts.length} part(s) of the page changed; for a pair of images of each, run once per part with its --selector:`,
    );
    // In single quotes for a shell; a quote inside is closed, escaped and opened again.
    const named = parts.map(area => `--selector '${area.selector!.replaceAll("'", "'\\''")}'`);
    const width = Math.max(...named.map(text => text.length));
    parts.forEach((area, i) => console.log(`  ${named[i].padEnd(width)}  ${area.changes} change(s)`));
  }
  const rest = areas.find(area => area.selector === null);
  if (rest)
    console.log(
      `${rest.changes} change(s) are in no part narrower than the page: shoot them with one more run, without --selector`,
    );
}

const sizeOf = (box: Box) => `${Math.round(box.width)}x${Math.round(box.height)} px`;

/** An image taller than this many windows is a lot of scrolling, and in a pull request, shrunk to the
 * width of its text, no longer one to compare a pair by eye. */
const TALL_IN_WINDOWS = 2;

/** On stderr, so stdout stays the --json output, whatever the format: when nothing changed, when
 * changes were outside --selector, when a change is cut from every image, or cut off on the page
 * itself, or when an image is taller than TALL_IN_WINDOWS windows of `height`. */
export function warn(result: Result, shots: WrittenShot[], height: number) {
  if (!result.wordChanges && !result.lookChanges)
    console.error(
      "shot-diff: no difference in the pages' words, images or looks; the shots show the top of each page",
    );
  const listed = ({ removed, added }: Result['leftOut']) => [
    ...removed.map(s => `removed: ${s}`),
    ...added.map(s => `added: ${s}`),
  ];
  const missed = listed(result.leftOut);
  const hidden = listed(result.hidden);
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
  if (hidden.length) {
    console.error(
      `shot-diff: ${hidden.length} change(s) are in a part of the page a scroll area cuts off, so no image can show them:`,
    );
    for (const line of hidden) console.error(`  ${line}`);
  }
  const tall = shots
    .flatMap(shot => [shot.before, shot.after])
    .filter(image => image !== null)
    .filter(image => image.box.height > TALL_IN_WINDOWS * height);
  if (tall.length) {
    console.error(
      `shot-diff: ${tall.length} image(s) are taller than two windows (--height ${height}), more than can be compared by eye in a pull request; lower --max-height, or shoot one part with --selector:`,
    );
    for (const image of tall) console.error(`  ${image.file}: ${sizeOf(image.box)}`);
  }
}
