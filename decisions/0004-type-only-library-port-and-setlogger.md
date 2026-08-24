# 0004: The type-only library port and setLogger

- Status: accepted
- Date: 2026-08-23
- Driving work: the logging-seam design (how libraries emit without
  a runtime dependency)
- Affects: `@interop/logger` (the `Logger` port); every logging
  `@interop/*` library (wallet-core first, was-react next)

## Context

Libraries must not carry app-infrastructure runtime dependencies,
and under the ecosystem's standing `link:` dev setups an accidental
value import would silently resolve to a second copy of the package
with its own sink registry, splitting events away from the app's
sinks while the console keeps looking fine.

## Decision

A library takes the structural `Logger` port as a type-only import:
`@interop/logger` goes in `devDependencies`, every import is
`import type`, and the published artifact carries no reference
(enforced by an eslint `no-restricted-imports` rule and a `dist/`
grep in the library's test script). Each logging library keeps one
internal module holding `let logger: Logger = consoleFallback` (~6
local lines mapping the four methods onto prefixed `console.*` -- a
stated, scoped exception to the no-vendoring rule) and exports
`setLogger(logger: Logger): Logger` from its package root, returning
the PREVIOUS logger so tests can restore it. The app wires each
library once at bootstrap.

## Rejected Alternatives

- **A runtime dependency on `@interop/logger`**: couples every
  library release to logger releases and breaks the leaf-package
  rule for no functional gain.
- **Threading a `logger` option through every ceremony entry point**:
  correctness-neutral but a signature change on every entry point for
  process-global infrastructure.

## Consequences

The `Logger` port is frozen at four two-arg methods; its stability is
what keeps libraries off the logger's release train. A library's
conversion is still a consumer-visible release (the fallback's
prefix and single-`data`-arg format differ from its old raw console
output). N libraries carry N copies of the 6-line fallback; the
canonical recipe lives in this repo's README.

## Revisit Criteria

Per-call logger options come back -- layered as an override on the
module default, which this design does not preclude -- when a real
consumer needs two DIFFERENT logger configurations inside one
process (e.g. two sessions with separate capture).
