# Drift Detection

When two sources for the same concept disagree, that disagreement is **drift**. This file is the framework contract for recording drift as a structured `DriftIssue` so the graph carries the signal forward; the proposal review pane and the apply-gate consume it automatically.

It names no source role. Which roles a workspace has, and what they mean, comes from the injected role list (`$BRAID_SOURCE_ROLES`); compare whatever sources a node actually cites. An ontology may ship worked, domain-specific examples in its own reference doc.

Drift is observed, not invented. If you can't point at two specific sources that disagree, you don't have drift. You have a question, and that belongs in a `Clarification`.

---

## When to Look

Compare two sources whenever a node has evidence from both. Two comparison shapes, framed by the node's source roles:

| Comparison | Setup |
|---|---|
| **Cross-role** | The node cites two sources of different roles (e.g. a source that specifies against one that realises). The most common case. |
| **Intra-role** | The node cites two sources of the same role (e.g. two layers of one source, or two overlapping documents). |

Drift is local to one node. Every `DriftIssue` belongs in that node's `metadata.driftIssues`.

---

## What to Compare (Dimensions)

Use this taxonomy as a checklist when reading the two sources. Cover the dimensions the sources actually have content on; skip the rest. Don't force every node into every dimension.

| Dimension | Look for | Example finding |
|---|---|---|
| `existence` | One source describes a concept the other doesn't mention | "One source defines an operation the other never realises" |
| `terminology` | Same concept, different name; or same name, different concept | "One source's name for a concept quietly covers a second case the other keeps separate" |
| `sequence` | Order of steps in a flow | "One source validates then commits; the other commits first" |
| `params` | Input / output field set | "One source lists 8 fields; the other accepts 10" |
| `states` | Enumerated states / status machine | "One source names 5 states; the other has 6" |
| `rules` | Rules / validation thresholds | "One source caps a quantity at 50; the other allows 99" |
| `permissions` | Role / actor / authorisation checks | "One source allows a single actor; the other also requires an admin" |
| `limits` | Numeric caps that differ across sources | "One source sets no cap; the other hardcodes a maximum" |
| `api-contract` | Wire format between a producer and a consumer | "A caller sends a field the receiver never reads" |
| `errors` | Error code coverage | "A producer returns an error the consumer has no handling for" |
| `feature-coverage` | One source ships a capability the other lacks | "One source exposes an action the other has no counterpart for" |

These are guidance, not enum values; the schema doesn't enforce them. Pick whichever fits the finding; if none fits, write the finding anyway with the best fit.

---

## What Is NOT Drift

Don't raise a `DriftIssue` for:

- Style differences (camelCase vs snake_case, one natural language vs another). Names mean the same thing.
- High-level description vs low-level detail (one source says "compute the total", the other spells out the arithmetic; that's expected, not drift).
- A role missing at the *whole-node* level (only some roles have evidence so far): that's already covered by `metadata.missingRoles` on the node. Use `DriftIssue` for field-level drift on a shared concept.
- Vague suspicions ("I think these might differ but couldn't verify"). Either confirm with a specific cite or skip. Drift is structured evidence, not impressions.

If the disagreement makes you unsure which concept these even *are* (two candidates that might be the same, might be distinct), you don't have field-level drift; you have an identity question. Emit a `Clarification`, not a `DriftIssue`.

---

## How to Write `description`

The description goes straight to a human reviewer. It must:

1. Name the left source and what it says.
2. Name the right source and what it does.
3. Convey business impact in one short sentence.

**Pattern:**
> `{source A} {says X}, {source B} {does Y}. {one-line consequence}.`

**Good example:**

> Source A (the specification) caps line items at 50; source B (the implementation) allows up to 99. Extra line items currently fail silently downstream.

**Avoid:**

- "Symbol name mismatch." (abstract metadata, no business meaning)
- "Drift detected on params." (taxonomy without specifics)
- "The two sources don't match." (no cite, no impact)

---

## Severity

Three values. Default rule of thumb:

| Situation | Severity |
|---|---|
| Both sources describe the concept and the descriptions actively contradict | `error` |
| One side has a detail the other lacks (no contradiction, just incomplete) | `warning` |
| Cosmetic / informational divergence worth recording but not actionable | `info` |

`error` blocks proposal apply via `EvidenceValidator`. Use it for contradictions that will cause a defect if left alone (limit mismatches, permission gaps, contract breaks). Use `warning` for "fix this when convenient" cases (terminology drift, missing-but-implied behaviour).

If you find drift across multiple dimensions for one node, emit one `DriftIssue` per dimension. Don't bundle them into a single description. The reviewer triages each independently.

---

## JSON Shape

`DriftIssue` lives on a node's `metadata.driftIssues[]`. You attach it when emitting an `addNode` or `updateNode` GraphOperation. The server mints no fields here; you provide everything:

```json
{
  "id": "drift-{shortRandom}",
  "description": "Source A caps line items at 50; source B allows up to 99.",
  "severity": "error",
  "sourceReferences": [
    { "sourceId": "src-a", "location": { "uri": "spec.md", "anchor": "Limits" } },
    { "sourceId": "src-b", "location": { "uri": "impl.ext", "startLine": 14 } }
  ],
  "raisedAt": "2026-05-24T10:15:00+08:00"
}
```

Schema rules:

- `sourceReferences` MUST have at least 2 entries (drift by definition compares two sources). The order is `left, right`, but the description names the sources by file, so order is informational.
- `description` is plain text, no markdown.
- `severity` is one of `error` / `warning` / `info`.
- `id` is yours to mint. Any non-empty string works; the server doesn't reuse it across builds. A short random suffix is fine.
- `raisedAt` is an ISO timestamp with offset.

Attach via `metadata.driftIssues[]` on an `addNode` or `updateNode` payload (see `proposal-format.md` for the surrounding shape). On `updateNode`, the patch fully replaces the array; drift is re-derived each build, not appended. Leave a previously-recorded drift out of the next patch to let apply clear it.

---

## What Happens After You Write One

- `EvidenceValidator` surfaces each entry as a `ValidationIssue` (code `evidence.drift`) on the proposal review pane; severity is preserved.
- `error`-severity entries block Apply until resolved (raised, fixed, or acknowledged).
- The human can suppress a specific drift by adding its `description` string to `node.metadata.acknowledgedDrifts[]`. You **do not** set this field yourself. It's a human acknowledgement, not a skill observation.
- Status `unclear` on the node is the conventional signal that the node has unresolved drift. Set it on `updateNode` patches when you raise an `error` drift on a previously `draft` node.

---

## Quick Checklist

Before attaching a `DriftIssue`:

- [ ] Two specific source citations (file + line / anchor)
- [ ] Description names both sides and the impact in one sentence
- [ ] Severity matches the contradiction-vs-gap distinction above
- [ ] Not duplicating a `missingRoles` entry at the whole-node level
- [ ] If multiple dimensions disagree, one `DriftIssue` per dimension
