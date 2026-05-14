import type { AbsolutePath, AgentEffort, AgentId, AgentKind, WorkspaceId } from '@telos/schema'
import type { AppDependencies } from './composition.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import {
  builtinSkillsRoot,
  EvidenceValidator,
  NotFoundError,
  OrphanEdgeValidator,
  PluginRegistry,
} from '@telos/core'
import { DDDOntology, DDDOntologyValidator } from '@telos/ontology-ddd'
import { GoogleDriveLoader } from '@telos/source-loader-gdrive'
import { GitLoader } from '@telos/source-loader-git'
import { KuzuModelRepository } from '@telos/storage-kuzu'
import { composeApp } from './composition.js'
import { ClaudeCodeAgentBinding } from './infrastructure/agent/ClaudeCodeAgentBinding.js'
import { SubprocessSkillRunner } from './infrastructure/agent/SubprocessSkillRunner.js'
import { FsClarifyTicketRepository } from './infrastructure/fs/FsClarifyTicketRepository.js'
import { FsDecisionRepository } from './infrastructure/fs/FsDecisionRepository.js'
import { FsProposalRepository } from './infrastructure/fs/FsProposalRepository.js'
import { FsRunRepository } from './infrastructure/fs/FsRunRepository.js'
import { FsSkillRegistry } from './infrastructure/fs/FsSkillRegistry.js'
import { FsWorkspaceRepository } from './infrastructure/fs/FsWorkspaceRepository.js'
import { WorkspaceRegistryFile } from './infrastructure/fs/WorkspaceRegistryFile.js'
import { GoogleOAuth } from './infrastructure/oauth/GoogleOAuth.js'
import { FsSecretStore } from './infrastructure/secrets/SecretStore.js'

export interface ComposeFsOptions {
  /** Where to persist registered workspace paths. Default `$TELOS_HOME` or `~/.telos`. */
  readonly telosHome?: string
  /** URL the server reports to spawned subprocesses for REST callbacks. */
  readonly apiUrl?: string
  /** Coding-agent model selection (default `opus`). */
  readonly agentModel?: string
  /** Coding-agent effort tier (default `high`). */
  readonly agentEffort?: AgentEffort
}

/**
 * Production composition root: real filesystem persistence for workspaces /
 * proposals / clarify / decisions, built-in skills loaded from `@telos/core`,
 * Claude Code subprocess agent. Model storage uses Kuzu (embedded, zero-infra)
 * per workspace at `<workspace>/.telos/model.kuzu`.
 */
export function composeFsApp(options: ComposeFsOptions = {}): AppDependencies {
  const telosHome = options.telosHome ?? process.env.TELOS_HOME ?? join(homedir(), '.telos')
  const apiUrl = options.apiUrl ?? 'http://localhost:4321'

  const secretStore = new FsSecretStore(join(telosHome, 'secrets'))

  const googleClientId = process.env.TELOS_GOOGLE_CLIENT_ID
  const googleClientSecret = process.env.TELOS_GOOGLE_CLIENT_SECRET
  const googleRedirect = process.env.TELOS_GOOGLE_REDIRECT_URI ?? `${apiUrl}/oauth/google/callback`
  const googleOAuth = googleClientId && googleClientSecret
    ? new GoogleOAuth({ clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: googleRedirect })
    : undefined

  const registry = new WorkspaceRegistryFile(join(telosHome, 'workspaces.json'))
  const workspaceRepository = new FsWorkspaceRepository({ registry })
  const workspaceRoots = async (): Promise<ReadonlyMap<WorkspaceId, AbsolutePath>> => {
    const workspaces = await workspaceRepository.list()
    return new Map(workspaces.map(ws => [ws.id, ws.rootPath]))
  }

  const proposalRepository = new FsProposalRepository({ workspaceRoots })
  const clarifyRepository = new FsClarifyTicketRepository({ workspaceRoots })
  const decisionRepository = new FsDecisionRepository({ workspaceRoots })

  const modelRepository = new KuzuModelRepository({
    resolveDbPath: async (workspaceId) => {
      const roots = await workspaceRoots()
      const root = roots.get(workspaceId)
      if (!root)
        throw new NotFoundError(`Workspace "${workspaceId}" not registered`)
      return join(root, '.telos', 'model.kuzu')
    },
  })

  const skillRegistry = new FsSkillRegistry({
    builtinSkillsRoot: builtinSkillsRoot as AbsolutePath,
  })

  const agentBinding = new ClaudeCodeAgentBinding({
    id: 'claude-default' as AgentId,
    kind: 'claude-code' as AgentKind,
    model: options.agentModel ?? 'opus',
    effort: options.agentEffort ?? 'high',
    extraArgs: [],
    env: {},
  })

  const runRepository = new FsRunRepository()

  const pluginRegistry = new PluginRegistry()
  const dddOntology = new DDDOntology()
  pluginRegistry.register(dddOntology)
  pluginRegistry.register(new EvidenceValidator())
  pluginRegistry.register(new OrphanEdgeValidator())
  pluginRegistry.register(new DDDOntologyValidator(dddOntology))
  pluginRegistry.register(new GitLoader())

  if (googleOAuth) {
    // GoogleDriveLoader requires OAuth to be configured. We resolve the
    // access token per (workspaceId, sourceId): read stored tokens from
    // the secret store, refresh if expired, persist the rotated access
    // token, hand the bearer to the loader.
    const oauth = googleOAuth
    pluginRegistry.register(new GoogleDriveLoader({
      resolveAccessToken: async ({ workspaceId, sourceId }) => {
        const key = `${workspaceId}--${sourceId}`
        const stored = await secretStore.read<{
          accessToken: string
          refreshToken: string
          expiresAt: string
        }>('oauth-google', key)
        if (!stored) {
          throw new NotFoundError(
            `Google Drive source "${sourceId}" on workspace "${workspaceId}" is not connected. `
            + `Authorise via POST /oauth/google/start.`,
          )
        }
        // 60-second skew so we don't hand out a token about to expire mid-request.
        const stillValidUntil = new Date(stored.expiresAt).getTime() - 60_000
        if (Date.now() < stillValidUntil)
          return stored.accessToken
        const refreshed = await oauth.refreshAccessToken(stored.refreshToken)
        await secretStore.write('oauth-google', key, {
          ...stored,
          accessToken: refreshed.accessToken,
          expiresAt: refreshed.expiresAt,
        })
        return refreshed.accessToken
      },
    }))
  }

  const skillRunner = new SubprocessSkillRunner({
    skillRegistry,
    agentBinding,
    apiUrl,
    runRepository,
    referenceDirs: [
      { name: 'shared', path: join(builtinSkillsRoot, 'shared') as AbsolutePath },
    ],
  })

  const deps = composeApp({
    workspaceRepository,
    proposalRepository,
    clarifyRepository,
    decisionRepository,
    modelRepository,
    skillRegistry,
    skillRunner,
    runRepository,
    pluginRegistry,
  })
  return {
    ...deps,
    secretStore,
    ...(googleOAuth ? { googleOAuth } : {}),
  }
}
