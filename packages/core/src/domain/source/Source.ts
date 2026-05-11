import type { Scope, SourceFragment, SourceId, SourceKind } from '@telos/schema'
import type { z } from 'zod'

export interface Source {
  id: SourceId
  kind: SourceKind
  configSchema: z.ZodSchema
  fetch: (config: unknown, scope: Scope) => AsyncIterable<SourceFragment>
}
