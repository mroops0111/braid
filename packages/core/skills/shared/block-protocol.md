# Block Protocol

How a skill puts structure on the screen. Instead of writing one document and hoping a reader finds the part addressed to them, a skill calls a render tool per piece of its output. Each call is an ordered block on the surface that shows the run.

These are `braid-core` tools like any other. They take the run they belong to, which the framework injects as `$BRAID_RUN_ID`, and they return an acknowledgement, nothing you need to read. The gateway names them in snake case, so a call named `showAnswer` here reaches you as `show_answer`.

This document assumes `$BRAID_OUTPUT_FORM` is `blocks`. Any other value means this run renders nothing, and `output-forms.md` rather than this file says what it owes.

Your skill declares which calls it draws with, and your tool list holds exactly those. One file per call sits in `calls/` beside this one, named for the call, and the rules below hold across all of them. Read the file for a call before your first use of it, and read no file for a call you were not given.

A skill may also declare an output contract in its frontmatter, naming the calls it owes and how many blocks each audience is due. When a run ends without meeting it, the framework resumes the same session once with the gap spelled out. Treat that correction as a request to add what is missing, not to redo the answer.

## Never Write What The Surface Will Draw

Wherever a call takes node ids, it takes ids and nothing else. The surface resolves each one to that node's own name, description, status, and colour, straight from the graph. So a block naming ten nodes costs you ten ids, and the reader sees ten fully drawn nodes.

Copying a node's description into your prose is the most expensive mistake available here. It doubles what you pay to produce, it goes stale the moment somebody edits the node, and the reader was going to be shown the real thing anyway. Say what the nodes mean together. Let the surface say what each one is.

The same holds for status. The surface reads `draft` or `unclear` off the graph and marks it, and it stays right after somebody settles one. A sentence of yours announcing a status is wrong the day after it is written.

## Prose In A Block

Block text lands in the same surface as the product's own labels, so it follows the same typography. Never write an em dash or an en dash, in any language. Split the sentence in two, or use a comma or parentheses. The same goes for a decorative arrow, which is reserved for naming the two ends of a relationship. Write three periods as the ellipsis character when you need one at all.

This applies to every string you pass, including a title, a matrix cell, and a diagram label.

Every string you pass is text, never markup. Write `&` as `&`, never as `&amp;`, and the same for every other HTML entity. Nothing here is parsed as HTML, so an entity reaches the reader exactly as you typed it.

## Audience

The framework injects `$BRAID_AUDIENCES`, a JSON array of the readers this workspace's ontology splits an answer for. Each carries an `id`, a `label`, a `description` of what that reader needs, and an `evidenceDetail` of `summary` or `full`. Read it before you render. Never name a reader the list does not contain, and when the list is empty, leave `audiences` off every call.

**Leave `audiences` empty unless you have a reason not to.** An empty list means every reader sees the block, and that is right for almost everything you render. A conclusion belongs to whoever asked the question, whatever kind of evidence happens to back it.

Name an audience only when a block genuinely says nothing to the others. A search trail is one. A conclusion is not, and neither is a finding, a matrix, or a comparison.

What differs between readers is **how much of a reference is shown**, and the surface already handles that from `evidenceDetail`. A reader who does not want line numbers still sees the finding, spelled with the document and section instead of the path and the range. So splitting a conclusion away from its reader to keep code out of their view is the wrong instinct, it removes the answer rather than the apparatus.

A reader who sees only half of a comparison has been given something worse than the whole. If you find yourself about to address one half of a comparison to one reader and the other half to another, render it once, addressed to nobody.

Whether a skill should address anything to one reader at all is the skill's own decision, not this document's. A skill whose output is reviewed by whoever holds a gate has one reader, so it leaves `audiences` empty throughout.

### What Is Worth Addressing To One Reader

There is one thing each reader needs that the others do not, and it is not the conclusion. It is what follows from it for them.

One reader acts on a conclusion inside their own working day and another changes something because of it, and those are different sentences carrying different information. Writing both is not duplication. Writing the conclusion twice is.

So where a skill splits for readers at all, render the shared conclusions first, then one short block per audience naming that audience, saying what this answer means for them. Read the audience's own `description` for what it cares about, and never guess at a reader the list does not name. Keep each to a few sentences, and skip an audience entirely rather than padding one out, since an empty implication tells a reader nothing they could not already see.

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

## What A Rendering Run Owes

Check these before you finish. They hold for every skill that renders, so a skill's own checklist carries what is true of its work rather than what is true of this protocol.

- [ ] The first block carrying a conclusion answers what was asked, rather than working up to it.
- [ ] Every trail block was emitted once, near the top, before the conclusions it covers.
- [ ] Nothing was written out as prose that a call already carries.
- [ ] No markdown table was written inside a prose block, since a comparison across two dimensions belongs in a matrix where its cells can carry state and evidence.
- [ ] Every consistency statement went out as its own finding, addressed to every reader rather than to one.
- [ ] Every reference carries the provenance it actually has, `graph` or `agent`, with nothing invented.
- [ ] Each declared audience got one short implication block naming it, or was skipped rather than padded, where the skill splits for readers at all.
