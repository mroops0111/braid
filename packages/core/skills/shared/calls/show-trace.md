# `show_trace`

What this run searched, read, cited, and deliberately left out. Emit it once, near the top, before the answer.

- `searched`: each query you ran against the graph, with how many hits came back.
- `read`: the sources you actually opened.
- `cited`: the node ids the answer ends up standing on.
- `skipped`: what you opened and then chose not to use, each with a one-line `why`.

`skipped` is the part that earns this call. A reader can infer what you used from the answer itself, but never what you looked at and dismissed, which is exactly where a wrong answer hides. Record it honestly, including the cases where you ran out of budget rather than ruled something out.

Audience is `both`, since a reader of either half wants to know the scope.
