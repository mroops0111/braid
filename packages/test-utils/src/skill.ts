import type {
  AbsolutePath,
  McpServerId,
  SkillId,
  SkillManifest as SkillManifestData,
} from '@braidhq/schema'
import { SkillManifest } from '@braidhq/core'

export interface MakeSkillManifestOptions {
  readonly id?: string
  readonly path?: AbsolutePath
  readonly origin?: 'builtin' | 'workspace'
  readonly extensionPath?: AbsolutePath
  readonly name?: string
  readonly description?: string
  readonly requiredEnv?: readonly string[]
  readonly requiredMcpServers?: readonly McpServerId[]
}

/**
 * Construct the raw `SkillManifestData` payload. Use `makeSkillManifest`
 * when you want the wrapped `SkillManifest` aggregate.
 */
export function makeSkillManifestData(opts: MakeSkillManifestOptions = {}): SkillManifestData {
  const id = opts.id ?? 'braid:ask'
  return {
    id: id as SkillId,
    origin: opts.origin ?? 'builtin',
    path: opts.path ?? (`/abs/skills/${id}/SKILL.md` as AbsolutePath),
    ...(opts.extensionPath ? { extensionPath: opts.extensionPath } : {}),
    frontmatter: {
      name: opts.name ?? 'ask',
      description: opts.description ?? 'test skill',
      disableModelInvocation: false,
      braid: {
        requiredEnv: [...(opts.requiredEnv ?? [])],
        requiredMcpServers: [...(opts.requiredMcpServers ?? [])],
        allowedRoles: ['owner', 'maintainer'],
      },
    },
  }
}

/**
 * Construct a wrapped `SkillManifest`. Defaults to a `braid:ask`
 * builtin manifest with no env / path / mcp requirements; override
 * for readiness-check tests.
 */
export function makeSkillManifest(opts: MakeSkillManifestOptions = {}): SkillManifest {
  return new SkillManifest(makeSkillManifestData(opts))
}
