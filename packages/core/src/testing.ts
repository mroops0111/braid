/**
 * Public entry for the framework's in-memory adapters.
 *
 * These adapters are test fakes / lightweight in-process defaults, not a production storage layer.
 * They live behind the `@braidhq/core/testing` subpath (rather than the main entry),
 * so the main entry stays a pure port-and-service surface.
 * Plugin authors and downstream packages get a clear signal,
 * that anything reachable from `@braidhq/core` is part of the framework's stable contract,
 * while anything under `/testing` is a convenience for writing tests or wiring temporary in-memory deployments.
 *
 * The composition root in `@braidhq/server` imports from here for `composeApp()` defaults,
 * production wiring (`composeFsApp`) replaces these with filesystem-backed implementations.
 */
export * from './infrastructure/in-memory/InMemoryClarifyTicketRepository.js'
export * from './infrastructure/in-memory/InMemoryKeyedStore.js'
export * from './infrastructure/in-memory/InMemoryModelRepository.js'
export * from './infrastructure/in-memory/InMemoryProposalRepository.js'
export * from './infrastructure/in-memory/InMemoryReactorCycleRepository.js'
export * from './infrastructure/in-memory/InMemorySourceUnitObservationRepository.js'
export * from './infrastructure/in-memory/InMemoryWorkspaceEventBus.js'
export * from './infrastructure/in-memory/InMemoryWorkspaceRepository.js'
export * from './infrastructure/in-memory/NoopRunRepository.js'
