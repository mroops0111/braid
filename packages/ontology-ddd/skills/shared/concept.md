# DDD Ontology Concept

The shared concept document for `@braidhq/ontology-ddd`. Every DDD-resident skill (`ddd:extract`, `ddd:clarify`, `ddd:reconcile`) consults this file before authoring nodes / edges, so the vocabulary, wiring rules, and authoring conventions live in one place instead of being duplicated in each Procedure.

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
- **Via policy**: when the reaction deserves a name (delayed, scheduled, cross-aggregate orchestration), materialise a `policy` node (see below).

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

They reflect team structure, organisational politics, and integration architecture, and are **not** derivable from a single feature slice. **Do not auto-emit them from per-slice extraction.** If the source signals one (a third-party dependency, two contexts described as coupled in release planning, etc.), raise a `ClarifyTicket` asking the architect to confirm the mapping type. Let the human pick.

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

`description` is markdown (see `content-conventions.md`); aim for several short paragraphs that convey causality, not just identity. The table below lists *topics* each type should address; pick the ones the source grounds, skip the rest, never invent.

| Type | Topics the description should address |
|---|---|
| `boundedContext` | **Lead with a `Problem` section: the slice of the domain reality this model addresses (Evans's problem space).** What part of the business this subsystem owns; the few key terms the domain team uses (in their own words), with the meaning each carries *here*; what falls outside it; the neighbouring subsystems it talks to and how. |
| `aggregate` | The main thing being managed (e.g. an order, a contract, a user account); the rules that always hold about it; how the rest of the system refers to it; its lifecycle from creation to terminal state. |
| `command` | What change the user / system is asking for; who issues it; what must be true before it runs; what happens as a result; how it can fail. |
| `query` | What the caller wants to see; who calls it (UI screen, report, API client); whether the answer is real-time or can be slightly stale. |
| `event` | What just happened (past tense fact); when in the flow it fires; who reacts to it; whether it stays inside the subsystem or crosses to others. |
| `rule` | What must be true; **why the business cares** (the consequence of violating it, not just the constraint); how violation is surfaced to the user; whether it applies to one operation or the whole entity. |
| `actor` | The role's job in the product; what the role typically does in this area; whether it's a person or a system; any scope / permission the role implies. |
| `policy` | What happens automatically and what triggers it; conditions or delays; whether the reaction is guaranteed or best-effort. |

**Translate, don't transliterate.** The description is read by domain experts and PMs, not DDD practitioners. Don't paste DDD terms ("aggregate root", "consistency boundary", "ubiquitous language", "value object", "anticorruption layer", "process manager") into the rendered text. Describe the *concept* in the domain's own words. The DDD framing belongs in the graph topology (edges, types) and in this concept doc; the user-facing string is product language.

**Strip code jargon too.** The same rule extends to code-side vocabulary: class names, table names, function names, repository ids, route paths, decorators, framework concepts (`Entity`, `Repository`, `Service`, `Controller`, `DAO`, `DTO`, `Saga`). Use the business term the team would say in a meeting. When a code identifier is genuinely the clearest cross-team reference (a public command name a partner team also speaks, an event whose code name shows up in dashboards), put the business term first and the code identifier in parentheses, like `建立訂單 (CreateOrder)` or `Notify Shipping (NotifyShippingPolicy)`. Use the parenthetical sparingly: one or two per description, not every noun. If the description ends up reading like a class diagram in prose, rewrite it.

Recommended skeleton (not a template; adapt freely):

1. **What it is**: one paragraph identifying the node in domain terms.
2. **Why it exists**: the business reason, not "the spec says so".
3. **How it connects**: what triggers it, what it triggers, what neighbours matter. Use a bullet list, table, or mermaid diagram for multi-item or flow content; see `content-conventions.md` § `node.description`.
4. **Caveats**: failure modes, edge cases, things the source explicitly excluded.

Skip any of these the source doesn't ground. A trivial event might be one line; a strategically-critical aggregate might use all four sections.

## ClarifyTickets: Reviewer Pool and Vocabulary

`ddd:extract` and `ddd:reconcile` emit ClarifyTickets when an extraction or global-pass decision is genuinely ambiguous. For DDD workspaces, the reviewer pool that answers those tickets is the **cross-functional team that owns the domain**: PM, RD, QA, designer, and anyone whose work touches the affected concept. Engineers can read graph topology; the others cannot, and the workflow is broken when they cannot answer.

Two rules apply to the ticket's `question` and each `candidate.description` (the fields the reviewer reads):

1. **Audience is the domain team, not the skill author.** The question and each candidate must be grokkable by a reviewer who knows the product but not the graph. If a PM cannot pick a candidate without asking an engineer to translate, rewrite.

2. **Translate, don't transliterate.** Same rule the node `description` field carries (see § Per-Type Description Aspects). Do not paste DDD vocabulary (`aggregate`, `emit`, `contains`, `performedBy edge`, "sibling commands") or code identifiers (`cmd.ingestSource`, `IntentExtractionLedger`) into the question or candidates. Use the term the team would say in a meeting. When a code-side name is the clearest cross-team reference, put the domain term first and the identifier in parentheses, sparingly. If the question reads like a graph walk in prose, rewrite it.

The ticket's `context` field has no audience constraint and is the right place for the engineering reasoning: which nodes were inconsistent, which sibling-coverage pattern triggered the question, which graph operations each candidate would run.

Worked contrast (same underlying ambiguity, two ways of writing it):

| Field | Wrong (graph walk in prose) | Right (domain language) |
|---|---|---|
| `question` | "Does `cmd.ingestSource` emit `evt.sourceSynced` so the reactor picks up a first full load?" | "After the framework first connects to a new source, should the next extraction start automatically, or should a person trigger it?" |
| `candidate.description` | "Add an emits edge from Ingest Source to Source Synced" | "Treat the first connect like every later refresh: extract automatically." |
| `context` | (engineering reasoning belongs here) | "cmd.ingestSource currently has no emits edge; cmd.syncSource emits evt.sourceSynced; the reactor reacts only to source.synced." |

## Where This Doc Sits in the Architecture

This file is shipped by `@braidhq/ontology-ddd` via its `Plugin.referenceDirs[]`. The runner symlinks it into every spawned skill session under `<session>/.claude/skills/ontology-ddd/`. Any DDD-resident skill consults it; non-DDD ontologies would ship their own equivalent under their own plugin name.

When the DDD ontology evolves (new types, new wiring rules, refined ID conventions), update this file and the corresponding `NodeTypeDescriptor.description` / `EdgeTypeDescriptor.description` in `DDDOntology.ts` together. The descriptors are the runtime contract; this doc is the prose explanation.
