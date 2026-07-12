import { access, mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import pc from 'picocolors'

export interface InitCommandInput {
  readonly dir: string
  readonly ontologyId: string
  readonly name?: string
  readonly force?: boolean
}

/**
 * Scaffold a new workspace at `dir`. Writes PRODUCT.md, .gitignore, and
 * an empty `intent/` so the directory has the shape of a Braid workspace.
 * Does not register with a running server (registration is a Studio
 * Wizard flow), so this is mostly useful for inspecting the template.
 */
export async function initCommand(input: InitCommandInput): Promise<void> {
  const absoluteDir = resolve(process.cwd(), input.dir)
  const workspaceName = input.name ?? basename(absoluteDir)

  await mkdir(absoluteDir, { recursive: true })

  const productPath = `${absoluteDir}/PRODUCT.md`
  if (!input.force && await fileExists(productPath))
    throw new Error(`${productPath} already exists. Pass --force to overwrite.`)

  await mkdir(`${absoluteDir}/intent`, { recursive: true })
  await writeFile(`${absoluteDir}/intent/.gitkeep`, '', 'utf-8')
  await writeFile(productPath, renderProductManifest({ name: workspaceName, ontologyId: input.ontologyId }), 'utf-8')
  await writeFile(`${absoluteDir}/.gitignore`, renderGitignore(), 'utf-8')

  process.stdout.write(`${pc.green('✓')} Created Braid workspace template at ${pc.cyan(absoluteDir)}\n`)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

/**
 * Workspace template. Mirrors `examples/example-workspace/PRODUCT.md`
 * but parametrised so `braid init` users start with their chosen name
 * and ontology id, not the literal string "example".
 */
function renderProductManifest({ name, ontologyId }: { name: string, ontologyId: string }): string {
  return `---
name: ${name}
version: 0.1.0
description: ${name} workspace. Edit sources below to point at your real intent and code paths.
ontologyId: ${ontologyId}

sources:
  - kind: filesystem
    id: src-prd
    role: intent
    name: prd
    path: ./intent

mcpServers: []

storage:
  kind: kuzu
  config: {}

channels:
  - kind: http
    config:
      port: 4321
---

# ${name}

A Braid workspace. The frontmatter above is the source of truth for
this workspace's configuration: sources, ontology, storage, channels.

## Adding code as a source

Symlink or clone the repository you want analysed under \`code/\`, then
add a source descriptor to the frontmatter:

\`\`\`yaml
sources:
  - kind: filesystem
    id: src-app
    role: code
    name: app
    path: ./code/app
    language: typescript
\`\`\`

## Next

Open Studio and create a workspace via the Wizard.
`
}

function renderGitignore(): string {
  return `artifacts/
code/
.env
.braid/
.braid-sessions/
`
}
