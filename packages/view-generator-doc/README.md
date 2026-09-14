# @braidhq/view-generator-doc

Braid keeps a product's intent and its code aligned in one knowledge graph, and lets plugins turn that graph into something a person reads. `@braidhq/view-generator-doc` is the plugin that writes documents out of it, so a container node in the graph becomes a page somebody can sit down with.

## Role

The doc generator splits a document in half. The half that is a fact about the graph is a function, and the half that is a choice about wording is a skill.

- **The Projection**: `projectDocument` walks the subject through the ontology's `renderHint` taxonomy and emits the material as JSON, so the same graph and subject produce the same bytes on every run.
- **The Forms**: `reference` and `tutorial` each ship a skill that reads that material and emits render calls. They share one projection and differ only in what they do with it.
- **The Output**: Both forms write blocks rather than prose. The deterministic half never passes through model output, so a document costs the tokens of what had to be decided and nothing more.

## Structure

```
src/
├── index.ts      the plugin, its subjects, its two forms, and the render entry point
└── material.ts   the projection, its material types, and the container-type lookup
skills/
├── reference/    the form written to be scanned, asking nothing of its reader
└── tutorial/     the form written for a first meeting, asking for a depth
```

- **docViewGeneratorPlugin**: Built through the sdk builder. It declares `subjects: [{ by: 'container' }]`, so what it can be written about comes from the ontology's hints rather than from a type name this package would have to know.
- **projectDocument**: Takes a model snapshot, the ontology's node types, and a subject, and returns the material or nothing where the subject is not a node this workspace holds.

## Why the material is data

A generator that hands a form a template gets a document that obeys the template and teaches nobody. What a form is handed here is the material in the order the ontology says the graph nests, and what it owes back is a page.

That split is also what makes staleness answerable. A written document records the material it came from, so asking whether it has gone out of date is a re-projection and a comparison, not a guess about which nodes a writer happened to read.

## Boundaries

- **No Ontology Names**: Nothing here names a DDD type. The taxonomy comes from `renderHint`, so a second ontology gets documents without this package changing.
- **No Wording**: The plugin decides what is in scope and in what order. What the sentences say is the skill's, and the skill's alone.
- **Blocks, Not Markup**: A form emits render calls the framework already draws. A form wanting a shape Braid does not draw declares it as a block kind and renders it in its own surface.

## Dependencies

- **Depends On**: `@braidhq/core` for the port and the render taxonomy, `@braidhq/schema` for shared types, `@braidhq/sdk` for the factory, and `zod`.
- **Consumed By**: The server composition root, where `composeFsApp` registers the doc generator in the default plugin bundle.
