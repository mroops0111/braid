import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw) as T
}

export async function writeJsonFile<T>(filePath: string, content: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf-8')
}

export async function moveFile(fromPath: string, toPath: string): Promise<void> {
  await mkdir(dirname(toPath), { recursive: true })
  await rename(fromPath, toPath)
}

export async function listJsonFiles(directory: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => join(directory, entry.name))
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return []
    throw error
  }
}
