import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'test/**/*.{test,spec}.ts',
      'tests/**/*.{test,spec}.ts',
    ],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts'],
      // floor just under current coverage so regressions fail CI; raise as tests are added
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 58,
        lines: 60,
      },
    },
  },
  oxc: {
    target: 'es2022',
  },
});
