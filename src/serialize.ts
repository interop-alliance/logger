/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */

/**
 * Event serialization for the NDJSON sink: Error values (the lifted `err`,
 * values in `data`, and `cause` chains) serialize to
 * `{ name, message, stack, cause? }`, circular references replace with
 * "[circular]", and a line that is too long or whose serialization throws
 * degrades to a `{ truncated: true, ns, level, msg }` stub.
 */
import type { LogEvent } from './core.js'

const MAX_LINE_BYTES = 16 * 1024
const byteEncoder = new TextEncoder()

/**
 * Returns the UTF-8 byte length of a string.
 *
 * @param value {string}
 * @returns {number}
 */
export function byteLengthOf(value: string): number {
  return byteEncoder.encode(value).length
}

/**
 * A JSON.stringify replacer that converts Error values to
 * `{ name, message, stack, cause? }` records and replaces circular
 * references with "[circular]". Ancestor tracking rides the depth-first
 * order of JSON.stringify. An Error converts SHALLOWLY -- its `cause` stays
 * a live reference for the walk to visit -- and the converted record is
 * tracked under its source Error, so a cycle routed through an Error (a
 * `cause` pointing back into the graph, or an Error in its own cause
 * chain) is detected like any other, while legitimate repeated
 * non-ancestor references are preserved verbatim.
 *
 * @returns {(key: string, value: unknown) => unknown}
 */
function circularReplacer(): (
  this: unknown,
  key: string,
  value: unknown
) => unknown {
  const ancestors: unknown[] = []
  const sourceErrorFor = new WeakMap<object, Error>()
  return function replace(this: unknown, key: string, value: unknown): unknown {
    let output = value
    if (value instanceof Error) {
      const record: Record<string, unknown> = {
        name: value.name,
        message: value.message
      }
      if (value.stack !== undefined) {
        record.stack = value.stack
      }
      if (value.cause !== undefined) {
        record.cause = value.cause
      }
      sourceErrorFor.set(record, value)
      output = record
    }
    if (typeof output !== 'object' || output === null) {
      return output
    }
    // The holder of the value being visited: for children of a converted
    // Error record, normalize back to the source Error the ancestors
    // stack tracks.
    const holder =
      typeof this === 'object' && this !== null
        ? (sourceErrorFor.get(this) ?? this)
        : this
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== holder) {
      ancestors.pop()
    }
    const identity = value instanceof Error ? value : output
    if (ancestors.includes(identity)) {
      return '[circular]'
    }
    ancestors.push(identity)
    return output
  }
}

/**
 * Serializes one event to an NDJSON line carrying the sink-stamped `page`
 * and `seq` fields. Serialization happens at emit, so a caller that keeps
 * mutating a logged object cannot rewrite the recorded state. A line longer
 * than 16 KiB, or one whose serialization throws (a throwing getter, a
 * BigInt), degrades to the truncation stub.
 *
 * @param options {object}
 * @param options.event {LogEvent}
 * @param options.page {string}
 * @param options.seq {number}
 * @returns {string}
 */
export function serializeLine({
  event,
  page,
  seq
}: {
  event: LogEvent
  page: string
  seq: number
}): string {
  const { ns, level, msg } = event
  const stub = (): string =>
    JSON.stringify({ truncated: true, ns, level, msg, page, seq })
  let line: string
  try {
    line = JSON.stringify(
      {
        ts: event.ts,
        ns,
        level,
        msg,
        err: event.err,
        data: event.data,
        page,
        seq
      },
      circularReplacer()
    )
  } catch {
    return stub()
  }
  if (byteLengthOf(line) > MAX_LINE_BYTES) {
    return stub()
  }
  return line
}
