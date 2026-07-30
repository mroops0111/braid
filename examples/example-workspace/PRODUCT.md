---
name: example
version: 0.1.0
description: A demo online store that models the shopping-cart bounded context.
ontologyId: ddd

sources:
  - kind: filesystem
    id: src-prd
    role: intent
    name: prd
    path: ./intent
  - kind: filesystem
    id: src-app
    role: code
    name: app
    path: ./code/app
    language: typescript

mcpServers: []

storage:
  kind: kuzu
  config: {}
---

# Example Store

A small online store, modelled down to a single bounded context, the shopping cart. A customer assembles items in a cart until checkout hands the order off to a separate order context. A cart holds at most 99 distinct items, rejects non-positive quantities, and is discarded after 30 days of inactivity.
