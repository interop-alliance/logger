import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ndjsonSink } from '../../src/index.js'
import type { LogEvent } from '../../src/index.js'

interface RecordedCall {
  url: string
  body: string
  keepalive: boolean
}

function recordingFetch(): {
  calls: RecordedCall[]
  fetch: typeof globalThis.fetch
} {
  const calls: RecordedCall[] = []
  const fetchImpl = ((url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: String(init?.body ?? ''),
      keepalive: init?.keepalive === true
    })
    return Promise.resolve(new Response(null, { status: 204 }))
  }) as typeof globalThis.fetch
  return { calls, fetch: fetchImpl }
}

function eventOf(overrides: Partial<LogEvent> = {}): LogEvent {
  return { ts: 111, ns: 'fw:test', level: 'warn', msg: 'mark', ...overrides }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ndjsonSink', () => {
  it('batches on the timer', () => {
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({ url: '/logs', flushMs: 500, fetch })
    sink(eventOf({ msg: 'one' }))
    sink(eventOf({ msg: 'two' }))
    expect(calls).toHaveLength(0)
    vi.advanceTimersByTime(499)
    expect(calls).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(calls).toHaveLength(1)
    const lines = (calls[0] as RecordedCall).body
      .split('\n')
      .map(line => JSON.parse(line))
    expect(lines.map(line => line.msg)).toEqual(['one', 'two'])
    expect(calls[0]?.keepalive).toBe(false)
  })

  it('flushes on maxBatch', () => {
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({ url: '/logs', flushMs: 500, maxBatch: 2, fetch })
    sink(eventOf({ msg: 'one' }))
    expect(calls).toHaveLength(0)
    sink(eventOf({ msg: 'two' }))
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(calls).toHaveLength(1)
  })

  it('flushes error-level events immediately', () => {
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({ url: '/logs', flushMs: 500, fetch })
    sink(eventOf({ msg: 'buffered' }))
    sink(eventOf({ level: 'error', msg: 'boom' }))
    expect(calls).toHaveLength(1)
    const lines = (calls[0] as RecordedCall).body
      .split('\n')
      .map(line => JSON.parse(line))
    expect(lines.map(line => line.msg)).toEqual(['buffered', 'boom'])
  })

  it('stamps page and a monotonic seq on every line, across flushes', () => {
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({ url: '/logs', flushMs: 500, fetch })
    sink(eventOf({ level: 'error', msg: 'a' }))
    sink(eventOf({ level: 'error', msg: 'b' }))
    const other = ndjsonSink({ url: '/logs', flushMs: 500, fetch })
    other(eventOf({ level: 'error', msg: 'c' }))
    const lines = calls.map(call => JSON.parse(call.body))
    expect(lines.map(line => line.seq)).toEqual([0, 1, 0])
    expect(typeof lines[0].page).toBe('string')
    expect(lines[0].page.length).toBeGreaterThan(0)
    expect(lines[0].page).toBe(lines[1].page)
    expect(lines[2].page).not.toBe(lines[0].page)
  })

  it('flushes with keepalive on pagehide only, byte-capped under the budget', () => {
    const listeners: Record<string, () => void> = {}
    vi.stubGlobal('addEventListener', (type: string, listener: () => void) => {
      listeners[type] = listener
    })
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({
      url: '/logs',
      flushMs: 60_000,
      maxBatch: 1000,
      fetch
    })
    const filler = 'x'.repeat(10 * 1024)
    for (let index = 0; index < 10; index += 1) {
      sink(eventOf({ msg: 'big', data: { filler, index } }))
    }
    expect(calls).toHaveLength(0)
    listeners.pagehide?.()
    expect(calls).toHaveLength(1)
    const call = calls[0] as RecordedCall
    expect(call.keepalive).toBe(true)
    expect(new TextEncoder().encode(call.body).length).toBeLessThanOrEqual(
      48 * 1024
    )
    expect(call.body.split('\n').length).toBeLessThan(10)
  })

  it('serializes errors, cause chains, and the lifted err field', () => {
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({ url: '/logs', fetch })
    const cause = new Error('root')
    const err = new Error('outer', { cause })
    sink(
      eventOf({ level: 'error', msg: 'failed', err, data: { inner: cause } })
    )
    const line = JSON.parse((calls[0] as RecordedCall).body)
    expect(line.err.name).toBe('Error')
    expect(line.err.message).toBe('outer')
    expect(typeof line.err.stack).toBe('string')
    expect(line.err.cause.message).toBe('root')
    expect(line.data.inner.message).toBe('root')
  })

  it('replaces circular references with [circular]', () => {
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({ url: '/logs', fetch })
    const data: Record<string, unknown> = { label: 'node' }
    data.self = data
    sink(eventOf({ level: 'error', msg: 'looped', data }))
    const line = JSON.parse((calls[0] as RecordedCall).body)
    expect(line.data.label).toBe('node')
    expect(line.data.self).toBe('[circular]')
  })

  it('detects a cycle routed through an Error cause', () => {
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({ url: '/logs', fetch })
    const data: Record<string, unknown> = { label: 'node' }
    const err = new Error('x')
    err.cause = data
    data.failure = err
    sink(eventOf({ level: 'error', msg: 'error-loop', data }))
    const line = JSON.parse((calls[0] as RecordedCall).body)
    expect(line.truncated).toBeUndefined()
    expect(line.msg).toBe('error-loop')
    expect(line.data.label).toBe('node')
    expect(line.data.failure.name).toBe('Error')
    expect(line.data.failure.message).toBe('x')
    expect(line.data.failure.cause).toBe('[circular]')
  })

  it('detects a true cycle sitting beside an Error', () => {
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({ url: '/logs', fetch })
    const data: Record<string, unknown> = { failure: new Error('x') }
    data.self = data
    sink(eventOf({ level: 'error', msg: 'sibling-loop', data }))
    const line = JSON.parse((calls[0] as RecordedCall).body)
    expect(line.truncated).toBeUndefined()
    expect(line.data.failure.message).toBe('x')
    expect(line.data.self).toBe('[circular]')
  })

  it('keeps a repeated (non-circular) reference intact', () => {
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({ url: '/logs', fetch })
    const shared = { id: 'abc' }
    sink(
      eventOf({ level: 'error', msg: 'shared', data: { a: shared, b: shared } })
    )
    const line = JSON.parse((calls[0] as RecordedCall).body)
    expect(line.data.a).toEqual({ id: 'abc' })
    expect(line.data.b).toEqual({ id: 'abc' })
  })

  it('degrades an oversize line to the truncation stub', () => {
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({ url: '/logs', fetch })
    sink(
      eventOf({
        level: 'error',
        msg: 'huge',
        data: { blob: 'y'.repeat(20 * 1024) }
      })
    )
    const line = JSON.parse((calls[0] as RecordedCall).body)
    expect(line).toMatchObject({
      truncated: true,
      ns: 'fw:test',
      level: 'error',
      msg: 'huge'
    })
    expect(line.data).toBeUndefined()
  })

  it('degrades a serialization throw (BigInt, throwing getter) to the stub', () => {
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({ url: '/logs', fetch })
    sink(eventOf({ level: 'error', msg: 'bigint', data: { big: 10n } }))
    const withGetter = {
      get bad(): never {
        throw new Error('getter throws')
      }
    }
    expect(() =>
      sink(eventOf({ level: 'error', msg: 'getter', data: withGetter }))
    ).not.toThrow()
    const lines = calls.map(call => JSON.parse(call.body))
    expect(lines[0]).toMatchObject({ truncated: true, msg: 'bigint' })
    expect(lines[1]).toMatchObject({ truncated: true, msg: 'getter' })
  })

  it('serializes at emit: later mutation of a logged object is not recorded', () => {
    const { calls, fetch } = recordingFetch()
    const sink = ndjsonSink({ url: '/logs', flushMs: 500, fetch })
    const report = { stage: 'roster', failed: 0 }
    sink(eventOf({ msg: 'progress', data: { report } }))
    report.failed = 7
    vi.advanceTimersByTime(500)
    const line = JSON.parse((calls[0] as RecordedCall).body)
    expect(line.data.report).toEqual({ stage: 'roster', failed: 0 })
  })

  it('swallows fetch rejections and synchronous fetch throws', async () => {
    const rejecting = (() =>
      Promise.reject(new Error('server down'))) as typeof globalThis.fetch
    const sink = ndjsonSink({ url: '/logs', fetch: rejecting })
    expect(() => sink(eventOf({ level: 'error', msg: 'boom' }))).not.toThrow()
    await vi.advanceTimersByTimeAsync(10)
    const throwing = (() => {
      throw new Error('no fetch here')
    }) as typeof globalThis.fetch
    const sink2 = ndjsonSink({ url: '/logs', fetch: throwing })
    expect(() => sink2(eventOf({ level: 'error', msg: 'boom' }))).not.toThrow()
  })
})
