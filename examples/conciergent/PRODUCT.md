---
name: conciergent
version: 0.1.0
ontologyId: ddd
sources:
  - kind: filesystem
    id: app
    role: code
    name: app
    path: ./codebases/app
    loader:
      kind: git
      config:
        url: https://github.com/mroops0111/conciergent.git
        branch: master
mcpServers: []
storage:
  kind: kuzu
  config: {}
---

# conciergent
