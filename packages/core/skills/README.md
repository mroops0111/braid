# Braid Skills

A skill is a prompt the framework runs as an agent. It lives in one directory with one `SKILL.md`, declares what it needs and what it produces in frontmatter, and reaches the graph through the `braid-core` tools the framework hands it. This directory holds the framework's own skills and the reference files every skill reads from.

## Role

A skill carries intent. The framework carries mechanism, and the ontology carries vocabulary, so a prompt that restates either of those has taken on a job that is not its own.

- **The skill**: what this run is for, how it goes about it, and what it owes on top of the contract for its form.
- **The shared reference**: how rendering works, what the environment holds, what a form owes. One copy, read on demand.
- **The ontology reference**: the node types, the source roles, the drift dimensions. Named by the workspace, never by a framework skill.

## Structure

```
skills/
├── README.md                  this file
├── <verb>/SKILL.md            one skill, one directory
└── shared/
    ├── run-environment.md     what the framework injects
    ├── output-forms.md        what a run that renders nothing owes
    ├── block-protocol.md      what a run that renders owes, across every call
    ├── calls/<call>.md        one file per render call
    └── *.md                   formats and conventions, read as needed
```

Ontology packages hold their own skills under the same layout, plus a `$BRAID_ONTOLOGY_REFERENCE` of their own.

## What A SKILL.md Contains

Sections appear in this order. The structure validator requires the seven common ones, plus `Output Files` for a `generate` skill.

- **`## Role`**: what this run is and what it will not do. No role id, no audience id, no node type.
- **`## Design Principles`**: the trade-offs this skill makes, not the ones every skill makes.
- **`## Initialization`**: reads `run-environment.md`, then whatever else this skill needs before it starts.
- **`## Procedure`**: the steps. This is the skill, and the least shareable part of it.
- **`## Output`**: a router by form, then what this skill owes on top of that contract, then `### Run Summary`.
- **`## Completion Checklist`**: what is true of the work, whatever form carried it. Never a render call by name.
- **`## Companion Docs`**: a table of `File | When to Read | Why`. The `When` is a condition or a step, not a vague time.
- **`## Notes`**: the `EXTEND.md` hook and anything left over.

A skill may add its own sections. `reconcile` has `## Modes`, and the document skills have `## Output Files`.

## Three Axes Decide What A Run Reads

Nothing in a prompt should restate something one of these already settles.

| Axis | Settled by | Decides |
|---|---|---|
| **form** | the runner, per run, from `braid.output.forms` and whether anybody is watching | whether the run reads `block-protocol.md` or `output-forms.md` |
| **calls** | the skill, in `braid.output.calls`, within its category's ceiling | which files under `calls/` it reads, and which tools it is handed |
| **ontology** | the workspace | the vocabulary the injected lists carry |

The form and the calls are enforced rather than advised. A run that renders nothing is handed no render operation, and a call a skill did not declare is absent from its tool list, so a prompt naming one describes a tool that does not exist.

## Rules

- **No framework mechanism in a skill.** If two skills would write the same paragraph, it belongs in `shared/`.
- **No ontology vocabulary in a framework skill.** Under `packages/core/skills/`, a prompt may name env vars and framework concepts. It may not name a source role, an audience, or a node type, not even as an example. The injected list is the whole vocabulary, and a hardcoded name answers correctly for one workspace by accident.
- **Declare the calls you use.** `braid.output.calls` narrows within the category ceiling. A call named in the body but not declared is a defect, and the shipped-skill test fails on it.
- **Checklists carry work, not protocol.** A checklist item naming a render call cannot be satisfied by a run that writes instead of renders. What each form owes lives with that form's contract.
- **Read one call's file, not all ten.** `calls/` is per call so a run pays for what it draws with.
- **One table shape everywhere.** `File | When to Read | Why`, with `$BRAID_` paths in the first column.
- **Frontmatter reads in one order.** `category`, `label`, `order`, `summary`, `hidden`, `required-env`, `allowed-roles`, `inputs`, `output`. What a run takes in comes before what it gives back.
- **Declare the environment you read.** `required-env` names every `$BRAID_` variable the prompt reads, including those a doc it opens tells it to read. `run-environment.md` is the exception: it names every variable in order to explain them, so reading it depends on none of them. A variable the framework injects unconditionally still gets declared, since the declaration says what this run needs rather than what the framework happens to provide.
- **Never name the user.** Every write carries the run's own credential, so the server knows who acted. A prompt filling in a user id is guessing at something already settled, and guessing is not reproducible.
- **Never restate a default.** `max-retries` defaults to 1, so declaring 1 says nothing and rots when the default moves.
- **One casing per list.** A list of names takes Title Case throughout, a list of sentences takes sentence case and a full stop throughout. Mixing the two inside one list reads as a mistake.
- **No em dash, en dash, or decorative arrow**, in any language. `block-protocol.md` § Prose In A Block carries the rest of the typography.

## Boundaries

A skill never instantiates anything, never names a host or a port, and never writes outside `$BRAID_WORKSPACE`. It reaches the graph through `braid-core` and the filesystem through the ordinary tools.

What a skill may do to the graph is its category, declared in frontmatter and enforced by the tool surface rather than by the prompt. An `ask` skill is handed no way to propose, so a promise not to mutate is a description rather than a restraint.

## Dependencies

`SKILL.md` is parsed by `FsSkillRegistry` against `SkillFrontmatter` in `@braidhq/schema`, and its body is checked by `SkillStructureValidator` in `@braidhq/core`. The render calls it may declare come from `RENDER_CALL_CATEGORIES`, and `settleRenderCalls` narrows them per run.
