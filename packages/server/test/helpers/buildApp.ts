import type { AbsolutePath, AgentId, StorageKind, WorkspaceId } from '@braidhq/schema'
import type { AppDependencies } from '../../src/composition.js'
import { Workspace } from '@braidhq/core'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composition.js'

const DEFAULT_WORKSPACE_ID = 'w-1' as WorkspaceId

/**
 * Build an app for route tests. Pre-registers a default workspace
 * (`w-1`) on the in-memory repository so handlers that resolve
 * `workspace.ontologyId` (e.g. validation in HITLService) don't 404.
 * Pass `workspaceIds` to register more.
 */
export function buildTestApp(options: { workspaceIds?: readonly WorkspaceId[] } = {}): {
  app: ReturnType<typeof createApp>
  deps: AppDependencies
} {
  const deps = composeApp()
  const ids = options.workspaceIds ?? [DEFAULT_WORKSPACE_ID]
  for (const id of ids) {
    const ws = new Workspace({
      id,
      rootPath: `/abs/${id}` as AbsolutePath,
      productManifest: {
        name: id,
        version: '0.0.0',
        ontologyId: 'ddd' as never,
        agents: { default: 'claude-default' as AgentId, tasks: {} },
        agentBindings: [],
        sources: [],
        mcpServers: [],
        storage: { kind: 'in-memory' as StorageKind, config: {} },
      },
    })
    void deps.workspaceRepository.save(ws)
  }
  return { app: createApp(deps), deps }
}
