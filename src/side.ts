// The two pages compared, the before page and the after page, and each one's colour on the shots.

export type Side = 'before' | 'after';

export const SIDES: Side[] = ['before', 'after'];

/** What the after page no longer has is red on the before shot; what it adds is green on the after shot. */
export const COLOURS: Record<Side, { color: string; tint: string }> = {
  before: { color: '#cf222e', tint: 'rgba(255, 129, 130, 0.45)' },
  after: { color: '#1a7f37', tint: 'rgba(74, 194, 107, 0.4)' },
};

/** What each side is called on its band, and what its colour marks. */
export const WORDS: Record<Side, { name: string; marks: string }> = {
  before: { name: 'Before', marks: 'removed' },
  after: { name: 'After', marks: 'added' },
};
