# Reference Syntax

How to point at a graph element from inside prose. Studio renders a matching token as a live tag: highlighted, hoverable for the target's name and description, clickable to open it. Prose with no token stays inert, so an id written plainly is just text a reader has to look up by hand.

This is the one exception to `content-conventions.md` § Common Rules, which otherwise bans code identifiers in prose. That rule is about *code-side* identifiers (file paths, class names, line numbers). A graph node id is not code-side, it is the graph's own vocabulary, and a token turns it into a link rather than jargon.

## Grammar

`@<kind>:<id>`

- `node` is the only kind today: `@node:ctx.signTask`
- Ids carrying whitespace or non-ASCII characters take brackets: `@node:[order flow]`
- A bare token ends at the first character an id cannot hold, so ordinary sentence punctuation needs no escaping. `Rewired @node:ctx.signTask.` is a token followed by a period.
- An unknown id still renders, marked as unresolved. Only write ids you have actually read back from the graph.

## Where to Use It

- **Narration.** Any message you write for the reviewer that names a node.
- **`clarification.context`.** The engineering-notes field, the field `content-conventions.md` already designates for exact node ids.
- **`proposal.rationale`.** When a sentence names a specific node rather than a count.
- **`node.description`.** When the description points at a neighbouring node.

## Where Not to Use It

- **`clarify.question` and `candidate.description`.** Their audience rule is unchanged. Those fields speak the ontology's ubiquitous language, never graph topology. Lower the ids into `context` as before.
- **`node.name`.** A name is a display string, not prose.
- **Fenced code and inline code.** Studio leaves those literal on purpose, so a reader quoting a token sees the token.

## Rules

- **No backticks around a token.** Write `@node:ctx.signTask`, not `` `@node:ctx.signTask` ``. Studio renders the token as a tag, so the code styling is redundant.
- Write the token alone. The tag already shows the node's name, so `@node:ctx.signTask (Sign Task)` renders the name twice.
- One token per mention. Repeating the same node in every sentence of a paragraph turns prose into a link farm.
- Never invent a kind. A kind Studio has no resolver for renders as unresolved text.
