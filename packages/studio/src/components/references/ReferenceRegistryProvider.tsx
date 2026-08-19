import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { createReferenceRegistry } from '@/lib/references/referenceRegistry'
import { ReferenceRegistryContext } from '@/lib/references/ReferenceRegistryContext'
import { useNodeReferenceResolver } from './useNodeReferenceResolver'

interface ReferenceRegistryProviderProps {
  workspaceId: string | undefined
  children: ReactNode
}

/**
 * The registration point for reference kinds.
 * A new kind adds its hook call and one array entry below, nothing else,
 * since every render site reads resolutions through the registry.
 * The calls stay literal because the rules of hooks forbid a loop here.
 */
export function ReferenceRegistryProvider({ workspaceId, children }: ReferenceRegistryProviderProps) {
  const nodeResolver = useNodeReferenceResolver(workspaceId)
  const registry = useMemo(() => createReferenceRegistry([nodeResolver]), [nodeResolver])
  return (
    <ReferenceRegistryContext.Provider value={registry}>
      {children}
    </ReferenceRegistryContext.Provider>
  )
}
