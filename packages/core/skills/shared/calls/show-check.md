# `show_check`

One question about what the reader just read, with the answer held back until they commit. A reader who has just read something believes they know it and is usually wrong.

- `prompt`: the question, one sentence.
- `choices`: send them where picking is the honest test, and send none where the reader should produce the answer first.
- `correct`: which choice is right, by its id. Required when you send choices, since a question nobody can be wrong about teaches nothing.
- `answer`: what the reader should have arrived at, shown after they commit.
- `level`: `recall` asks what the material said, `apply` what follows from it, `judge` what would settle something it left open.

Depth is not difficulty. An obscure fact dressed up as `judge` is still recall, and the reader learns only that the question was unfair.
