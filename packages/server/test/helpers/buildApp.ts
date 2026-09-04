import type { PluginRegistry } from '@braidhq/core'
import type { WorkspaceId } from '@braidhq/schema'
import type { AppDependencies } from '../../src/composeApp.js'
import { makeWorkspace } from '@braidhq/test-utils'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composeApp.js'

const DEFAULT_WORKSPACE_ID = 'w-1' as WorkspaceId

/**
 * Build an app for route tests. Pre-registers a default workspace
 * (`w-1`) on the in-memory repository so handlers that resolve
 * `workspace.ontologyId` (e.g. validation in HITLService) don't 404.
 * Pass `workspaceIds: []` to start without any registered workspace.
 */
export async function buildTestApp(options: {
  workspaceIds?: readonly WorkspaceId[]
  /**
   * Registers real plugins.
   * A route that consults the workspace's ontology needs one,
   * since a bare registry cannot serve its own workspaces, and answers 404.
   */
  pluginRegistry?: PluginRegistry
} = {}): Promise<{
    app: ReturnType<typeof createApp>
    deps: AppDependencies
  }> {
  const deps = composeApp(options.pluginRegistry ? { pluginRegistry: options.pluginRegistry } : {})
  const ids = options.workspaceIds ?? [DEFAULT_WORKSPACE_ID]
  for (const id of ids) {
    await deps.workspaceRepository.save(makeWorkspace({ id }))
  }
  return { app: createApp(deps), deps }
}
