import type { PluginId, Scope, SourceFragment, SourceId, SourceKind } from '@telos/schema'
import type { Source } from '../../src/index.js'
import { z } from 'zod'

export class FakeSource implements Source {
  readonly configSchema = z.object({}).passthrough()

  constructor(
    readonly id: SourceId,
    readonly kind: SourceKind,
    private readonly fragments: SourceFragment[],
  ) {}

  async *fetch(_config: unknown, _scope: Scope): AsyncIterable<SourceFragment> {
    for (const fragment of this.fragments) yield fragment
  }
}

export function fakeIntentFragment(text: string, sourceId: SourceId): SourceFragment {
  return {
    kind: 'intent',
    sourceId,
    text,
    location: { uri: `intent:${text}` },
    fragmentType: 'prd' as never,
  }
}

export function fakeFactFragment(text: string, sourceId: SourceId): SourceFragment {
  return {
    kind: 'fact',
    sourceId,
    text,
    location: { uri: `file:///${text}.ts` },
  }
}

export const sourceIdIntent = 's-intent' as SourceId
export const sourceIdCode = 's-code' as SourceId
export const pluginIdIntent = 'plugin-intent' as PluginId
export const pluginIdCode = 'plugin-code' as PluginId
