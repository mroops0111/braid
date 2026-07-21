import type { RunRepository, Workspace } from '@braidhq/core'
import type { AbsolutePath, RunRecord, SessionMetadata, SkillEvent, SkillRunId } from '@braidhq/schema'
import { createReadStream } from 'node:fs'
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { RunRecord as RunRecordSchema, SessionMetadata as SessionMetadataSchema, SkillEvent as SkillEventSchema } from '@braidhq/schema'
import { runEventsPath, runIndexPath, runsDir, runSessionsMetadataPath } from '../_shared/paths.js'

/**
 * File-system adapter for skill-run recording.
 *
 *   <workspaceRoot>/artifacts/runs/
 *     ├── index.jsonl                (append-only summary, last-wins per runId)
 *     └── <runId>.jsonl              (full SkillEvent stream for one run)
 *
 * The index is append-only because every write of one workspace goes,
 * today, through a single server process.
 * Should that ever change,
 * we would swap to atomic `mv tmp final` rewrites, or hand it to sqlite.
 */
export class FsRunRepository implements RunRepository {
  async saveRecord(workspace: Workspace, record: RunRecord): Promise<void> {
    const root = workspace.rootPath
    await mkdir(runsDir(root), { recursive: true })
    const line = `${JSON.stringify(record)}\n`
    await appendFile(runIndexPath(root), line, 'utf-8')
  }

  async appendEvent(workspace: Workspace, runId: SkillRunId, event: SkillEvent): Promise<void> {
    const root = workspace.rootPath
    await mkdir(runsDir(root), { recursive: true })
    const line = `${JSON.stringify(event)}\n`
    await appendFile(runEventsPath(root, runId), line, 'utf-8')
  }

  async listRecords(workspace: Workspace): Promise<readonly RunRecord[]> {
    const root = workspace.rootPath
    const path = runIndexPath(root)
    let raw: string
    try {
      raw = await readFile(path, 'utf-8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return []
      throw error
    }
    // Last-write-wins per runId so progress updates collapse to a single entry.
    const byId = new Map<string, RunRecord>()
    for (const line of raw.split('\n')) {
      if (line.length === 0)
        continue
      const parsed = safeParseRecord(line)
      if (parsed)
        byId.set(parsed.runId, parsed)
    }
    // Reverse-chronological by startedAt so the newest conversation lands at top.
    return Array.from(byId.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  async * readEvents(workspace: Workspace, runId: SkillRunId): AsyncIterable<SkillEvent> {
    const path = runEventsPath(workspace.rootPath, runId)
    const stream = createReadStream(path, { encoding: 'utf-8' })
    const reader = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })
    try {
      for await (const line of reader) {
        if (line.length === 0)
          continue
        const parsed = safeParseEvent(line)
        if (parsed)
          yield parsed
      }
    }
    finally {
      stream.destroy()
    }
  }

  async deleteRecords(workspace: Workspace, runIds: readonly SkillRunId[]): Promise<void> {
    if (runIds.length === 0)
      return
    const root = workspace.rootPath
    const indexPath = runIndexPath(root)
    const targets = new Set<string>(runIds)
    let raw: string
    try {
      raw = await readFile(indexPath, 'utf-8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return
      throw error
    }
    // Rewrite the index excluding every line that names a target run.
    // Last-wins reader semantics mean we must drop ALL occurrences,
    // not just the latest one.
    // An earlier entry left behind would,
    // otherwise resurrect the run when `listRecords()` next runs.
    const kept: string[] = []
    for (const line of raw.split('\n')) {
      if (line.length === 0)
        continue
      const parsed = safeParseRecord(line)
      if (parsed && targets.has(parsed.runId))
        continue
      kept.push(line)
    }
    const tmp = `${indexPath}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, kept.length === 0 ? '' : `${kept.join('\n')}\n`, 'utf-8')
    await rename(tmp, indexPath)
    // Per-runId event files get best-effort removal.
    // A missing file is fine, the run errored before any event landed.
    await Promise.all(runIds.map(id => rm(runEventsPath(root, id), { force: true })))
  }

  async saveSessionMetadata(workspace: Workspace, metadata: SessionMetadata): Promise<void> {
    const root = workspace.rootPath
    await mkdir(runsDir(root), { recursive: true })
    const line = `${JSON.stringify(metadata)}\n`
    await appendFile(runSessionsMetadataPath(root), line, 'utf-8')
  }

  async listSessionMetadata(workspace: Workspace): Promise<readonly SessionMetadata[]> {
    const root = workspace.rootPath
    let raw: string
    try {
      raw = await readFile(runSessionsMetadataPath(root), 'utf-8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return []
      throw error
    }
    // Last-write-wins per sessionId, matching the index semantics.
    const byId = new Map<string, SessionMetadata>()
    for (const line of raw.split('\n')) {
      if (line.length === 0)
        continue
      const parsed = safeParseSessionMetadata(line)
      if (parsed)
        byId.set(parsed.sessionId, parsed)
    }
    return Array.from(byId.values())
  }
}

function safeParseRecord(line: string): RunRecord | undefined {
  try {
    return RunRecordSchema.parse(JSON.parse(line))
  }
  catch {
    return undefined
  }
}

function safeParseEvent(line: string): SkillEvent | undefined {
  try {
    return SkillEventSchema.parse(JSON.parse(line))
  }
  catch {
    return undefined
  }
}

function safeParseSessionMetadata(line: string): SessionMetadata | undefined {
  try {
    return SessionMetadataSchema.parse(JSON.parse(line))
  }
  catch {
    return undefined
  }
}

// Re-exported so callers don't need to thread AbsolutePath types around.
export type { AbsolutePath }
