# Batch Plan Write Contract

The write contract for `artifacts/batch-plan.json`, the file the batch orchestrator hands to an ontology's `deriveUnits` skill. Framework mechanics owned by `@braidhq/core`: the plan schema is the same whatever ontology binds `deriveUnits`, so every derive skill follows this one document rather than restating the rules in its own prompt.

This doc covers only how to populate and rewrite the plan. What a unit *means* (how to cut a source into units, what a unit represents) is the ontology's own opinion and belongs in the derive skill's prompt.

## Preconditions

1. Read `$BRAID_WORKSPACE/artifacts/batch-plan.json`.
2. Confirm `plan.status === 'deriving'`. Refuse otherwise. The orchestrator owns every status flip; a plan not in `deriving` is not yours to write.

## What to Write

Replace **only** the `units` array. Leave every other field exactly as read:

`id`, `workspaceId`, `createdAt`, `updatedAt`, `mode`, `status`, `autoApply`, `baselineTag`.

The orchestrator handles status transitions and timestamps after the skill exits. Touching them corrupts its recovery on the `completed` event.

## Unit Shape

Each entry in `units` carries:

| Field | Value |
|---|---|
| `id` | Short opaque id matching `pu-<8 hex>`. Mint a fresh value per unit. |
| `name` | Unit name, 60 chars or fewer. |
| `description` | 1-3 sentences. The derive skill decides what goes here. |
| `status` | `'pending'` |
| `proposalIds` | `[]` |
| `clarificationIds` | `[]` |

## Atomic Write

Write with the tmp-file-then-rename pattern: write to `<path>.tmp-<pid>-<ts>`, then `mv` over the target. A partial write corrupts the plan and breaks the orchestrator's `completed`-event recovery.

Write no other file. Call no `braid-core` write capability. The plan is the only output.
