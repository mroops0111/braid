import type { ModelSnapshot, ViewArtifact, ViewKind } from '@braidhq/schema'
import type { Plugin } from './Plugin.js'

export interface RenderInput {
  readonly model: ModelSnapshot
  readonly config: unknown
}

export interface Generator extends Plugin {
  readonly type: 'generator'
  readonly viewKind: ViewKind
  render: (input: RenderInput) => Promise<ViewArtifact>
}
