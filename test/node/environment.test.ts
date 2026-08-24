import { describe, it, expect, afterEach, vi } from 'vitest'
import type { Logger } from '../../src/index.js'

interface Seam {
  addSink: typeof import('../../src/index.js').addSink
  captureSink: typeof import('../../src/index.js').captureSink
  configure: typeof import('../../src/index.js').configure
  createLogger: (ns: string) => Logger
}

async function freshSeam(): Promise<Seam> {
  vi.resetModules()
  return (await import('../../src/index.js')) as unknown as Seam
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  vi.resetModules()
})

describe('environment guards', () => {
  it('reads the localStorage filter key once, lazily, and never writes it', async () => {
    let reads = 0
    const setItem = vi.fn()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem(key: string): string | null {
          reads += 1
          return key === 'interop:logger' ? 'fw:*' : null
        },
        setItem
      }
    })
    const seam = await freshSeam()
    seam.configure({ console: false })
    const capture = seam.captureSink()
    seam.addSink(capture.sink)
    const log = seam.createLogger('fw:session')
    expect(reads).toBe(0)
    log.debug('one')
    log.debug('two')
    seam.createLogger('wc:other').debug('three')
    expect(reads).toBe(1)
    expect(capture.events.map(event => event.msg)).toEqual(['one', 'two'])
    expect(setItem).not.toHaveBeenCalled()
  })

  it('loads and logs when localStorage access throws', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get(): never {
        throw new Error('storage blocked')
      }
    })
    const seam = await freshSeam()
    seam.configure({ console: false })
    const capture = seam.captureSink()
    seam.addSink(capture.sink)
    const log = seam.createLogger('fw:session')
    expect(() => log.debug('hidden')).not.toThrow()
    expect(() => log.warn('still logs')).not.toThrow()
    expect(capture.events.map(event => event.msg)).toEqual(['still logs'])
  })

  it('loads and logs with no window and no localStorage (plain Node)', async () => {
    expect((globalThis as { window?: unknown }).window).toBeUndefined()
    const seam = await freshSeam()
    seam.configure({ console: false })
    const capture = seam.captureSink()
    seam.addSink(capture.sink)
    seam.createLogger('fw:session').warn('works')
    expect(capture.events).toHaveLength(1)
  })
})
