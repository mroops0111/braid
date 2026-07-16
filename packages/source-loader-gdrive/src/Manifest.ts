import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Filename written inside `destination` to track per-file sync state. */
export const MANIFEST_FILENAME = '.braid-manifest.json'

export interface ManifestEntry {
  /** Posix relative dir under `destination`: the per-doc package. */
  localDir: string
  modifiedTime: string
  /** Drive title at the time of the last sync, for debugging only. */
  title: string
}

export interface Manifest {
  folderId: string
  include: string | undefined
  exclude: string | undefined
  files: Record<string, ManifestEntry>
}

/**
 * Read the manifest file from `destination`. Returns `undefined` if the
 * file is missing or unparseable; callers should fall back to a clean
 * provision in that case (no manifest = no incremental state to diff against).
 */
export async function readManifest(destination: string): Promise<Manifest | undefined> {
  try {
    const raw = await readFile(join(destination, MANIFEST_FILENAME), 'utf-8')
    return JSON.parse(raw) as Manifest
  }
  catch {
    return undefined
  }
}

export async function writeManifest(destination: string, manifest: Manifest): Promise<void> {
  await writeFile(
    join(destination, MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf-8',
  )
}
