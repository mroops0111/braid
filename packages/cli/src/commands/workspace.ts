import process from 'node:process'
import pc from 'picocolors'

interface WorkspaceData {
  id: string
  rootPath: string
  productManifest: { name: string, ontologyId: string }
}

export interface WorkspaceListInput {
  readonly apiUrl: string
}

export async function workspaceListCommand(input: WorkspaceListInput): Promise<void> {
  const response = await fetch(`${input.apiUrl}/workspaces`).catch((error: unknown) => {
    throw new Error(`could not reach ${input.apiUrl} (is "braid serve" running?): ${(error as Error).message}`)
  })
  if (!response.ok) {
    const detail = await extractProblemDetail(response)
    throw new Error(`server returned ${response.status}: ${detail}`)
  }
  const body = await response.json() as { items: readonly WorkspaceData[] }
  if (body.items.length === 0) {
    process.stdout.write(`${pc.dim('No workspaces registered. Create one via Studio.')}\n`)
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
