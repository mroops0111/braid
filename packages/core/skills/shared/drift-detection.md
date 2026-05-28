# Drift Detection

When you read more than one source for the same concept (intent file + code, two intent files, two code layers), the sources can disagree. That disagreement is **drift**. This file tells you when to emit a structured `DriftIssue` so the graph carries that signal forward; the proposal review pane and the apply-gate consume it automatically.

Drift is observed, not invented. If you can't point at two specific sources that disagree, you don't have drift. You have a question, and that belongs in a `ClarifyTicket`.

---

## When to Look

You compare two sources whenever a node has evidence from both. Three comparison shapes:

| Comparison | Typical setup |
|---|---|
| **intent vs code** | Node has both an intent ref (under `intent/`) and a code ref. The most common case. |
| **code vs code** | Multi-layer codebases: backend handler vs frontend client, controller vs service, etc. |
| **intent vs intent** | Multiple intent files describe the same concept (e.g. two PRDs that overlap). |

Drift is local to one node. Every `DriftIssue` belongs in that node's `metadata.driftIssues`.

---

## What to Compare (Dimensions)

Use this taxonomy as a checklist when reading the two sources. Cover the dimensions that the sources actually have content on; skip the rest. Don't force every node into every dimension.

| Dimension | Look for | Example finding |
|---|---|---|
| `existence` | One source describes a concept the other doesn't mention | "Intent describes `cancelOrder` command; no implementation found in `apps/api/order/`" |
| `terminology` | Same concept, different name; or same name, different concept | "Intent calls them `buyers`, code uses `customer` (which also covers anonymous guests)" |
| `sequence` | Order of steps in a flow | "Intent: validate quota then debit. Code: debits first, then validates quota at `order.service.ts:88`" |
| `params` | Input / output field set | "Intent lists 8 field types for line items; code accepts 10 (extras: `currency`, `regex`)" |
| `states` | Enumerated states / status machine | "Intent: 5 order states. Code enum has 6 (extra: `archived`)" |
| `rules` | Business rules / validation thresholds | "Intent: max 50 line items per order. Code: `<= 99` at `validator.ts:14`" |
| `permissions` | Role / actor / authorisation checks | "Intent: only `buyer` can cancel. Code also requires `org.admin` at `policy.ts:31`" |
| `limits` | Numeric caps that differ across layers (code-vs-code) | "Backend `approval_step` has no cap (-1); frontend hardcodes `max=99`" |
| `api-contract` | Wire format between layers | "Frontend POSTs `{ couponCode }`; backend handler doesn't read it" |
| `errors` | Error code coverage | "Backend returns `quota_exceeded`; frontend has no matching message" |
| `feature-coverage` | One layer ships a feature the other lacks | "Frontend has 'share order' UI; backend has no endpoint" |

These are guidance, not enum values; the schema doesn't enforce them. Pick whichever fits the finding; if none fits, write the finding anyway with the best fit.

---

## What Is NOT Drift

Don't raise a `DriftIssue` for:

- Style differences (camelCase vs snake_case, English vs Chinese phrasing). Names mean the same thing.
- High-level intent vs low-level implementation detail (intent says "compute total price", code has 12 lines of arithmetic; that's expected, not drift).
- Code-only or intent-only existence at the *whole-node* level: that's already covered by `metadata.intentMissing` / `metadata.implementationMissing` flags on the node. Use `DriftIssue` for field-level drift on a shared concept.
- Vague suspicions ("I think these might differ but couldn't verify"). Either confirm with a specific cite or skip. Drift is structured evidence, not impressions.

If the disagreement makes you unsure which concept these even *are* (two different `cancelOrder` candidates? same? distinct?), you don't have field-level drift; you have an identity question. Emit a `ClarifyTicket`, not a `DriftIssue`.

---

## How to Write `description`

The description goes straight to a human reviewer. It must:

1. Name the left source and what it says.
2. Name the right source and what it does.
3. Convey business impact in one short sentence.

**Pattern:**
> `{source A} {says X}, {source B} {does Y}. {one-line consequence}.`

**Good example:**

> Intent (`intent/order.md` §"Quota") caps line items at 50; code at `apps/api/order/validator.ts:14` allows up to 99. Extra line items currently silently fail a downstream DB unique check.

**Avoid:**

- "Symbol name mismatch." (abstract metadata, no business meaning)
- "Drift detected on params." (taxonomy without specifics)
- "The intent and code don't match." (no cite, no impact)

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
  "description": "Intent (intent/order.md §Quota) caps line items at 50; code at apps/api/order/validator.ts:14 allows up to 99.",
  "severity": "error",
  "sourceReferences": [
    { "sourceId": "src-intent", "location": { "uri": "intent/order.md", "anchor": "Quota" } },
    { "sourceId": "src-code", "location": { "uri": "apps/api/order/validator.ts", "startLine": 14 } }
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
- [ ] Not duplicating an `intentMissing` / `implementationMissing` flag at the whole-node level
- [ ] If multiple dimensions disagree, one `DriftIssue` per dimension
