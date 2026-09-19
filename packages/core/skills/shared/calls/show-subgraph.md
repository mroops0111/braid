# `show_subgraph`

The slice of the graph the answer stands on.

- `nodes`: the node ids, nothing more. The surface resolves each to its own name and type, so do not repeat them here and do not invent an id you have not seen.
- `edges`: `from`, `to`, and an optional short `label`, for relationships worth showing.

Use it when the answer turns on how a handful of nodes relate. Do not dump every node you touched, that is what `show_trace` records.
