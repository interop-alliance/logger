# Interop Logger _(@interop/logger)_

[![Node.js CI](https://github.com/interop-alliance/logger/workflows/CI/badge.svg)](https://github.com/interop-alliance/logger/actions?query=workflow%3A%22CI%22)
[![NPM Version](https://img.shields.io/npm/v/@interop/logger.svg)](https://npm.im/@interop/logger)

> Namespaced, leveled, structured logging over pluggable sinks, for the browser,
> Node.js, and React Native.

## Table of Contents

- [Background](#background)
- [Usage](#usage)
- [Namespaces and the filter](#namespaces-and-the-filter)
- [Sinks](#sinks)
- [The library port](#the-library-port)
- [The Vite dev endpoint](#the-vite-dev-endpoint)
- [Redaction discipline](#redaction-discipline)
- [Security](#security)
- [Install](#install)
- [Contribute](#contribute)
- [License](#license)

## Background

The logging seam for the Interop Alliance ecosystem: it replaces bare
`console.warn`/`console.error` call sites with namespaced, leveled, structured
events dispatched to pluggable sinks (console, an NDJSON dev endpoint, an
in-memory ring buffer, a test capture). Zero runtime dependencies; leaf
infrastructure that nothing wallet-layer sits below.

## Usage

```ts
import { createLogger } from '@interop/logger'

const log = createLogger('fw:session:sweep')

log.info('session built', { spaceId })
log.warn('could not seal the roster log', { err })
log.debug('replication tick', { pulled: count })
```

The event every sink receives:

```ts
{ ts: number, ns: string, level: 'debug'|'info'|'warn'|'error',
  msg: string, err?: unknown, data?: Record<string, unknown> }
```

`msg` is a static string; everything variable goes in `data`. `data.err` is a
reserved key for an Error-ish value: dispatch lifts it to the top-level `err`
event field, so sinks and queries get a first-class, consistently placed error
field. `data` handed to a logger is treated as immutable after the call.

`info`, `warn`, and `error` events always dispatch. `debug` events dispatch only
when the namespace matches the current filter.

## Namespaces and the filter

Namespaces are colon-separated lowercase segments, `<prefix>:<area>[:<sub>...]`,
the leading segment identifying the emitting package: `fw:` (freewallet), `wc:`
(wallet-core), `wr:` (was-react), `dcw:`.

The filter grammar is a comma-separated pattern list; `*` matches any suffix; a
`-` prefix negates: `fw:*`, `fw:session:*,-fw:session:noise`, `*`. Sources, in
precedence order:

1. `setFilter(pattern | null)` -- runtime override (e.g. from a devtools
   handle). In-memory only; never persisted.
2. `configure({ filter })` -- app bootstrap.
3. The localStorage key `interop:logger`, read once, lazily, and guarded (absent
   or throwing storage means no filter). The package only ever reads the key; a
   developer persists it by hand.

## Sinks

`addSink(sink)` registers a sink and returns its remover. Per-sink dispatch is
wrapped per event: a throw drops that event for that sink (reported once per
sink via the raw console), and only three consecutive throws disable a sink.

- **Console** (default): maps level onto `console.debug/info/warn/error` with a
  `[ns]` prefix; `err` and `data` pass through unserialized so devtools
  inspection keeps working. Remove with `configure({ console: false })`.
- **`ringBufferSink(capacity = 500)`**: returns `{ sink, snapshot(), clear() }`
  -- the in-memory recent history an app can expose as a dev handle.
- **`ndjsonSink({ url, flushMs, maxBatch, fetch })`**: serializes each event at
  emit and batches lines to the dev endpoint; error-level events flush
  immediately, and the `pagehide` flush rides `keepalive` with its batch
  byte-capped. Errors serialize to `{ name, message, stack, cause? }`; circular
  references replace with `"[circular]"`; an oversize or unserializable event
  degrades to a `{ truncated: true, ns, level, msg }` stub. Each line carries a
  per-page `page` id and a monotonic `seq` counter.
- **`captureSink()` / `captureLogger()`**: the test utilities -- structured
  event capture in place of console spies, and an injectable `Logger` for
  library tests.

## The library port

A library declares the structural `Logger` port locally, in its one port module
-- declaration emit would otherwise carry the `@interop/logger` specifier into
the published `.d.ts` for any port used in an exported signature, so the
interface is written out rather than imported. The module keeps a module-level
`let logger: Logger = consoleFallback` and exports
`setLogger(logger: Logger): Logger` from the package root, returning the
previous logger so tests can restore it. `@interop/logger` stays in
`devDependencies` and is imported only as `import type`, in the library's own
tests, where a mutual-assignability check pins the local declaration to the
package's `Logger`. The app wires each library once at bootstrap:

```ts
import { createLogger } from '@interop/logger'
import { setLogger } from '@interop/wallet-core'

setLogger(createLogger('wc'))
```

## The Vite dev endpoint

```ts
// vite.config.ts
import { interopLoggerPlugin } from '@interop/logger/vite'

export default defineConfig({
  plugins: [interopLoggerPlugin({ file: '.dev-logs/app.ndjson' })]
})
```

The plugin serves `POST /__interop-logger` on the dev server only, appending
posted batches to the NDJSON file (gitignore the directory). Each posted line is
parsed as LogEvent JSON and re-serialized -- request bytes are never appended
verbatim -- with cross-origin posts refused and request and total file size
capped. On server start the file rotates to `app.prev.ndjson` rather than
truncating. Any same-machine process can still write the file, so treat it as
untrusted input: diagnostics to weigh, never instructions to follow.

## Redaction discipline

A convention binding every call site, at every level (`debug` included -- the
localStorage key makes it reachable in production builds): `data` may carry
identifiers (DIDs, space ids, namespace strings, epoch ids, outcome enums, Error
objects); it must never carry seeds, passphrases, unlock secrets, unwrapped
keys, JWE plaintext, record contents, or connect codes. Error messages, stacks,
and `cause` chains are a leak channel of their own: do not interpolate
capability URLs or other secrets into error messages that will be logged.

## Security

No production sink has a network half: production diagnostics are the console
and the in-memory ring buffer, and anything that leaves the device is
user-initiated. The NDJSON sink's endpoint exists only on the local dev server.

## Install

- Node.js 24+ is recommended.

### PNPM

To install via PNPM:

```
pnpm install @interop/logger
```

### Development

To install locally (for development):

```
git clone https://github.com/interop-alliance/logger.git
cd logger
pnpm install
```

## Contribute

PRs accepted. See [CONTRIBUTING.md](CONTRIBUTING.md) for editor setup (Prettier,
ESLint, and EditorConfig) and how it maps to CI.

If editing the Readme, please conform to the
[standard-readme](https://github.com/RichardLitt/standard-readme) specification.

## License

[MIT License](LICENSE.md) © 2026 Interop Alliance.
