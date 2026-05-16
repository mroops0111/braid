import { resolve } from 'node:path'
import process from 'node:process'
import pc from 'picocolors'

interface WorkspaceData {
  id: string
  rootPath: string
  productManifest: { name: string, ontologyId: string }
}

export interface WorkspaceAddInput {
  readonly rootPath: string
  readonly apiUrl: string
}

/**
 * POST /workspaces with the absolute path. The server resolves the
 * workspace by reading PRODUCT.md at that path. Conflict (already
 * registered) and validation errors arrive as `application/problem+json`;
 * extract the `detail` field and surface as a single-line error.
 */
export async function workspaceAddCommand(input: WorkspaceAddInput): Promise<void> {
  const absolute = resolve(process.cwd(), input.rootPath)
  const response = await fetch(`${input.apiUrl}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootPath: absolute }),
  }).catch((error: unknown) => {
    throw new Error(`could not reach ${input.apiUrl} (is "telos serve" running?): ${(error as Error).message}`)
  })
  if (!response.ok) {
    const detail = await extractProblemDetail(response)
    throw new Error(`server returned ${response.status}: ${detail}`)
  }
  const workspace = await response.json() as WorkspaceData
  process.stdout.write(
    `${pc.green('✓')} Registered workspace ${pc.cyan(workspace.id)} `
    + `(${workspace.productManifest.name}, ontology: ${workspace.productManifest.ontologyId})\n`,
  )
}

export interface WorkspaceListInput {
  readonly apiUrl: string
}

export async function workspaceListCommand(input: WorkspaceListInput): Promise<void> {
  const response = await fetch(`${input.apiUrl}/workspaces`).catch((error: unknown) => {
    throw new Error(`could not reach ${input.apiUrl} (is "telos serve" running?): ${(error as Error).message}`)
  })
  if (!response.ok) {
    const detail = await extractProblemDetail(response)
    throw new Error(`server returned ${response.status}: ${detail}`)
  }
  const body = await response.json() as { items: readonly WorkspaceData[] }
  if (body.items.length === 0) {
    process.stdout.write(`${pc.dim('No workspaces registered. Try:')} telos workspace add "$(pwd)"\n`)
    return
  }
  for (const workspace of body.items) {
    process.stdout.write(
      `${pc.cyan(workspace.id.padEnd(24))} `
      + `${pc.dim('ontology:')} ${workspace.productManifest.ontologyId.padEnd(12)} `
      + `${pc.dim('path:')} ${workspace.rootPath}\n`,
    )
  }
}

async function extractProblemDetail(response: Response): Promise<string> {
  try {
    const body = await response.json() as { detail?: string, title?: string }
    return body.detail ?? body.title ?? response.statusText
  }
  catch {
    return response.statusText
  }
}
