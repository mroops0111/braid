# `show_finding`

One consistency statement. Use it whenever two sources agree, disagree, or cannot be checked against each other.

- `statement`: what was compared, in one line.
- `verdict`: `consistent`, `conflict`, or `unverifiable`.
- `sides`: two or more, each a one-line summary plus its own references. Name both sides, never pick one.
- Do not send a confidence. The surface derives one from `sides`, reading `corroborated` when every side rests on a `graph` reference, `partial` when every side has a reference but at least one carries `agent` provenance, and `thin` when a side has none. Earn a stronger reading by finding the reference, never by asserting one. The response tells you which one it derived, so read it back. A finding the reader will see marked `thin` should not be narrated as settled, and if you can find the missing reference, send the finding again with it rather than writing around the gap.
- `registered` and `driftId`: set both when the model already records this as a `DriftIssue`, so the surface can link to the record instead of offering to create it. **Look before you answer.** The nodes involved carry `metadata.driftIssues`, and a workspace that has been reconciled holds dozens. Reporting a known drift as new wastes a reviewer's time on something already triaged.
- `suggestedSource`: only for `unverifiable`, naming what would settle it.

One finding per statement. A block carrying three disagreements is three blocks.

`unverifiable` is a real answer. A run that could not settle a question says so rather than choosing the side it read most recently.
