---
name: example
version: 0.1.0
description: Minimal Telos workspace template. Copy this directory, edit the source paths, and point Telos at it.
ontologyId: ddd

sources:
  - kind: filesystem
    id: src-prd
    role: intent
    name: prd
    path: ./intent
  - kind: filesystem
    id: src-app
    role: code
    name: app
    path: ./code/app
    language: typescript

mcpServers: []

agents:
  default: claude-default
  tasks: {}

agentBindings:
  - id: claude-default
    kind: claude-code
    model: opus
    effort: high
    extraArgs: []
    env: {}

storage:
  kind: in-memory
  config: {}

channels:
  - kind: http
    config:
      port: 4321
---

# Example Workspace

A minimal Telos workspace you can copy and adapt. Edit the `sources:` paths
above to point at your own intent (PRD / RFC) directories and codebases.

## Usage

```bash
WORKSPACE_DIR="$(pwd)/examples/example-workspace"

# Boot the server (uses in-memory storage by default)
pnpm --filter @telos/server dev
```

In another terminal:

```bash
# Register the workspace
curl -X POST http://localhost:4321/workspaces \
  -H 'Content-Type: application/json' \
  -d "{\"rootPath\":\"$WORKSPACE_DIR\"}"

# List installed skills
curl http://localhost:4321/workspaces/example-workspace/skills

# Run extract (requires `claude` CLI on PATH)
curl -X POST http://localhost:4321/workspaces/example-workspace/skills/telos-extract/run \
  -H 'Content-Type: application/json' \
  -d '{"args":"signup"}'
```

## Directory layout

```
example-workspace/
├── PRODUCT.md                    ← this file (frontmatter is the workspace SSoT)
├── intent/                       ← put PRD markdown here
├── code/                         ← symlink or path to real repos
│   └── app -> ../../path/to/your/app
├── skills/                       ← workspace-only custom skills
├── skill-extensions/             ← extend built-in skills via EXTEND.md
└── artifacts/                    ← produced by skills (gitignored)
    ├── proposals/{pending,applied,rejected}/
    ├── clarify/{pending,answered,applied,skipped}/
    ├── decisions/
    └── views/{docs,features}/
```
