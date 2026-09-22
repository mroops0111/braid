# Proposal Format

How a skill decides what to put in a proposal. Every field of one, and what each is for, is in the MCP tool's `inputSchema`, so nothing about a field's shape or its allowed values is repeated here. What this doc covers:

- Which entry to lead `sourceReferences` with, which is a judgement no schema can make.
- What the server checks before it stores a proposal.

Which types and statuses exist comes from the active ontology. Pull the current set from the `braid-core` ontology-fetch capability, since `OntologyTypeValidator` rejects a value that is not in it. For the `DriftIssue` judgement rules, see `drift-detection.md`. For content rules (description length, name format, rationale structure), see `content-conventions.md`. For per-ontology id prefix conventions and per-type description aspects, see the active ontology's `concept.md` at `$BRAID_ONTOLOGY_REFERENCE/concept.md`. For the server-side validators that gate `createProposal`, see `validator-rules.md`.

## Evidence

`EvidenceValidator` (in `validator-rules.md`) requires *some* evidence on a node: at least one `sourceReferences` entry, or a non-empty `missingRoles`.

### Picking sourceReferences

A node usually has more than one place it could cite, spread across the workspace's declared source roles and often several files within one role. All of them are valid evidence, but order matters.

**Lead with the most representative entry for this node's type**: the file that most directly *defines* or *invokes* the thing the node names. Then list supporting refs in decreasing specificity. For example:

- A node naming a **definition** (a type, a model, a schema, an invariant): lead with the file holding the canonical declaration; UI bindings, consumers, and prose mentions follow.
- A node naming an **action** or **moment** (a request that changes state, an event emitted, a reaction): lead with the entry point that handles or emits it; supporting layers (validators, UI dispatchers, downstream subscribers) follow.
- A node naming a **role**: lead with where the role's identity / scope is defined; the places it's consumed follow.

Source role is **not** a fixed order. Lead with whichever role genuinely defines the node today: when only one role carries it, that role leads; when several align, lead with whichever is more concrete for that node's type. Apply the same principle inside one role too (e.g. a handler before its tests, a model before its migrations).

The order is consumed by Studio's detail panel and the document forms as "the link a reader should click first." Drift detection treats every entry equally regardless of order.

## Edges

`StructuralValidator` (in `validator-rules.md`) enforces that an edge's endpoints are types the ontology allows for that edge type, on both ends.

## Sizing

Split a slice that runs past the operation cap into several proposals rather than trimming the work. They share an `externalReferences` entry when they trace back to the same source.
