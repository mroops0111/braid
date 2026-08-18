import type { GraphNode } from '@braidhq/schema'
import type { ReferenceResolver } from '@/lib/references/ReferenceResolver'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { asNodeId } from '@/lib/brands'
import { useModelSnapshot } from '@/lib/queries'
import { createNodeReferenceResolver } from '@/lib/references/nodeReferenceResolver'
import { useGraphNavigation } from '@/lib/useGraphNavigation'
import { NodeReferenceDetail } from './NodeReferenceDetail'

/**
 * Binds the node resolver to the snapshot Studio has already loaded,
 * so hovering a tag costs no request.
 * The detail body lives here rather than in the pure resolver,
 * which keeps that module free of React.
 */
export function useNodeReferenceResolver(workspaceId: string | undefined): ReferenceResolver {
  const { t } = useTranslation()
  const { data: snapshot } = useModelSnapshot(workspaceId)
  const navigation = useGraphNavigation()
  const nodesById = useMemo(
    () => new Map<string, GraphNode>((snapshot?.nodes ?? []).map(node => [node.id, node])),
    [snapshot],
  )
  const openLabel = t('references.openInGraph')

  return useMemo(() => {
    const resolver = createNodeReferenceResolver({
      nodesById,
      openLabel,
      ...(navigation ? { onOpen: navigation.focusNode } : {}),
    })
    if (workspaceId === undefined)
      return resolver
    return {
      ...resolver,
      renderDetail: (id: string) => <NodeReferenceDetail workspaceId={workspaceId} nodeId={asNodeId(id)} />,
    }
  }, [nodesById, navigation, openLabel, workspaceId])
}
