# @braidhq/test-utils

Every package's tests need the same handful of valid aggregates and a controllable clock. `@braidhq/test-utils` is the shared fixture library that builds them, so a test states only the axis it cares about and inherits a correct default for everything else.

## Role

The package hands tests three things: a deterministic clock, readable ids, and factories that return domain aggregates already satisfying their invariants.

- **The Clock and Time**: `FixedClock` is a mutable `Clock` seeded at the anchor `T0`, and `at(seconds)` mints timestamps at a fixed offset from it. Tests assert on the injected timestamp instead of `Date.now()`, and read ordering off `T0`, `T_PLUS_1_MIN`, and `T_PLUS_1_HOUR`.
- **The Ids**: `mintTestId` returns a fresh per-prefix counter value like `p-1` or `n-2`, and `resetTestIds` clears the counters from a `beforeEach`. Failures print readable ids rather than UUIDs.
- **The Factories**: `makeWorkspace`, `makeProposal`, `makeSkillManifest`, and `makeOntology` construct real core aggregates with happy-path defaults, each taking an options object to override one field per test.

## Structure

The package is flat. Each file owns one fixture concern, and the barrel re-exports all of them.

```
src/
├── index.ts       barrel, re-exports every fixture
├── time.ts        at(seconds) plus the T0 / T_PLUS_1_MIN / T_PLUS_1_HOUR anchors
├── clock.ts       FixedClock, a mutable Clock seeded at T0
├── ids.ts         mintTestId and resetTestIds, deterministic counter ids
├── ontology.ts    makeOntology, a bare OntologyPlugin
├── proposal.ts    makeProposal, a pending Proposal
├── skill.ts       makeSkillManifest and its raw data payload
└── workspace.ts   makeWorkspace plus the DEFAULT_AGENT_BINDING sample
```

- **time / clock / ids**: The deterministic primitives. Time and ids are pure, so a test that pins one gets stable output across runs.
- **ontology / proposal / skill / workspace**: The aggregate factories. Each default returns a shape that passes the real invariants, so overriding one axis never forces a test to rebuild the whole object.

## Boundaries

These rules keep the fixtures a test-only concern.

- **Test-Only**: Nothing in production imports this package. It is a dev dependency, consumed from other packages' `test/` folders alone.
- **Casts Are Fine Here**: Fixtures brand ids with `as NodeId` and friends, which production forbids. A fixture is a controlled input, not a boundary, so parsing would only add noise.
- **Defaults Stay Valid**: A factory default must satisfy the aggregate's invariants on its own, so a test overrides a single field without reconstructing the rest.

## Dependencies

The package sits beside core, reaching only for the types and aggregates it builds.

- **Depends On**: `@braidhq/core` for the aggregates and the `Clock` port, `@braidhq/schema` for the branded types, and `zod`.
- **Consumed By**: The test suites across the monorepo, wired as a dev dependency.
