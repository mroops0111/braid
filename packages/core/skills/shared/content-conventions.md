# Content Conventions

How to write the human-facing string fields a skill produces. These rules apply across every ontology; ontology-specific aspects (what to address in a `boundedContext` description, etc.) live in the active ontology's `concept.md`.

Hard caps (min / max lengths, single-line regex) live in the MCP tool `inputSchema` each capability exposes — the agent sees them at call time and the server rejects violations. This document is the **soft recipe** schema can't express: target lengths, tone, structure, language policy, and rules like "first paragraph is prose" that need prose to describe.

## Common Rules (All Fields)

- **Plain text** is the default for every field **except `node.description`**, which allows markdown. Plain-text fields render verbatim; markdown leaks as raw `**` / `#` characters there.
- **No code identifiers in prose** (file paths, line numbers, type ids). Those go in `metadata.sourceReferences` or in lower / engineering output sections, never in the human-facing string itself.
- **No newlines** unless the field's spec explicitly allows multiple paragraphs (currently only `node.description`).
- **No leading / trailing whitespace.**

## Language Policy

Every string field follows the language of its **source intent** (the PRD / spec / code comment the node was extracted from). If the workspace's intent is written in 中文, names and descriptions are 中文 first. Mixed-language workspaces are normal; per-node language follows per-node source.

## Per-Field Rules

### `node.name`

- **Format**: human-facing display string. Distinct from `id` (`id = cmd.createOrder`, `name = Create Order` or `建立訂單`).
- **Length**: aim for ≤ 60 including any bilingual suffix.
- **Style**:
  - `command`, `query`, `event`: match the code identifier when there's a clear mapping (`CreateOrder`, `OrderPlaced`).
  - `boundedContext`, `aggregate`, `actor`: descriptive title (`Order Checkout`, `Order`, `Buyer`).
  - `rule`, `policy`: noun phrase that reads as the invariant or reaction (`Max Line Items`, `Notify Shipping`).
- **Bilingual suffix (optional)**: when the workspace is multilingual, the name follows the source intent's language and may carry the alternate language in parentheses (half-width `()` or full-width `（）` both accepted):
  - Intent in English, team reads 中文: `Create Order (建立訂單)`
  - Intent in 中文, code in English: `建立訂單 (CreateOrder)`
  - Skip the suffix when the name is already a code identifier the reader will recognise either way.

### `node.description`

- **Format**: **markdown allowed**. Multiple short paragraphs encouraged. Inline `code`, bold for emphasis, and lists are fine. Headings (`#`, `##`) are discouraged since the field already lives under a section header in the UI.
- **First paragraph is always prose**. The very first block must be a plain paragraph — no heading, no list, no blockquote, no fenced code. The Graph view card uses the first paragraph as its preview; non-prose openings render badly in the 200px card. Subsequent blocks can be any markdown.
- **Length**: aim for the **shortest text that lets a reader without the source understand this node** — typically 2-5 short paragraphs for non-trivial nodes; a single line is fine for terminal commands / events.
- **Content goal**: convey *causality*, not just identity. A reader should be able to answer "what is this, why does it exist, what does it interact with, what would break if I remove it" from the description alone. The type's `NodeTypeDescriptor.description` already names the *kind*; this field describes the *instance*.
- **Per-type aspects**: each ontology's `concept.md` lists the *topics* to cover per type (e.g. `boundedContext` should describe its purpose, ubiquitous language, integration boundaries). Treat the list as **topics to address**, not a template — pick the topics the source actually grounds; don't invent.
- **Don't repeat the type**. Don't open with "This is a bounded context that…"; open with the subject.
- **No newline-padding tricks**. Two newlines for paragraph break, one for line break inside a list item. Don't add blank lines just to inflate the description.

### `edge.metadata.sourceReferences[].location.anchor`

- **Format**: short slug or section heading, plain text.
- **Length**: ≤ 80 chars typical.

### `proposal.rationale`

- **Format**: one paragraph plain text.
- **Length**: aim for 1-5 sentences, ≤ 500 chars.
- **Structure**: three beats in this order:
  1. **What** changed (1 clause, e.g. "Extracted ctx.checkout with 3 commands, 2 events").
  2. **Why** (the trigger: "from intent/checkout.md + apps/api/checkout/").
  3. **Scope hint** (anything noteworthy about what was deliberately *excluded*, e.g. "policies deferred to a follow-up extract").

### `clarify.question`

- **Format**: a single question sentence ending with `?`.
- **Length**: aim for ≤ 200.
- **Style**: name both candidate readings in the question itself ("Are `cancelOrder` and `revokeOrder` aliases for the same command, or two distinct commands?"). A reviewer should grok the alternatives from the question alone.

### `clarify candidate.description`

- **Format**: one-line plain text.
- **Length**: aim for ≤ 100.
- **Style**: imperative or declarative, fitting the answer ("Merge as aliases" / "Treat as distinct" / "Defer to architect").

### `DriftIssue.description`

Already specified by `drift-detection.md` (pattern: `{source A} {says X}, {source B} {does Y}. {one-line consequence}.`). Plain text, no markdown. Cite both sources concretely.

