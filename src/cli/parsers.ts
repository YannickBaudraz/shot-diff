// Option parsers, as commander calls them: the value given, and what the option held so far.

import { InvalidArgumentError } from 'commander';

export function nonNegativeNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new InvalidArgumentError('not a number');
  return parsed;
}

export function appendKeyValue(value: string, pairs: [string, string][]): [string, string][] {
  const equals = value.indexOf('=');
  if (equals < 1) throw new InvalidArgumentError('wants key=value');
  return [...pairs, [value.slice(0, equals), value.slice(equals + 1)]];
}

export function append(value: string, list: string[]): string[] {
  return [...list, value];
}
