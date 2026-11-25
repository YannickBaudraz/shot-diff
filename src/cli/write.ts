import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Box } from '../geometry.ts';
import type { Result } from '../run.ts';
import type { Side } from '../side.ts';

/** One shot's two files, and what each shows; null for a side --unified leaves out, not written. A
 * lone image's file has no side in its name. */
export type WrittenShot = {
  before: { file: string; removed: string[]; box: Box } | null;
  after: { file: string; added: string[]; box: Box } | null;
};

/** Write each shot's images, two, or one with --unified, which has no side in its name; a page with
 * several shots numbers them in the file names. A dry run has no image to write: its shots are
 * named as they would be. */
export function write(result: Result, out: string, name: string): WrittenShot[] {
  return result.shots.map((shot, n) => {
    const prefix = result.shots.length > 1 ? `${name}-${n + 1}` : name;
    const alone = !shot.before || !shot.after;
    const fileOf = (side: Side) => join(out, alone ? `${prefix}.png` : `${prefix}-${side}.png`);
    const files = { before: fileOf('before'), after: fileOf('after') };
    for (const side of ['before', 'after'] as const) {
      const png = shot[side]?.png;
      if (!png) continue;
      mkdirSync(out, { recursive: true });
      writeFileSync(files[side], png);
    }
    const { before, after } = shot;
    return {
      before: before && { file: files.before, removed: before.changed, box: before.box },
      after: after && { file: files.after, added: after.changed, box: after.box },
    };
  });
}
