/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */

/**
 * The in-memory ring-buffer sink: keeps the most recent events, overwriting
 * the oldest at capacity. The dev handle over a browser session's recent
 * structured history.
 */
import type { LogEvent, Sink } from './core.js'

/**
 * Creates a ring-buffer sink.
 *
 * @param [capacity] {number}
 * @returns {{ sink: Sink, snapshot: () => LogEvent[], clear: () => void }}
 */
export function ringBufferSink(capacity: number = 500): {
  sink: Sink
  snapshot: () => LogEvent[]
  clear: () => void
} {
  const buffer: (LogEvent | undefined)[] = new Array(capacity)
  let next = 0
  let size = 0
  return {
    sink(event: LogEvent): void {
      buffer[next] = event
      next = (next + 1) % capacity
      if (size < capacity) {
        size += 1
      }
    },
    snapshot(): LogEvent[] {
      const events: LogEvent[] = []
      const first = (next - size + capacity) % capacity
      for (let offset = 0; offset < size; offset += 1) {
        events.push(buffer[(first + offset) % capacity] as LogEvent)
      }
      return events
    },
    clear(): void {
      buffer.fill(undefined)
      next = 0
      size = 0
    }
  }
}
