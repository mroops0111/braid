# Shopping Cart

## Bounded Context: cart

The `cart` context owns the shopping-cart aggregate and the lifecycle of a
customer's pending order before it becomes a confirmed `Order` (which lives
in the separate `checkout` context).

## Aggregate: Cart

A `Cart` is the root aggregate. It contains zero or more `CartItem` entities.
Each cart belongs to exactly one customer (identified by `customerId`).
Carts are eventually discarded after 30 days of inactivity.

Invariants:

- A cart cannot exceed 99 distinct items
- A cart cannot contain a negative-quantity item

## Commands

### addItemToCart

Adds a product to the cart, or increments quantity if already present.

Inputs: `cartId`, `productId`, `quantity` (positive integer).

Emits `ItemAdded`.

Rejects with `CartFull` when the cart already has 99 distinct items.

### removeItemFromCart

Removes a `CartItem` from the cart entirely.

Inputs: `cartId`, `productId`.

Emits `ItemRemoved`.

### clearCart

Empties every item in the cart.

Inputs: `cartId`.

Emits `CartCleared`.

## Events

- `ItemAdded` (cartId, productId, quantity, addedAt)
- `ItemRemoved` (cartId, productId, removedAt)
- `CartCleared` (cartId, clearedAt)

## Rules

- `MaxItemsRule`: A cart never has more than 99 distinct items
- `PositiveQuantityRule`: quantity must be > 0 in every `CartItem`
