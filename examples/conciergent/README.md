# conciergent (Example)

A code-first workspace that Braid built from the [conciergent](https://github.com/mroops0111/conciergent) codebase, with no intent docs. Braid scanned the repository, split it into business units, and derived a Domain-Driven Design model that was reviewed as it landed.

## Contents

Three files, each a piece of the same result.

- **PRODUCT.md**: the source manifest. One `role: code` source (a git loader on the conciergent repo), the DDD ontology, and Kuzu storage. No intent source.
- **model.snapshot.json**: the derived model as `{ nodes, edges }`, 120 nodes and 159 edges. Node ids follow the ontology convention (`ctx.` bounded context, `agg.` aggregate, plus `cmd.`, `qry.`, `evt.`, `rule.`). Every node carries a plain-language `description` and `metadata.sourceReferences` pointing back at the code it was drawn from.
- **graph.png**: the model in Studio, filtered to bounded contexts and aggregates for a readable overview.

## Build Steps

Four steps, all run through Studio.

- A code-only workspace was created from PRODUCT.md.
- `braid:scan` split the codebase into 8 business units.
- `ddd:extract` ran per unit, and `ddd:reconcile` checkpointed the model.
- Every change landed as a reviewed proposal, applied automatically for this run.

The result is a model an engineer and a PM can both read, traced back to the code, with no hand-written docs.

## Model Shape

The 120 nodes break down by type.

- **Bounded Context**: 5
- **Aggregate**: 16
- **Command**: 26
- **Query**: 5
- **Domain Event**: 17
- **Business Rule**: 49
- **Actor**: 2
