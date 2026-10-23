import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    // The command, built for Node; its packages stay imports, installed with it.
    ssr: 'src/cli.ts',
    target: 'node22',
    outDir: 'dist',
    // Kept readable: the functions in src/page.ts are sent to the page as source.
    minify: false,
    rolldownOptions: { output: { entryFileNames: 'cli.js' } },
  },
  test: {
    include: ['test/**/*.test.ts'],
    // The command tests open Chrome.
    testTimeout: 60_000,
  },
});
