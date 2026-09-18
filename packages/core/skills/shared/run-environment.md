# Run Environment

What the framework injects before your first turn, and what to do with it. Read this once at the start. Your skill's own Initialization says what it needs on top.

## The Workspace

- `$BRAID_WORKSPACE` is the directory holding the product. `PRODUCT.md` at its root declares the source paths and the MCP servers this workspace connects.
- `$BRAID_WORKSPACE_ID` is the id the API knows it by, and `$BRAID_API_URL` is where that API answers. You reach both through the `braid-core` tools rather than by hand.

## The Source Vocabulary

`$BRAID_SOURCE_ROLES` is a JSON array of the roles the active ontology splits sources into, each `{ id, label, pathSegment, unitBearing }`. A role's sources live under `$BRAID_WORKSPACE/<pathSegment>/`, read with the ordinary Read, Grep, and Glob tools.

This is your whole source vocabulary. **Never name a role the list does not contain**, and never assume one is there because a similar workspace had it. A product with three roles and a product with one are the same skill running, and a prompt that hardcodes a role name answers correctly for one of them by accident.

## The Readers

`$BRAID_AUDIENCES` is a JSON array of the readers this ontology splits an answer for, each with an `id`, a `label`, a `description` of what that reader needs, and an `evidenceDetail`. It is often empty, which means one reader and no splitting. `block-protocol.md` says what to do with it where a skill renders.

The same rule holds as for roles. The list is the vocabulary, and a reader it does not name does not exist for this run.

## The Reference Mounts

- `$BRAID_SHARED_REFERENCE` holds the framework contracts, this file among them.
- `$BRAID_ONTOLOGY_REFERENCE` holds the active ontology's own vocabulary and rules.

Your skill's Companion Docs table names what to read from each and when. Concatenate the variable with the file name when you Read one.

## This Run

- `$BRAID_RUN_ID` identifies the run. Every render call takes it.
- `$BRAID_OUTPUT_FORM` is what this run produces. `blocks` means read `block-protocol.md`, anything else means read `output-forms.md` and render nothing.
- `$BRAID_UNATTENDED` is `true` when a batch or a reactor cycle is driving you and nobody is waiting. A question you raise then is filed for whoever next opens the graph rather than answered in time to carry this run on, so record the doubt and continue rather than stopping on it.
