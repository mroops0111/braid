import { describe, expect, it } from 'vitest'
import {
  FactFragment,
  IntentFragment,
  IntentFragmentType,
  Scope,
  SourceDescriptor,
  SourceFragment,
  SourceKind,
} from '../src/index.js'

describe('sourceDescriptor', () => {
  it('parses with config blob', () => {
    const descriptor = SourceDescriptor.parse({
      id: 's-1',
      pluginId: 'source-github',
      kind: 'code',
      config: { repo: 'org/repo' },
    })
    expect(descriptor.kind).toBe('code')
  })

  it('rejects unknown kind', () => {
    const result = SourceDescriptor.safeParse({
      id: 's-1',
      pluginId: 'source-x',
      kind: 'mystery',
      config: {},
    })
    expect(result.success).toBe(false)
  })
})

describe('sourceKind', () => {
  it('has three kinds: intent / code / external', () => {
    expect(SourceKind.options).toEqual(['intent', 'code', 'external'])
  })
})

describe('scope', () => {
  it('defaults to empty arrays', () => {
    const scope = Scope.parse({})
    expect(scope.tokens).toEqual([])
    expect(scope.pathGlobs).toEqual([])
  })

  it('accepts tokens + globs', () => {
    const scope = Scope.parse({
      tokens: ['service-a'],
      pathGlobs: ['src/**/*.ts'],
    })
    expect(scope.tokens).toContain('service-a')
  })
})

describe('intentFragmentType (open brand — concrete types live in source plugins)', () => {
  it('accepts any non-empty string', () => {
    expect(IntentFragmentType.parse('prd')).toBe('prd')
    expect(IntentFragmentType.parse('design-doc')).toBe('design-doc')
  })
  it('rejects empty', () => {
    expect(IntentFragmentType.safeParse('').success).toBe(false)
  })
})

describe('intentFragment', () => {
  it('parses with arbitrary fragmentType', () => {
    const fragment = IntentFragment.parse({
      kind: 'intent',
      sourceId: 's-1',
      text: 'Users can void a task',
      location: { uri: 'file:///prd.md' },
      fragmentType: 'prd',
    })
    expect(fragment.fragmentType).toBe('prd')
  })

  it('rejects empty fragmentType', () => {
    const result = IntentFragment.safeParse({
      kind: 'intent',
      sourceId: 's-1',
      text: 'x',
      location: { uri: 'x' },
      fragmentType: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('factFragment', () => {
  it('parses with codeSymbol', () => {
    const fragment = FactFragment.parse({
      kind: 'fact',
      sourceId: 's-1',
      text: 'function voidTask() { ... }',
      location: { uri: 'file:///src/task.ts' },
      codeSymbol: { file: 'src/task.ts', symbol: 'voidTask', language: 'typescript' },
    })
    expect(fragment.codeSymbol?.symbol).toBe('voidTask')
  })

  it('codeSymbol is optional', () => {
    const fragment = FactFragment.parse({
      kind: 'fact',
      sourceId: 's-1',
      text: 'x',
      location: { uri: 'x' },
    })
    expect(fragment.codeSymbol).toBeUndefined()
  })
})

describe('sourceFragment union', () => {
  it('discriminates intent vs fact via kind', () => {
    const intent = SourceFragment.parse({
      kind: 'intent',
      sourceId: 's-1',
      text: 'x',
      location: { uri: 'x' },
      fragmentType: 'rfc',
    })
    expect(intent.kind).toBe('intent')

    const fact = SourceFragment.parse({
      kind: 'fact',
      sourceId: 's-1',
      text: 'x',
      location: { uri: 'x' },
    })
    expect(fact.kind).toBe('fact')
  })

  it('rejects other kinds', () => {
    const result = SourceFragment.safeParse({
      kind: 'mystery',
      sourceId: 's-1',
      text: 'x',
      location: { uri: 'x' },
    })
    expect(result.success).toBe(false)
  })
})
