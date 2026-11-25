// The command's options, in groups of one concern each: its options, the checks on them, and its
// part of the run's options.

import type { Option } from 'commander';

/** A check on the values given, with what is wrong when it does not hold. */
export type Rule<V> = { holds(values: V): boolean; message: string };

/** The two pages' addresses, as the browser opens them. */
export type Pages = { before: string; after: string };

/** Options of one concern. `V` is the values it reads, as commander gives them by their camel-cased
 * names, some of them another group's; `Out` is its part of the run's options. */
export interface OptionGroup<V, Out> {
  /** Its section in --help. */
  heading: string;
  options: Option[];
  rules?: Rule<V>[];
  /** Its part of the run's options; {} for a group whose options are the command's own. */
  resolve(values: V, pages: Pages): Out;
}

/** The values a group reads. */
export type ValuesOf<G> = G extends OptionGroup<infer V, unknown> ? V : never;

/** The first rule of the groups, in their order, that the values break; undefined when all hold. */
export function broken<V>(groups: OptionGroup<V, unknown>[], values: V): Rule<V> | undefined {
  return groups.flatMap(group => group.rules ?? []).find(rule => !rule.holds(values));
}
