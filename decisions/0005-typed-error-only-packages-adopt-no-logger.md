# 0005: Typed-error-only packages adopt no logger

- Status: accepted
- Date: 2026-08-23
- Driving work: the logging-seam design's consumer enumeration
  (which packages migrate and which do not)
- Affects: `@interop/was-client`, `@interop/social-core`,
  `@interop/vh-resource-log` today; any future package that
  communicates failure solely through typed errors

## Context

A library needs a logger only where it SWALLOWS a failure and
continues -- there, a log event is the only record the failure
happened. Packages whose every failure propagates as a typed error
(refusal classes, CAS conflicts, HTTP errors) already hand the
caller strictly better information than a log line. As of 2026-08-23
was-client, social-core, and vh-resource-log carry zero console
calls in `src/`.

## Decision

A library adopts the logger port only where it has genuine
best-effort paths (swallow-and-continue). A package that
communicates failure solely through typed errors stays logger-free:
its refusal classes ARE its diagnostics channel, and an importable
`log.warn` is an invitation to demote a refusal to
warn-and-continue. Keeping the package logger-free makes "this
library never swallows" structurally visible.

## Rejected Alternatives

- **Thread the port through everywhere for uniformity**: surface
  with no call sites, plus the demotion temptation above.

## Consequences

was-client, social-core, and vh-resource-log take no port, no
fallback, no `setLogger`. A contributor wanting to log there must
first confront this record.

## Revisit Criteria

A genuine best-effort path appears in such a package (e.g. a
background retry loop that gives up silently). Then that package
adopts the standard type-only port recipe (0004) at that moment --
nothing forecloses it; the rule tracks the package's error
discipline, not its name.
