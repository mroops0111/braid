---
name: generate-doc
description: Render markdown documentation from the current Knowledge Graph. Writes one file per bounded context (or per scope hint) into artifacts/views/docs/. Read-only. Never mutates the graph.
argument-hint: "[scope-hint]"
disable-model-invocation: true
braid:
  category: generate
  summary: Render Markdown docs from the current graph
  required-env: [BRAID_API_URL, BRAID_WORKSPACE, BRAID_WORKSPACE_ID]
  inputs:
    - name: container
      label: Container
      description: One or more containers (e.g. bounded contexts) to render. Multi-select runs the skill in parallel for each pick. Leave empty to render one doc per container in the workspace.
      kind: multi-pick
      optional: true
      provider:
        kind: graph-node
        filter:
          renderHint: { container: true }
      fallback: text
---

## Role

You are a documentation generator. You translate the Knowledge Graph into readable markdown for non-engineering audiences (PM / QA / Customer Support / new hires).

The skill talks to the workspace through the `braid-core` MCP server (read-only operations: ontology fetch, node list, node-scope expansion). Discover the actual tool names via the MCP tool list before authoring calls; the capabilities below are *what to do*, not literal identifiers.

You read the graph, write `artifacts/views/docs/*.md`. You never modify graph state, never produce proposals, never record decisions.

## Design Principles

- Business language. No file paths, code identifiers, or type ids in prose. Translate to plain words.
- Honest status. Nodes with `status: draft / unclear / deprecated` get visible call-outs, not silent inclusion.
- Traceable. Footer lists the source node ids. The prose itself does not name ids.
- Idempotent. Same graph plus same scope yields byte-identical output.

## Initialization

1. Read `$BRAID_WORKSPACE/PRODUCT.md` for the active `ontologyId`.
2. Fetch the active ontology via `braid-core` to learn the node and edge type ids the rendering will encounter. Each `NodeTypeDescriptor` may carry a `renderHint`; the renderer is driven by those hints, not by ontology-specific vocabulary.
3. From the ontology response, derive the rendering taxonomy:
   - **Container types**: every `nodeTypes[]` entry whose `renderHint.container === true`. One output file per node of these types.
   - **Nesting chains**: for every type with `renderHint.expandedUnder`, the chain it joins (e.g. `aggregate` under `boundedContext`, `command` under `aggregate`). Recurse to compute the depth.
   - **Top-level sections**: types with `renderHint.section` but no `expandedUnder` are flat lists rendered as their own H2 inside each container.
   - **Leaves**: types with no `renderHint` are rendered as footnotes in the source-id list rather than promoted into the body.
4. Parse `$ARGUMENTS`:
   - A specific node id: render only that container (must be a container-typed node; otherwise abort with a clear error).
   - Empty: list every top-level container node via the `braid-core` node-search capability, filtering by each container type, and render one doc per container.
5. Ensure the output directory exists: `mkdir -p "$BRAID_WORKSPACE/artifacts/views/docs"`.

## Procedure

Repeat the four steps below per scope selected by Initialization (one scope = one output file).

### Step 1: Fetch the Scoped Subgraph

Use the `braid-core` node-scope capability with the container node id and depth D, where D is the depth of the longest `expandedUnder` chain rooted at this container type plus one (so leaf nodes are included). For DDD-shaped ontologies that's typically 3.

### Step 2: Group Nodes by renderHint

Walk the in-scope nodes using the taxonomy derived in Initialization:

- The container node itself sits at the root.
- For each type whose `renderHint.expandedUnder` resolves (transitively) to the container type, group its nodes as direct children of the appropriate parent and recurse.
- Types with `renderHint.section` go into a top-level section per `section` value, regardless of nesting (e.g. an `Actors` list at the container level).
- Types with no `renderHint` are recorded for the Source-nodes footer but not surfaced in the body.

The traversal is intentionally ontology-agnostic: it never mentions `aggregate`, `command`, `event`, etc. by name. If a non-DDD ontology declares its own container / expandedUnder chains, this skill renders it without modification.

### Step 3: Render Markdown

The structure mirrors the renderHint taxonomy: one H1 for the container, one H2 per top-level `renderHint.section`, then nested H3 / H4 for each level of the `expandedUnder` chain.

```markdown
# {container.name}

> {container.description, pure business language}

{If status is draft or unclear, add a ⚠️ banner}

## {top-level-section-A.label, e.g. "Actors"}

- **{node.name}**: {node.description}

## {section-B.label, e.g. "Use cases"}

### {first-level-child.name}

{first-level-child.description}

#### {second-level-child.name}

{second-level-child.description}

(repeat one bullet / sub-section per node, descending the
expandedUnder chain)

---

## Consistency status

{If any draft / unclear / deprecated nodes exist, list them}

| Item | Status | Note |
|---|---|---|
| {name} | ⚠️ unclear | See clarify ticket {id} |
| {name} | 🟡 draft | Description incomplete |

---

> Generated by braid:generate-doc from the graph.
> Source nodes: {node_id_1}, {node_id_2}, ...
```

### Step 4: Atomic Write

Compose the markdown in memory; write via `mv tmp final` so a partial render never replaces an existing file. Pseudocode:

```
TARGET="$BRAID_WORKSPACE/artifacts/views/docs/$(echo "$NODE_ID" | tr '.' '-').md"
TMP=$(mktemp)
write_markdown_to "$TMP"
mv "$TMP" "$TARGET"
```

## Output

stdout summary:

```
Generated artifacts/views/docs/ctx-checkout.md (12 nodes, 3 unclear)
Generated artifacts/views/docs/ctx-billing.md (8 nodes, 0 unclear)

Wrote 2 documents.
```

## Output Files

- **Path**: `$BRAID_WORKSPACE/artifacts/views/docs/<container-id>.md` (replace `.` in id with `-`, e.g. `ctx.checkout` becomes `ctx-checkout.md`).
- **Format**: CommonMark Markdown. Atomic via `mv tmp final`.
- **Scope**: never write outside `artifacts/views/docs/`. `views/` is reserved for read-only projections.

## Completion Checklist

- [ ] Every in-scope container produced one markdown file.
- [ ] Upper sections (business sections) contain no paths, code identifiers, or type ids in prose.
- [ ] `draft` / `unclear` / `deprecated` nodes are surfaced in the Consistency status table.
- [ ] Source node ids listed in the footer.
- [ ] All file writes use the `mv tmp final` atomic pattern.
- [ ] Final stdout lists each produced file + node count.

## Companion Docs

This skill is read-only and currently does not need supplementary shared docs. (The Companion Docs section is required by the style guide and stays in place for symmetry; entries will appear when needed.)

## Notes

- Do not invent or fill in missing descriptions. That is `ddd:extract` / `ddd:clarify`'s job. Render what the graph says, faithfully.
- If `$BRAID_WORKSPACE/skill-extensions/braid-generate-doc/EXTEND.md` exists, follow its rules after the steps above. Product-specific tone / glossary / customer-facing terminology overrides go there.
