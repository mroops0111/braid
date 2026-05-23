import type { IngestReport, SourceLoaderContext, SourceLoaderPlugin, SyncReport } from '@braidhq/core'
import type { AbsolutePath, LoaderKind, PluginId } from '@braidhq/schema'
import { Buffer } from 'node:buffer'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { DriveClient, type DriveFileMetadata, type FetchFn } from './driveClient.js'
import { type Manifest, type ManifestEntry, readManifest, writeManifest } from './Manifest.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DOC_MIME = 'application/vnd.google-apps.document'

/**
 * Drive auto-creates duplicates named "Copy of …" (English) or "…的副本"
 * (Chinese) when users use the Make a Copy menu. They almost always carry
 * stale content that would conflict with the canonical doc, so we skip
 * them silently. Same rule as redoc.
 */
const COPY_PATTERNS = [/^Copy of /, /的副本$/]

/**
 * Drive's `text/markdown` export inlines images as base64 data URIs in
 * reference-style link form:
 *
 *   [image0]: <data:image/png;base64,iVBORw0KG…>
 *
 * Leaving those base64 blobs in the markdown bloats the file by ~33 % per
 * image and is unreadable for both humans and LLMs. This regex matches one
 * such reference line so we can extract the image to its own file and
 * rewrite the link to a relative path. Same approach as redoc.
 */
const INLINE_IMAGE_RE = /^\[([^\]]+)\]:\s*<data:image\/([\w+]+);base64,([^>]+)>$/gm

export const GoogleDriveLoaderConfig = z.object({
  /**
   * Drive folder id (the long alphanumeric in the URL). Reject the alias
   * `root` outright: it expands to the user's entire My Drive and would
   * mirror every file they own, which is almost never what someone wants
   * from an "intent docs" source and easily costs gigabytes + minutes.
   * Make people pick a specific subfolder.
   */
  folderId: z.string()
    .min(1)
    .refine(value => value !== 'root', {
      message: 'folderId "root" refers to the entire My Drive and is rejected. Create a dedicated subfolder and use its id instead.',
    }),
  /**
   * Whether to traverse subfolders. Default true. Subfolder hierarchy
   * is NOT preserved on disk; every matching doc lives in its own dir
   * directly under `destination/`. Disable to limit to immediate
   * children of `folderId`.
   */
  recursive: z.boolean().default(true),
  /**
   * Optional regex (string). When set, only docs whose *Drive title*
   * matches this pattern are downloaded. Subfolders are still traversed.
   */
  include: z.string().optional(),
  /**
   * Optional regex (string). When set, docs whose title matches are
   * skipped. Evaluated after `include`, so exclude takes priority.
   */
  exclude: z.string().optional(),
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

/** Walked + filtered Drive doc, ready to download. */
interface CandidateDoc {
  /** Drive file id. */
  id: string
  /** Drive title, untouched. */
  title: string
  modifiedTime: string
  /** Sanitised directory name where the doc + its images will land. */
  localDir: string
}

/**
 * Google Drive source loader. Walks a Drive folder, exports every
 * Google Doc inside as markdown, extracts inlined base64 images into
 * sibling files, and lays everything out as:
 *
 *   <destination>/
 *     <sanitised-doc-title>/
 *       index.md
 *       <image-label>.png       (one per inlined image)
 *     <sanitised-doc-title-2>/
 *       index.md
 *     .braid-manifest.json      (sync state)
 *
 * Drive folder hierarchy is NOT preserved on disk; every matched doc
 * is flattened into a sibling directory under `destination/`. Two docs
 * with the same sanitised title will collide; rename one in Drive to
 * disambiguate.
 *
 * Out of scope (intentional): Google Sheets, Slides, Drawings, Forms,
 * and standalone binaries. Mirrors redoc's PRD-focused workflow. If you
 * need spreadsheets / slide decks, ingest them through a different
 * source-loader plugin.
 */
export class GoogleDriveLoader implements SourceLoaderPlugin {
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
    const candidates = await this.walk(client, config)
    const manifest: Manifest = {
      folderId: config.folderId,
      include: config.include,
      exclude: config.exclude,
      files: {},
    }
    for (const doc of candidates) {
      await this.downloadOne(client, doc, destination)
      manifest.files[doc.id] = entryOf(doc)
    }
    await writeManifest(destination, manifest)
    return {
      localPath: destination,
      metadata: { folderId: config.folderId, fileCount: candidates.length },
      fetchedAt: new Date().toISOString() as never,
    }
  }

  async sync(rawConfig: unknown, destination: AbsolutePath, context: SourceLoaderContext): Promise<SyncReport> {
    const config = GoogleDriveLoaderConfig.parse(rawConfig)
    const cached = await readManifest(destination)
    if (!cached) {
      // No manifest yet (first sync after upgrade / cache wiped). Fall
      // back to a clean ingest so we end up in a known-good state.
      const report = await this.ingest(config, destination, context)
      return {
        changed: true,
        added: report.metadata && typeof report.metadata.fileCount === 'number' ? report.metadata.fileCount : 0,
        updated: 0,
        removed: 0,
        unchanged: 0,
        ...(report.metadata ? { metadata: report.metadata } : {}),
        fetchedAt: report.fetchedAt,
      }
    }

    const client = await this.client(context)
    const candidates = await this.walk(client, config)
    const seen = new Set<string>()
    let added = 0
    let updated = 0
    let unchanged = 0
    const next: Manifest = {
      folderId: config.folderId,
      include: config.include,
      exclude: config.exclude,
      files: {},
    }

    for (const doc of candidates) {
      seen.add(doc.id)
      const prior = cached.files[doc.id]
      if (!prior) {
        await this.downloadOne(client, doc, destination)
        added++
      }
      else if (prior.localDir !== doc.localDir || prior.modifiedTime !== doc.modifiedTime) {
        // Either content updated or the doc was renamed in Drive. Both
        // cases: re-download to the new dir, then rm the old dir.
        if (prior.localDir !== doc.localDir)
          await rm(join(destination, prior.localDir), { recursive: true, force: true })
        await this.downloadOne(client, doc, destination)
        updated++
      }
      else {
        unchanged++
      }
      next.files[doc.id] = entryOf(doc)
    }

    let removed = 0
    for (const [id, entry] of Object.entries(cached.files)) {
      if (seen.has(id))
        continue
      await rm(join(destination, entry.localDir), { recursive: true, force: true })
      removed++
    }

    await writeManifest(destination, next)

    return {
      changed: added + updated + removed > 0,
      added,
      updated,
      removed,
      unchanged,
      metadata: { folderId: config.folderId },
      fetchedAt: new Date().toISOString() as never,
    }
  }

  private async client(context: SourceLoaderContext): Promise<DriveClient> {
    const token = await this.deps.resolveAccessToken(context)
    return new DriveClient(token, this.deps.fetchFn)
  }

  private async walk(
    client: DriveClient,
    config: GoogleDriveLoaderConfig,
  ): Promise<readonly CandidateDoc[]> {
    const includeRe = compileRegex(config.include, 'include')
    const excludeRe = compileRegex(config.exclude, 'exclude')
    const out: CandidateDoc[] = []
    const seenDirs = new Map<string, string>() // localDir -> first doc id, to detect collisions
    const visit = async (folderId: string): Promise<void> => {
      const children = await client.listChildren(folderId)
      for (const child of children) {
        if (child.mimeType === FOLDER_MIME) {
          if (config.recursive)
            await visit(child.id)
          continue
        }
        if (child.mimeType !== DOC_MIME)
          continue
        if (COPY_PATTERNS.some(re => re.test(child.name)))
          continue
        if (includeRe && !includeRe.test(child.name))
          continue
        if (excludeRe && excludeRe.test(child.name))
          continue
        const localDir = sanitiseName(child.name)
        const collides = seenDirs.get(localDir)
        if (collides && collides !== child.id) {
          // Two distinct Drive docs sanitise to the same dir name. Keep
          // the first one we walked into; skipping the second is safer
          // than silently overwriting. User can rename in Drive.
          continue
        }
        seenDirs.set(localDir, child.id)
        out.push({
          id: child.id,
          title: child.name,
          modifiedTime: child.modifiedTime,
          localDir,
        })
      }
    }
    await visit(config.folderId)
    return out
  }

  private async downloadOne(
    client: DriveClient,
    doc: CandidateDoc,
    destination: string,
  ): Promise<void> {
    const docDir = join(destination, doc.localDir)
    // Clean any prior content for this doc so removed images don't linger.
    await rm(docDir, { recursive: true, force: true })
    await mkdir(docDir, { recursive: true })
    const bytes = await client.exportDoc(doc.id, 'text/markdown')
    const markdown = bytes.toString('utf-8')
    const rewritten = await extractInlineImages(markdown, docDir)
    await writeFile(join(docDir, 'index.md'), rewritten, 'utf-8')
  }
}

/**
 * Pull every `[label]: <data:image/ext;base64,...>` reference out of the
 * markdown, write the decoded bytes as `<label>.<ext>` in `docDir`, and
 * rewrite the reference to point at the new local file. Returns the
 * cleaned markdown. Matches redoc's behaviour.
 */
async function extractInlineImages(markdown: string, docDir: string): Promise<string> {
  const writes: Promise<void>[] = []
  const rewritten = markdown.replace(INLINE_IMAGE_RE, (_match, label: string, ext: string, data: string) => {
    const filename = `${sanitiseName(label)}.${ext}`
    writes.push(writeFile(join(docDir, filename), Buffer.from(data, 'base64')))
    return `[${label}]: <${filename}>`
  })
  await Promise.all(writes)
  return rewritten
}

function compileRegex(pattern: string | undefined, field: 'include' | 'exclude'): RegExp | undefined {
  if (!pattern)
    return undefined
  try {
    return new RegExp(pattern)
  }
  catch (err) {
    throw new Error(`GoogleDriveLoader: ${field} is not a valid regex (${(err as Error).message})`)
  }
}

function entryOf(doc: CandidateDoc): ManifestEntry {
  return {
    localDir: doc.localDir,
    modifiedTime: doc.modifiedTime,
    title: doc.title,
  }
}

function sanitiseName(name: string): string {
  // Replace path separators, control chars, and common shell-hostile
  // characters with `_`. Spaces stay so human-readable titles survive
  // ("Roadmap Q3 2026" → "Roadmap Q3 2026").
  return name.replace(/[/\\:*?"<>|]/g, '_')
}

/** Note: the helper used by DriveClient.exportDoc returns Buffer. */
export type { DriveFileMetadata, FetchFn }
