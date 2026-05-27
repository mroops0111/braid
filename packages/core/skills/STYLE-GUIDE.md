# Skill style guide

> v1, 2026-05-26. The contract that `SkillStructureValidator` enforces.
> When this guide and the validator disagree, the validator wins; file a
> patch to this guide.

This document is for anyone authoring or refactoring a `SKILL.md` —
whether under `@braidhq/core/skills/`, inside an ontology / source-loader
plugin, or in a workspace's `.claude/skills/` directory.

Skills are Markdown prompts the spawned agent reads top-to-bottom. They
have two simultaneous audiences: the agent at run time, and a human
reviewing the prompt later. Both audiences benefit from the same
property — predictable structure — so we standardise it.

---

## 1. Where a skill lives

| Origin | Path | Who ships it | When |
|---|---|---|---|
| `builtin` | `packages/core/skills/<id>/SKILL.md` | `@braidhq/core` | The skill is ontology-agnostic. It uses ontology types only by reading `/ontology` at run time; it does not bake any ontology's vocabulary into its procedure. |
| `plugin` | `packages/<plugin-pkg>/skills/<id>/SKILL.md` | An ontology / source-loader plugin | The skill's procedure relies on a specific ontology's structural rules (e.g. DDD's "BoundedContext contains aggregate only"). The plugin declares the skill via `Plugin.skills: PluginSkillRef[]`. |
| `workspace` | `<workspace>/.claude/skills/<id>/SKILL.md` | The workspace itself | One-off skill for this product / team. Not reusable. |
| `extension` | `<workspace>/.claude/skill-extensions/<id>/EXTEND.md` | The workspace | Workspace-specific addendum to a `builtin` / `plugin` skill. Appended at run time after the base SKILL.md. |

Rule of thumb: **if the procedure names a specific ontology type id
(e.g. `aggregate`, `boundedContext`) outside a `$ref` to an ontology
response, the skill belongs in a plugin, not core.**

---

## 2. Frontmatter contract

A skill's frontmatter is split into two namespaces: top-level fields
the Claude Code CLI itself reads, and a `braid:` block for Braid's own
metadata. `SkillFrontmatter` (`packages/schema/src/skill.ts`) is the
zod source of truth; this section describes intent.

### Top-level (Claude Code CLI)

```yaml
name: braid-ask                              # required; the slash command id
description: One sentence describing what the skill does.
argument-hint: "[question]"                  # optional; CLI autocomplete hint
disable-model-invocation: true               # block automatic invocation by the model
allowedTools: [Read, Grep, Bash]             # optional; tool allow-list
model: claude-opus-4-7                       # optional; pin a model
```

`disable-model-invocation: true` is the default for Braid-shipped
skills — they're explicit slash commands, not auto-invoked tools.

### `braid:` namespace

```yaml
braid:
  category: ask          # ask | build | generate; controls Studio sidebar grouping
  summary: A short line. # ≤ 80 chars; sidebar / card display
  required-env: [...]    # env vars the skill needs; checked before spawn
  required-mcp-servers: [...]  # MCP server ids the skill needs; checked before spawn
  order: 100             # only meaningful for category: build (canonical step number)
```

Omit any optional field rather than setting it to an empty value. Skills
without a `category` land in the Studio sidebar's "Custom" group.

**Do not invent fields.** If you need new metadata, extend
`BraidSkillExtension` in `packages/schema/src/skill.ts` first so the
schema and the consumers move together.

---

## 3. Required H2 sections

Every SKILL.md must declare these `## ` sections, in this order. The
validator rejects load if a section is missing.

### Common to all categories

| Order | Section | Purpose |
|---|---|---|
| 1 | `## Role` | One paragraph: the skill's place in the HITL flow. State read-only vs mutating. State what the skill never does. Name the key MCP tools the skill calls (if any). |
| 2 | `## Design Principles` | Bullet list, 3–5 entries. Each entry: a principle + why it matters. |
| 3 | `## Initialization` | Pre-flight steps: env validation, ontology fetch, scope parsing. |
| 4 | `## Procedure` | The main flow. Sub-sections start with `### Step N: <imperative>`. Edge-case / failure handling lives inline in the relevant step, not as a separate section. |
| 5 | `## Output` | What the skill writes to stdout / files. Include a literal example. |
| 6 | `## Completion Checklist` | Bulleted checklist the agent runs through before exiting. |
| 7 | `## Companion Docs` | See §5. List the *referenced supplementary* docs, not endpoint references. |

Headings are written in Title Case — every word's first letter capitalised, e.g. `Completion Checklist`, `Companion Docs`, `Output Files`. Mixed casing (`Companion docs`, `output files`) trips the structural validator.

The contract is **what's already in the original SKILL.md set** — not a new list. Earlier drafts of this guide added `## Inputs & Outputs` and `## Failure Handling`, but `Inputs & Outputs` duplicated the YAML frontmatter, and `Failure Handling` rarely had enough substance to merit its own section (failure paths live inside the Procedure steps that produce them). Both were dropped.

### Additional sections by category

- `category: build` — may add `## Modes` between Initialization and Procedure when the skill supports multiple invocation modes (e.g. `build` vs `validate`).
- `category: generate` — must add `## Output Files` after Output, declaring the file path / naming convention / atomicity model.

### Optional trailing section

`## Notes` is allowed at the very end for caveats that don't fit elsewhere (workspace-extension hint, "do not ever do X" reminders). Every Notes bullet should justify why it isn't promoted into one of the canonical sections.

---

## 4. Tables, bullets, and code blocks

The formats are not interchangeable. Each conveys a different shape.

### Tables

Use a table when the same concept has **≥ 2 symmetric attributes**
worth aligning across rows. Examples that warrant a table:

- `| Symptom | Action |`
- `| Mode | Behaviour |`
- `| Dimension | What to check | Example finding |`

Anti-patterns:

- A one-row table (just inline the sentence).
- A single-column table (use a bulleted list).
- A table cell containing a multi-line command (use a code block).
- More than four columns (split into sub-sections — the reader can't
  scan that wide on a phone-sized SKILL.md preview).

### Bullets

Use bullets for **single-dimension lists**: design principles,
checklists, exits from a step, outcomes worth enumerating.

Bullets are also the right shape for "do X, do Y, do Z" instructions
that aren't ordered (use a numbered list when order matters).

### Code blocks

Use a fenced code block for **executable command flow**: an MCP tool
invocation, a multi-line CLI pipeline, a JSON payload sketch. Set the
language fence (` ```bash`, ` ```jsonc`, ` ```ts`) so the agent reads
it as code and not as prose.

Never paste a code block inside a table cell.

---

## 5. Companion Docs (the old "References")

Earlier versions of Braid's skills placed a `## References` table
between Design Principles and Initialization. That table mixed two
different things: lazy-loaded supplementary reading, and endpoint
references that the Procedure steps then duplicated. The duplication
became the source of drift.

The replacement is `## Companion Docs`, with one strict rule:

> The Companion Docs section lists supplementary documents that explain
> *concepts the agent needs to understand* before or during the
> Procedure — not API surface, not call patterns. API surface is the
> MCP tool contract, owned by the gateway.

For each entry: file path under `$BRAID_SESSION_DIR/.claude/skills/...`,
one-line description of *why* the agent reads it, and the step where
the agent should load it.

If a Procedure step needs to read a companion doc to act, the step
references the doc inline (`Read $BRAID_SESSION_DIR/.claude/skills/shared/drift-detection.md`)
rather than relying on the agent to remember the Companion Docs
section. The Companion Docs section exists to index those documents,
not to defer them.

---

## 6. Tone and voice

- Address the agent in second person, present tense: "You read X.",
  "You emit Y."
- Avoid hedging: write "Skip the step" instead of "You may want to
  skip the step." Hedges let the agent off the hook.
- State what the skill **does not** do as explicitly as what it does.
  Most regressions come from agents broadening their scope.
- Plain business / domain language in user-facing output sections.
  Internal identifiers (node ids, file paths) belong in lower /
  engineering output halves and footnotes.

---

## 7. De-specification

Examples in `SKILL.md` and shared docs must not name any specific
product, customer, or internal codebase. Use generic placeholders
(`<commandA>`, `<aggregateA>`) or a canonical neutral domain
(orders / inventory / billing). The skills ship with `@braidhq/core`
and are read in every workspace that uses Braid; product-specific
vocabulary leaks the publisher's domain into every reader's mental
model.

---

## 8. Validation

`SkillStructureValidator` (`packages/core/src/infrastructure/skill/SkillStructureValidator.ts`)
runs at skill load time. It checks:

- Frontmatter parses against `SkillFrontmatter` (zod).
- All H2 sections from §3 are present, in order.
- Every `Companion Docs` entry resolves to a real file.
- No reserved section names are used for off-label content.

Failures are **hard**: the skill refuses to load and the workspace's
skill list omits it with a diagnostic. There is no warning mode; if
your skill won't load, fix the structure.

---

## 9. Extension mechanism

A workspace can supplement any `builtin` / `plugin` skill by dropping a
file at `<workspace>/.claude/skill-extensions/<skill-id>/EXTEND.md`.
The runner appends its contents to the base SKILL.md after the
Procedure (so the extension can add steps without rewriting the base).

Use EXTEND.md for **workspace-specific** rules: source path
conventions, ID prefix conventions, product glossary overrides.
**Do not** use EXTEND.md to change a skill's read-only/mutating
character or to redefine its required sections — the validator runs
against the base alone.

---

## 10. Open questions deferred to a later revision

- Skill family base prompts (one `ask` template, multiple
  specialisations). Out of scope while there's only one realisation of
  each category. Revisit when a second customer-support / SRE-style
  `ask` skill exists.
- Per-category Output schema (today every skill freeforms its stdout).
  Worth considering once we have a downstream consumer that parses it.
