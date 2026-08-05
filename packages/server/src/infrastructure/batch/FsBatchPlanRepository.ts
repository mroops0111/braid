import type { BatchPlanRepository, Workspace } from '@braidhq/core'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { BatchPlan } from '@braidhq/core'
import { BatchPlan as BatchPlanData } from '@braidhq/schema'
import { z } from 'zod'
import { batchPlanPath, workspaceArtifactsDir } from '../_shared/paths.js'

// On-disk envelope version. Bumped only when the plan payload shape changes.
export const BATCH_PLAN_VERSION = 2

// Envelope only. The plan itself is validated by its schema below.
export const BatchPlanFile = z.object({
  version: z.number().int(),
  plan: z.unknown(),
})

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
    return new BatchPlan(BatchPlanData.parse(file.plan))
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
