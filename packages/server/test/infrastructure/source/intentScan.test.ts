import type { Workspace } from '@braidhq/core'
import type { AbsolutePath, SourceId } from '@braidhq/schema'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listIntentItems } from '../../../src/infrastructure/source/intentScan.js'

function makeWorkspace(rootPath: string, sourcePath: string): Workspace {
  return {
    id: 'ws-test',
    rootPath: rootPath as AbsolutePath,
    sources: [{
      kind: 'filesystem',
      id: 'issues' as SourceId,
      role: 'intent',
      name: 'issues',
      path: sourcePath,
    }],
  } as unknown as Workspace
}

describe('listIntentItems', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'braid-intent-scan-'))
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it('expands a flat directory of markdown files into one unit per file (github loader layout)', async () => {
    const sourceRoot = join(workspaceRoot, 'intents/issues')
    const issuesDir = join(sourceRoot, 'issues')
    await mkdir(issuesDir, { recursive: true })
    await writeFile(join(issuesDir, '27.md'), '# Issue 27\n')
    await writeFile(join(issuesDir, '29.md'), '# Issue 29\n')
    await writeFile(join(issuesDir, '31.md'), '# Issue 31\n')
    // Loader cursor file at the source root must not affect unit derivation.
    await writeFile(join(sourceRoot, '.braid-github-cursor.json'), '{}')

    const items = await listIntentItems(makeWorkspace(workspaceRoot, 'intents/issues'))

    expect(items.map(i => i.value).sort()).toEqual([
      'issues/27.md',
      'issues/29.md',
      'issues/31.md',
    ])
    expect(items.map(i => i.label).sort()).toEqual([
      'issues/27',
      'issues/29',
      'issues/31',
    ])
  })

  it('keeps a top-level directory with sub-structure as a single unit (the directory itself is the unit boundary)', async () => {
    const sourceRoot = join(workspaceRoot, 'intents/prd')
    await mkdir(join(sourceRoot, 'checkout', 'flows'), { recursive: true })
    await writeFile(join(sourceRoot, 'checkout', 'flows', 'happy-path.md'), '# happy\n')
    await writeFile(join(sourceRoot, 'checkout', 'overview.md'), '# checkout overview\n')
    await mkdir(join(sourceRoot, 'billing', 'flows'), { recursive: true })
    await writeFile(join(sourceRoot, 'billing', 'flows', 'invoice.md'), '# invoice\n')

    const items = await listIntentItems(makeWorkspace(workspaceRoot, 'intents/prd'))

    expect(items.map(i => i.value).sort()).toEqual(['billing/', 'checkout/'])
  })

  it('still treats a directory of loose markdown files as flat (per-file expansion) at the root layer', async () => {
    const sourceRoot = join(workspaceRoot, 'intents/notes')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(join(sourceRoot, 'q1-roadmap.md'), '# q1\n')
    await writeFile(join(sourceRoot, 'q2-roadmap.md'), '# q2\n')

    const items = await listIntentItems(makeWorkspace(workspaceRoot, 'intents/notes'))

    // Root-level loose markdowns already work pre-change; this test pins the behaviour so
    // the flat-directory expansion does not regress the simpler case.
    expect(items.map(i => i.value).sort()).toEqual(['q1-roadmap.md', 'q2-roadmap.md'])
  })

  it('skips a directory containing a non-markdown file even if it also has markdown (treats as one unit, not flat)', async () => {
    const sourceRoot = join(workspaceRoot, 'intents/mixed')
    const inner = join(sourceRoot, 'mixed')
    await mkdir(inner, { recursive: true })
    await writeFile(join(inner, 'a.md'), '# a\n')
    await writeFile(join(inner, 'b.json'), '{}')

    const items = await listIntentItems(makeWorkspace(workspaceRoot, 'intents/mixed'))

    // Non-markdown sibling disqualifies flat-directory expansion; the dir
    // stays as a single unit (caller must decide whether to drill in).
    expect(items.map(i => i.value)).toEqual(['mixed/'])
  })

  it('returns nothing for an unreadable source root', async () => {
    const items = await listIntentItems(makeWorkspace(workspaceRoot, 'intents/missing'))
    expect(items).toEqual([])
  })
})
