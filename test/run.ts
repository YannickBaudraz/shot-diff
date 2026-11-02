// Runs the command from source on fixture pages, as the tests use it.

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const cli = join(import.meta.dirname, '..', 'src', 'cli.ts');
export const page = (name: string) => pathToFileURL(join(import.meta.dirname, 'fixtures', name)).href;

/** The command's exit, and its --json output when it succeeded. */
export function shotDiff(...args: string[]) {
  const out = mkdtempSync(join(tmpdir(), 'shot-diff-'));
  const done = spawnSync(process.execPath, [cli, ...args, '--out', out, '--json'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { done, result: done.status === 0 ? JSON.parse(done.stdout) : null };
}
