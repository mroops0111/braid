import type { AbsolutePath } from '@braidhq/schema'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ValidationError } from '@braidhq/core'
import { AbsolutePath as AbsolutePathSchema } from '@braidhq/schema'
import { z } from 'zod'

const RegistryContent = z.object({
  workspaces: z.array(z.object({ rootPath: AbsolutePathSchema })).default([]),
})

type RegistryContent = z.infer<typeof RegistryContent>

/**
 * Persists the list of registered workspace rootPaths to a JSON file.
 * Default location is `${BRAID_HOME}/workspaces.json` (set by the caller).
 * Acts as the source of truth across server restarts — the in-memory
 * `FsWorkspaceRepository` cache is rebuilt from this file on cold start.
 */
export class WorkspaceRegistryFile {
  constructor(private readonly filePath: string) {}

  async list(): Promise<AbsolutePath[]> {
    const content = await this.read()
    return content.workspaces.map(entry => entry.rootPath)
  }

  async add(rootPath: AbsolutePath): Promise<void> {
    const content = await this.read()
    if (content.workspaces.some(entry => entry.rootPath === rootPath))
      return
    content.workspaces.push({ rootPath })
    await this.write(content)
  }

  async remove(rootPath: AbsolutePath): Promise<void> {
    const content = await this.read()
    const filtered = content.workspaces.filter(entry => entry.rootPath !== rootPath)
    if (filtered.length === content.workspaces.length)
      return
    await this.write({ workspaces: filtered })
  }

  private async read(): Promise<RegistryContent> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = RegistryContent.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        throw new ValidationError(`Invalid workspace registry at "${this.filePath}": ${parsed.error.message}`)
      }
      return parsed.data
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { workspaces: [] }
      throw error
    }
  }

  private async write(content: RegistryContent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf-8')
  }
}
