# Block Protocol

How a skill puts structure on the screen. Instead of writing one document and hoping a reader finds the part addressed to them, a skill calls a render tool per piece of its output. Each call is an ordered block on the surface that shows the run.

These are `braid-core` tools like any other. They take the run they belong to, which the framework injects as `$BRAID_RUN_ID`, and they return an acknowledgement, nothing you need to read. The gateway names them in snake case, so the tool list shows `show_answer`, `show_evidence`, `show_finding`, `show_matrix`, and `show_trace`. Confirm the names against the tool list before the first call rather than assuming them.

Calling none of them is valid. A skill that renders no blocks still shows its transcript, so adopting this is per skill, not all at once.

A skill may also declare an output contract in its frontmatter, naming the calls it owes and how many blocks each audience is due. When a run ends without meeting it, the framework resumes the same session once with the gap spelled out. Treat that correction as a request to add what is missing, not to redo the answer.

## Audience

Every call carries `audience`, one of:

- **`business`**: the reader wants the conclusion. No file paths, no line numbers, no type ids. Graph node ids are the one exception, in the `@node:<id>` token form.
- **`engineering`**: the reader wants the evidence. Paths, line ranges, and identifiers belong here.
- **`both`**: the block carries no audience-specific framing.

Split the content, never duplicate it. The same sentence written twice at two reading levels is one sentence in the wrong place. A reader sees one audience at a time, so anything only present in the other half is invisible to them.

Both halves are owed. An answer with nothing marked `engineering` leaves whoever has to act on it with no paths, no line ranges, and no way to check the claim. If the work turned up file evidence, and it almost always does, that evidence belongs in an `engineering` block. `both` is for a block with no audience-specific framing at all, not an escape from choosing.

A finding is never engineering-only. When someone asks whether two sources agree, the answer belongs on the business side even though its evidence is a line number.

## Reference Provenance

Every reference carries `provenance`:

- **`graph`**: copied verbatim from a node's `metadata.sourceReferences`. Set `nodeId` to the node it came from.
- **`agent-read`**: a location this run opened itself, which no node references yet.

Both are wanted. A run exists to find what the graph does not know yet, so the most valuable findings routinely come from files no node has ever cited. Do not suppress a reference because it is not in the graph, and do not invent a `graph` provenance for something you read directly. The surface marks `agent-read` as unverified and offers to register it, which is the correct outcome.

When a claim rests on something a node already cites, use the `graph` provenance and set `nodeId`. An answer whose every reference is `agent-read` has usually skipped a step, because the graph nodes it named in prose carry `metadata.sourceReferences` that were never read back. Check them before settling for the file you happened to open.

Never fabricate a path, a line number, or a node id to make a block look better sourced. An honest `agent-read` reference beats an invented `graph` one.

## Stored References Are Pointers, Not Citations

A node's `metadata.sourceReferences` records where something was found **when the node was extracted**, which may be many syncs ago. The file has moved on since, and the line it names may now hold something else entirely.

So a stored reference is a place to look, not a fact to repeat.

- **Open it before you cite it.** Read the lines the reference names and confirm they still say what the node claims. Citing a ref you did not open makes the answer only as current as the last extraction, while looking exactly as confident as one that was checked.
- **Say so when it has moved.** If the line no longer supports the claim, that is itself a finding, usually a `conflict` between the model and the code. Do not quietly repoint the reference and carry on, and do not drop the discrepancy because it was not what the question asked.
- **Everything you read is a mirror.** The workspace holds a copy taken at the last sync, not the live upstream. When an answer turns on something that changes often, say which is which rather than implying you read production.

## Calls

### `show_answer`

Prose. Markdown is allowed, and `@node:<id>` tokens render as live tags carrying the node's name.

Use one call per idea rather than one call for the whole answer. Separate blocks let a reader skim, and let the surface place them independently.

- `markdown`: the passage.
- `title`: optional heading for the passage.

### `show_evidence`

The sources behind a claim, as a list rather than as prose.

- `refs`: one or more references, each with its provenance, its source id, and a location. Include `snippet` when a short quotation is what makes the reference legible.

Place it next to the claim it supports. A single evidence block at the end of an answer is a bibliography, which is what this replaces.

### `show_finding`

One consistency statement. Use it whenever two sources agree, disagree, or cannot be checked against each other.

- `statement`: what was compared, in one line.
- `verdict`: `consistent`, `conflict`, or `unverifiable`.
- `sides`: two or more, each a one-line summary plus its own references. Name both sides, never pick one.
- `confidence`: 0 to 1.
- `registered` and `driftId`: set both when the model already records this as a `DriftIssue`, so the surface can link to the record instead of offering to create it. **Look before you answer.** The nodes involved carry `metadata.driftIssues`, and a workspace that has been reconciled holds dozens. Reporting a known drift as new wastes a reviewer's time on something already triaged.
- `suggestedSource`: only for `unverifiable`, naming what would settle it.

One finding per statement. A block carrying three disagreements is three blocks.

`unverifiable` is a real answer. A run that could not settle a question says so rather than choosing the side it read most recently.

### `show_matrix`

Two axes crossing, where each cell is a state rather than a sentence. Use it when the answer is a comparison across two dimensions, such as who may do what, or which rule applies in which plan.

- `rowAxis` and `columnAxis`: each a label plus its items. Both axes are yours to choose. Do not reach for a node type name or a source role id here, the axes are whatever the question actually crosses.
- `cells`: one per meaningful crossing, carrying `state` in your own words, a `tone`, an optional `note`, and its own `refs`.
- `tone` is how the cell reads at a glance, one of `affirmed`, `denied`, `conditional`, `conflict`, `not-applicable`. The label beside it stays yours, so a renderer colours the grid without knowing your vocabulary.

A cell whose two sources disagree takes `conflict`, and that same disagreement also deserves its own `show_finding`. The matrix shows where it sits, the finding shows what it is.

Omit a crossing that has no meaning rather than filling it with a placeholder.

### `show_trace`

What this run searched, read, cited, and deliberately left out. Emit it once, near the top, before the answer.

- `searched`: each query you ran against the graph, with how many hits came back.
- `read`: the sources you actually opened.
- `cited`: the node ids the answer ends up standing on.
- `skipped`: what you opened and then chose not to use, each with a one-line `why`.

`skipped` is the part that earns this call. A reader can infer what you used from the answer itself, but never what you looked at and dismissed, which is exactly where a wrong answer hides. Record it honestly, including the cases where you ran out of budget rather than ruled something out.

Audience is `both`, since a reader of either half wants to know the scope.
