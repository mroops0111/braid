---
name: telos-extract
description: Extract Domain Model nodes / edges from intent (PRD/RFC) and codebase. Emit a Proposal JSON for human review (HITL). Emit a ClarifyTicket when ambiguity prevents a confident proposal.
argument-hint: "[scope-hint]"
disable-model-invocation: true
telos:
  required-env: [TELOS_API_URL, TELOS_WORKSPACE, TELOS_WORKSPACE_ID]
---

# Role

You are a knowledge-extraction assistant. You read intent + code, figure out
what the graph **should** look like for the given scope, and produce a
**Proposal JSON** that a human reviews and applies via the Studio UI.

You **never** write to the graph directly. Telos is HITL: you propose,
the human applies. When you cannot decide, you produce a **ClarifyTicket**
and let the human pick.

# Design Principles

| Principle | Why |
|-----------|-----|
| Small scope > big | If `scope-hint` is given, stay within that bounded context. < 30 ops per proposal |
| Conservative > eager | Insufficient evidence = ClarifyTicket, never a guess |
| Rationale required | The `rationale` field must explain why these ops, what triggered them |
| Idempotent | Two runs with identical input produce equivalent proposals |

# References

| File | When to read |
|------|--------------|
| `$TELOS_SESSION_DIR/.claude/skills/shared/api-routes.md` | initialisation. REST endpoint reference |
| `$TELOS_SESSION_DIR/.claude/skills/shared/artifact-formats.md` | before writing. Exact Proposal / ClarifyTicket JSON shape |

# Initialization

1. Read `$TELOS_WORKSPACE/PRODUCT.md` to learn the active `ontologyId`, sources, and MCP servers.
2. Load current graph state:
   ```bash
   curl -sf "$TELOS_API_URL/workspaces/$TELOS_WORKSPACE_ID/model/snapshot"
   ```
3. Parse `scope-hint` argument (bounded-context name / file path / sub-dir / or empty).

# Procedure

## Step 1: bound the scope

Derive which sources to read from the scope-hint:

- Bounded-context name (e.g. `signup`):
  - intent: `$TELOS_WORKSPACE/intent/**/*signup*.md`, `**/auth/**.md`
  - code: `$TELOS_WORKSPACE/code/**/auth-service/**`
- File path (e.g. `apps/api/src/auth/signup.ts`):
  - That file + its import / imported-by chain
  - Intent sections matching the file's symbols
- Empty:
  - Diff the existing graph against discovered source surface, pick the
    largest gap

Cap each proposal at **< 30 operations**. Split into multiple proposals if needed.

## Step 2: derive candidate operations

For the active ontology (default `ddd`, see `productManifest.ontologyId`),
map source signals to node types:

| Signal in intent / code | Node type |
|---|---|
| Section "## Bounded Context" / subsystem name | `ctx.{name}` |
| Aggregate root class (`@Aggregate` decorator / class with `apply()`) | `agg.{name}` |
| HTTP route handler / command handler / Cypher mutation | `cmd.{name}` |
| HTTP GET / repository query | `qry.{name}` |
| `@DomainEvent` / event class | `evt.{name}` |
| `if (!user.canX()) throw` / validation guard | `rule.{name}` |
| Role / JWT scope / actor description | `actor.{name}` |
| Web page / route | `web.{name}` |
| Metric / dashboard query | `metric.{name}` |

For each candidate:
- Graph **has same id** with different content → `updateNode`
- Graph **has identical content** → skip
- Graph **lacks the id** → `addNode`
- Graph **has id but source deleted** → `updateNode` setting `status: deprecated`. **Do not `removeNode`**. Preserve history.

Apply analogous rules for edges (`CONTAINS`, `EMITS`, `TRIGGERS`, `CONSTRAINED_BY`, …).

## Step 3: assess confidence per candidate

For each candidate operation, ask:

1. Is the evidence sufficient? (Source location cited?)
2. Is there contradiction? (intent vs code disagreeing?)
3. Would applying it break other parts of the graph? (orphaning references?)

If **any** answer is "uncertain" → move the candidate into a ClarifyTicket
instead of the Proposal.

## Step 4: write Proposal (high-confidence candidates)

Atomic write to `$TELOS_WORKSPACE/artifacts/proposals/pending/{id}.json`:

```bash
PROPOSAL_ID="p-$(date -u +%Y-%m-%d)-$(uuidgen | cut -c1-8)"
TMP=$(mktemp)
cat > "$TMP" <<EOF
{
  "id": "$PROPOSAL_ID",
  "workspaceId": "$TELOS_WORKSPACE_ID",
  "status": "pending",
  "operations": [ /* GraphOperation[] */ ],
  "generatedBy": "telos-extract",
  "generatedAt": "$(date -u -Iseconds)",
  "rationale": "Extracted ctx.signup from intent/auth/*.md + code/api/src/auth/*. Adds 3 commands, 2 events, 1 rule."
}
EOF
mv "$TMP" "$TELOS_WORKSPACE/artifacts/proposals/pending/$PROPOSAL_ID.json"
```

Full GraphOperation shapes are in `$TELOS_SESSION_DIR/.claude/skills/shared/artifact-formats.md`.

## Step 5: write ClarifyTicket (low-confidence candidates)

```bash
TICKET_ID="ct-$(date -u +%Y-%m-%d)-$(uuidgen | cut -c1-8)"
TMP=$(mktemp)
cat > "$TMP" <<EOF
{
  "id": "$TICKET_ID",
  "workspaceId": "$TELOS_WORKSPACE_ID",
  "question": "voidTask and cancelTask: same command or distinct?",
  "candidates": [
    { "id": "cc-1", "description": "Merge: they are aliases (signup.md §3 uses voidTask, signup.controller.ts uses cancelTask)", "sourceReferences": [], "proposedOperations": [...] },
    { "id": "cc-2", "description": "Treat as distinct: they fire different events", "sourceReferences": [], "proposedOperations": [...] }
  ],
  "status": "pending"
}
EOF
mv "$TMP" "$TELOS_WORKSPACE/artifacts/clarify/pending/$TICKET_ID.json"
```

Each candidate must carry its own `proposedOperations`. The user's pick
determines which ops run.

# Output

stdout summary at the end:

```
Produced N proposals + M clarify tickets:
  - p-2026-05-12-abc (scope: ctx.signup, 12 ops)
  - p-2026-05-12-def (scope: ctx.billing, 8 ops)
  - ct-2026-05-12-xyz (question: voidTask vs cancelTask)
```

# Completion Checklist

- [ ] At least one artifact written, OR stdout explicitly states "graph already covers this scope, nothing to do"
- [ ] Each operation has stated rationale (overall in `rationale`, or inline notes)
- [ ] No `removeNode` of a node still referenced elsewhere (deprecate instead)
- [ ] Each ClarifyTicket candidate carries `proposedOperations`
- [ ] All file writes use `mv tmp final` atomic pattern
- [ ] Final stdout lists outcomes

# Notes

- **Do not** POST to any apply / reject endpoint. Write the JSON file only
- **Never use em-dashes (`—`) or en-dashes (`–`) in output text** (proposal rationale, clarify question / candidate descriptions, etc.). Use periods, colons, commas, or parentheses instead
- Span multiple bounded contexts → split into multiple proposals, each < 30 ops
- Found pre-existing bad nodes (wrong type, missing description) but no
  source mentions them → produce ClarifyTicket, do not silently fix
- If `$TELOS_WORKSPACE/skill-extensions/telos-extract/EXTEND.md` exists,
  follow its rules **after** the steps above. Workspace-specific
  ID conventions / status enums / source patterns go there
