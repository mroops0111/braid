// Load the zod-openapi extension before any schema module, so all zod
// schemas (including branded types from @braidhq/schema) share one patched
// zod instance under vitest. Matches production, where node loads one zod.
import '@hono/zod-openapi'
