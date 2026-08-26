# 0004: The type-only library port and setLogger

- Status: accepted
- Date: 2026-08-23
- Amendments: 2026-08-23: corrected the type-only-import clause -- a
  library declares `Logger` locally in its port module instead of
  importing the type; the type-only import and the assignability
  check against `@interop/logger`'s own `Logger` move to the
  library's tests.
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

**Amendment (2026-08-23).** The type-only-import clause above conflicts
with the no-reference clause for a port used in an exported signature:
TypeScript's declaration emit re-imports a type used in a public
signature, so `import type { Logger } from '@interop/logger'` inside the
port module would land in the emitted `dist/*.d.ts` after all, and the
bare specifier would make the package a soft types dependency of every
consumer (a consumer without it installed fails typechecking against the
library's `.d.ts` unless `skipLibCheck` hides it). The corrected recipe,
implemented in wallet-core (the first library converted): the port module
declares the structural `Logger` interface locally instead of importing
it -- the same scoped-vendoring exception this decision already grants
the 6-line console fallback, safe because the port is frozen at four
two-arg methods and deliberately structural, so its identity is its
shape. The type-only import from `@interop/logger` and a mutual-
assignability check (both directions, against the locally declared
interface) move to the library's test suite instead. The `dist/` grep
still enforces "no reference"; it now covers all of `dist/`, `.d.ts`
files included.

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
