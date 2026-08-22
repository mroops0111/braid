import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where Studio's built files sit, for a server that wants to serve them.
 *
 * A path rather than the files themselves is what a static handler needs,
 * and it reads the same here as from a published copy,
 * since `dist` sits beside this module in both.
 */
export const studioAssetsDir = join(dirname(fileURLToPath(import.meta.url)), 'dist')
