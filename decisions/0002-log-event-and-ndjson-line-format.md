# 0002: The LogEvent shape and NDJSON line format

- Status: accepted
- Date: 2026-08-23
- Driving work: the logging-seam design's sign-off walk over its
  permanent public surface
- Affects: `@interop/logger` (the `LogEvent` type, all sinks, the
  dev NDJSON file format); everything that parses the dev log file

## Context

The event shape is the contract every sink, jq query, test assertion,
and agent reading the dev log file depends on. It had to stay terse
(written thousands of times per session), keep the four-method
`Logger` port frozen (0004), and give errors a first-class,
consistently placed home rather than a convention buried in an
untyped bag.

## Decision

The event is:

```ts
{ ts: number, ns: string, level: 'debug'|'info'|'warn'|'error',
  msg: string, err?: unknown, data?: Record<string, unknown> }
```

`msg` is a static string; everything variable goes in `data`. Errors
ride the dispatch-side lift: callers pass `data.err` (a reserved key,
usable only for an Error-ish value) and dispatch lifts it to the
top-level `err` field, so the call signature stays `warn(msg, data?)`
while sinks receive a first-class error field.

The NDJSON dev line is the event plus two sink-stamped fields:
`page` (a short random per-page id) and `seq` (a monotonic integer
from 0 per page), so interleaved lines from two tabs or a popup
beside its opener stay attributable and causally ordered past the
error-immediate flush. The NDJSON sink serializes at emit time.
`Error` values serialize to `{ name, message, stack, cause? }`; a
line over 16 KiB, or one whose serialization throws, degrades to the
stub `{ truncated: true, ns, level, msg }`. Stub lines still
carry the sink-stamped `page` and `seq` (ratified 2026-08-23):
the two fields ride every line, stubs included.

## Rejected Alternatives

- **Longer field names** (`timestamp`/`namespace`/`message`): more
  self-describing, but costs bytes and typing in every filter and jq
  expression on a format written constantly.
- **An `err` parameter in the port signature** (`warn(msg, err?,
  data?)`): puts the error at the call site but unfreezes the port --
  every library fallback changes, and future port edits break all
  logging libraries at once.
- **`data.err` as convention only** (no lift): keeps the event
  minimal but leaves the error in an untyped bag every sink must
  fish in.

## Consequences

`err` is reserved in `data`. Additive event fields are non-breaking;
renames of the existing fields are never made -- the field names ARE
the on-disk line format agents and tooling parse.

## Revisit Criteria

New needs are met with additive optional fields. Reopen the existing
names or the lift only for a major version of the package, and only
with a migration story for line-format consumers.
