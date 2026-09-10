# Block Protocol

How a skill puts structure on the screen. Instead of writing one document and hoping a reader finds the part addressed to them, a skill calls a render tool per piece of its output. Each call is an ordered block on the surface that shows the run.

These are `braid-core` tools like any other. They take the run they belong to, which the framework injects as `$BRAID_RUN_ID`, and they return an acknowledgement, nothing you need to read. The gateway names them in snake case, so the tool list shows `show_answer`, `show_evidence`, `show_finding`, `show_matrix`, and `show_trace`. Confirm the names against the tool list before the first call rather than assuming them.

Calling none of them is valid. A skill that renders no blocks still shows its transcript, so adopting this is per skill, not all at once.

A skill may also declare an output contract in its frontmatter, naming the calls it owes and how many blocks each audience is due. When a run ends without meeting it, the framework resumes the same session once with the gap spelled out. Treat that correction as a request to add what is missing, not to redo the answer.

## Prose In A Block

Block text lands in the same surface as the product's own labels, so it follows the same typography. Never write an em dash or an en dash, in any language. Split the sentence in two, or use a comma or parentheses. The same goes for a decorative arrow, which is reserved for naming the two ends of a relationship. Write three periods as the ellipsis character when you need one at all.

This applies to every string you pass, including a title, a matrix cell, and a diagram label.

## Audience

The framework injects `$BRAID_AUDIENCES`, a JSON array of the readers this workspace's ontology splits an answer for. Each carries an `id`, a `label`, a `description` of what that reader needs, and an `evidenceDetail` of `summary` or `full`. Read it before you render. Never name a reader the list does not contain, and when the list is empty, leave `audiences` off every call.

**Leave `audiences` empty unless you have a reason not to.** An empty list means every reader sees the block, and that is right for almost everything you render. A conclusion belongs to whoever asked the question, whatever kind of evidence happens to back it.

Name an audience only when a block genuinely says nothing to the others. A search trail is one. A conclusion is not, and neither is a finding, a matrix, or a comparison.

What differs between readers is **how much of a reference is shown**, and the surface already handles that from `evidenceDetail`. A reader who does not want line numbers still sees the finding, spelled with the document and section instead of the path and the range. So splitting a conclusion away from its reader to keep code out of their view is the wrong instinct, it removes the answer rather than the apparatus.

A reader who sees only half of a comparison has been given something worse than the whole. If you find yourself about to address one half of a comparison to one reader and the other half to another, render it once, addressed to nobody.

Whether a skill should address anything to one reader at all is the skill's own decision, not this document's. A skill whose output is reviewed by whoever holds a gate has one reader, so it leaves `audiences` empty throughout.

## Grouping Blocks That Belong Together

Every call takes an optional `group`, a short free string. Two blocks carrying the same `group` are two readings of one thing, and the surface will place them beside each other when the page is wide enough and stack them when it is not.

Use it when a comparison only makes sense read together. Two flows being contrasted share a group. A flow and the matrix that summarises it do not, they are one after the other.

You are saying the blocks belong together, not where to put them. Never try to express a position, a size, or an order beyond the order you emit in, because the same sequence has to work on a narrow screen and on a printed page.

## Reference Provenance

Every reference carries `provenance`:

- **`graph`**: copied verbatim from a node's `metadata.sourceReferences`. Set `nodeId` to the node it came from.
- **`agent`**: a location this run opened itself, which no node references yet.

Both are wanted. A run exists to find what the graph does not know yet, so the most valuable findings routinely come from files no node has ever cited. Do not suppress a reference because it is not in the graph, and do not invent a `graph` provenance for something you read directly. The surface marks an `agent` reference as unrecorded and offers to register it, which is the correct outcome.

When a claim rests on something a node already cites, use the `graph` provenance and set `nodeId`. An answer whose every reference is `agent` has usually skipped a step, because the graph nodes it named in prose carry `metadata.sourceReferences` that were never read back. Check them before settling for the file you happened to open.

Every render call answers `201` with the `blockId` it recorded, and `show_finding` also returns the `support` it derived. Nothing else comes back, so there is no acknowledgement to read past.

Never fabricate a path, a line number, or a node id to make a block look better sourced. An honest `agent` reference beats an invented `graph` one.

This one is checked rather than trusted. A `graph` reference must set `nodeId`, and that node must be one the model holds. A call carrying a `graph` reference that names no node, or names one the model does not have, is refused with a 400 naming what it could not settle. Fix it by setting `nodeId` to the node the reference was actually copied from, or by setting `provenance` to `agent` if you opened the location yourself.

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
- Do not send a confidence. The surface derives one from `sides`, reading `corroborated` when every side rests on a `graph` reference, `partial` when every side has a reference but at least one carries `agent` provenance, and `thin` when a side has none. Earn a stronger reading by finding the reference, never by asserting one. The response tells you which one it derived, so read it back: a finding the reader will see marked `thin` should not be narrated as settled, and if you can find the missing reference, send the finding again with it rather than writing around the gap.
- `registered` and `driftId`: set both when the model already records this as a `DriftIssue`, so the surface can link to the record instead of offering to create it. **Look before you answer.** The nodes involved carry `metadata.driftIssues`, and a workspace that has been reconciled holds dozens. Reporting a known drift as new wastes a reviewer's time on something already triaged.
- `suggestedSource`: only for `unverifiable`, naming what would settle it.

One finding per statement. A block carrying three disagreements is three blocks.

`unverifiable` is a real answer. A run that could not settle a question says so rather than choosing the side it read most recently.

### `show_matrix`

Two axes crossing, where each cell is a state rather than a sentence. Use it when the answer is a comparison across two dimensions, such as who may do what, or which rule applies in which plan.

- `rowAxis` and `columnAxis`: each a label plus its items. Both axes are yours to choose. Do not reach for a node type name or a source role id here, the axes are whatever the question actually crosses.
- `cells`: one per meaningful crossing, carrying `state` in your own words, a `tone`, an optional `note`, and its own `refs`.
- `tone` is how the cell reads at a glance, one of `affirmed`, `denied`, `conditional`, `conflict`, `not-applicable`. The label beside it stays yours, so a renderer colours the grid without knowing your vocabulary.

**Any comparison across two dimensions goes here, not into prose.** A markdown table inside `show_answer` renders as flat text, so its cells carry no state, no evidence, and nothing to click. If you catch yourself writing a table with a header row in an answer, that is a matrix.

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

### `show_diagram`

A mermaid definition, for a shape a table would flatten. A flow between two models, a state machine, a sequence of hand-offs.

- `mermaid`: the definition. Keep it small enough to read without panning.
- `caption`: optional, one line on what the reader should take from it.

Reach for this when the answer is about how things connect or in what order, and for a matrix when it is about which combinations hold.

Two diagrams being compared should carry the same `group`, so a reader sees them together rather than scrolling between them.

### `show_subgraph`

The slice of the graph the answer stands on.

- `nodes`: the node ids, nothing more. The surface resolves each to its own name and type, so do not repeat them here and do not invent an id you have not seen.
- `edges`: `from`, `to`, and an optional short `label`, for relationships worth showing.

Use it when the answer turns on how a handful of nodes relate. Do not dump every node you touched, that is what `show_trace` records.
