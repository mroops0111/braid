import type { SourceLoaderContext } from '@braidhq/core'
import type { AbsolutePath, SourceId, WorkspaceId } from '@braidhq/schema'
import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGoogleDriveLoader } from '../src/GoogleDriveSourceLoaderPlugin.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DOC_MIME = 'application/vnd.google-apps.document'
const CONTEXT: SourceLoaderContext = {
  workspaceId: 'test-ws' as WorkspaceId,
  sourceId: 'test-source' as SourceId,
}

interface MockFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  parents?: string[]
  /** For Google Docs, the text/markdown export body. */
  markdown?: string
}

function buildMockFetch(files: readonly MockFile[]): typeof globalThis.fetch {
  const byId = new Map(files.map(f => [f.id, f]))
  return async (input, _init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const parsed = new URL(url)
    if (parsed.pathname === '/drive/v3/files') {
      const q = parsed.searchParams.get('q') ?? ''
      const match = q.match(/^'([^']+)' in parents and trashed=false$/)
      const parentId = match?.[1]
      const children = files.filter(f => f.parents?.includes(parentId ?? ''))
      return jsonResponse({ files: children })
    }
    const exportMatch = parsed.pathname.match(/^\/drive\/v3\/files\/([^/]+)\/export$/)
    if (exportMatch) {
      const file = byId.get(exportMatch[1]!)
      if (!file)
        return new Response('not found', { status: 404 })
      return new Response(file.markdown ?? '', { status: 200, headers: { 'Content-Type': 'text/markdown' } })
    }
    return new Response('no route', { status: 404 })
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function readdirNoManifest(path: string): Promise<string[]> {
  const entries = await readdir(path)
  return entries.filter(name => name !== '.braid-gdrive-manifest.json')
}

interface PersistedManifest {
  folderId: string
  include: string | null | undefined
  exclude: string | null | undefined
  files: Record<string, { localDir: string, modifiedTime: string, title: string }>
}

async function readManifestFile(path: string): Promise<PersistedManifest> {
  return JSON.parse(await readFile(join(path, '.braid-gdrive-manifest.json'), 'utf-8')) as PersistedManifest
}

/** Tiny 1x1 transparent PNG, base64-encoded. Mirrors what Drive embeds. */
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='

describe('GoogleDriveLoader', () => {
  let dest: AbsolutePath

  beforeEach(async () => {
    dest = await mkdtemp(join(tmpdir(), 'braid-gdrive-loader-')) as AbsolutePath
  })

  afterEach(async () => {
    await rm(dest, { recursive: true, force: true })
  })

  it('provision lays each Google Doc out as <title>/index.md (flat per-doc, ignores subfolder hierarchy)', async () => {
    const fetchFn = buildMockFetch([
      { id: 'doc-1', name: 'Roadmap', mimeType: DOC_MIME, modifiedTime: '2026-05-01T00:00:00Z', parents: ['demo'], markdown: '# Roadmap\n\nh1 body' },
      { id: 'subfolder-1', name: 'subdir', mimeType: FOLDER_MIME, modifiedTime: 't', parents: ['demo'] },
      { id: 'doc-2', name: 'Notes', mimeType: DOC_MIME, modifiedTime: 't', parents: ['subfolder-1'], markdown: '# Notes\n' },
    ])

    const loader = createGoogleDriveLoader({ resolveAccessToken: async () => 'fake', fetchFn })
    const report = await loader.provision({ folderId: 'demo' }, dest, CONTEXT)
    expect(report.localPath).toBe(dest)
    expect((report.metadata as { fileCount?: number }).fileCount).toBe(2)

    // Both docs live as siblings under destination, no `subdir/` mirror.
    const top = (await readdirNoManifest(dest)).sort()
    expect(top).toEqual(['Notes', 'Roadmap'])

    expect(await readFile(join(dest, 'Roadmap', 'index.md'), 'utf-8')).toBe('# Roadmap\n\nh1 body')
    expect(await readFile(join(dest, 'Notes', 'index.md'), 'utf-8')).toBe('# Notes\n')
  })

  it('extracts inline base64 images into sibling files and rewrites the markdown link', async () => {
    const markdown = `# Roadmap\n\nSee ![architecture][arch]\n\n[arch]: <data:image/png;base64,${TINY_PNG_BASE64}>\n`
    const fetchFn = buildMockFetch([
      { id: 'doc-1', name: 'Roadmap', mimeType: DOC_MIME, modifiedTime: 't', parents: ['demo'], markdown },
    ])

    const loader = createGoogleDriveLoader({ resolveAccessToken: async () => 'fake', fetchFn })
    await loader.provision({ folderId: 'demo' }, dest, CONTEXT)

    const docFiles = (await readdir(join(dest, 'Roadmap'))).sort()
    expect(docFiles).toEqual(['arch.png', 'index.md'])

    // Image file is the decoded bytes, not the base64 string.
    const imgBytes = await readFile(join(dest, 'Roadmap', 'arch.png'))
    expect(imgBytes.equals(Buffer.from(TINY_PNG_BASE64, 'base64'))).toBe(true)

    // Markdown reference now points at the local file, not the data URI.
    const rewritten = await readFile(join(dest, 'Roadmap', 'index.md'), 'utf-8')
    expect(rewritten).toContain('[arch]: <arch.png>')
    expect(rewritten).not.toContain('base64,')
  })

  it('skips non-Doc Drive items (sheets, slides, drawings, binaries, forms)', async () => {
    const fetchFn = buildMockFetch([
      { id: 'doc-1', name: 'Keep', mimeType: DOC_MIME, modifiedTime: 't', parents: ['demo'], markdown: 'k' },
      { id: 'sheet-1', name: 'Sheet', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: 't', parents: ['demo'] },
      { id: 'slide-1', name: 'Slide', mimeType: 'application/vnd.google-apps.presentation', modifiedTime: 't', parents: ['demo'] },
      { id: 'drawing-1', name: 'Drawing', mimeType: 'application/vnd.google-apps.drawing', modifiedTime: 't', parents: ['demo'] },
      { id: 'form-1', name: 'Form', mimeType: 'application/vnd.google-apps.form', modifiedTime: 't', parents: ['demo'] },
      { id: 'binary-1', name: 'standalone.png', mimeType: 'image/png', modifiedTime: 't', parents: ['demo'] },
    ])
    const loader = createGoogleDriveLoader({ resolveAccessToken: async () => 'fake', fetchFn })
    await loader.provision({ folderId: 'demo' }, dest, CONTEXT)
    expect(await readdirNoManifest(dest)).toEqual(['Keep'])
  })

  it('silently skips "Copy of" and "的副本" duplicate docs', async () => {
    const fetchFn = buildMockFetch([
      { id: 'doc-1', name: 'Original', mimeType: DOC_MIME, modifiedTime: 't', parents: ['demo'], markdown: 'o' },
      { id: 'doc-2', name: 'Copy of Original', mimeType: DOC_MIME, modifiedTime: 't', parents: ['demo'], markdown: 'c' },
      { id: 'doc-3', name: 'Original的副本', mimeType: DOC_MIME, modifiedTime: 't', parents: ['demo'], markdown: 'c2' },
    ])
    const loader = createGoogleDriveLoader({ resolveAccessToken: async () => 'fake', fetchFn })
    await loader.provision({ folderId: 'demo' }, dest, CONTEXT)
    expect(await readdirNoManifest(dest)).toEqual(['Original'])
  })

  it('rejects folderId "root" so we never mirror the entire My Drive by accident', async () => {
    const loader = createGoogleDriveLoader({
      resolveAccessToken: async () => 'fake',
      fetchFn: buildMockFetch([]),
    })
    await expect(loader.provision({ folderId: 'root' }, dest, CONTEXT)).rejects.toThrow(/root/i)
  })

  it('recursive=false ignores subfolders', async () => {
    const fetchFn = buildMockFetch([
      { id: 'doc-1', name: 'A', mimeType: DOC_MIME, modifiedTime: 't', parents: ['demo'], markdown: 'a' },
      { id: 'sub', name: 'sub', mimeType: FOLDER_MIME, modifiedTime: 't', parents: ['demo'] },
      { id: 'doc-2', name: 'B', mimeType: DOC_MIME, modifiedTime: 't', parents: ['sub'], markdown: 'b' },
    ])
    const loader = createGoogleDriveLoader({ resolveAccessToken: async () => 'fake', fetchFn })
    await loader.provision({ folderId: 'demo', recursive: false }, dest, CONTEXT)
    expect(await readdirNoManifest(dest)).toEqual(['A'])
  })

  it('filters by include regex matched against the Drive title', async () => {
    const fetchFn = buildMockFetch([
      { id: 'a', name: 'PRD-Auth', mimeType: DOC_MIME, modifiedTime: 't', parents: ['demo'], markdown: 'a' },
      { id: 'b', name: 'Random', mimeType: DOC_MIME, modifiedTime: 't', parents: ['demo'], markdown: 'b' },
    ])
    const loader = createGoogleDriveLoader({ resolveAccessToken: async () => 'fake', fetchFn })
    await loader.provision({ folderId: 'demo', include: '^PRD-' }, dest, CONTEXT)
    expect(await readdirNoManifest(dest)).toEqual(['PRD-Auth'])
  })

  it('excludes match takes priority over include', async () => {
    const fetchFn = buildMockFetch([
      { id: 'a', name: 'PRD-Keep', mimeType: DOC_MIME, modifiedTime: 't', parents: ['demo'], markdown: 'a' },
      { id: 'b', name: 'PRD-Drop', mimeType: DOC_MIME, modifiedTime: 't', parents: ['demo'], markdown: 'b' },
    ])
    const loader = createGoogleDriveLoader({ resolveAccessToken: async () => 'fake', fetchFn })
    await loader.provision({ folderId: 'demo', include: '^PRD-', exclude: 'Drop' }, dest, CONTEXT)
    expect(await readdirNoManifest(dest)).toEqual(['PRD-Keep'])
  })

  it('rejects an invalid regex with a clear error', async () => {
    const loader = createGoogleDriveLoader({ resolveAccessToken: async () => 'fake', fetchFn: buildMockFetch([]) })
    await expect(loader.provision({ folderId: 'demo', include: '(' }, dest, CONTEXT))
      .rejects
      .toThrow(/include is not a valid regex/)
  })

  it('writes a manifest after provision with one entry per downloaded doc', async () => {
    const fetchFn = buildMockFetch([
      { id: 'doc-1', name: 'A', mimeType: DOC_MIME, modifiedTime: '2026-05-01T00:00:00Z', parents: ['demo'], markdown: 'a' },
      { id: 'doc-2', name: 'B', mimeType: DOC_MIME, modifiedTime: '2026-05-02T00:00:00Z', parents: ['demo'], markdown: 'b' },
    ])
    const loader = createGoogleDriveLoader({ resolveAccessToken: async () => 'fake', fetchFn })
    await loader.provision({ folderId: 'demo' }, dest, CONTEXT)
    const manifest = await readManifestFile(dest)
    expect(manifest.folderId).toBe('demo')
    expect(Object.keys(manifest.files).sort()).toEqual(['doc-1', 'doc-2'])
    expect(manifest.files['doc-1']).toEqual({ localDir: 'A', modifiedTime: '2026-05-01T00:00:00Z', title: 'A' })
  })

  it('sync detects added / updated / removed via modifiedTime + manifest diff', async () => {
    const stateA = [
      { id: 'a', name: 'A', mimeType: DOC_MIME, modifiedTime: '2026-05-01T00:00:00Z', parents: ['demo'], markdown: 'a-v1' },
      { id: 'b', name: 'B', mimeType: DOC_MIME, modifiedTime: '2026-05-01T00:00:00Z', parents: ['demo'], markdown: 'b-v1' },
      { id: 'c', name: 'C', mimeType: DOC_MIME, modifiedTime: '2026-05-01T00:00:00Z', parents: ['demo'], markdown: 'c-v1' },
    ]
    const stateB = [
      stateA[0]!,
      { ...stateA[1]!, modifiedTime: '2026-05-10T00:00:00Z', markdown: 'b-v2' },
      { id: 'd', name: 'D', mimeType: DOC_MIME, modifiedTime: '2026-05-10T00:00:00Z', parents: ['demo'], markdown: 'd-v1' },
    ]

    let active = stateA
    const dynamicFetch: typeof globalThis.fetch = async (input, init) => buildMockFetch(active)(input, init)
    const loader = createGoogleDriveLoader({ resolveAccessToken: async () => 'fake', fetchFn: dynamicFetch })

    await loader.provision({ folderId: 'demo' }, dest, CONTEXT)
    expect((await readdirNoManifest(dest)).sort()).toEqual(['A', 'B', 'C'])
    expect(await readFile(join(dest, 'B', 'index.md'), 'utf-8')).toBe('b-v1')

    active = stateB
    const report = await loader.sync!({ folderId: 'demo' }, dest, CONTEXT)
    expect(report.changed).toBe(true)
    expect(report).toMatchObject({ added: 1, updated: 1, removed: 1, unchanged: 1 })
    expect((await readdirNoManifest(dest)).sort()).toEqual(['A', 'B', 'D'])
    expect(await readFile(join(dest, 'B', 'index.md'), 'utf-8')).toBe('b-v2')
  })

  it('sync without a prior manifest falls back to a clean provision', async () => {
    const fetchFn = buildMockFetch([
      { id: 'a', name: 'A', mimeType: DOC_MIME, modifiedTime: 't', parents: ['demo'], markdown: 'a' },
    ])
    const loader = createGoogleDriveLoader({ resolveAccessToken: async () => 'fake', fetchFn })
    const report = await loader.sync!({ folderId: 'demo' }, dest, CONTEXT)
    expect(report.changed).toBe(true)
    expect(await readdirNoManifest(dest)).toEqual(['A'])
  })

  it('sync handles a Drive-side rename: removes the old per-doc dir and writes the new one', async () => {
    const before = [
      { id: 'a', name: 'Original', mimeType: DOC_MIME, modifiedTime: '2026-05-01T00:00:00Z', parents: ['demo'], markdown: 'x' },
    ]
    const after = [
      { ...before[0]!, name: 'Renamed', modifiedTime: '2026-05-10T00:00:00Z' },
    ]
    let active = before
    const dynamicFetch: typeof globalThis.fetch = async (input, init) => buildMockFetch(active)(input, init)
    const loader = createGoogleDriveLoader({ resolveAccessToken: async () => 'fake', fetchFn: dynamicFetch })

    await loader.provision({ folderId: 'demo' }, dest, CONTEXT)
    expect(await readdirNoManifest(dest)).toEqual(['Original'])

    active = after
    const report = await loader.sync!({ folderId: 'demo' }, dest, CONTEXT)
    expect(report).toMatchObject({ updated: 1, unchanged: 0, added: 0, removed: 0 })
    expect(await readdirNoManifest(dest)).toEqual(['Renamed'])
  })
})
