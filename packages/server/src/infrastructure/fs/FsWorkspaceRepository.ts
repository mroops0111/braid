import type { Workspace as WorkspaceData } from '@telos/schema'
import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { NotFoundError, ValidationError, Workspace, type WorkspaceRepository } from '@telos/core'
import { AbsolutePath, ProductManifest, WorkspaceId } from '@telos/schema'
import { parseMarkdownFrontmatter } from './frontmatter.js'
import { workspaceProductManifestPath } from './paths.js'

export class FsWorkspaceRepository implements WorkspaceRepository {
  private readonly cache = new Map<AbsolutePath, Workspace>()

  async list(): Promise<Workspace[]> {
    return [...this.cache.values()]
  }

  async load(rootPath: AbsolutePath): Promise<Workspace> {
    const cached = this.cache.get(rootPath)
    if (cached)
      return cached
    const workspace = await this.readFromDisk(rootPath)
    this.cache.set(rootPath, workspace)
    return workspace
  }

  async save(workspace: Workspace): Promise<void> {
    this.cache.set(workspace.rootPath, workspace)
  }

  private async readFromDisk(rootPath: AbsolutePath): Promise<Workspace> {
    await this.assertDirectoryExists(rootPath)
    const manifestPath = workspaceProductManifestPath(rootPath)
    const raw = await this.readManifest(manifestPath)
    const { frontmatter } = parseMarkdownFrontmatter<unknown>(raw)
    const productManifest = this.parseManifest(frontmatter, manifestPath)
    const data: WorkspaceData = {
      id: WorkspaceId.parse(basename(rootPath)),
      rootPath: AbsolutePath.parse(resolve(rootPath)),
      productManifest,
      pluginConfig: { plugins: [] },
    }
    return new Workspace(data)
  }

  private async assertDirectoryExists(rootPath: AbsolutePath): Promise<void> {
    try {
      const stats = await stat(rootPath)
      if (!stats.isDirectory()) {
        throw new ValidationError(`Workspace path "${rootPath}" is not a directory`)
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError(`Workspace directory "${rootPath}" not found`)
      }
      throw error
    }
  }

  private async readManifest(manifestPath: string): Promise<string> {
    try {
      return await readFile(manifestPath, 'utf-8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError(`PRODUCT.md not found at "${manifestPath}"`)
      }
      throw error
    }
  }

  private parseManifest(raw: unknown, manifestPath: string): ProductManifest {
    const parsed = ProductManifest.safeParse(raw)
    if (!parsed.success) {
      throw new ValidationError(`Invalid PRODUCT.md at "${manifestPath}": ${parsed.error.message}`)
    }
    return parsed.data
  }
}
