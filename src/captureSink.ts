/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */

/**
 * The test utilities: a capture sink recording dispatched events
 * structurally, and a capture Logger factory for library tests that inject
 * a logger and assert on events instead of console argument arrays.
 */
import { buildLogEvent } from './core.js'
import type { LogEvent, Logger, Sink } from './core.js'

/**
 * Creates a sink that records every dispatched event.
 *
 * @returns {{ sink: Sink, events: LogEvent[], clear: () => void }}
 */
export function captureSink(): {
  sink: Sink
  events: LogEvent[]
  clear: () => void
} {
  const events: LogEvent[] = []
  return {
    sink(event: LogEvent): void {
      events.push(event)
    },
    events,
    clear(): void {
      events.length = 0
    }
  }
}

/**
 * Creates a standalone capture Logger for injecting into a library's
 * `setLogger`. Events record with the same dispatch-side `err` lift the
 * seam performs; the filter does not apply (a test wants every event,
 * `debug` included).
 *
 * @param [ns] {string}
 * @returns {{ logger: Logger, events: LogEvent[] }}
 */
export function captureLogger(ns: string = 'capture'): {
  logger: Logger
  events: LogEvent[]
} {
  const events: LogEvent[] = []
  function record(
    level: 'debug' | 'info' | 'warn' | 'error',
    msg: string,
    data?: Record<string, unknown>
  ): void {
    events.push(buildLogEvent({ ns, level, msg, data }))
  }
  return {
    logger: {
      debug(msg: string, data?: Record<string, unknown>): void {
        record('debug', msg, data)
      },
      info(msg: string, data?: Record<string, unknown>): void {
        record('info', msg, data)
      },
      warn(msg: string, data?: Record<string, unknown>): void {
        record('warn', msg, data)
      },
      error(msg: string, data?: Record<string, unknown>): void {
        record('error', msg, data)
      }
    },
    events
  }
}
