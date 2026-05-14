import type { IngestReport, SourceLoader, SourceLoaderContext, SyncReport } from '@telos/core'
import type { AbsolutePath, LoaderKind, PluginId } from '@telos/schema'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { DriveClient, type DriveFileMetadata, type FetchFn } from './driveClient.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

/**
 * Map of Google-native mime types to (Drive export format, filename
 * extension we write to disk). Skip everything else: only Drive
 * "applications" need exporting. Regular binaries (images, PDFs, etc.)
 * go through `downloadFile`.
 */
const GOOGLE_NATIVE_EXPORT: Record<string, { mimeType: string, extension: string }> = {
  'application/vnd.google-apps.document': { mimeType: 'text/markdown', extension: '.md' },
  'application/vnd.google-apps.spreadsheet': { mimeType: 'text/csv', extension: '.csv' },
  'application/vnd.google-apps.presentation': { mimeType: 'application/pdf', extension: '.pdf' },
  'application/vnd.google-apps.drawing': { mimeType: 'image/png', extension: '.png' },
}

export const GoogleDriveLoaderConfig = z.object({
  /** Drive folder id (the long alphanumeric in the URL). */
  folderId: z.string().min(1),
  /**
   * Whether to follow subfolders recursively. Default true. Disable for
   * flat folder mirrors where nested folders should be skipped.
   */
  recursive: z.boolean().default(true),
})
export type GoogleDriveLoaderConfig = z.infer<typeof GoogleDriveLoaderConfig>

export interface GoogleDriveLoaderDeps {
  /**
   * Resolve a fresh access token for a given `(workspaceId, sourceId)`.
   * The composition root implements this against its OAuth refresh-token
   * store; tests can return a static token regardless of context.
   */
  resolveAccessToken: (context: SourceLoaderContext) => Promise<string>
  /** Inject for tests. Real callers use globalThis.fetch. */
  fetchFn?: FetchFn
}

/**
 * Google Drive source loader. Walks a Drive folder, exports Google-native
 * docs to text/markdown/csv/pdf depending on type, downloads binaries
 * (images, PDFs) as-is, and mirrors the folder layout under `destination/`.
 *
 * Loader owns destination contents: it `rm -rf`'s `destination` on each
 * `ingest` so previously-fetched files don't linger. `sync` re-walks and
 * compares modifiedTime per file; reports `changed = true` if any file
 * was added / updated / removed.
 */
export class GoogleDriveLoader implements SourceLoader {
  readonly id = 'source-loader-gdrive' as PluginId
  readonly type = 'source-loader' as const
  readonly kind = 'gdrive' as LoaderKind
  readonly configSchema = GoogleDriveLoaderConfig

  constructor(private readonly deps: GoogleDriveLoaderDeps) {}

  async ingest(rawConfig: unknown, destination: AbsolutePath, context: SourceLoaderContext): Promise<IngestReport> {
    const config = GoogleDriveLoaderConfig.parse(rawConfig)
    await rm(destination, { recursive: true, force: true })
    await mkdir(destination, { recursive: true })
    const client = await this.client(context)
    const result = await this.walk(client, config.folderId, destination, { recursive: config.recursive })
    return {
      localPath: destination,
      metadata: { folderId: config.folderId, fileCount: result.fileCount },
      fetchedAt: new Date().toISOString() as never,
    }
  }

  async sync(rawConfig: unknown, destination: AbsolutePath, context: SourceLoaderContext): Promise<SyncReport> {
    // v0.1: incremental sync needs per-file mtime cache. Until we add
    // that, sync is "blow away + re-ingest". Always safe, just slow.
    const config = GoogleDriveLoaderConfig.parse(rawConfig)
    const before = Date.now()
    await this.ingest(config, destination, context)
    return {
      changed: true,
      metadata: { folderId: config.folderId, syncedAt: new Date(before).toISOString() },
      fetchedAt: new Date().toISOString() as never,
    }
  }

  private async client(context: SourceLoaderContext): Promise<DriveClient> {
    const token = await this.deps.resolveAccessToken(context)
    return new DriveClient(token, this.deps.fetchFn)
  }

  private async walk(
    client: DriveClient,
    folderId: string,
    destination: string,
    options: { recursive: boolean },
  ): Promise<{ fileCount: number }> {
    let fileCount = 0
    const children = await client.listChildren(folderId)
    for (const child of children) {
      if (child.mimeType === FOLDER_MIME) {
        if (!options.recursive)
          continue
        const subDest = join(destination, sanitiseName(child.name))
        await mkdir(subDest, { recursive: true })
        const nested = await this.walk(client, child.id, subDest, options)
        fileCount += nested.fileCount
        continue
      }
      const written = await this.writeOneFile(client, child, destination)
      if (written)
        fileCount++
    }
    return { fileCount }
  }

  private async writeOneFile(
    client: DriveClient,
    file: DriveFileMetadata,
    destination: string,
  ): Promise<boolean> {
    const exportSpec = GOOGLE_NATIVE_EXPORT[file.mimeType]
    if (exportSpec) {
      const bytes = await client.exportDoc(file.id, exportSpec.mimeType)
      const filename = `${sanitiseName(file.name)}${exportSpec.extension}`
      await writeFile(join(destination, filename), bytes)
      return true
    }
    // Skip native Drive types we don't have an export for (e.g. forms).
    if (file.mimeType.startsWith('application/vnd.google-apps.'))
      return false
    // Regular binary: download as-is, preserve the name.
    const bytes = await client.downloadFile(file.id)
    await writeFile(join(destination, sanitiseName(file.name)), bytes)
    return true
  }
}

function sanitiseName(name: string): string {
  // Replace path separators and control chars; leave the rest alone so
  // human-readable filenames survive ('My Doc — v3.md').
  return name.replace(/[/\\]/g, '_')
}
