import type { AppDependencies } from '../../src/composition.js'
import { createApp } from '../../src/app.js'
import { composeApp } from '../../src/composition.js'

export function buildTestApp(): { app: ReturnType<typeof createApp>, deps: AppDependencies } {
  const deps = composeApp()
  return { app: createApp(deps), deps }
}
