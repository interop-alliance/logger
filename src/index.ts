/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */
export {
  addSink,
  buildLogEvent,
  configure,
  createLogger,
  setFilter
} from './core.js'
export type { LogEvent, LogLevel, Logger, Sink } from './core.js'
export { ringBufferSink } from './ringBufferSink.js'
export { ndjsonSink } from './ndjsonSink.js'
export { captureLogger, captureSink } from './captureSink.js'
