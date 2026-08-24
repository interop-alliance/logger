import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import {
  addSink,
  captureSink,
  configure,
  createLogger,
  setFilter
} from '../../src/index.js'

const capture = captureSink()
let remove: (() => void) | null = null

beforeAll(() => {
  configure({ console: false })
  remove = addSink(capture.sink)
})

afterEach(() => {
  capture.clear()
  setFilter(null)
  configure({ filter: null })
})

function debugDispatched(ns: string): boolean {
  const before = capture.events.length
  createLogger(ns).debug('probe')
  return capture.events.length > before
}

describe('the wildcard filter', () => {
  it('no filter means no debug', () => {
    expect(debugDispatched('fw:session:sweep')).toBe(false)
  })

  it('matches exactly', () => {
    setFilter('fw:session:sweep')
    expect(debugDispatched('fw:session:sweep')).toBe(true)
    expect(debugDispatched('fw:session')).toBe(false)
    expect(debugDispatched('fw:session:sweep:extra')).toBe(false)
  })

  it('* matches any suffix', () => {
    setFilter('fw:*')
    expect(debugDispatched('fw:session:sweep')).toBe(true)
    expect(debugDispatched('fw:sync')).toBe(true)
    expect(debugDispatched('wc:recovery')).toBe(false)
  })

  it('bare * matches everything', () => {
    setFilter('*')
    expect(debugDispatched('fw:session')).toBe(true)
    expect(debugDispatched('wc:recovery')).toBe(true)
  })

  it('a - prefix negates', () => {
    setFilter('fw:session:*,-fw:session:noise')
    expect(debugDispatched('fw:session:sweep')).toBe(true)
    expect(debugDispatched('fw:session:noise')).toBe(false)
  })

  it('a negation wins over a match', () => {
    setFilter('*,-fw:*')
    expect(debugDispatched('wc:recovery')).toBe(true)
    expect(debugDispatched('fw:session')).toBe(false)
  })

  it('comma lists match any entry', () => {
    setFilter('fw:sync:*,wc:recovery')
    expect(debugDispatched('fw:sync:pull')).toBe(true)
    expect(debugDispatched('wc:recovery')).toBe(true)
    expect(debugDispatched('fw:session')).toBe(false)
  })

  it('info, warn, and error dispatch regardless of the filter', () => {
    setFilter('nothing:matches')
    const log = createLogger('fw:session')
    log.info('i')
    log.warn('w')
    log.error('e')
    expect(capture.events).toHaveLength(3)
  })

  it('configure({ filter }) supplies the filter below the runtime override', () => {
    configure({ filter: 'fw:*' })
    expect(debugDispatched('fw:session')).toBe(true)
    setFilter('wc:*')
    expect(debugDispatched('fw:session')).toBe(false)
    expect(debugDispatched('wc:recovery')).toBe(true)
    setFilter(null)
    expect(debugDispatched('fw:session')).toBe(true)
  })

  it('remove sink cleanup', () => {
    expect(remove).not.toBeNull()
  })
})
