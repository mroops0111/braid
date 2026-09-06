import type { SourceWebUrlInput } from '@braidhq/core'
import { readManifest } from './Manifest.js'

/**
 * The document on Drive, not the exported copy on disk.
 *
 * Line numbers describe the local export and mean nothing upstream, so only
 * an anchor survives, and Drive resolves a heading fragment on its own. The
 * file id lives in the mirror's manifest rather than in config, which is why
 * this reads local state instead of deriving the address from the folder.
 */
export async function driveWebUrl(input: SourceWebUrlInput): Promise<string | null> {
  const manifest = await readManifest(input.destination)
  if (!manifest)
    return null

  const unitDir = input.unitPath.replace(/^\/+/, '').split('/')[0]
  if (!unitDir)
    return null

  const entry = Object.entries(manifest.files).find(([, file]) => file.localDir === unitDir)
  const fileId = entry?.[0]
  if (!fileId)
    return null

  const anchor = input.location.anchor
  const fragment = anchor === undefined ? '' : `#heading=${encodeURIComponent(anchor)}`
  return `https://docs.google.com/document/d/${fileId}/edit${fragment}`
}
