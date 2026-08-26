# @interop/logger Changelog

## 0.2.0 - 2026-08-25

### Changed

- Console sink lines now start with the event's UTC time (`HH:MM:SS.mmm`), and
  absent `err`/`data` arguments are omitted instead of padded with empty strings
  (no more trailing `<empty string>` in devtools).

## 0.1.0 - 2026-08-23

### Added

- Initial release: `createLogger` with `:`-separated namespaces, four levels,
  and the wildcard `debug` filter (`setFilter`, `configure`, or the localStorage
  key `interop:logger`, read-only).
- Pluggable sinks via `addSink`: the default console sink, the NDJSON dev batch
  sink, the ring-buffer sink, and the capture sink / `captureLogger` test
  utilities.
- The dispatch-side `err` lift: the reserved `data.err` key becomes the
  top-level `err` event field.
- `./vite` subpath: the dev-server NDJSON endpoint plugin
  (`POST /__interop-logger`, re-serializing writes, same-origin only,
  size-capped, rotating to `app.prev.ndjson` on start).
