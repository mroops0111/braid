/**
 * Public entry for the framework's in-memory adapters.
 *
 * Faithful in-process implementations of the repository ports,
 * a lightweight default for tests and ephemeral boot, not a durable store.
 * They sit behind the `@braidhq/core/in-memory` subpath, not the main entry,
 * so `@braidhq/core` stays a pure port-and-service surface.
 * The signal to downstream packages,
 * anything reachable from `@braidhq/core` is the stable framework contract,
 * anything under `/in-memory` is a convenience for tests or ephemeral boot.
 *
 * The server composition root imports these for `composeApp()` defaults,
 * production wiring swaps them for filesystem or vendor adapters.
 */
export * from './infrastructure/in-memory/InMemoryClarificationRepository.js'
export * from './infrastructure/in-memory/InMemoryKeyedStore.js'
export * from './infrastructure/in-memory/InMemoryModelRepository.js'
export * from './infrastructure/in-memory/InMemoryProposalRepository.js'
export * from './infrastructure/in-memory/InMemoryReactorCycleRepository.js'
export * from './infrastructure/in-memory/InMemorySourceUnitObservationRepository.js'
export * from './infrastructure/in-memory/InMemoryWorkspaceEventBus.js'
export * from './infrastructure/in-memory/InMemoryWorkspaceRepository.js'
export * from './infrastructure/in-memory/NoopRunRepository.js'
