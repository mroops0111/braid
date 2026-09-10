import type { RunRepository, SkillRunner } from '@braidhq/core'
import type {
  AbsolutePath,
  McpServerId,
  RunRecord,
  SkillId,
  SkillInputDescriptor,
  SkillManifest as SkillManifestData,
  SkillRunId,
  UserId,
  WorkspaceId,
} from '@braidhq/schema'
import { SkillManifest } from '@braidhq/core'
import { T0 } from './time.js'

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

/**
 * The part of `SkillRunner` a fake has to satisfy and no test drives.
 *
 * A fake exists to give one behaviour a test can steer. The rest of the port
 * still has to be there, and written out per fake it becomes the thing that
 * silently drifts: three copies of Braid's own fakes each had to gain
 * `emitBlock` when the port did, and their `hasActiveRun` had already stopped
 * matching the real signature.
 *
 * Spread this and override what the test steers. Anything left is inert on
 * purpose: it answers as if nothing is running and refuses what it cannot
 * honestly do, rather than returning a plausible value a test might come to
 * rely on.
 */
export function inertSkillRunner(): SkillRunner {
  return {
    start: async () => 'run-not-started' as SkillRunId,
    subscribe: () => ({ unsubscribe: () => {}, positionAtSubscribe: 0 }),
    emitBlock: async () => { throw new Error('This fake records no blocks') },
    hasActiveRun: () => false,
    isActive: () => false,
    cancel: async () => {},
    sessionIdFor: async () => undefined,
    forgetSession: async () => {},
  }
}

/**
 * The part of `RunRepository` a fake has to satisfy and no test drives.
 *
 * Same reason as `inertSkillRunner`. A test needing one method was casting
 * the whole port away, which also turned off the checking on the record it
 * was building, and the record had drifted.
 */
export function inertRunRepository(): RunRepository {
  return {
    saveRecord: async () => {},
    appendEvent: async () => {},
    listRecords: async () => [],
    readEvents: () => ({ async *[Symbol.asyncIterator]() {} }),
    deleteRecords: async () => {},
    saveSessionMetadata: async () => {},
    listSessionMetadata: async () => [],
  }
}

/**
 * A run summary, as the log would hold it.
 *
 * Every field is real rather than cast away, so a test stops compiling when
 * the record gains something a surface needs. Two call sites built this
 * inline, one of them behind an `as never` that turned the type off.
 */
export function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: 'run-1' as SkillRunId,
    workspaceId: 'w-1' as WorkspaceId,
    skillId: 'braid:ask' as SkillId,
    args: 'a question',
    resumed: false,
    startedBy: 'tester' as UserId,
    startedAt: T0,
    unattended: false,
    ...overrides,
  }
}
