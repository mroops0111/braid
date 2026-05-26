---
name: braid-extract
description: Extract Domain Model nodes / edges from intent (PRD/RFC) and codebase. Emit a Proposal JSON for human review (HITL). Emit a ClarifyTicket when ambiguity prevents a confident proposal.
argument-hint: "[scope-hint]"
disable-model-invocation: true
braid:
  category: build
  order: 100
  summary: Extract domain nodes/edges from PRDs and code
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
| `$BRAID_SESSION_DIR/.claude/skills/shared/artifact-formats.md` | before writing. Exact Proposal / ClarifyTicket / DriftIssue JSON shape |
| `$BRAID_SESSION_DIR/.claude/skills/shared/drift-detection.md` | Step 3. When sources disagree on a field, attach a structured DriftIssue to the node instead of guessing or silently picking one side |

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

### Canonical edges to add when emitting a new node

Read the `description` field of every node type and every edge type from the `/ontology` response before deciding. The descriptions are the source of truth for what each element means and where it fits. They carry the canonical reading (Evans / Vernon DDD + EventStorming supplements) and call out anything that is not strict canon.

A BoundedContext contains aggregates only. Commands, queries, events, and rules belong to an aggregate and are reached via the aggregate's edges. When you create one of those nodes also emit the wiring edge into its owning aggregate.

| New node | Required parent / wiring edge |
|---|---|
| `aggregate` | `boundedContext --contains--> aggregate` |
| `command` / `query` | `aggregate --accepts--> command` or `aggregate --accepts--> query` |
| `event` | `command --emits--> event` (CQRS / EventStorming reading; preferred when extracting from PRD / spec language) or `aggregate --emits--> event` (Vernon IDDD structural reading; preferred when describing state ownership). Both shapes are valid in this ontology |
| `rule` (per-operation) | `command --constrainedBy--> rule` or `query --constrainedBy--> rule` |
| `rule` (aggregate-wide invariant) | `aggregate --constrainedBy--> rule` |
| `actor` | `command --performedBy--> actor` or `query --performedBy--> actor` |
| `policy` | `event --triggers--> policy --enacts--> command` (see "Policy emission" below) |

A command, query, event, or rule with no edge into its owning aggregate is an orphan. If the source material doesn't make the owning aggregate obvious, surface it as a ClarifyTicket per Step 5 rather than attaching it directly to a BoundedContext.

Cross-aggregate references go through `aggregate --dependsOn--> aggregate` (by id only, per DDD). Event-driven cross-aggregate flow goes through `event --triggers--> command` or via a policy when the reaction has a name worth keeping.

### Policy emission

A policy materialises Vernon's Process Manager / EventStorming's purple Policy sticky. The pattern is **"when event X happens, do Y"**. Emit a policy when the source material describes an automatic reaction with a name worth keeping in the graph, especially when:
- the reaction crosses aggregates (event in aggregate A triggers a command in aggregate B);
- the reaction is delayed or scheduled (e.g. "after N days");
- the reaction has its own configuration or conditions.

Shape: `event --triggers--> policy --enacts--> command`. A policy without both edges is incomplete.

Skip the policy when the reaction is a single synchronous command on the same aggregate that emitted the event; that's just `event --triggers--> command` directly. Policy is for reactions that deserve a name.

Distinguish from `rule`: a rule is "this must always be true" (a constraint); a policy is "when this happens, do that" (a reaction).

### Context Mapping (strategic edges)

The seven Context Mapping edges (`partnership`, `customerSupplier`, `conformist`, `sharedKernel`, `anticorruptionLayer`, `openHostService`, `publishedLanguage`) describe strategic BoundedContext-to-BoundedContext relationships from Evans Blue Book Part IV. Each `description` on the `/ontology` response defines its direction and meaning; read them before emitting.

These are not derivable from a single feature slice; they reflect team structure, organisational politics, and integration architecture. **Do not auto-emit them from per-slice extract.** If the source material strongly signals one (e.g. mentions a third-party system the workspace depends on, or two contexts described as coupled in release planning), raise a ClarifyTicket per Step 5 asking the architect to confirm the mapping type. Let the human pick.

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
- **Both sources disagree**: distinguish identity-level disagreement from field-level drift before deciding what to emit (see below).

Every node you emit MUST have `metadata` set. A node with `metadata.sourceReferences: []` AND no `implementationMissing` AND no `intentMissing` will be rejected by the server validator.

### Identity-level disagreement → ClarifyTicket

You can't tell whether two sources are even describing the *same* concept (`voidTask` and `cancelTask`: alias or distinct? Two unrelated `Task` definitions in different PRDs?). Don't pick. Emit a `ClarifyTicket` per Step 5 and stop.

### Field-level drift → DriftIssue attached to the node

The sources agree on *what* this is, but disagree on *specifics*: a limit, a state set, a parameter list, a sequence of steps. **Don't** drop into a ClarifyTicket — emit the node anyway and attach one structured `DriftIssue` per dimension to its `metadata.driftIssues[]`. Set `status: 'unclear'` instead of `draft` when at least one DriftIssue is `severity: 'error'`. Read `drift-detection.md` for the dimension checklist, the description pattern, and severity rules; the JSON shape is in `artifact-formats.md`.

This split is load-bearing: ClarifyTickets are "the human must decide what this is", DriftIssues are "the human can see two sources disagree and act on the proposal review pane". Conflating them buries field-level drift in ticket prose where the validator can't gate Apply.

Also ask:

1. Would applying it break other parts of the graph? (orphaning references?)
2. Are there contradictions between two intent docs about the same concept? Those are field-level drift on a node, not identity disagreement.

If **any** answer is "uncertain" about node identity → ClarifyTicket, not Proposal.

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
- [ ] When two sources for the same node disagreed on a specific field, a structured `DriftIssue` is attached (not a ClarifyTicket); see `drift-detection.md`
- [ ] Every `node.type` matches a `nodeTypes[].id` from `/ontology`; every `edge.type` matches an `edgeTypes[].id`
- [ ] No `contains` edge points from BoundedContext to a non-aggregate.
- [ ] Every cmd and qry has at least one `accepts` in-edge from an aggregate.
- [ ] Every evt has at least one `emits` in-edge from a command or aggregate.
- [ ] Every rule has at least one `constrainedBy` in-edge from a cmd, qry, or aggregate.
- [ ] Every policy has both a `triggers` in-edge from an event and an `enacts` out-edge to a command.
- [ ] Every `dependsOn` edge runs `aggregate --dependsOn--> aggregate`. Cross-aggregate cmd/qry coupling goes through `triggers` (optionally via a policy) instead.
- [ ] No Context Mapping edge was auto-emitted. Those land via ClarifyTicket only.
- [ ] Each proposal was submitted via `POST /proposals` and the final response was 201 (not 4xx)
- [ ] No `removeNode` of a node still referenced elsewhere (deprecate instead)
- [ ] Each ClarifyTicket candidate carries `proposedOperations`
- [ ] Final stdout lists outcomes (or, if a POST kept returning 400 after 3 rounds, lists the remaining issues)

# Notes

- Skill creates artifacts via `POST /proposals` and `POST /clarify`. **Do not** write JSON files to `artifacts/` directly. The server handles atomic persistence + validation in one shot.
- **Do not** POST to `apply` / `reject` / `answer` / `skip` endpoints. Those are human-triggered through the UI.
- Span multiple bounded contexts → split into multiple proposals, each < 30 ops
- Found pre-existing bad nodes (wrong type, missing description) but no
  source mentions them → produce ClarifyTicket, do not silently fix
- If `$BRAID_WORKSPACE/skill-extensions/braid-extract/EXTEND.md` exists,
  follow its rules **after** the steps above. Workspace-specific
  ID conventions / status enums / source patterns go there
