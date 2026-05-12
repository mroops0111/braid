import { z } from 'zod'
import { AbsolutePath, SkillId, SkillRunId, Timestamp, UserId } from './common.js'
import { McpServerId } from './mcp.js'

export const SkillRunStatus = z.enum(['running', 'succeeded', 'failed', 'cancelled'])
export type SkillRunStatus = z.infer<typeof SkillRunStatus>

export const SkillRun = z.object({
  id: SkillRunId,
  skillId: SkillId,
  startedAt: Timestamp,
  finishedAt: Timestamp.optional(),
  status: SkillRunStatus,
  triggeredBy: UserId,
  durationMs: z.number().int().nonnegative().optional(),
  tokensUsed: z.number().int().nonnegative().optional(),
  errorMessage: z.string().optional(),
})
export type SkillRun = z.infer<typeof SkillRun>

export const SkillOrigin = z.enum(['builtin', 'workspace', 'extension'])
export type SkillOrigin = z.infer<typeof SkillOrigin>

export const SkillFrontmatter = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  argumentHint: z.string().optional(),
  disableModelInvocation: z.boolean().default(false),
  requiredEnv: z.array(z.string()).default([]),
  requiredPaths: z.array(z.string()).default([]),
  requiredMcpServers: z.array(McpServerId).default([]),
})
export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>

export const SkillManifest = z.object({
  id: SkillId,
  origin: SkillOrigin,
  path: AbsolutePath,
  frontmatter: SkillFrontmatter,
  extensionPath: AbsolutePath.optional(),
})
export type SkillManifest = z.infer<typeof SkillManifest>

export const SkillEventStarted = z.object({
  type: z.literal('started'),
  runId: SkillRunId,
  skillId: SkillId,
  at: Timestamp,
})

export const SkillEventMessage = z.object({
  type: z.literal('message'),
  text: z.string(),
})

export const SkillEventToolCall = z.object({
  type: z.literal('tool-call'),
  tool: z.string().min(1),
  args: z.unknown(),
})

export const SkillArtifactKind = z.enum(['proposal', 'clarify', 'decision', 'view'])
export type SkillArtifactKind = z.infer<typeof SkillArtifactKind>

export const SkillEventArtifactWritten = z.object({
  type: z.literal('artifact-written'),
  artifactKind: SkillArtifactKind,
  artifactId: z.string().min(1),
  path: AbsolutePath,
})

export const SkillEventCompleted = z.object({
  type: z.literal('completed'),
  runId: SkillRunId,
  exitCode: z.number().int(),
  at: Timestamp,
})

export const SkillEventError = z.object({
  type: z.literal('error'),
  message: z.string().min(1),
  at: Timestamp,
})

export const SkillEvent = z.discriminatedUnion('type', [
  SkillEventStarted,
  SkillEventMessage,
  SkillEventToolCall,
  SkillEventArtifactWritten,
  SkillEventCompleted,
  SkillEventError,
])
export type SkillEvent = z.infer<typeof SkillEvent>
