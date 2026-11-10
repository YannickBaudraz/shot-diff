// The image matcher's type, for Vitest 5, as @brachkow/vitest-image-snapshot's README gives it.
import type { MatchImageSnapshotOptions } from '@brachkow/vitest-image-snapshot';

declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toMatchImageSnapshot: (options?: MatchImageSnapshotOptions) => R;
    toMatchImageSnapshotAsync: (options?: MatchImageSnapshotOptions) => Promise<void>;
  }
}
