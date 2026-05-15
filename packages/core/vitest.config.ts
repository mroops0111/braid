import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Type-only contracts (interfaces) compile to nothing; v8 reports them
      // as 0% which has no real meaning. Exclude.
      exclude: [
        'src/index.ts',
        'src/**/*Repository.ts',
        'src/domain/plugin/Plugin.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
})
