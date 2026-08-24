/*!
 * Copyright (c) 2026 Interop Alliance. All rights reserved.
 */

/**
 * The NDJSON dev sink: buffers serialized lines and flushes them as one
 * POST of newline-delimited JSON -- on a timer, on a full batch, on
 * `pagehide`, and immediately for error-level events. Delivery is
 * fire-and-forget and failure-silent. Every line carries a sink-stamped
 * per-page id and a monotonic per-page sequence counter.
 */
import { byteLengthOf, serializeLine } from './serialize.js'
import type { LogEvent, Sink } from './core.js'

/**
 * The pagehide flush rides `keepalive: true`, whose batch must stay safely
 * under the fetch spec's 64 KiB shared keepalive budget.
 */
const KEEPALIVE_BUDGET_BYTES = 48 * 1024

/**
 * Creates the NDJSON sink.
 *
 * @param options {object}
 * @param options.url {string}
 * @param [options.flushMs] {number}
 * @param [options.maxBatch] {number}
 * @param [options.fetch] {typeof globalThis.fetch}
 * @returns {Sink}
 */
export function ndjsonSink(options: {
  url: string
  flushMs?: number
  maxBatch?: number
  fetch?: typeof globalThis.fetch
}): Sink {
  const { url, flushMs = 500, maxBatch = 50 } = options
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis)
  const page = Math.random().toString(36).slice(2, 10)
  let seq = 0
  let lines: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  function post({
    body,
    keepalive
  }: {
    body: string
    keepalive: boolean
  }): void {
    if (fetchImpl === undefined) {
      return
    }
    try {
      const result = fetchImpl(
        url,
        keepalive
          ? { method: 'POST', body, keepalive: true }
          : { method: 'POST', body }
      )
      void Promise.resolve(result).catch(() => {
        // fire-and-forget: a dead dev server must not throw the sink out
      })
    } catch {
      // a synchronously throwing fetch must not escape the sink
    }
  }

  function flush({ keepalive = false }: { keepalive?: boolean } = {}): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (lines.length === 0) {
      return
    }
    if (keepalive) {
      // Byte-cap the keepalive batch; what does not fit stays buffered (lost
      // with the page on a real unload -- the stated loss window).
      const batch: string[] = []
      let bytes = 0
      while (lines.length > 0) {
        const nextBytes = byteLengthOf(lines[0] as string) + 1
        if (batch.length > 0 && bytes + nextBytes > KEEPALIVE_BUDGET_BYTES) {
          break
        }
        batch.push(lines.shift() as string)
        bytes += nextBytes
      }
      post({ body: batch.join('\n'), keepalive: true })
      return
    }
    const body = lines.join('\n')
    lines = []
    post({ body, keepalive: false })
  }

  const listenerTarget = globalThis as {
    addEventListener?: (type: string, listener: () => void) => void
  }
  if (typeof listenerTarget.addEventListener === 'function') {
    listenerTarget.addEventListener('pagehide', function onPagehide(): void {
      flush({ keepalive: true })
    })
  }

  return function sink(event: LogEvent): void {
    // Serialize at emit, not at flush: the file must record the state the
    // caller logged, not what a mutated object holds later.
    lines.push(serializeLine({ event, page, seq }))
    seq += 1
    if (event.level === 'error' || lines.length >= maxBatch) {
      flush()
      return
    }
    if (timer === null) {
      timer = setTimeout(function onFlushTimer(): void {
        timer = null
        flush()
      }, flushMs)
      ;(timer as { unref?: () => void }).unref?.()
    }
  }
}
