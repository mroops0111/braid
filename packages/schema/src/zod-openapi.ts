import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

// Add `.openapi()` to zod before this package builds any schema.
// zod 4's extension is not retroactive, a branded type created before the
// call never gains the method, so consumers that import schema ahead of
// the server's OpenAPI setup would otherwise crash on `.openapi()`.
// Importing this module first (see index.ts) makes schema OpenAPI-ready
// for every consumer, regardless of import order.
extendZodWithOpenApi(z)
