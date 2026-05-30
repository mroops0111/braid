/**
 * Shared visual tokens for the graph + table views. Anything that has
 * to match across `GraphCanvas`, `GraphTablePage`, and `NodeDetailPanel`
 * lives here so the three stay in lockstep (in particular the aside
 * width affects right-side toolbar positioning across both views).
 *
 * Tailwind class strings stay inline at the call site — only raw values
 * that need to be referenced from multiple files get a const here.
 */

/**
 * Fixed width of the right-side node detail aside, in px. Matches the
 * studio's "Inspector" panel-width tier (`w-96` = 24rem = 384px), so it
 * stays on the same 12-divisible grid as Rail (48) / Nav (240) / List
 * (288). See `panel-widths` notes if more tiers are added.
 */
export const NODE_DETAIL_ASIDE_WIDTH = 384

/** Reduced opacity used to dim non-neighbour nodes / edges when a selection is active. */
export const DIMMED_NODE_OPACITY = 0.25
export const DIMMED_EDGE_OPACITY = 0.2
export const DIMMED_ROW_OPACITY = 0.3

/** Stroke widths for ReactFlow edges in various states. */
export const EDGE_STROKE = {
  selected: 2.5,
  incident: 2,
  /**
   * Added edges in a proposal preview.
   * Pumped above `incident` so an incremental fix stands out instead of blending into the existing topology (e.g. a model audit adding a handful of edges to an otherwise unchanged graph).
   */
  added: 3,
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
