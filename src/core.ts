/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */

/**
 * The logging seam's core: the event and port types, the sink registry,
 * dispatch with the reserved-`err` lift, the filter sources, and
 * `createLogger`.
 */
import { matchesFilter } from './filter.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEvent {
  /**
   * Epoch milliseconds.
   */
  ts: number
  /**
   * Namespace, e.g. 'fw:session:sweep'.
   */
  ns: string
  level: LogLevel
  /**
   * Static message; no interpolation. Everything variable goes in `data`.
   */
  msg: string
  /**
   * Lifted from the reserved `data.err` key at dispatch.
   */
  err?: unknown
  /**
   * Structured context (minus `err`).
   */
  data?: Record<string, unknown>
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
}

export type Sink = (event: LogEvent) => void

interface SinkEntry {
  sink: Sink
  consecutiveThrows: number
  reported: boolean
}

const MAX_CONSECUTIVE_THROWS = 3
const FILTER_STORAGE_KEY = 'interop:logger'

const sinks: SinkEntry[] = []

let runtimeFilter: string | null = null
let configuredFilter: string | null = null
let storedFilterRead = false
let storedFilter: string | null = null
let dispatching = false

/**
 * Registers a sink to receive every dispatched event. Returns the remover.
 *
 * @param sink {Sink}
 * @returns {() => void}
 */
export function addSink(sink: Sink): () => void {
  const entry: SinkEntry = { sink, consecutiveThrows: 0, reported: false }
  sinks.push(entry)
  return function removeSink(): void {
    const index = sinks.indexOf(entry)
    if (index !== -1) {
      sinks.splice(index, 1)
    }
  }
}

/**
 * The default console sink: maps level onto console.debug/info/warn/error,
 * prefixing each line with the event's UTC time (HH:MM:SS.mmm) and passing
 * `err` and `data` through unserialized so devtools inspection keeps
 * working. Absent `err`/`data` are omitted rather than padded, so a bare
 * message line carries no trailing empty-string arguments.
 *
 * @param event {LogEvent}
 */
function consoleSink(event: LogEvent): void {
  const time = new Date(event.ts).toISOString().slice(11, 23)
  const extras = [event.err, event.data].filter(value => value !== undefined)
  console[event.level]('%s [%s] %s', time, event.ns, event.msg, ...extras)
}

addSink(consoleSink)

/**
 * Returns whether the default console sink is currently installed.
 * Presence is checked against the live sink list rather than tracked in a
 * flag, so a console sink auto-disabled by consecutive throws reads as
 * absent and can be reinstalled.
 *
 * @returns {boolean}
 */
function consoleSinkInstalled(): boolean {
  return sinks.some(entry => entry.sink === consoleSink)
}

/**
 * Applies app-bootstrap configuration. Semantics are merge: each key is
 * independent, and an omitted key leaves its setting untouched.
 *
 * @param options {object}
 * @param [options.console] {boolean} - false removes the default console
 *   sink; true reinstalls it (recovering one auto-disabled by consecutive
 *   throws).
 * @param [options.filter] {string | null} - the configured debug filter;
 *   null unsets it (falling back to the localStorage source).
 */
export function configure(options: {
  console?: boolean
  filter?: string | null
}): void {
  if (options.console === false) {
    const index = sinks.findIndex(entry => entry.sink === consoleSink)
    if (index !== -1) {
      sinks.splice(index, 1)
    }
  } else if (options.console === true && !consoleSinkInstalled()) {
    addSink(consoleSink)
  }
  if ('filter' in options) {
    configuredFilter = options.filter ?? null
  }
}

/**
 * Sets the runtime debug-filter override (e.g. from a devtools handle).
 * In-memory only: nothing is ever persisted. Pass null to clear the
 * override, falling back to the configured filter or the localStorage key.
 *
 * @param pattern {string | null}
 */
export function setFilter(pattern: string | null): void {
  runtimeFilter = pattern
}

/**
 * Resolves the effective debug filter: the runtime override, then the
 * configured filter, then the localStorage key 'interop:logger' -- read
 * once, lazily, and guarded (absent storage, storage whose access throws,
 * or a non-browser environment yields no filter). No code path writes the
 * key.
 *
 * @returns {string | null}
 */
function effectiveFilter(): string | null {
  if (runtimeFilter !== null) {
    return runtimeFilter
  }
  if (configuredFilter !== null) {
    return configuredFilter
  }
  if (!storedFilterRead) {
    storedFilterRead = true
    try {
      const storage = (
        globalThis as { localStorage?: { getItem(key: string): string | null } }
      ).localStorage
      storedFilter = storage?.getItem(FILTER_STORAGE_KEY) ?? null
    } catch {
      storedFilter = null
    }
  }
  return storedFilter
}

/**
 * Builds a LogEvent from a call's arguments, performing the dispatch-side
 * lift: the reserved `data.err` key moves to the top-level `err` field, and
 * `data` carries the remaining keys (absent when none remain). A throwing
 * getter beside the reserved key degrades to passing `data` by reference,
 * so the throw surfaces inside per-sink handling rather than at the caller.
 *
 * @param options {object}
 * @param options.ns {string}
 * @param options.level {LogLevel}
 * @param options.msg {string}
 * @param [options.data] {Record<string, unknown>}
 * @returns {LogEvent}
 */
export function buildLogEvent({
  ns,
  level,
  msg,
  data
}: {
  ns: string
  level: LogLevel
  msg: string
  data?: Record<string, unknown>
}): LogEvent {
  const event: LogEvent = { ts: Date.now(), ns, level, msg }
  if (data !== undefined) {
    try {
      if ('err' in data) {
        event.err = data.err
        const rest: Record<string, unknown> = {}
        for (const key of Object.keys(data)) {
          if (key !== 'err') {
            rest[key] = data[key]
          }
        }
        if (Object.keys(rest).length > 0) {
          event.data = rest
        }
      } else {
        event.data = data
      }
    } catch {
      delete event.err
      event.data = data
    }
  }
  return event
}

/**
 * Dispatches one call to every registered sink. `info`, `warn`, and `error`
 * always dispatch; `debug` is gated on the effective filter. Per-sink
 * dispatch is wrapped per event: a throw drops that event for that sink and
 * is reported once per sink via the raw console; three consecutive throws
 * disable the sink. Dispatch iterates a snapshot of the sink list, and
 * reentrant dispatch from inside a sink is dropped, not queued.
 *
 * @param options {object}
 * @param options.ns {string}
 * @param options.level {LogLevel}
 * @param options.msg {string}
 * @param [options.data] {Record<string, unknown>}
 */
function dispatch({
  ns,
  level,
  msg,
  data
}: {
  ns: string
  level: LogLevel
  msg: string
  data?: Record<string, unknown>
}): void {
  if (dispatching) {
    return
  }
  if (level === 'debug') {
    const filter = effectiveFilter()
    if (filter === null || !matchesFilter({ pattern: filter, ns })) {
      return
    }
  }
  const event = buildLogEvent({ ns, level, msg, data })
  dispatching = true
  try {
    for (const entry of [...sinks]) {
      try {
        entry.sink(event)
        entry.consecutiveThrows = 0
      } catch (err) {
        entry.consecutiveThrows += 1
        if (!entry.reported) {
          entry.reported = true

          console.error(
            '[interop:logger] a sink threw handling a log event; the event was dropped for that sink',
            err
          )
        }
        if (entry.consecutiveThrows >= MAX_CONSECUTIVE_THROWS) {
          const index = sinks.indexOf(entry)
          if (index !== -1) {
            sinks.splice(index, 1)
          }
        }
      }
    }
  } finally {
    dispatching = false
  }
}

/**
 * Returns a logger bound to a namespace. Namespaces are colon-separated
 * lowercase segments, the leading segment identifying the emitting package
 * (e.g. 'fw:session:sweep').
 *
 * @param ns {string}
 * @returns {Logger}
 */
export function createLogger(ns: string): Logger {
  return {
    debug(msg: string, data?: Record<string, unknown>): void {
      dispatch({ ns, level: 'debug', msg, data })
    },
    info(msg: string, data?: Record<string, unknown>): void {
      dispatch({ ns, level: 'info', msg, data })
    },
    warn(msg: string, data?: Record<string, unknown>): void {
      dispatch({ ns, level: 'warn', msg, data })
    },
    error(msg: string, data?: Record<string, unknown>): void {
      dispatch({ ns, level: 'error', msg, data })
    }
  }
}
