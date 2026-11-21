import { availableParallelism } from 'node:os';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    // The command, built for Node; its packages stay imports, installed with it.
    ssr: 'src/cli.ts',
    target: 'node22',
    outDir: 'dist',
    // Kept readable: the functions in src/page/runtime.ts are sent to the page as source.
    minify: false,
    rolldownOptions: { output: { entryFileNames: 'cli.js' } },
  },
  test: {
    // Each end-to-end test starts the command and a Chrome. Measured, running the end-to-end files:
    //   24 cores: 1 at once 122 s, 2 80 s, 3 65 s, 4 67 s, 5 57 s, all 7 57 s
    //   4 cores: 1 at once 105 s, 2 90 s, 3 77 s, 4 65 s
    //   2 cores: 1 at once 133 s, 2 98 s
    // The run is fastest with as many files at once as the machine has cores. Vitest's default
    // is one fewer, which costs about 12 s on a 4-core CI runner.
    maxWorkers: availableParallelism(),
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
          // One test file opens Chrome, which a busy machine starts slowly.
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          // The functions of src/page/runtime.ts, run in Chrome on small pages each test builds.
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: { channel: 'chrome' } }),
            instances: [{ browser: 'chromium', viewport: { width: 1000, height: 700 } }],
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['e2e/**/*.test.ts'],
          // The command tests open Chrome.
          testTimeout: 60_000,
        },
      },
    ],
  },
});
