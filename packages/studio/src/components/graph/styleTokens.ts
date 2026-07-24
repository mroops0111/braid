/**
 * Shared visual tokens for the graph and table views.
 * Anything that must match across `GraphCanvas`, `GraphTablePage`,
 * and `NodeDetailPanel` lives here so the three stay in lockstep.
 * In particular the aside width affects right-side toolbar positioning,
 * across both views.
 *
 * Tailwind class strings stay inline at the call site.
 * Only raw values referenced from multiple files get a const here.
 */

/**
 * Fixed width of the right-side node detail aside, in px.
 * Matches the studio's "Inspector" panel-width tier,
 * `w-96` = 24rem = 384px,
 * so it stays on the same 12-divisible grid,
 * as Rail (48), Nav (240), and List (288).
 */
export const NODE_DETAIL_ASIDE_WIDTH = 384

/** Reduced opacity used to dim non-neighbour nodes and edges when a selection is active. */
export const DIMMED_NODE_OPACITY = 0.25
export const DIMMED_EDGE_OPACITY = 0.2
export const DIMMED_ROW_OPACITY = 0.3

/** Stroke widths for ReactFlow edges in various states. */
export const EDGE_STROKE = {
  selected: 2.5,
  incident: 2,
  /**
   * Added edges in a proposal preview.
   * Pumped above `incident` so an incremental fix stands out,
   * instead of blending into the existing topology,
   * such as a model audit adding a handful of edges,
   * to an otherwise unchanged graph.
   */
  added: 3,
  default: 1.25,
} as const

/** Dasharray for diff-state edge strokes. */
export const EDGE_DASH = {
  removed: '6 4',
  updated: '2 3',
} as const

/** Dim factor for the type-coloured edge stroke when not selected or incident. */
export const EDGE_DIM_REMOVED = 0.35
export const EDGE_DIM_DEFAULT = 0.45
