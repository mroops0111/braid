import type { Workspace } from '@braidhq/core'
import type { AbsolutePath, SourceId, SourceRole } from '@braidhq/schema'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listUnitItems } from '../../../src/infrastructure/source/unitScan.js'

const ROLES = ['primary'] as unknown as SourceRole[]

function makeWorkspace(rootPath: string, sourcePath: string): Workspace {
  return {
    id: 'ws-test',
    rootPath: rootPath as AbsolutePath,
    sources: [{
      kind: 'filesystem',
      id: 'issues' as SourceId,
      role: 'primary' as SourceRole,
      name: 'issues',
      path: sourcePath,
    }],
  } as unknown as Workspace
}

describe('listUnitItems', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'braid-unit-scan-'))
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it('expands a flat directory of markdown files into one unit per file (github loader layout)', async () => {
    const sourceRoot = join(workspaceRoot, 'primaries/issues')
    const issuesDir = join(sourceRoot, 'issues')
    await mkdir(issuesDir, { recursive: true })
    await writeFile(join(issuesDir, '27.md'), '# Issue 27\n')
    await writeFile(join(issuesDir, '29.md'), '# Issue 29\n')
    await writeFile(join(issuesDir, '31.md'), '# Issue 31\n')
    // Loader cursor file at the source root must not affect unit derivation.
    await writeFile(join(sourceRoot, '.braid-github-cursor.json'), '{}')

    const items = await listUnitItems(makeWorkspace(workspaceRoot, 'primaries/issues'), ROLES)

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

  // A mirrored unit is named by its upstream id,
  // so a picker of bare numbers says nothing about what any of them are.
  it('reads the title out of a document\'s frontmatter', async () => {
    const issuesDir = join(workspaceRoot, 'primaries/issues/issues')
    await mkdir(issuesDir, { recursive: true })
    await writeFile(join(issuesDir, '30.md'), '---\nid: "30"\ntitle: Add a Discord surface\n---\n\nBody.\n')
    await writeFile(join(issuesDir, '31.md'), '# No frontmatter here\n')

    const items = await listUnitItems(makeWorkspace(workspaceRoot, 'primaries/issues'), ROLES)

    expect(items.find(i => i.value === 'issues/30.md')?.title).toBe('Add a Discord surface')
    expect(items.find(i => i.value === 'issues/31.md')?.title).toBeUndefined()
  })

  it('survives a document whose frontmatter is broken', async () => {
    const issuesDir = join(workspaceRoot, 'primaries/issues/issues')
    await mkdir(issuesDir, { recursive: true })
    await writeFile(join(issuesDir, '32.md'), '---\ntitle: [unclosed\n---\n\nBody.\n')

    const items = await listUnitItems(makeWorkspace(workspaceRoot, 'primaries/issues'), ROLES)

    expect(items.map(i => i.value)).toEqual(['issues/32.md'])
    expect(items[0]?.title).toBeUndefined()
  })

  it('keeps a top-level directory with sub-structure as a single unit (the directory itself is the unit boundary)', async () => {
    const sourceRoot = join(workspaceRoot, 'primaries/prd')
    await mkdir(join(sourceRoot, 'checkout', 'flows'), { recursive: true })
    await writeFile(join(sourceRoot, 'checkout', 'flows', 'happy-path.md'), '# happy\n')
    await writeFile(join(sourceRoot, 'checkout', 'overview.md'), '# checkout overview\n')
    await mkdir(join(sourceRoot, 'billing', 'flows'), { recursive: true })
    await writeFile(join(sourceRoot, 'billing', 'flows', 'invoice.md'), '# invoice\n')

    const items = await listUnitItems(makeWorkspace(workspaceRoot, 'primaries/prd'), ROLES)

    expect(items.map(i => i.value).sort()).toEqual(['billing/', 'checkout/'])
  })

  it('still treats a directory of loose markdown files as flat (per-file expansion) at the root layer', async () => {
    const sourceRoot = join(workspaceRoot, 'primaries/notes')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(join(sourceRoot, 'q1-roadmap.md'), '# q1\n')
    await writeFile(join(sourceRoot, 'q2-roadmap.md'), '# q2\n')

    const items = await listUnitItems(makeWorkspace(workspaceRoot, 'primaries/notes'), ROLES)

    // Root-level loose markdowns already work pre-change; this test pins the behaviour so
    // the flat-directory expansion does not regress the simpler case.
    expect(items.map(i => i.value).sort()).toEqual(['q1-roadmap.md', 'q2-roadmap.md'])
  })

  it('skips a directory containing a non-markdown file even if it also has markdown (treats as one unit, not flat)', async () => {
    const sourceRoot = join(workspaceRoot, 'primaries/mixed')
    const inner = join(sourceRoot, 'mixed')
    await mkdir(inner, { recursive: true })
    await writeFile(join(inner, 'a.md'), '# a\n')
    await writeFile(join(inner, 'b.json'), '{}')

    const items = await listUnitItems(makeWorkspace(workspaceRoot, 'primaries/mixed'), ROLES)

    // Non-markdown sibling disqualifies flat-directory expansion; the dir
    // stays as a single unit (caller must decide whether to drill in).
    expect(items.map(i => i.value)).toEqual(['mixed/'])
  })

  it('skips sources whose role is not in the requested set', async () => {
    const sourceRoot = join(workspaceRoot, 'primaries/issues')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(join(sourceRoot, 'a.md'), '# a\n')

    const items = await listUnitItems(makeWorkspace(workspaceRoot, 'primaries/issues'), ['other'] as unknown as SourceRole[])
    expect(items).toEqual([])
  })

  it('returns nothing for an unreadable source root', async () => {
    const items = await listUnitItems(makeWorkspace(workspaceRoot, 'primaries/missing'), ROLES)
    expect(items).toEqual([])
  })
})
