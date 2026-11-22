// The two pages compared, the before page and the after page, and each one's colour on the shots.

export type Side = 'before' | 'after';

export const SIDES: Side[] = ['before', 'after'];

/** `work` for each side, the two at once. */
export async function bothSides<T>(work: (side: Side) => Promise<T>): Promise<Record<Side, T>> {
  const [before, after] = await Promise.all(SIDES.map(work));
  return { before, after };
}

/** What the after page no longer has is boxed red on the before shot; what it adds is boxed green on
 * the after shot. */
export const COLORS: Record<Side, { color: string }> = {
  before: { color: '#cf222e' },
  after: { color: '#1a7f37' },
};

/** What is drawn on or around a side's colour: the side's name on its pill, a disc's number and ring,
 * a label's words. */
export const ON_SIDE_COLOR = '#ffffff';

/** What each side is called on its band, what its colour marks, and what its pill says instead of
 * its name on a lone image, one with no other side to be told apart from (--unified). */
export const WORDS: Record<Side, { name: string; marks: string; alone: string }> = {
  before: { name: 'Before', marks: 'removed', alone: 'Removed' },
  after: { name: 'After', marks: 'added', alone: 'Added' },
};
