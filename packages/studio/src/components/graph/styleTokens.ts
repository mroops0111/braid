/**
 * Shared visual tokens for the graph + table views. Anything that has
 * to match across `GraphCanvas`, `GraphTablePage`, and `NodeDetailPanel`
 * lives here so the three stay in lockstep (in particular the aside
 * width affects right-side toolbar positioning across both views).
 *
 * Tailwind class strings stay inline at the call site — only raw values
 * that need to be referenced from multiple files get a const here.
 */

/** Fixed width of the right-side node detail aside, in px. */
export const NODE_DETAIL_ASIDE_WIDTH = 440

/** Reduced opacity used to dim non-neighbour nodes / edges when a selection is active. */
export const DIMMED_NODE_OPACITY = 0.25
export const DIMMED_EDGE_OPACITY = 0.2
export const DIMMED_ROW_OPACITY = 0.3

/** Stroke widths for ReactFlow edges in various states. */
export const EDGE_STROKE = {
  selected: 2.5,
  incident: 2,
  added: 2,
  default: 1.25,
} as const

/** Dasharray for diff-state edge strokes. */
export const EDGE_DASH = {
  removed: '6 4',
  updated: '2 3',
} as const

/** Dim factor for the type-coloured edge stroke when not selected / incident. */
export const EDGE_DIM_REMOVED = 0.4
export const EDGE_DIM_DEFAULT = 0.65
