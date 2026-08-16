---
name: scan
description: Decompose a codebase into business units when no intent docs exist. One-shot bootstrap helper consumed by the batch orchestrator; the units it writes back are fed unit-by-unit into ddd:extract.
argument-hint: ""
disable-model-invocation: true
braid:
  category: build
  order: 50
  summary: Scan a codebase and produce extraction units
  required-env: [BRAID_WORKSPACE, BRAID_WORKSPACE_ID, BRAID_SHARED_REFERENCE]
  hidden: true
---

## Role

You analyse a codebase's overall structure and split it into independent **business units** that the batch orchestrator will feed one-by-one into `ddd:extract`. You do NOT extract entities, do NOT submit proposals, do NOT submit clarifications. You only plan the cut.

This skill runs once when bootstrapping a workspace that has no intent docs (only codebases). The orchestrator created `artifacts/batch-plan.json` with `status: 'deriving'` and an empty `units` array before invoking you; your job is to populate `units` and return.

## Design Principles

| Principle | Why |
|---|---|
| Broad scan, not deep dive | Skim each codebase's structure; do not read every file. Reasoning about business logic is extract's job, not yours. |
| Semantically meaningful units | A unit is a business area (orders, payments, notifications, …), not an arbitrary file slice. |
| Right-sized units | Each unit must fit inside one extract session. Split huge codebases into several units. |
| Overlap is acceptable | Two units may share supporting concepts. Extract's deduplication handles cross-references. |
| Terse descriptions | A unit's `description` names the area and points at the relevant code paths. Aggregates, roles, and states are extract's vocabulary, not yours. |

## Initialization

1. Read `$BRAID_WORKSPACE/PRODUCT.md` to discover the `role: code` sources and their `path` fields. Skip any `role: intent` sources.
2. Verify the Knowledge Graph is empty via the `braid-core` MCP server. If non-empty, exit non-zero with a clear error. Scan is for empty graphs only.
3. Read `$BRAID_WORKSPACE/artifacts/batch-plan.json` and confirm `plan.status === 'deriving'` per `$BRAID_SHARED_REFERENCE/batch-plan.md`.

## Procedure

1. Walk each `role: code` source at `$BRAID_WORKSPACE/<path>` with Read / Grep / Glob. Look at the top-level layout: entry points, top-level modules, routing tables. Do not enter individual feature files unless the top-level layout demands it.
2. Decide unit boundaries. Aim for a handful per codebase. What a DDD unit carries:
   - `name`: business area name.
   - `description`: 1-3 sentences naming the area and the code paths (file globs or directory prefixes) extract should consult first.

   The full required unit shape and the remaining fields live in `$BRAID_SHARED_REFERENCE/batch-plan.md`.

## Output

Rewrite `$BRAID_WORKSPACE/artifacts/batch-plan.json` per the write contract in `$BRAID_SHARED_REFERENCE/batch-plan.md`: replace only the `units` array, leave every other field untouched, and write atomically. That doc is the single source of truth for the plan-file mechanics.

## Completion Checklist

- [ ] PRODUCT.md was read; `role: code` sources identified.
- [ ] Graph emptiness was verified via the MCP server.
- [ ] batch-plan.json was read; status was confirmed `deriving`.
- [ ] Each code source contributed one or more units.
- [ ] Every unit carries id / name / description / status / proposalIds / clarificationIds.
- [ ] batch-plan.json was rewritten atomically, with the `units` array replaced and other fields untouched.
- [ ] Exit code 0.

## Companion Docs

| File | When to Read | Why |
|---|---|---|
| `$BRAID_SHARED_REFERENCE/batch-plan.md` | Initialization step 3 and Output | The plan-file write contract: preconditions, the required unit shape, which fields to leave untouched, and the atomic-write rule. |

The downstream `ddd:extract` skill owns its own companion docs (ontology-specific shared/*.md files) when it picks up the unit.
