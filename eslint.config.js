// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    typescript: true,
    formatters: false,
    stylistic: {
      indent: 2,
      quotes: 'single',
      semi: false,
    },
    ignores: [
      '**/dist',
      '**/node_modules',
      '**/.turbo',
      'pnpm-lock.yaml',
      'docs/**',
      '**/skills/**/*.md',
      '**/*.tsbuildinfo',
    ],
  },
  {
    // Zod idiom: `const X = z.object(...)` + `type X = z.infer<typeof X>`
    // shares a name. TS allows it (separate value/type namespaces); the lint
    // rule is too aggressive for schema-heavy code.
    rules: {
      'ts/no-redeclare': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      // Test descriptions often start with a class / type name (e.g. "Citation
      // is a discriminated union") which the lowercase-title rule rejects.
      'test/prefer-lowercase-title': 'off',
    },
  },
)
