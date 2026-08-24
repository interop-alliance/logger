# 0003: The namespace grammar and filter surface

- Status: accepted
- Date: 2026-08-23
- Driving work: the logging-seam design's sign-off walk over its
  permanent public surface
- Affects: `@interop/logger`; every emitting package's namespace
  prefix; developer muscle memory (the localStorage key, filter
  patterns)

## Context

Namespaces are typed into filters and grepped in logs for the life of
the ecosystem; the filter key lives in developers' localStorage. The
`debug` package's browser builds read `localStorage.debug`, so the
key must not collide, and enabling ours must not enable
transitive-dep tracing.

## Decision

Namespaces are colon-separated lowercase segments,
`<prefix>:<area>[:<sub>...]`, the leading segment identifying the
emitting package: `fw:` (freewallet), `wc:` (wallet-core), `wr:`
(was-react), `dcw:`. The filter grammar is borrowed from `debug`: a
comma-separated pattern list, `*` matches any suffix, a `-` prefix
negates. The filter gates `debug`-level events only; `info`, `warn`,
and `error` always dispatch. The localStorage filter key is
`interop:logger`, read once, lazily; no code path in the package
writes it.

## Rejected Alternatives

- **Full package-name prefixes** (`freewallet:`, `wallet-core:`):
  unambiguous but long in every console line and filter pattern.
- **Dot-separated segments**: reads like module paths but diverges
  from the `debug` filter convention the grammar borrows.
- **Filter gating `info` too**: a quieter default console, but
  lifecycle marks vanish unless a filter is set -- wrong for the
  agent-diagnostics goal. (Dispatch policy, not API; a later change
  is non-breaking.)

## Consequences

A new emitting package claims a new short prefix; collisions are
prevented by convention, recorded in this repo's README. A chatty
namespace at `info` is demoted to `debug` rather than growing a
second filter axis.

## Revisit Criteria

The `info` dispatch policy may be revisited on evidence of real
noise; it is explicitly non-breaking. The grammar, prefixes, and key
are permanent surface; reopen only with a major version.
