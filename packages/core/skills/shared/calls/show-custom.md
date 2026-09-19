# `show_custom`

A shape only your own plugin understands. Braid checks the payload against the schema that plugin registered, refuses it when no plugin claims the kind, and stores it.

- `kind`: the kind your plugin registered.
- `payload`: whatever that kind's schema says.

Braid's own surface does not draw one and says plainly that it cannot, so reach for this when your own application is what renders the result.
