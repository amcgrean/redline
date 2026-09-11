import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'pdf-core',
          root: './packages/pdf-core',
          include: ['test/**/*.test.ts'],
          exclude: ['test/corpus.test.ts'],
          environment: 'node',
          setupFiles: ['./test/setup.ts'],
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'toolchest',
          root: './packages/toolchest',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'web',
          root: './apps/web',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'corpus',
          root: './packages/pdf-core',
          include: ['test/corpus.test.ts'],
          environment: 'node',
          setupFiles: ['./test/setup.ts'],
          testTimeout: 300_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});
