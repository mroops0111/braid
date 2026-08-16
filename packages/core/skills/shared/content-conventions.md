# Content Conventions

How to write the human-facing string fields a skill produces. These rules apply across every ontology; ontology-specific aspects (what to address in a given node type's description, etc.) live in the active ontology's `concept.md`.

Hard caps (min / max lengths, single-line regex) live in the MCP tool `inputSchema` each capability exposes; the agent sees them at call time and the server rejects violations. This document is the **soft recipe** schema can't express: target lengths, tone, structure, language policy, and rules like "first paragraph is prose" that need prose to describe.

## Common Rules (All Fields)

- **Plain text** is the default for every field **except `node.description`**, which allows markdown. Plain-text fields render verbatim; markdown leaks as raw `**` / `#` characters there.
- **No code identifiers in prose** (file paths, line numbers, type ids). Those go in `metadata.sourceReferences` or in lower / engineering output sections, never in the human-facing string itself.
- **No newlines** unless the field's spec explicitly allows multiple paragraphs (currently only `node.description`).
- **No leading / trailing whitespace.**

## Language Policy

Every string field follows the language of the **source it was extracted from** (whatever document, spec, or code comment grounded the node). If that source is written in 中文, names and descriptions are 中文 first. Mixed-language workspaces are normal; per-node language follows per-node source.

## Per-Field Rules

### `node.name`

- **Format**: human-facing display string. Distinct from `id`, which is an opaque identifier (e.g. `id = create-order`, `name = Create Order` or `建立訂單`).
- **Length**: aim for ≤ 60 including any bilingual suffix.
- **Style**: match a code identifier when one clearly maps to the node, otherwise use a descriptive title or a noun phrase. Per-type naming specifics (which types mirror a code identifier, which read as a title) are the active ontology's opinion; its `concept.md` spells them out.
- **Bilingual suffix (optional)**: when the workspace is multilingual, the name follows its source's language and may carry the alternate language in parentheses (half-width `()` or full-width `（）` both accepted):
  - Source in English, readers expect 中文: `Create Order (建立訂單)`
  - Source in 中文, readers expect English: `建立訂單 (Create Order)`
  - Skip the suffix when the name is already an identifier the reader will recognise either way.

### `node.description`

- **Format**: **markdown allowed**. Multiple short paragraphs encouraged. Inline `code`, bold for emphasis, lists, tables, and fenced code (including ```` ```mermaid ```` diagrams) are all fine. Headings (`#`, `##`) are discouraged since the field already lives under a section header in the UI.
- **First paragraph is always prose**. The very first block must be a plain paragraph (no heading, no list, no blockquote, no fenced code). The Graph view card uses the first paragraph as its preview; non-prose openings render badly in the 200px card. Subsequent blocks can be any markdown.
- **Prefer structure over run-on prose** when the content has structure:
  - **Enumerations** (preconditions, side effects, allowed values, related nodes): use a bullet list or table. Don't pack 5 items into a comma-separated sentence.
  - **State transitions** (e.g. the chain `draft`, `submitted`, `approved`, `archived`): use a mermaid `stateDiagram-v2` or a 3-column table (`from | event | to`).
  - **Flows / orchestration** (event-driven sagas, multi-step processes): use a mermaid `sequenceDiagram` or `flowchart`.
  - **Comparisons** (this concept vs that concept): use a 2-column table.
  - Prose only when the point genuinely flows as one thought.
- **Length**: aim for the **shortest text that lets a reader without the source understand this node**. Typically 2-5 short paragraphs (or a list / table / diagram plus a sentence) for non-trivial nodes; a single line is fine for terminal commands / events.
- **Content goal**: convey *causality*, not just identity. A reader should be able to answer "what is this, why does it exist, what does it interact with, what would break if I remove it" from the description alone. The type's `NodeTypeDescriptor.description` already names the *kind*; this field describes the *instance*.
- **Per-type aspects**: each ontology's `concept.md` lists the *topics* to cover per type (a type's purpose, its boundaries, how it connects). Treat the list as **topics to address**, not a template; pick the topics the source actually grounds; don't invent.
- **Don't repeat the type**. Don't open with "This is a bounded context that…"; open with the subject.
- **No newline-padding tricks**. Two newlines for paragraph break, one for line break inside a list item. Don't add blank lines just to inflate the description.

### `edge.metadata.sourceReferences[].location.anchor`

- **Format**: short slug or section heading, plain text.
- **Length**: ≤ 80 chars typical.

### `proposal.rationale`

- **Format**: one paragraph plain text.
- **Length**: aim for 1-5 sentences, ≤ 500 chars.
- **Structure**: three beats in this order:
  1. **What** changed (1 clause, e.g. "Added one subsystem with 3 operations and 2 events").
  2. **Why** (the trigger: name the sources it was derived from, e.g. "from the checkout spec and its handler directory").
  3. **Scope hint** (anything noteworthy about what was deliberately *excluded*, e.g. "reactions deferred to a follow-up pass").

### `clarify.question`

- **Format**: a single question sentence ending with `?`.
- **Length**: aim for ≤ 200.
- **Audience**: the reviewer pool the **active ontology** serves, not the skill author. The ontology's own `concept.md` names that pool explicitly and shows what the right vocabulary looks like for that ontology; consult it before writing.
- **Translate, don't transliterate**: same principle as `node.description`. The question reads in the active ontology's ubiquitous language. Do not paste the ontology's own graph vocabulary (its node and edge type ids, the names of its structural relationships) or any code-side identifier (file path, class name, route, framework concept) into the question; the active ontology's `concept.md` enumerates which terms its reviewers will and will not recognise, and shows the parenthetical convention when a code-side name is genuinely the clearest cross-team reference. Lower graph topology, exact node ids, and the engineering reasoning into the ticket's `context` field instead, which has no audience constraint and is the right place for skill-author notes.
- **Style**: name both candidate readings in the question itself, in the ontology's vocabulary, so a reviewer can grok the alternatives from the question alone.

### `clarify candidate.description`

- **Format**: one-line plain text.
- **Length**: aim for ≤ 100.
- **Audience**: same as `clarify.question`. The reviewer is picking between domain outcomes, not GraphOperations.
- **Translate, don't transliterate**: same principle as `clarify.question`. The candidate describes the outcome the reviewer will pick in the active ontology's vocabulary, not the operations behind it.
- **Style**: imperative or declarative, fitting the answer.

### `DriftIssue.description`

Already specified by `drift-detection.md` (pattern: `{source A} {says X}, {source B} {does Y}. {one-line consequence}.`). Plain text, no markdown. Cite both sources concretely.

