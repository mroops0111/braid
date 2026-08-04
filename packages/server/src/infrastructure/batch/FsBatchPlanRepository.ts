import type { BatchPlanRepository, Workspace } from '@braidhq/core'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { BatchPlan } from '@braidhq/core'
import { BatchPlan as BatchPlanData } from '@braidhq/schema'
import { z } from 'zod'
import { batchPlanPath, workspaceArtifactsDir } from '../_shared/paths.js'

// v2 renamed BatchInputMode from intent|derive to direct|derived.
export const BATCH_PLAN_VERSION = 2

// Envelope only. The plan is validated after migration, not at this layer.
export const BatchPlanFile = z.object({
  version: z.number().int(),
  plan: z.unknown(),
})

// v1 named the batch input mode intent|derive, v2 renamed it direct|derived.
function migrateModeV1ToV2(plan: unknown): unknown {
  if (!plan || typeof plan !== 'object' || !('mode' in plan))
    return plan
  const legacy = (plan as { mode: unknown }).mode
  const mode = legacy === 'intent' ? 'direct' : legacy === 'derive' ? 'derived' : legacy
  return { ...(plan as Record<string, unknown>), mode }
}

/** Upgrade a persisted plan payload from its on-disk version to the current schema. */
function migratePlan(fromVersion: number, plan: unknown): unknown {
  return fromVersion < 2 ? migrateModeV1ToV2(plan) : plan
}

export class FsBatchPlanRepository implements BatchPlanRepository {
  async load(workspace: Workspace): Promise<BatchPlan | null> {
    let raw: string
    try {
      raw = await readFile(batchPlanPath(workspace.rootPath), 'utf-8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return null
      throw error
    }
    const file = BatchPlanFile.parse(JSON.parse(raw))
    if (file.version > BATCH_PLAN_VERSION) {
      throw new Error(
        `batch-plan.json in ${workspace.rootPath} is version ${file.version}, newer than supported ${BATCH_PLAN_VERSION}`,
      )
    }
    const migrated = migratePlan(file.version, file.plan)
    return new BatchPlan(BatchPlanData.parse(migrated))
  }

  async save(workspace: Workspace, plan: BatchPlan): Promise<void> {
    const path = batchPlanPath(workspace.rootPath)
    await mkdir(workspaceArtifactsDir(workspace.rootPath), { recursive: true })
    const payload = { version: BATCH_PLAN_VERSION, plan: plan.toData() }
    // Atomic write so a crashed server can't leave a half-file mid-run.
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
    await rename(tmp, path)
  }

  async clear(workspace: Workspace): Promise<void> {
    await rm(batchPlanPath(workspace.rootPath), { force: true })
  }
}
