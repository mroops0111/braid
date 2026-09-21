# `show_matrix`

Two axes crossing, where each cell is a state rather than a sentence. Use it when the answer is a comparison across two dimensions, such as who may do what, or which rule applies in which plan.

- `rowAxis` and `columnAxis`: each a label plus its items. Both axes are yours to choose. Do not reach for a node type name or a source role id here, the axes are whatever the question actually crosses.
- `cells`: one per meaningful crossing, carrying `state` in your own words, a `tone`, an optional `note`, and its own `refs`.
- `tone` is how the cell reads at a glance, one of `affirmed`, `denied`, `conditional`, `conflict`, `not-applicable`. The label beside it stays yours, so a renderer colours the grid without knowing your vocabulary.

**Any comparison across two dimensions goes here, not into prose.** A markdown table inside `show_answer` renders as flat text, so its cells carry no state, no evidence, and nothing to click. If you catch yourself writing a table with a header row in an answer, that is a matrix.

A cell whose two sources disagree takes `conflict`, and that same disagreement also deserves its own `show_finding`. The matrix shows where it sits, the finding shows what it is.

Omit a crossing that has no meaning rather than filling it with a placeholder.
