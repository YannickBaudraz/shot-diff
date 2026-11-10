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
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts', 'e2e/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
          // The command tests open Chrome.
          testTimeout: 60_000,
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
    ],
  },
});
