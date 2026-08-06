import type { EdgeTypeId, Locale, NodeTypeId, OntologyResponse } from '@braidhq/schema'
import type { CSSProperties } from 'react'
import { localize } from '@braidhq/schema'

export interface OntologyPalette {
  /** Raw CSS colour for a node type's stroke, dot, or accent. */
  nodeColor: (type: NodeTypeId) => string
  /** Raw CSS colour for an edge type's stroke. */
  edgeColor: (type: EdgeTypeId) => string
  /** Localized label for a node type, or the id when unknown. */
  nodeLabel: (type: NodeTypeId) => string
  /** Localized label for an edge type, or the id when unauthored. */
  edgeLabel: (type: EdgeTypeId) => string
  /** Inline `style` object for the type badge background, border, or text. */
  nodeBadgeStyle: (type: NodeTypeId) => CSSProperties
  /** Inline `style` object for a solid dot in the same colour. */
  nodeDotStyle: (type: NodeTypeId) => CSSProperties
  /**
   * Sort types in the order the ontology declared them,
   * unknown types fall through to alphabetical at the end.
   */
  sortNodeTypes: <T extends NodeTypeId>(types: readonly T[]) => T[]
}

const FALLBACK_COLOR = 'oklch(0.55 0 0)'

/**
 * Build a palette from a resolved Ontology response.
 * Plugin authors who supply `color` on each descriptor,
 * get exactly what they wrote.
 * Descriptors without `color` get a deterministic hash-of-id colour,
 * so an ontology that skips colours still renders distinguishable types.
 * Pass `undefined` while the query is loading,
 * and every lookup returns the muted fallback.
 *
 * Returns inline style objects rather than Tailwind utility classes,
 * because Tailwind's JIT cannot scan dynamic strings at build time.
 * `bg-[${color}]` only produces a class when that literal is in the source,
 * which it is not for runtime palette values.
 */
export function buildPalette(ontology: OntologyResponse | undefined, locale: Locale): OntologyPalette {
  const nodeColorById = new Map<NodeTypeId, string>()
  const edgeColorById = new Map<EdgeTypeId, string>()
  const nodeLabelById = new Map<NodeTypeId, string>()
  const edgeLabelById = new Map<EdgeTypeId, string>()
  const nodeOrder = new Map<NodeTypeId, number>()

  if (ontology) {
    ontology.nodeTypes.forEach((descriptor, index) => {
      nodeOrder.set(descriptor.id, index)
      nodeLabelById.set(descriptor.id, localize(descriptor.label, locale))
      if (descriptor.color)
        nodeColorById.set(descriptor.id, descriptor.color)
    })
    for (const descriptor of ontology.edgeTypes) {
      if (descriptor.color)
        edgeColorById.set(descriptor.id, descriptor.color)
      if (descriptor.label)
        edgeLabelById.set(descriptor.id, localize(descriptor.label, locale))
    }
  }

  function nodeColor(type: NodeTypeId): string {
    return nodeColorById.get(type) ?? (ontology ? hashColor(type) : FALLBACK_COLOR)
  }

  function edgeColor(type: EdgeTypeId): string {
    return edgeColorById.get(type) ?? (ontology ? hashColor(type) : FALLBACK_COLOR)
  }

  function nodeLabel(type: NodeTypeId): string {
    return nodeLabelById.get(type) ?? type
  }

  function edgeLabel(type: EdgeTypeId): string {
    return edgeLabelById.get(type) ?? type
  }

  function nodeBadgeStyle(type: NodeTypeId): CSSProperties {
    const color = nodeColor(type)
    return {
      backgroundColor: withAlpha(color, 0.15),
      color,
      borderColor: withAlpha(color, 0.35),
    }
  }

  function nodeDotStyle(type: NodeTypeId): CSSProperties {
    return { backgroundColor: nodeColor(type) }
  }

  return {
    nodeColor,
    edgeColor,
    nodeLabel,
    edgeLabel,
    nodeBadgeStyle,
    nodeDotStyle,
    sortNodeTypes: <T extends NodeTypeId>(types: readonly T[]): T[] => {
      const sorted = [...types]
      sorted.sort((a, b) => {
        const ai = nodeOrder.get(a) ?? Number.MAX_SAFE_INTEGER
        const bi = nodeOrder.get(b) ?? Number.MAX_SAFE_INTEGER
        if (ai !== bi)
          return ai - bi
        return a.localeCompare(b)
      })
      return sorted
    },
  }
}

/**
 * Stable colour for a type id when the descriptor did not author one.
 * Hue is derived from a string hash,
 * chroma and lightness are pinned,
 * so the palette stays within Braid's dark-mode contrast envelope.
 */
function hashColor(id: string): string {
  if (!id)
    return FALLBACK_COLOR
  let hash = 0
  for (let i = 0; i < id.length; i++)
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  const hue = ((hash % 360) + 360) % 360
  return `oklch(0.7 0.15 ${hue})`
}

/**
 * Append an alpha component to an OKLCH, hex, or rgb colour string.
 * Works because CSS colour functions accept ` / <alpha>`,
 * before the closing paren, for oklch, lch, hsl, and rgb.
 * For hex or named colours we fall back to opacity at the consumer.
 */
export function withAlpha(color: string, alpha: number): string {
  const trimmed = color.trim()
  // Already has alpha set (e.g. `oklch(0.6 0.18 274 / 0.3)`), leave it.
  if (/\/\s*[\d.]+\s*\)$/.test(trimmed))
    return trimmed
  // CSS colour function with a closing paren, insert alpha before it.
  if (trimmed.endsWith(')'))
    return `${trimmed.slice(0, -1)} / ${alpha})`
  // Plain hex or named, return as-is.
  // Consumers should not rely on alpha for these,
  // or upgrade the ontology to use oklch or rgb.
  return trimmed
}
