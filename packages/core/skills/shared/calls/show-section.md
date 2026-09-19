# `show_section`

Opens a part of a document, and exists because a document has a shape where an answer has only an order.

- `heading`: what this part is, in words a reader could pick out of a list.
- `level`: 1, 2, or 3.
- `covers`: the nodes this part is about. This is what lets one part be told it has gone out of date while the rest has not, so name the nodes the part actually explains rather than every node it mentions.

Call it before the prose that sits under it, never after.
