import confirm from '@inquirer/confirm';

/** Asks a yes or no question on the terminal, answered `byDefault` on Enter alone. */
export type Ask = (message: string, byDefault: boolean) => Promise<boolean>;

/** The terminal's question; null when there is no terminal. The question goes to stderr, so stdout
 * stays the --json output. */
export const ask: Ask | null =
  process.stdin.isTTY && process.stderr.isTTY
    ? (message, byDefault) => confirm({ message, default: byDefault }, { output: process.stderr })
    : null;
