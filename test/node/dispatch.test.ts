import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import {
  addSink,
  captureSink,
  configure,
  createLogger,
  setFilter
} from '../../src/index.js'
import type { LogEvent } from '../../src/index.js'

const removers: (() => void)[] = []

function track(remover: () => void): () => void {
  removers.push(remover)
  return remover
}

beforeAll(() => {
  configure({ console: false })
})

afterEach(() => {
  while (removers.length > 0) {
    removers.pop()?.()
  }
  setFilter(null)
  vi.restoreAllMocks()
})

describe('dispatch', () => {
  it('lifts the reserved data.err key to the top-level err field', () => {
    const capture = captureSink()
    track(addSink(capture.sink))
    const err = new Error('boom')
    createLogger('fw:test').warn('failed', { err, spaceId: 'abc' })
    expect(capture.events).toHaveLength(1)
    const event = capture.events[0] as LogEvent
    expect(event.err).toBe(err)
    expect(event.data).toEqual({ spaceId: 'abc' })
    expect(event.ns).toBe('fw:test')
    expect(event.level).toBe('warn')
    expect(event.msg).toBe('failed')
    expect(typeof event.ts).toBe('number')
  })

  it('omits data when err was its only key, and err when absent', () => {
    const capture = captureSink()
    track(addSink(capture.sink))
    const log = createLogger('fw:test')
    log.warn('a', { err: new Error('x') })
    log.warn('b', { spaceId: 'abc' })
    log.warn('c')
    expect(capture.events[0]?.data).toBeUndefined()
    expect(capture.events[1]?.err).toBeUndefined()
    expect(capture.events[1]?.data).toEqual({ spaceId: 'abc' })
    expect(capture.events[2]?.err).toBeUndefined()
    expect(capture.events[2]?.data).toBeUndefined()
  })

  it('fans out to multiple sinks', () => {
    const first = captureSink()
    const second = captureSink()
    track(addSink(first.sink))
    track(addSink(second.sink))
    createLogger('fw:test').info('mark')
    expect(first.events).toHaveLength(1)
    expect(second.events).toHaveLength(1)
  })

  it('drops the event for a throwing sink, keeps the sink, reports once', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let throwNext = true
    const received: LogEvent[] = []
    track(
      addSink(event => {
        if (throwNext) {
          throw new Error('sink broke')
        }
        received.push(event)
      })
    )
    const other = captureSink()
    track(addSink(other.sink))
    const log = createLogger('fw:test')
    log.warn('one')
    expect(other.events).toHaveLength(1)
    expect(received).toHaveLength(0)
    expect(consoleError).toHaveBeenCalledTimes(1)
    throwNext = false
    log.warn('two')
    throwNext = true
    log.warn('three')
    expect(received).toHaveLength(1)
    expect(other.events).toHaveLength(3)
    // reported once per sink, not per throw
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('disables a sink after three consecutive throws; a success resets', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = false
    let deliveries = 0
    track(
      addSink(() => {
        if (shouldThrow) {
          throw new Error('sink broke')
        }
        deliveries += 1
      })
    )
    const other = captureSink()
    track(addSink(other.sink))
    const log = createLogger('fw:test')
    shouldThrow = true
    log.warn('t1')
    log.warn('t2')
    shouldThrow = false
    log.warn('ok')
    expect(deliveries).toBe(1)
    shouldThrow = true
    log.warn('t3')
    log.warn('t4')
    log.warn('t5')
    shouldThrow = false
    log.warn('after-disable')
    expect(deliveries).toBe(1)
    expect(other.events).toHaveLength(7)
  })

  it('iterates a snapshot: a remover firing mid-dispatch skips nothing', () => {
    const second = captureSink()
    let removeSecond: () => void = () => {}
    track(
      addSink(() => {
        removeSecond()
      })
    )
    removeSecond = track(addSink(second.sink))
    const log = createLogger('fw:test')
    log.warn('one')
    expect(second.events).toHaveLength(1)
    log.warn('two')
    expect(second.events).toHaveLength(1)
  })

  it('drops reentrant dispatch from inside a sink', () => {
    const capture = captureSink()
    const log = createLogger('fw:test')
    let reentered = false
    track(
      addSink(() => {
        if (!reentered) {
          reentered = true
          log.warn('inner')
        }
      })
    )
    track(addSink(capture.sink))
    log.warn('outer')
    expect(capture.events).toHaveLength(1)
    expect(capture.events[0]?.msg).toBe('outer')
  })

  it('removers stop delivery', () => {
    const capture = captureSink()
    const remove = addSink(capture.sink)
    const log = createLogger('fw:test')
    log.warn('one')
    remove()
    log.warn('two')
    expect(capture.events).toHaveLength(1)
  })

  it('always dispatches info, warn, and error; debug only behind the filter', () => {
    const capture = captureSink()
    track(addSink(capture.sink))
    const log = createLogger('fw:test')
    log.debug('hidden')
    log.info('i')
    log.warn('w')
    log.error('e')
    expect(capture.events.map(event => event.level)).toEqual([
      'info',
      'warn',
      'error'
    ])
    setFilter('fw:*')
    log.debug('shown')
    expect(capture.events).toHaveLength(4)
    expect(capture.events[3]?.level).toBe('debug')
  })
})
