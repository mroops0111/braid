import type {
  AbsolutePath,
  McpServerId,
  SkillId,
  SkillInputDescriptor,
  SkillManifest as SkillManifestData,
} from '@braidhq/schema'
import { SkillManifest } from '@braidhq/core'

/** A per-unit input, the declaration that marks a step as working on one document. */
const SOURCE_SCOPE_INPUT: SkillInputDescriptor = {
  name: 'scope',
  label: 'Scope',
  kind: 'multi-pick',
  optional: true,
  provider: { kind: 'source' },
  fallback: 'text',
}

/** An input fed by answered clarifications, which is what marks the step that reads them. */
const ANSWERED_CLARIFICATION_INPUT: SkillInputDescriptor = {
  name: 'clarification',
  label: 'Clarification',
  kind: 'pick',
  optional: true,
  provider: { kind: 'clarify', filter: { status: 'answered' } },
  fallback: 'disabled',
}

export interface MakeSkillManifestOptions {
  readonly id?: string
  readonly path?: AbsolutePath
  readonly origin?: 'builtin' | 'workspace'
  readonly extensionPath?: AbsolutePath
  readonly name?: string
  readonly description?: string
  readonly requiredEnv?: readonly string[]
  readonly requiredMcpServers?: readonly McpServerId[]
  readonly category?: 'ask' | 'build' | 'generate'
  readonly order?: number
  readonly hidden?: boolean
  /** Give it an input fed by the source provider, so it reads as per-unit. */
  readonly sourceInput?: boolean
  /** Give it an input fed by answered clarifications, so it reads as the step that consumes them. */
  readonly readsAnswered?: boolean
}

/**
 * Construct the raw SkillManifestData payload.
 * Use makeSkillManifest when you want the wrapped SkillManifest aggregate.
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
        ...(opts.category ? { category: opts.category } : {}),
        ...(opts.order !== undefined ? { order: opts.order } : {}),
        ...(opts.hidden ? { hidden: true } : {}),
        ...(opts.sourceInput || opts.readsAnswered
          ? {
              inputs: [
                ...(opts.sourceInput ? [SOURCE_SCOPE_INPUT] : []),
                ...(opts.readsAnswered ? [ANSWERED_CLARIFICATION_INPUT] : []),
              ],
            }
          : {}),
      },
    },
  }
}

/**
 * Construct a wrapped SkillManifest.
 * Defaults to a braid:ask builtin manifest with no env, path,
 * or mcp requirements. Override for readiness-check tests.
 */
export function makeSkillManifest(opts: MakeSkillManifestOptions = {}): SkillManifest {
  return new SkillManifest(makeSkillManifestData(opts))
}
