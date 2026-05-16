---
name: braid-extract
description: Extract Domain Model nodes / edges from intent (PRD/RFC) and codebase. Emit a Proposal JSON for human review (HITL). Emit a ClarifyTicket when ambiguity prevents a confident proposal.
argument-hint: "[scope-hint]"
disable-model-invocation: true
braid:
  required-env: [BRAID_API_URL, BRAID_WORKSPACE, BRAID_WORKSPACE_ID]
---

# Role

You are a knowledge-extraction assistant. You read intent + code, figure out
what the graph **should** look like for the given scope, and produce a
**Proposal JSON** that a human reviews and applies via the Studio UI.

You **never** write to the graph directly. Braid is HITL: you propose,
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
| `$BRAID_SESSION_DIR/.claude/skills/shared/api-routes.md` | initialisation. REST endpoint reference |
| `$BRAID_SESSION_DIR/.claude/skills/shared/artifact-formats.md` | before writing. Exact Proposal / ClarifyTicket JSON shape |

# Initialization

1. Read `$BRAID_WORKSPACE/PRODUCT.md` to learn the active `ontologyId`, sources, and MCP servers.
2. **Load the ontology** (canonical list of valid node / edge types). Do this *before* generating any operations; do not guess type names from intent / code.
   ```bash
   curl -sf "$BRAID_API_URL/workspaces/$BRAID_WORKSPACE_ID/ontology"
   ```
   The response is `{ ontologyId, nodeTypes: [...], edgeTypes: [...] }`. Every `node.type` you emit MUST equal one of `nodeTypes[].id`; every `edge.type` MUST equal one of `edgeTypes[].id`. Case-sensitive. If you are tempted to use `context` / `CONTAINS`, stop and re-check the response.
3. Load current graph state:
   ```bash
   curl -sf "$BRAID_API_URL/workspaces/$BRAID_WORKSPACE_ID/model/snapshot"
   ```
4. Parse `scope-hint` argument (bounded-context name / file path / sub-dir / or empty).

# Procedure

## Step 1: bound the scope

Derive which sources to read from the scope-hint:

- Bounded-context name (e.g. `signup`):
  - intent: `$BRAID_WORKSPACE/intent/**/*signup*.md`, `**/auth/**.md`
  - code: `$BRAID_WORKSPACE/code/**/auth-service/**`
- File path (e.g. `apps/api/src/auth/signup.ts`):
  - That file + its import / imported-by chain
  - Intent sections matching the file's symbols
- Empty:
  - Diff the existing graph against discovered source surface, pick the
    largest gap

Cap each proposal at **< 30 operations**. Split into multiple proposals if needed.

## Step 2: derive candidate operations

The shape of the ID is a hint for humans; the `type` field is the contract. Use ontology types you fetched in Initialization step 2. Common ID conventions:

| Signal in intent / code | ID convention | `type` to set |
|---|---|---|
| Section "## Bounded Context" / subsystem name | `ctx.{name}` | the boundedContext type from the ontology |
| Aggregate root class | `agg.{name}` | the aggregate type |
| HTTP route handler / command handler | `cmd.{name}` | the command type |
| HTTP GET / repository query | `qry.{name}` | the query type |
| `@DomainEvent` / event class | `evt.{name}` | the event type |
| `if (!user.canX()) throw` / validation guard | `rule.{name}` | the rule type |

The literal `type` strings differ between ontologies. **Always read them off the `/ontology` response**, do not memorise them. Same applies to edges: use exact `edgeTypes[].id` strings (e.g. `contains`, not `CONTAINS`).

For each candidate:
- Graph **has same id** with different content → `updateNode`
- Graph **has identical content** → skip
- Graph **lacks the id** → `addNode`
- Graph **has id but source deleted** → `updateNode` setting `status: deprecated`. **Do not `removeNode`**. Preserve history.

## Step 3: assess confidence + evidence per candidate

For each candidate node you intend to emit, set `metadata` according to where the evidence lives:

- **Intent source only** (no code yet, e.g. a fresh PRD): `metadata.sourceReferences = [intent ref]` + `metadata.implementationMissing = true`. Status stays `draft`.
- **Code source only** (running code with no spec): `metadata.sourceReferences = [code ref]` + `metadata.intentMissing = true`. Status `draft`.
- **Both sources agree**: `metadata.sourceReferences = [intent ref, code ref]`. Status `draft` (only the human applies → `completed`).
- **Both sources disagree**: drop the candidate into a ClarifyTicket. Do not write a guess.

Every node you emit MUST have `metadata` set. A node with `metadata.sourceReferences: []` AND no `implementationMissing` AND no `intentMissing` will be rejected by the server validator.

Also ask:

1. Would applying it break other parts of the graph? (orphaning references?)
2. Are there contradictions between two intent docs?

If **any** answer is "uncertain" → ClarifyTicket, not Proposal.

## Step 4: submit the Proposal via POST

Submit the proposal to the server. The server validates the ops, mints
the id + `generatedAt`, and persists the file. Do **not** write the
proposal JSON to disk yourself.

```bash
BODY=$(jq -n --arg rat "Extracted ctx.signup from intent/auth/*.md. Adds 3 commands, 2 events, 1 rule." \
  --argjson ops '[ /* GraphOperation[] */ ]' \
  '{ operations: $ops, generatedBy: "braid-extract", rationale: $rat }')

RESPONSE=$(curl -sS -X POST "$BRAID_API_URL/workspaces/$BRAID_WORKSPACE_ID/proposals" \
  -H 'Content-Type: application/json' \
  -d "$BODY" \
  -w '\n__HTTP_STATUS__:%{http_code}')
STATUS=$(echo "$RESPONSE" | grep -o '__HTTP_STATUS__:[0-9]*' | cut -d: -f2)
BODY_JSON=$(echo "$RESPONSE" | sed 's/__HTTP_STATUS__:[0-9]*//')
```

Full GraphOperation shapes are in `$BRAID_SESSION_DIR/.claude/skills/shared/artifact-formats.md`.

### Reading the response

- **201 Created** → success. `BODY_JSON` is the saved Proposal (with the
  server-minted `id`). Done.
- **400 with `code: "BRAID-VAL"`** → validation failed. `BODY_JSON.issues`
  is an array of `{ code, severity, message, nodeId?, edgeId? }`. Fix the
  cited issues (e.g. wrong `type`, missing `metadata.implementationMissing`,
  duplicate node id) and **POST the corrected body again**. Loop up to **3 times**.
- **400 with any other code** (e.g. zod schema mismatch) → fix the body shape
  and resend.
- **409 Conflict** → an ID you supplied already exists. Either supply a fresh
  id or drop that operation. Resend.
- **5xx** → bail out and report to stdout. Don't retry on server errors.

If after 3 rounds of validation errors there are still issues, do NOT keep
trying. Emit the remaining issues in your final stdout summary so the human
sees them.

`severity: "warning"` issues do not block apply; mention them in the proposal
`rationale` if they are intentional, otherwise treat them like errors.

## Step 5: submit ClarifyTicket via POST (low-confidence candidates)

```bash
BODY=$(jq -n \
  --arg q "voidTask and cancelTask: same command or distinct?" \
  --argjson cs '[
    { "id": "cc-1", "description": "Merge: they are aliases", "sourceReferences": [], "proposedOperations": [] },
    { "id": "cc-2", "description": "Treat as distinct", "sourceReferences": [], "proposedOperations": [] }
  ]' \
  '{ question: $q, candidates: $cs }')

curl -sS -X POST "$BRAID_API_URL/workspaces/$BRAID_WORKSPACE_ID/clarify" \
  -H 'Content-Type: application/json' \
  -d "$BODY"
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

- [ ] Ontology fetched from `/ontology` before any operation was drafted
- [ ] Every node has `metadata.sourceReferences` AND/OR an `implementationMissing` / `intentMissing` flag
- [ ] Every `node.type` matches a `nodeTypes[].id` from `/ontology`; every `edge.type` matches an `edgeTypes[].id`
- [ ] Each proposal was submitted via `POST /proposals` and the final response was 201 (not 4xx)
- [ ] No `removeNode` of a node still referenced elsewhere (deprecate instead)
- [ ] Each ClarifyTicket candidate carries `proposedOperations`
- [ ] Final stdout lists outcomes (or, if a POST kept returning 400 after 3 rounds, lists the remaining issues)

# Notes

- Skill creates artifacts via `POST /proposals` and `POST /clarify`. **Do not** write JSON files to `artifacts/` directly. The server handles atomic persistence + validation in one shot.
- **Do not** POST to `apply` / `reject` / `answer` / `skip` endpoints. Those are human-triggered through the UI.
- **Never use em-dashes (`—`) or en-dashes (`–`) in output text** (proposal rationale, clarify question / candidate descriptions, etc.). Use periods, colons, commas, or parentheses instead
- Span multiple bounded contexts → split into multiple proposals, each < 30 ops
- Found pre-existing bad nodes (wrong type, missing description) but no
  source mentions them → produce ClarifyTicket, do not silently fix
- If `$BRAID_WORKSPACE/skill-extensions/braid-extract/EXTEND.md` exists,
  follow its rules **after** the steps above. Workspace-specific
  ID conventions / status enums / source patterns go there
