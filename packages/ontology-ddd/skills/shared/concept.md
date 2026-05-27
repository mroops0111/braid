# DDD Ontology Concept

The shared concept document for `@braidhq/ontology-ddd`. Every DDD-resident skill (`braid-extract`, `braid-clarify`, `braid-model`) consults this file before authoring nodes / edges, so the vocabulary, wiring rules, and authoring conventions live in one place instead of being duplicated in each Procedure.

Skills read this at `<cwd>/.claude/skills/ontology-ddd/concept.md`, where `<cwd>` is the working directory each SKILL.md captures in its Initialization step.

## Vocabulary

The 8 node types grouped by sub-domain. Full per-type definitions are in each `NodeTypeDescriptor.description` from the ontology fetch capability; this table is the categorization view.

| Node type | Sub-domain |
|---|---|
| `boundedContext` | Strategic DDD (Evans Blue Book Part IV) |
| `aggregate` | Tactical DDD (Vernon IDDD ch. 10) |
| `command` | CQRS (Young 2010) |
| `query` | CQRS |
| `event` | Tactical DDD + EventStorming (orange sticky) |
| `rule` | Tactical DDD (Specification pattern; Vernon invariants) |
| `actor` | EventStorming (yellow stick figure) |
| `policy` | EventStorming (purple sticky); Vernon Process Manager / Saga |

## Wiring Rules

Edges carry the structural contract. Always use the exact `edgeTypes[].id` from `getOntology`; the strings below mirror those ids.

### Mandatory parent / wiring

Every new node carries an edge into its owning structural parent. Orphans are a hard reject in `StructuralValidator` (see `validators.md` in `shared/`).

| New node | Required parent edge |
|---|---|
| `aggregate` | `boundedContext --contains--> aggregate` |
| `command` / `query` | `aggregate --accepts--> command` (or `query`) |
| `event` | `command --emits--> event` (CQRS / EventStorming reading; preferred when extracting from PRD / spec language) **or** `aggregate --emits--> event` (Vernon IDDD structural reading; preferred when describing state ownership). Both shapes are valid. |
| `rule` (per-operation) | `command --constrainedBy--> rule` (or `query --constrainedBy--> rule`) |
| `rule` (aggregate-wide invariant) | `aggregate --constrainedBy--> rule` |
| `actor` | `command --performedBy--> actor` (or `query --performedBy--> actor`) |
| `policy` | `event --triggers--> policy --enacts--> command` (both edges required; see Policy Pattern) |

### Cross-aggregate references

Aggregates reference other aggregates **by id only**, never by holding a direct reference (Vernon IDDD "Reference Other Aggregates by Identity"). The cross-link goes through `aggregate --dependsOn--> aggregate`.

Event-driven cross-aggregate flow takes one of two shapes:

- **Direct**: `event (in agg A) --triggers--> command (in agg B)` when the reaction is a single synchronous command with no name worth keeping.
- **Via policy**: when the reaction deserves a name (delayed, scheduled, cross-aggregate orchestration), materialise a `policy` node — see below.

### `contains` is for aggregates only

`boundedContext --contains--> X` is **only** valid when `X` is an aggregate. Commands / queries / events / rules already reach their bounded context transitively through `accepts` / `emits` / `constrainedBy` from the aggregate. The `StructuralValidator` rejects `contains` to non-aggregates, and the graph view hubs-and-spokes ugly if you bypass.

## Policy Pattern

A policy materialises Vernon's Process Manager (also EventStorming's purple sticky). The pattern is **"when event X happens, do Y"**.

Emit a policy when the source describes an automatic reaction with a name worth keeping in the graph, especially when:

- The reaction crosses aggregates (event in aggregate A triggers a command in aggregate B).
- The reaction is delayed or scheduled (e.g. "after N days").
- The reaction has its own configuration or conditions.

Shape: `event --triggers--> policy --enacts--> command`. A policy without both edges is incomplete.

**Skip the policy** when the reaction is a single synchronous command on the same aggregate that emitted the event. That's `event --triggers--> command` directly; policy is for reactions that deserve their own name.

**`policy` vs `rule`**: a rule is "this must always be true" (a constraint, checked by `constrainedBy`); a policy is "when this happens, do that" (a reaction, wired via `triggers`+`enacts`).

## Context Mapping (Strategic Edges)

Seven strategic edges describe BoundedContext-to-BoundedContext relationships (Evans Blue Book Part IV): `partnership`, `customerSupplier`, `conformist`, `sharedKernel`, `anticorruptionLayer`, `openHostService`, `publishedLanguage`. Direction, symmetry, and semantics are in each `EdgeTypeDescriptor.description` from the ontology fetch capability.

They reflect team structure, organisational politics, and integration architecture — **not** derivable from a single feature slice. **Do not auto-emit them from per-slice extraction.** If the source signals one (a third-party dependency, two contexts described as coupled in release planning, …), raise a `ClarifyTicket` asking the architect to confirm the mapping type. Let the human pick.

## ID Conventions

Node and edge ids are minted by the skill following the ontology-style dotted convention. The `id` is a hint for humans; the contract is `type`.

| Concept | Prefix | Example |
|---|---|---|
| Bounded context | `ctx.` | `ctx.checkout` |
| Aggregate | `agg.` | `agg.order` |
| Command | `cmd.` | `cmd.placeOrder` |
| Query | `qry.` | `qry.recentOrders` |
| Event | `evt.` | `evt.orderPlaced` |
| Rule | `rule.` | `rule.maxLineItems` |
| Actor | `actor.` | `actor.buyer` |
| Policy | `policy.` | `policy.notifyShipping` |
| Edge | `edge.<slug>` | `edge.ctx-checkout-agg-order` |

## Description Authoring (Per Type)

`description` is markdown (see `content-conventions.md`); aim for several short paragraphs that convey causality, not just identity. The table below lists *topics* each type should address — pick the ones the source grounds, skip the rest, never invent.

| Type | Topics the description should address |
|---|---|
| `boundedContext` | The subsystem's purpose; its ubiquitous language (a few key terms); the consistency boundary (what's in, what's out); contexts it integrates with and how. |
| `aggregate` | The root entity; the key invariants it enforces; the external way to reference instances (by id only); typical lifecycle (creation → terminal states). |
| `command` | What state change it requests; who typically issues it (actor); preconditions; expected event(s); failure modes worth knowing about. |
| `query` | What state it returns; the consumer (UI / API / report); whether it's a strict CQRS read-model or a read-through-aggregate; freshness expectations. |
| `event` | The fact it records; *when* in the lifecycle it's emitted; downstream reactions worth knowing about; whether it's a domain event or integration event. |
| `rule` | What must hold; *why* (the business reason, not just the constraint); how violation surfaces (error code, message); whether per-operation or aggregate-wide. |
| `actor` | The role's responsibility; the commands / queries the actor typically issues; whether human or system; any permission / scope it implies. |
| `policy` | The reaction's trigger; what it does; conditions or delays; whether the reaction is best-effort or guaranteed. |

Recommended skeleton (not a template — adapt freely):

1. **What it is** — one paragraph identifying the node in its own terms.
2. **Why it exists** — the business / domain reason, not just "the spec says so".
3. **How it connects** — preconditions, triggers, downstream effects, neighbouring nodes a reader should look at.
4. **Caveats** — failure modes, edge cases, things the source explicitly excluded.

Skip any of these the source doesn't ground. A trivial event might be one line; a strategically-critical aggregate might use all four sections.

## Where This Doc Sits in the Architecture

This file is shipped by `@braidhq/ontology-ddd` via its `Plugin.referenceDirs[]`. The runner symlinks it into every spawned skill session under `<session>/.claude/skills/ontology-ddd/`. Any DDD-resident skill consults it; non-DDD ontologies would ship their own equivalent under their own plugin name.

When the DDD ontology evolves (new types, new wiring rules, refined ID conventions), update this file and the corresponding `NodeTypeDescriptor.description` / `EdgeTypeDescriptor.description` in `DDDOntology.ts` together. The descriptors are the runtime contract; this doc is the prose explanation.
