import { describe, it, expect, afterEach, vi } from 'vitest'
import { configure, createLogger } from '../../src/index.js'

afterEach(() => {
  configure({ console: true })
  vi.restoreAllMocks()
})

describe('the default console sink', () => {
  it('is installed by default and maps level onto the console method', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const err = new Error('boom')
    createLogger('fw:test').warn('failed', { err, spaceId: 'abc' })
    expect(warn).toHaveBeenCalledWith('[%s] %s', 'fw:test', 'failed', err, {
      spaceId: 'abc'
    })
  })

  it('passes empty strings for absent err and data', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    createLogger('fw:test').info('mark')
    expect(info).toHaveBeenCalledWith('[%s] %s', 'fw:test', 'mark', '', '')
  })

  it('configure({ console: false }) removes it; true reinstalls, once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    configure({ console: false })
    createLogger('fw:test').warn('silent')
    expect(warn).not.toHaveBeenCalled()
    configure({ console: true })
    configure({ console: true })
    createLogger('fw:test').warn('loud')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('configure({ console: true }) reinstalls after an auto-disable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('console broke')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = createLogger('fw:test')
    log.warn('one')
    log.warn('two')
    log.warn('three')
    warn.mockImplementation(() => {})
    log.warn('dropped: the sink was disabled at the third throw')
    expect(warn).toHaveBeenCalledTimes(3)
    configure({ console: true })
    log.warn('loud again')
    expect(warn).toHaveBeenCalledTimes(4)
  })

  it('configure merges: a later filter change does not undo console: false', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    configure({ console: false })
    configure({ filter: 'fw:*' })
    createLogger('fw:test').warn('silent')
    expect(warn).not.toHaveBeenCalled()
    configure({ filter: null })
  })
})
