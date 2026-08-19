import type { Reference, ReferenceKind } from '@braidhq/schema'
import type { ReactNode } from 'react'

/** Everything a tag and its hover card need for one reference. */
export interface ResolvedReference {
  readonly reference: Reference
  readonly title: string
  /** Short kind-specific label, such as a node's type id. */
  readonly badge?: string
  readonly description?: string
  /**
   * Leaves the current surface for the one that owns the target.
   * Absent when nothing can navigate, such as a missing navigation context.
   */
  readonly open?: () => void
  /** Names the destination, since each kind leaves for a different surface. */
  readonly openLabel?: string
  /** The destination's own icon, so the action reads the same as its nav entry. */
  readonly openIcon?: ReactNode
}

/** A resolution plus how well it matched, so several kinds share one menu. */
export interface ReferenceCandidate extends ResolvedReference {
  readonly score: number
}

/**
 * One reference kind's lookup. Registering a resolver is the only edit,
 * a new kind needs, every render site stays untouched.
 */
export interface ReferenceResolver {
  readonly kind: ReferenceKind
  readonly resolve: (id: string) => ResolvedReference | null
  /** Empty query means browse, so a resolver still offers its entries. */
  readonly search: (query: string) => readonly ReferenceCandidate[]
  /**
   * Full detail body for the peek sheet, which reads a reference in place,
   * rather than navigating away from whatever the reader was reviewing.
   * A kind that omits it gets a peek carrying the hover card's fields alone.
   */
  readonly renderDetail?: (id: string) => ReactNode
}
