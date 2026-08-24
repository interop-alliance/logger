import { describe, it, expect } from 'vitest'
import { captureLogger, captureSink, ringBufferSink } from '../../src/index.js'
import type { LogEvent } from '../../src/index.js'

describe('ringBufferSink', () => {
  it('keeps events in order below capacity', () => {
    const ring = ringBufferSink(5)
    for (let index = 0; index < 3; index += 1) {
      ring.sink({ ts: index, ns: 'fw:test', level: 'info', msg: `m${index}` })
    }
    expect(ring.snapshot().map(event => event.msg)).toEqual(['m0', 'm1', 'm2'])
  })

  it('overwrites the oldest at capacity', () => {
    const ring = ringBufferSink(3)
    for (let index = 0; index < 5; index += 1) {
      ring.sink({ ts: index, ns: 'fw:test', level: 'info', msg: `m${index}` })
    }
    expect(ring.snapshot().map(event => event.msg)).toEqual(['m2', 'm3', 'm4'])
  })

  it('clear empties the buffer and it refills cleanly', () => {
    const ring = ringBufferSink(3)
    ring.sink({ ts: 0, ns: 'fw:test', level: 'info', msg: 'old' })
    ring.clear()
    expect(ring.snapshot()).toEqual([])
    ring.sink({ ts: 1, ns: 'fw:test', level: 'info', msg: 'new' })
    expect(ring.snapshot().map(event => event.msg)).toEqual(['new'])
  })

  it('snapshot returns a copy', () => {
    const ring = ringBufferSink(3)
    ring.sink({ ts: 0, ns: 'fw:test', level: 'info', msg: 'one' })
    const snapshot = ring.snapshot()
    snapshot.pop()
    expect(ring.snapshot()).toHaveLength(1)
  })
})

describe('captureSink', () => {
  it('records events structurally and clears', () => {
    const capture = captureSink()
    const event: LogEvent = { ts: 1, ns: 'fw:test', level: 'warn', msg: 'x' }
    capture.sink(event)
    expect(capture.events).toEqual([event])
    capture.clear()
    expect(capture.events).toEqual([])
  })
})

describe('captureLogger', () => {
  it('records structured events with the err lift, debug included', () => {
    const { logger, events } = captureLogger('wc')
    const err = new Error('boom')
    logger.debug('fine-grained')
    logger.warn('could not seal', { err, epoch: 3 })
    expect(events).toHaveLength(2)
    expect(events[0]?.level).toBe('debug')
    expect(events[0]?.ns).toBe('wc')
    expect(events[1]?.err).toBe(err)
    expect(events[1]?.data).toEqual({ epoch: 3 })
  })
})
