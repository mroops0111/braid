import type { RunRepository, Workspace } from '@braidhq/core'
import type { AbsolutePath, RunRecord, SkillEvent, SkillRunId } from '@braidhq/schema'
import { createReadStream } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { RunRecord as RunRecordSchema, SkillEvent as SkillEventSchema } from '@braidhq/schema'
import { runEventsPath, runIndexPath, runsDir } from './paths.js'

/**
 * File-system adapter for skill-run recording.
 *
 *   <workspaceRoot>/artifacts/runs/
 *     ├── index.jsonl                (append-only summary, last-wins per runId)
 *     └── <runId>.jsonl              (full SkillEvent stream for one run)
 *
 * Index is append-only because every concurrent write of a single workspace
 * goes through one server process today; if that changes we'd swap to
 * `mv tmp final` atomic rewrites or hand it to sqlite.
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

// Re-exported so callers don't need to thread AbsolutePath types around.
export type { AbsolutePath }
