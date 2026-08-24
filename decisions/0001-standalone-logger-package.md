# 0001: Standalone logger package

- Status: accepted
- Date: 2026-08-23
- Driving work: the design of the ecosystem-wide logging seam (the
  package, the library port, and the migration of the wallets'
  console call sites onto it)
- Affects: `@interop/logger` (this repo); every `@interop/*` library
  and app that logs

## Context

Diagnostics across the ecosystem were bare `console.warn/error`
calls: unstructured, unfilterable, invisible to agents and tests
without driving a browser. A shared seam was needed, and it had to
sit below everything: was-react and plain consuming apps must not
depend on the wallet layer, and libraries must not carry
app-infrastructure runtime dependencies.

## Decision

The logging seam is its own standalone package, `@interop/logger`:
zero runtime dependencies, isomorphic (browser, Node, React Native),
built on the isomorphic-lib-template infrastructure. It provides
namespaced leveled loggers, wildcard runtime filtering, and pluggable
sinks. It is leaf infrastructure; nothing in it may import from any
wallet-layer package.

## Rejected Alternatives

- **Adopt the `debug` package.** No levels (everything lands on
  `console.debug`), off-by-default -- backwards for the hundreds of
  production warn/error sites; sinks limited to overriding a global
  that receives pre-interpolated strings; global singleton state that
  splits across pnpm-isolated copies (the tree already carries three
  versions). Its wildcard filter grammar was adopted; the package was
  not.
- **Adopt `loglevel`.** Levels but no namespace wildcards; the
  `methodFactory` seam forfeits its one unique asset (preserved
  devtools call sites) the moment a sink wraps it; still a
  console-only singleton, so the entire sink/event layer would be
  written anyway.
- **A wallet-core subpath (`@interop/wallet-core/log`).** Wrong
  dependency direction: non-wallet consumers must not depend on the
  wallet layer, and a logger sits below everything.

## Consequences

The implementation exists once. Each logging library carries a ~6-line
console fallback (see 0004) as the price of zero runtime deps. New
packages that need logging depend on this one (apps) or take the
type-only port (libraries).

## Revisit Criteria

None foreseen. The dependency-direction argument against the subpath
is structural, and the third-party rejections rest on properties of
those packages' designs, not on their versions.
