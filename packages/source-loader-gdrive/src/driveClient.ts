import { Buffer } from 'node:buffer'

function globalBuffer(): typeof Buffer {
  return Buffer
}

/**
 * Tiny Google Drive v3 client wrapper. We only use a few endpoints and
 * don't need the full `googleapis` package (which ships > 1 MB of types).
 *
 * Inject `fetchFn` for tests; real callers use globalThis.fetch.
 */
export type FetchFn = typeof globalThis.fetch

export interface DriveFileMetadata {
  readonly id: string
  readonly name: string
  readonly mimeType: string
  readonly modifiedTime: string
  readonly parents?: readonly string[]
}

export class DriveClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetchFn: FetchFn = globalThis.fetch,
  ) {}

  /** List immediate children of a folder. Paginated. */
  async listChildren(folderId: string): Promise<readonly DriveFileMetadata[]> {
    const items: DriveFileMetadata[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,parents)',
        pageSize: '1000',
      })
      if (pageToken)
        params.set('pageToken', pageToken)
      const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`
      const response = await this.fetchFn(url, { headers: this.authHeader() })
      if (!response.ok)
        throw await driveError(response, `listChildren(${folderId})`)
      const data = await response.json() as { files: DriveFileMetadata[], nextPageToken?: string }
      items.push(...data.files)
      pageToken = data.nextPageToken
    } while (pageToken)
    return items
  }

  /** Export a Google native doc (gdoc / gsheet / gslides) to a chosen format. */
  async exportDoc(fileId: string, mimeType: string): Promise<Buffer> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?${new URLSearchParams({ mimeType })}`
    const response = await this.fetchFn(url, { headers: this.authHeader() })
    if (!response.ok)
      throw await driveError(response, `exportDoc(${fileId},${mimeType})`)
    return globalBuffer().from(await response.arrayBuffer())
  }

  /** Download a binary file (image, PDF, …) as-is. */
  async downloadFile(fileId: string): Promise<Buffer> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    const response = await this.fetchFn(url, { headers: this.authHeader() })
    if (!response.ok)
      throw await driveError(response, `downloadFile(${fileId})`)
    return globalBuffer().from(await response.arrayBuffer())
  }

  private authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}` }
  }
}

async function driveError(response: Response, op: string): Promise<Error> {
  const text = await response.text().catch(() => '')
  return new Error(`Drive ${op} failed: ${response.status} ${response.statusText} ${text}`)
}
