import { defineConfig } from 'vitest/config'

export default defineConfig({
  // zod-openapi patches zod's prototype once, dedupe keeps a single zod
  // instance so schema-defined types see `.openapi()` under vitest too.
  resolve: {
    dedupe: ['zod'],
  },
  test: {
    // Load the zod-openapi extension before any schema module so every zod
    // schema, including branded types, shares one patched zod instance.
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/server.ts'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
})
